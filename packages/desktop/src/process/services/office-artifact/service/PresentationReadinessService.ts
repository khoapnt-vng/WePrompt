/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-await-in-loop -- bounded reads, writes, and slide renders must preserve exact order */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import type {
  PresentationArtifactIdentity,
  PresentationReadinessBlocker,
  PresentationReadinessBlockerCode,
  PresentationReadinessEvidence,
  PresentationReadinessOoxmlEvidence,
  PresentationSlideRenderEvidence,
} from '@/common/types/office/artifactReadiness';

import type { OfficeCliRenderRunner, OfficeCliRunner } from '../officeCliRunner';
import type { PptxOoxmlInspection } from './pptxOoxmlInspector';
import { inspectPresentationReadiness } from './presentationReadinessInspector';

export type PresentationReadinessCandidateReader = {
  readonly byteLength: number;
  readonly readAt: (position: number, length: number) => Promise<Buffer>;
};

export type PresentationReadinessRetentionProof = {
  readonly stagingBeforeRetain: string;
  readonly retainedTemp: string;
  readonly stagingAfterRetain: string;
};

export type PresentationReadinessServiceRequest = {
  readonly runId: string;
  readonly candidate: PresentationReadinessCandidateReader;
  readonly expectedCandidate: PresentationArtifactIdentity;
  readonly retentionProof: PresentationReadinessRetentionProof;
  readonly planBytes: Uint8Array;
  readonly knownSourceRefs: readonly string[];
};

export type PresentationInspectionWorkspace = {
  readonly directory: string;
  readonly dispose: () => Promise<void>;
};

export type PresentationReadinessServiceLimits = {
  readonly maxCandidateBytes: number;
  readonly maxRenderBytesPerSlide: number;
  readonly maxRenderBytesTotal: number;
  readonly copyChunkBytes: number;
};

export type PresentationReadinessServiceDependencies = {
  readonly runner: Pick<OfficeCliRunner, 'validate'> & OfficeCliRenderRunner;
  readonly inspectOoxml: (filePath: string) => Promise<PptxOoxmlInspection>;
  readonly createInspectionWorkspace: (runId: string) => Promise<PresentationInspectionWorkspace>;
  readonly limits?: Partial<PresentationReadinessServiceLimits>;
};

export type PresentationReadinessServiceResult =
  | { readonly ok: true; readonly evidence: PresentationReadinessEvidence }
  | { readonly ok: false; readonly blockers: readonly PresentationReadinessBlocker[] };

type FileIdentity = PresentationArtifactIdentity & {
  readonly device: bigint;
  readonly inode: bigint;
  readonly ctimeNs: bigint;
};

type ReadinessFailureOptions = {
  readonly code: PresentationReadinessBlockerCode;
  readonly slideNumber?: number | null;
};

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IHDR_BYTE_LENGTH = 13;
const PNG_MAX_DIMENSION = 32_768;
const PNG_MAX_INFLATED_BYTES = 128 * 1_024 * 1_024;
const DEFAULT_COPY_CHUNK_BYTES = 1024 * 1024;

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

let renderQueueTail = Promise.resolve();

class ReadinessFailure extends Error {
  readonly blocker: PresentationReadinessBlocker;

  constructor({ code, slideNumber = null }: ReadinessFailureOptions) {
    super(code);
    this.name = 'ReadinessFailure';
    this.blocker = Object.freeze({ code, slideNumber });
  }
}

function fail(code: PresentationReadinessBlockerCode, slideNumber: number | null = null): never {
  throw new ReadinessFailure({ code, slideNumber });
}

function requireComparableCtimeNs(value: unknown, slideNumber: number | null = null): bigint {
  if (typeof value !== 'bigint' || value <= BigInt(0)) fail('EVIDENCE_MISSING', slideNumber);
  return value;
}

function failureResult(...blockers: readonly PresentationReadinessBlocker[]): PresentationReadinessServiceResult {
  return Object.freeze({
    ok: false,
    blockers: Object.freeze(blockers.map((item) => Object.freeze({ ...item }))),
  });
}

function blocker(
  code: PresentationReadinessBlockerCode,
  slideNumber: number | null = null
): PresentationReadinessBlocker {
  return { code, slideNumber };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function hashBytes(bytes: Uint8Array): PresentationArtifactIdentity {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  };
}

function isSafeLength(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function pngCrc32(type: Buffer, data: Buffer): number {
  let crc = 0xffffffff;
  for (const bytes of [type, data]) {
    for (const byte of bytes) crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngBitsPerPixel(bitDepth: number, colorType: number): number | null {
  if (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) return bitDepth;
  if (colorType === 2 && [8, 16].includes(bitDepth)) return bitDepth * 3;
  if (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) return bitDepth;
  if (colorType === 4 && [8, 16].includes(bitDepth)) return bitDepth * 2;
  if (colorType === 6 && [8, 16].includes(bitDepth)) return bitDepth * 4;
  return null;
}

type PngPass = readonly [startX: number, startY: number, stepX: number, stepY: number];

function pngPasses(interlace: number): readonly PngPass[] {
  if (interlace === 0) return [[0, 0, 1, 1]];
  return [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ];
}

function passLength(size: number, start: number, step: number): number {
  return size <= start ? 0 : Math.ceil((size - start) / step);
}

function validateInflatedPng(
  compressed: Buffer,
  width: number,
  height: number,
  bitsPerPixel: number,
  interlace: number,
  maximumFileBytes: number
): boolean {
  const rows: Array<{ count: number; byteLength: number }> = [];
  let expectedByteLength = 0;
  const maximumInflatedBytes = Math.min(PNG_MAX_INFLATED_BYTES, maximumFileBytes * 4);

  for (const [startX, startY, stepX, stepY] of pngPasses(interlace)) {
    const passWidth = passLength(width, startX, stepX);
    const passHeight = passLength(height, startY, stepY);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowByteLength = Math.ceil((passWidth * bitsPerPixel) / 8);
    const passByteLength = passHeight * (rowByteLength + 1);
    if (!Number.isSafeInteger(passByteLength) || expectedByteLength + passByteLength > maximumInflatedBytes) {
      return false;
    }
    rows.push({ count: passHeight, byteLength: rowByteLength });
    expectedByteLength += passByteLength;
  }
  if (expectedByteLength <= 0) return false;

  let inflated: Buffer;
  try {
    const result = inflateSync(compressed, {
      maxOutputLength: expectedByteLength,
      info: true,
    }) as unknown as { readonly buffer: Buffer; readonly engine: { readonly bytesWritten: number } };
    inflated = result.buffer;
    if (result.engine.bytesWritten !== compressed.byteLength) return false;
  } catch {
    return false;
  }
  if (inflated.byteLength !== expectedByteLength) return false;

  let position = 0;
  for (const row of rows) {
    for (let index = 0; index < row.count; index += 1) {
      if (inflated[position] === undefined || inflated[position]! > 4) return false;
      position += row.byteLength + 1;
    }
  }
  return position === inflated.byteLength;
}

function isCompletePng(bytes: Buffer, maximumFileBytes: number): boolean {
  if (
    bytes.byteLength < PNG_SIGNATURE.byteLength ||
    !bytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
  ) {
    return false;
  }

  let position = PNG_SIGNATURE.byteLength;
  let width = 0;
  let height = 0;
  let bitsPerPixel: number | null = null;
  let colorType = -1;
  let interlace = -1;
  let sawHeader = false;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataClosed = false;
  let sawEnd = false;
  const imageData: Buffer[] = [];

  while (position < bytes.byteLength) {
    if (bytes.byteLength - position < 12) return false;
    const chunkLength = bytes.readUInt32BE(position);
    const typeStart = position + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + chunkLength;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.byteLength) return false;

    const typeBytes = bytes.subarray(typeStart, dataStart);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    const data = bytes.subarray(dataStart, dataEnd);
    if (pngCrc32(typeBytes, data) !== bytes.readUInt32BE(dataEnd)) return false;
    if (sawImageData && type !== 'IDAT') imageDataClosed = true;

    if (type === 'IHDR') {
      if (sawHeader || position !== PNG_SIGNATURE.byteLength || chunkLength !== PNG_IHDR_BYTE_LENGTH) return false;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8]!;
      colorType = data[9]!;
      bitsPerPixel = pngBitsPerPixel(bitDepth, colorType);
      interlace = data[12]!;
      if (
        width <= 0 ||
        height <= 0 ||
        width > PNG_MAX_DIMENSION ||
        height > PNG_MAX_DIMENSION ||
        bitsPerPixel === null ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        (interlace !== 0 && interlace !== 1)
      ) {
        return false;
      }
      sawHeader = true;
    } else if (type === 'PLTE') {
      if (!sawHeader || sawPalette || sawImageData || chunkLength === 0 || chunkLength > 768 || chunkLength % 3 !== 0) {
        return false;
      }
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (!sawHeader || imageDataClosed || chunkLength === 0) return false;
      sawImageData = true;
      imageData.push(data);
    } else if (type === 'IEND') {
      if (!sawHeader || !sawImageData || sawEnd || chunkLength !== 0 || chunkEnd !== bytes.byteLength) return false;
      sawEnd = true;
    } else if ((typeBytes[0]! & 0x20) === 0) {
      return false;
    }

    position = chunkEnd;
  }

  if (!sawEnd || bitsPerPixel === null || (colorType === 3 && !sawPalette)) return false;
  return validateInflatedPng(Buffer.concat(imageData), width, height, bitsPerPixel, interlace, maximumFileBytes);
}

function resolveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function resolveLimits(
  overrides: Partial<PresentationReadinessServiceLimits> | undefined
): PresentationReadinessServiceLimits {
  return Object.freeze({
    maxCandidateBytes: resolveLimit(
      overrides?.maxCandidateBytes,
      PRESENTATION_RUN_LIMITS.MAX_CANDIDATE_COMPRESSED_BYTES
    ),
    maxRenderBytesPerSlide: resolveLimit(
      overrides?.maxRenderBytesPerSlide,
      PRESENTATION_RUN_LIMITS.MAX_RENDER_BYTES_PER_SLIDE
    ),
    maxRenderBytesTotal: resolveLimit(overrides?.maxRenderBytesTotal, PRESENTATION_RUN_LIMITS.MAX_RENDER_BYTES_TOTAL),
    copyChunkBytes: resolveLimit(overrides?.copyChunkBytes, DEFAULT_COPY_CHUNK_BYTES),
  });
}

function isTimedOut(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === 'ETIMEDOUT') return true;
  return 'name' in error && error.name === 'TimeoutError';
}

function ensureExpectedEvidence(request: PresentationReadinessServiceRequest): PresentationReadinessBlocker | null {
  const proofHashes = [
    request.retentionProof.stagingBeforeRetain,
    request.retentionProof.retainedTemp,
    request.retentionProof.stagingAfterRetain,
  ];
  if (
    !UUID_RE.test(request.runId) ||
    !SHA256_RE.test(request.expectedCandidate.sha256) ||
    !isSafeLength(request.expectedCandidate.byteLength) ||
    proofHashes.some((hash) => !SHA256_RE.test(hash))
  ) {
    return blocker('EVIDENCE_MISSING');
  }
  if (proofHashes.some((hash) => hash !== request.expectedCandidate.sha256)) return blocker('EVIDENCE_STALE');
  return null;
}

async function withGlobalRenderLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = renderQueueTail;
  let release!: () => void;
  renderQueueTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function readCandidate(
  reader: PresentationReadinessCandidateReader,
  expectedByteLength: number,
  chunkBytes: number,
  consume?: (chunk: Buffer, position: number) => Promise<void>
): Promise<PresentationArtifactIdentity> {
  if (reader.byteLength !== expectedByteLength) fail('HASH_MISMATCH');

  const hash = createHash('sha256');
  let position = 0;
  while (position < expectedByteLength) {
    const length = Math.min(chunkBytes, expectedByteLength - position);
    let chunk: Buffer;
    try {
      chunk = await reader.readAt(position, length);
    } catch {
      return fail('HASH_MISMATCH');
    }
    if (!Buffer.isBuffer(chunk) || chunk.byteLength !== length) fail('HASH_MISMATCH');
    hash.update(chunk);
    if (consume) await consume(chunk, position);
    position += length;
  }

  if (reader.byteLength !== expectedByteLength) fail('HASH_MISMATCH');
  return { sha256: hash.digest('hex'), byteLength: position };
}

async function writeInspectionCopy(
  filePath: string,
  reader: PresentationReadinessCandidateReader,
  expectedByteLength: number,
  chunkBytes: number
): Promise<FileIdentity> {
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(filePath, flags, 0o600);
  try {
    const identity = await readCandidate(reader, expectedByteLength, chunkBytes, async (chunk, position) => {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, position + offset);
        if (bytesWritten <= 0) fail('HASH_MISMATCH');
        offset += bytesWritten;
      }
    });
    await handle.chmod(0o600);
    const opened = await handle.stat({ bigint: true });
    const ctimeNs = requireComparableCtimeNs(opened.ctimeNs);
    let linked: Awaited<ReturnType<typeof lstat>>;
    try {
      linked = await lstat(filePath);
    } catch {
      return fail('HASH_MISMATCH');
    }
    if (
      !opened.isFile() ||
      opened.nlink !== BigInt(1) ||
      opened.size !== BigInt(identity.byteLength) ||
      !linked.isFile() ||
      linked.isSymbolicLink() ||
      linked.nlink !== 1 ||
      !sameOpenFile(linked, opened)
    ) {
      fail('HASH_MISMATCH');
    }
    return { ...identity, device: opened.dev, inode: opened.ino, ctimeNs };
  } finally {
    await handle.close();
  }
}

function sameOpenFile(
  linked: Awaited<ReturnType<typeof lstat>>,
  opened: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>
): boolean {
  return BigInt(linked.dev) === BigInt(opened.dev) && BigInt(linked.ino) === BigInt(opened.ino);
}

async function inspectRegularFile(
  filePath: string,
  missingCode: PresentationReadinessBlockerCode,
  slideNumber: number | null,
  maximumBytes: number,
  requirePng: boolean,
  limitCode: PresentationReadinessBlockerCode = 'RENDER_LIMIT_EXCEEDED'
): Promise<FileIdentity> {
  let linked: Awaited<ReturnType<typeof lstat>>;
  try {
    linked = await lstat(filePath);
  } catch {
    return fail(missingCode, slideNumber);
  }
  if (!linked.isFile() || linked.isSymbolicLink() || linked.nlink !== 1 || !isSafeLength(linked.size)) {
    fail(missingCode, slideNumber);
  }
  if (linked.size > maximumBytes) fail(limitCode, slideNumber);

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return fail(missingCode, slideNumber);
  }

  try {
    if (requirePng) {
      try {
        await handle.chmod(0o600);
      } catch {
        return fail(missingCode, slideNumber);
      }
    }
    const before = await handle.stat({ bigint: true });
    const beforeCtimeNs = requireComparableCtimeNs(before.ctimeNs, slideNumber);
    if (!before.isFile() || before.nlink !== BigInt(1) || !sameOpenFile(linked, before)) {
      fail(missingCode, slideNumber);
    }
    if (before.size > BigInt(maximumBytes)) fail(limitCode, slideNumber);
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) fail(missingCode, slideNumber);

    const hash = createHash('sha256');
    let position = 0;
    const byteLength = Number(before.size);
    const pngBytes = requirePng ? Buffer.allocUnsafe(byteLength) : null;
    const buffer = Buffer.allocUnsafe(Math.min(DEFAULT_COPY_CHUNK_BYTES, Math.max(byteLength, 1)));
    while (position < byteLength) {
      const length = Math.min(buffer.byteLength, byteLength - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead <= 0) fail(missingCode, slideNumber);
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (pngBytes) chunk.copy(pngBytes, position);
      position += bytesRead;
    }

    const after = await handle.stat({ bigint: true });
    const afterCtimeNs = requireComparableCtimeNs(after.ctimeNs, slideNumber);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      afterCtimeNs !== beforeCtimeNs
    ) {
      fail('HASH_MISMATCH', slideNumber);
    }
    if (pngBytes && !isCompletePng(pngBytes, maximumBytes)) {
      fail('RENDER_MISSING', slideNumber);
    }

    return {
      sha256: hash.digest('hex'),
      byteLength,
      device: before.dev,
      inode: before.ino,
      ctimeNs: beforeCtimeNs,
    };
  } finally {
    await handle.close();
  }
}

async function ensurePrivateWorkspace(directory: string): Promise<void> {
  if (!path.isAbsolute(directory)) fail('OOXML_UNSAFE');
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(directory);
  } catch {
    return fail('OOXML_UNSAFE');
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail('OOXML_UNSAFE');
  await chmod(directory, 0o700);
}

async function assertCandidateIdentity(
  reader: PresentationReadinessCandidateReader,
  expected: PresentationArtifactIdentity,
  chunkBytes: number
): Promise<string> {
  const observed = await readCandidate(reader, expected.byteLength, chunkBytes);
  if (observed.sha256 !== expected.sha256 || observed.byteLength !== expected.byteLength) fail('HASH_MISMATCH');
  return observed.sha256;
}

async function assertInspectionCopy(filePath: string, expected: FileIdentity): Promise<string> {
  const observed = await inspectRegularFile(
    filePath,
    'HASH_MISMATCH',
    null,
    expected.byteLength,
    false,
    'HASH_MISMATCH'
  );
  if (
    observed.sha256 !== expected.sha256 ||
    observed.byteLength !== expected.byteLength ||
    observed.device !== expected.device ||
    observed.inode !== expected.inode ||
    observed.ctimeNs !== expected.ctimeNs
  ) {
    fail('HASH_MISMATCH');
  }
  return observed.sha256;
}

function toOoxmlEvidence(inspection: PptxOoxmlInspection): PresentationReadinessOoxmlEvidence {
  return {
    zipEntryCount: inspection.zipEntryCount,
    expandedByteLength: inspection.expandedByteLength,
    xmlByteLength: inspection.xmlByteLength,
    slideCount: inspection.slideCount,
    totalTextChars: inspection.totalTextChars,
    slides: inspection.slides.map((slide) => ({
      slideNumber: slide.slideNumber,
      shapeCount: slide.shapeCount,
      textCharCount: slide.textCharCount,
      textOnlyShapeCount: slide.textOnlyShapeCount,
      notesTextCharCount: slide.notesTextCharCount,
      visualAnchorKinds: [...slide.visualAnchorKinds],
    })),
  };
}

/**
 * Builds path-free, exact-hash presentation evidence. This service is pure with
 * respect to run state: it neither persists evidence nor grants any lifecycle action.
 */
export class PresentationReadinessService {
  private readonly limits: PresentationReadinessServiceLimits;

  constructor(private readonly dependencies: PresentationReadinessServiceDependencies) {
    this.limits = resolveLimits(dependencies.limits);
  }

  async inspect(request: PresentationReadinessServiceRequest): Promise<PresentationReadinessServiceResult> {
    const evidenceBlocker = ensureExpectedEvidence(request);
    if (evidenceBlocker) return failureResult(evidenceBlocker);
    if (request.expectedCandidate.byteLength > this.limits.maxCandidateBytes) {
      return failureResult(blocker('OOXML_UNSAFE'));
    }
    if (request.candidate.byteLength !== request.expectedCandidate.byteLength) {
      return failureResult(blocker('HASH_MISMATCH'));
    }

    const expectedCandidate = Object.freeze({ ...request.expectedCandidate });
    const retentionProof = Object.freeze({ ...request.retentionProof });
    const planBytes = Buffer.from(request.planBytes);
    const knownSourceRefs = Object.freeze([...request.knownSourceRefs]);
    let workspace: PresentationInspectionWorkspace | undefined;

    try {
      workspace = await this.dependencies.createInspectionWorkspace(request.runId);
      await ensurePrivateWorkspace(workspace.directory);
      const inspectionCopyPath = path.join(workspace.directory, 'candidate.pptx');
      const inspectionCopy = await writeInspectionCopy(
        inspectionCopyPath,
        request.candidate,
        expectedCandidate.byteLength,
        this.limits.copyChunkBytes
      );
      if (
        inspectionCopy.sha256 !== expectedCandidate.sha256 ||
        inspectionCopy.byteLength !== expectedCandidate.byteLength
      ) {
        fail('HASH_MISMATCH');
      }
      await assertInspectionCopy(inspectionCopyPath, inspectionCopy);
      await assertCandidateIdentity(request.candidate, expectedCandidate, this.limits.copyChunkBytes);

      try {
        await this.dependencies.runner.validate(inspectionCopyPath);
      } catch {
        fail('STRUCTURAL_VALIDATION_FAILED');
      }
      await assertInspectionCopy(inspectionCopyPath, inspectionCopy);
      const retainedAfterStructuralValidation = await assertCandidateIdentity(
        request.candidate,
        expectedCandidate,
        this.limits.copyChunkBytes
      );

      let ooxml: PptxOoxmlInspection;
      try {
        ooxml = await this.dependencies.inspectOoxml(inspectionCopyPath);
      } catch {
        return failureResult(blocker('OOXML_UNSAFE'));
      }
      await assertInspectionCopy(inspectionCopyPath, inspectionCopy);
      const retainedAfterOoxmlInspection = await assertCandidateIdentity(
        request.candidate,
        expectedCandidate,
        this.limits.copyChunkBytes
      );

      const policy = inspectPresentationReadiness({ planBytes, knownSourceRefs, ooxml });
      if (policy.blockers.length > 0) return failureResult(...policy.blockers);

      const rendered = await withGlobalRenderLock(async () => {
        const renders: PresentationSlideRenderEvidence[] = [];
        const renderPaths: string[] = [];
        const retainedAfterEachSlideRender: string[] = [];
        let renderedBytes = 0;

        for (let slideNumber = 1; slideNumber <= ooxml.slideCount; slideNumber += 1) {
          const outputPath = path.join(workspace.directory, `slide-${slideNumber}.png`);
          try {
            await this.dependencies.runner.renderSlide(inspectionCopyPath, slideNumber, outputPath);
          } catch (error) {
            const renderCode =
              typeof error === 'object' && error !== null && 'code' in error && error.code === 'EFBIG'
                ? 'RENDER_LIMIT_EXCEEDED'
                : isTimedOut(error)
                  ? 'RENDER_TIMEOUT'
                  : 'RENDER_MISSING';
            fail(renderCode, slideNumber);
          }

          const render = await inspectRegularFile(
            outputPath,
            'RENDER_MISSING',
            slideNumber,
            this.limits.maxRenderBytesPerSlide,
            true
          );
          renderedBytes += render.byteLength;
          if (renderedBytes > this.limits.maxRenderBytesTotal) fail('RENDER_LIMIT_EXCEEDED', slideNumber);
          renders.push({
            slideNumber,
            candidateSha256: expectedCandidate.sha256,
            sha256: render.sha256,
            byteLength: render.byteLength,
          });
          renderPaths.push(outputPath);

          await assertInspectionCopy(inspectionCopyPath, inspectionCopy);
          retainedAfterEachSlideRender.push(
            await assertCandidateIdentity(request.candidate, expectedCandidate, this.limits.copyChunkBytes)
          );
        }

        for (const [index, expectedRender] of renders.entries()) {
          const observed = await inspectRegularFile(
            renderPaths[index]!,
            'RENDER_MISSING',
            expectedRender.slideNumber,
            this.limits.maxRenderBytesPerSlide,
            true
          );
          if (observed.sha256 !== expectedRender.sha256 || observed.byteLength !== expectedRender.byteLength) {
            fail('HASH_MISMATCH', expectedRender.slideNumber);
          }
        }

        await assertInspectionCopy(inspectionCopyPath, inspectionCopy);
        await assertCandidateIdentity(request.candidate, expectedCandidate, this.limits.copyChunkBytes);

        return { renders, retainedAfterEachSlideRender };
      });

      const evidence: PresentationReadinessEvidence = {
        version: 1,
        candidate: expectedCandidate,
        plan: hashBytes(planBytes),
        hashChain: {
          stagingBeforeRetain: retentionProof.stagingBeforeRetain,
          retainedTemp: retentionProof.retainedTemp,
          stagingAfterRetain: retentionProof.stagingAfterRetain,
          manifestRetained: expectedCandidate.sha256,
          inspectionCopy: inspectionCopy.sha256,
          retainedAfterStructuralValidation,
          retainedAfterOoxmlInspection,
          retainedAfterEachSlideRender: rendered.retainedAfterEachSlideRender,
        },
        structure: { officeCliValidated: true },
        ooxml: toOoxmlEvidence(ooxml),
        policy,
        renders: rendered.renders,
      };
      return Object.freeze({ ok: true, evidence: deepFreeze(evidence) });
    } catch (error) {
      if (error instanceof ReadinessFailure) return failureResult(error.blocker);
      throw error;
    } finally {
      if (workspace) await workspace.dispose();
    }
  }
}
