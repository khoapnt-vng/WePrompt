/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import { normalizePresentationConversationId } from '@/common/types/office/presentationConversationId';
import type {
  PresentationTemplateCandidateDescription,
  PresentationTemplateCandidateFailureCode,
  PresentationTemplateManifest,
  PresentationTemplateSummary,
} from '@/common/types/office/presentationTemplate';
import type { BuiltinTemplatePack } from '@process/resources/presentation-templates/index';
import type { PresentationSourcePathAuthorization } from './run';
import { TEMPLATE_ID_RE, validateTemplateManifest } from './templateManifest';
import { parseThemeTokens, renderThemeThumbnailSvg, svgToDataUrl } from './themeThumbnail';

const MANIFEST_FILE = 'template.json';
const INSTALL_TEMP_PREFIX = '.aionui-template-install-';
const INSTALL_TEMP_DIRECTORY_RE = /^\.aionui-template-install-[a-z0-9][a-z0-9-]{1,63}-[A-Za-z0-9]{6}$/;
const INSTALL_TEMP_STALE_MS = 24 * 60 * 60 * 1000;
const MAX_INSTALL_TEMP_INSPECTIONS = 100;
const MAX_INSTALL_TEMP_REMOVALS = 20;
const MAX_CANDIDATE_CONFIRMATIONS = 100;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const DIRECTORY_ONLY = constants.O_DIRECTORY ?? 0;
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });
const SHA256_RE = /^[0-9a-f]{64}$/;

type WorkspaceSourceAuthorizer = {
  authorizeWorkspaceSourcePath: (
    workspaceRoot: string,
    relativePath: string
  ) => Promise<PresentationSourcePathAuthorization>;
};

type CandidateInput = {
  conversationId: string;
  workspaceRoot: string;
  filePath: string;
};

type CandidateConfirmation = {
  conversationId: string;
  workspaceRoot: string;
  canonicalFilePath: string;
  sha256: string;
  installedId?: string;
  installPromise?: Promise<PresentationTemplateSummary>;
};

/** Typed failure for a main-owned candidate describe or bound import. */
export class PresentationTemplateCandidateError extends Error {
  constructor(
    readonly code: PresentationTemplateCandidateFailureCode,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = 'PresentationTemplateCandidateError';
  }
}

export type PresentationTemplateResolutionErrorCode = 'TEMPLATE_UNSUPPORTED' | 'RESOURCE_LIMIT_EXCEEDED';

/** Typed main-process lookup failure for a present but unusable template pack. */
export class PresentationTemplateResolutionError extends Error {
  constructor(
    readonly code: PresentationTemplateResolutionErrorCode,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = 'PresentationTemplateResolutionError';
  }
}

export type ResolvedPresentationTemplateFile = {
  fileName: string;
  bytes: Buffer;
  byteLength: number;
  sha256: string;
};

/** Main-owned byte snapshot. It intentionally carries no filesystem path. */
export type ResolvedPresentationTemplate = {
  manifest: PresentationTemplateManifest;
  theme: ResolvedPresentationTemplateFile;
  reference: ResolvedPresentationTemplateFile | null;
};

type StableDirectory = {
  handle: Awaited<ReturnType<typeof open>>;
  metadata: BigIntStats;
};

function hasErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === code) return true;
  return 'cause' in error && hasErrorCode(error.cause, code);
}

function sameFileVersion(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function unsupported(cause?: unknown): PresentationTemplateResolutionError {
  return new PresentationTemplateResolutionError('TEMPLATE_UNSUPPORTED', cause === undefined ? undefined : { cause });
}

async function openStableDirectory(directory: string): Promise<StableDirectory> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const named = await lstat(directory, { bigint: true });
    if (named.isSymbolicLink() || !named.isDirectory()) throw unsupported();
    handle = await open(directory, constants.O_RDONLY | NO_FOLLOW | DIRECTORY_ONLY);
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isDirectory() || !sameFileVersion(named, metadata)) throw unsupported();
    return { handle, metadata };
  } catch (error) {
    if (handle !== null) await handle.close();
    if (error instanceof PresentationTemplateResolutionError) throw error;
    throw unsupported(error);
  }
}

async function assertStableDirectory(directory: string, stable: StableDirectory): Promise<void> {
  try {
    const [opened, named] = await Promise.all([
      stable.handle.stat({ bigint: true }),
      lstat(directory, { bigint: true }),
    ]);
    if (
      !opened.isDirectory() ||
      named.isSymbolicLink() ||
      !named.isDirectory() ||
      !sameFileVersion(stable.metadata, opened) ||
      !sameFileVersion(stable.metadata, named)
    ) {
      throw unsupported();
    }
  } catch (error) {
    if (error instanceof PresentationTemplateResolutionError) throw error;
    throw unsupported(error);
  }
}

async function assertStableDirectoryIdentity(directory: string, stable: StableDirectory): Promise<void> {
  try {
    const [opened, named] = await Promise.all([
      stable.handle.stat({ bigint: true }),
      lstat(directory, { bigint: true }),
    ]);
    if (
      !opened.isDirectory() ||
      named.isSymbolicLink() ||
      !named.isDirectory() ||
      !sameFileIdentity(stable.metadata, opened) ||
      !sameFileIdentity(stable.metadata, named)
    ) {
      throw unsupported();
    }
  } catch (error) {
    if (error instanceof PresentationTemplateResolutionError) throw error;
    throw unsupported(error);
  }
}

async function openOrCreateStableDirectory(directory: string): Promise<StableDirectory> {
  try {
    return await openStableDirectory(directory);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }

  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    throw unsupported(error);
  }
  return openStableDirectory(directory);
}

async function writeStableFile(
  directory: string,
  stableDirectory: StableDirectory,
  fileName: string,
  contents: string | Buffer
): Promise<void> {
  if (path.basename(fileName) !== fileName) throw unsupported();
  const filePath = path.join(directory, fileName);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let namedBefore: BigIntStats | null = null;
  try {
    await assertStableDirectoryIdentity(directory, stableDirectory);
    try {
      namedBefore = await lstat(filePath, { bigint: true });
      if (namedBefore.isSymbolicLink() || !namedBefore.isFile() || namedBefore.nlink !== BigInt(1)) {
        throw unsupported();
      }
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    }

    handle = await open(filePath, constants.O_WRONLY | constants.O_CREAT | NO_FOLLOW, 0o600);
    const openedBefore = await handle.stat({ bigint: true });
    if (
      !openedBefore.isFile() ||
      openedBefore.nlink !== BigInt(1) ||
      (namedBefore !== null && !sameFileIdentity(namedBefore, openedBefore))
    ) {
      throw unsupported();
    }
    const namedOpened = await lstat(filePath, { bigint: true });
    if (
      namedOpened.isSymbolicLink() ||
      !namedOpened.isFile() ||
      namedOpened.nlink !== BigInt(1) ||
      !sameFileIdentity(openedBefore, namedOpened)
    ) {
      throw unsupported();
    }
    await assertStableDirectoryIdentity(directory, stableDirectory);

    const bytes = typeof contents === 'string' ? Buffer.from(contents, 'utf-8') : contents;
    await handle.truncate(0);
    await handle.writeFile(bytes);
    await handle.sync();

    const [openedAfter, namedAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(filePath, { bigint: true }),
    ]);
    if (
      !openedAfter.isFile() ||
      openedAfter.nlink !== BigInt(1) ||
      namedAfter.isSymbolicLink() ||
      !namedAfter.isFile() ||
      namedAfter.nlink !== BigInt(1) ||
      !sameFileIdentity(openedBefore, openedAfter) ||
      !sameFileIdentity(openedBefore, namedAfter) ||
      openedAfter.size !== BigInt(bytes.byteLength)
    ) {
      throw unsupported();
    }
    await assertStableDirectoryIdentity(directory, stableDirectory);
  } catch (error) {
    if (error instanceof PresentationTemplateResolutionError) throw error;
    throw unsupported(error);
  } finally {
    if (handle !== null) await handle.close();
  }
}

async function readStableFile(
  filePath: string,
  fileName: string,
  maxBytes: number
): Promise<ResolvedPresentationTemplateFile> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const namedBefore = await lstat(filePath, { bigint: true });
    if (namedBefore.isSymbolicLink() || !namedBefore.isFile()) throw unsupported();
    handle = await open(filePath, constants.O_RDONLY | NO_FOLLOW);
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || !sameFileVersion(namedBefore, openedBefore)) throw unsupported();
    if (openedBefore.size > BigInt(maxBytes) || openedBefore.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new PresentationTemplateResolutionError('RESOURCE_LIMIT_EXCEEDED');
    }

    const byteLength = Number(openedBefore.size);
    const bytes = Buffer.alloc(byteLength);
    let offset = 0;
    while (offset < byteLength) {
      // eslint-disable-next-line no-await-in-loop -- one stable file handle must be read sequentially and bounded
      const { bytesRead } = await handle.read(bytes, offset, byteLength - offset, offset);
      if (bytesRead === 0) throw unsupported();
      offset += bytesRead;
    }
    const trailing = Buffer.alloc(1);
    if ((await handle.read(trailing, 0, 1, byteLength)).bytesRead !== 0) throw unsupported();

    const openedAfter = await handle.stat({ bigint: true });
    const namedAfter = await lstat(filePath, { bigint: true });
    if (
      namedAfter.isSymbolicLink() ||
      !namedAfter.isFile() ||
      !sameFileVersion(openedBefore, openedAfter) ||
      !sameFileVersion(openedBefore, namedAfter)
    ) {
      throw unsupported();
    }
    return {
      fileName,
      bytes,
      byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    if (error instanceof PresentationTemplateResolutionError) throw error;
    throw unsupported(error);
  } finally {
    if (handle !== null) await handle.close();
  }
}

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'template';

const parseThemeName = (themeMd: string, filePath: string): string => {
  const nameMatch = themeMd.match(/^#\s+(.+)$/m);
  return (nameMatch ? nameMatch[1] : path.basename(filePath, '.md')).replace(/\s*[—-]\s*Theme Spec.*$/i, '').trim();
};

const sameAuthorization = (
  left: PresentationSourcePathAuthorization,
  right: PresentationSourcePathAuthorization
): boolean =>
  left.allowedRootPath === right.allowedRootPath &&
  left.allowedRootDev === right.allowedRootDev &&
  left.allowedRootIno === right.allowedRootIno &&
  left.canonicalSourcePath === right.canonicalSourcePath &&
  left.sourceDev === right.sourceDev &&
  left.sourceIno === right.sourceIno;

/**
 * Owns the on-disk template pack directory (one folder per template).
 * All methods are async and safe to call repeatedly; builtin sync is
 * versioned so user edits to builtin files survive same-version restarts.
 */
export class PresentationTemplateService {
  private readonly rootDir: string;
  private readonly builtinPacks: BuiltinTemplatePack[];
  private readonly workspaceSourceAuthorizer: WorkspaceSourceAuthorizer | null;
  private readonly candidateConfirmations = new Map<string, CandidateConfirmation>();
  private initialized: Promise<void> | null = null;

  constructor(options: {
    rootDir: string;
    builtinPacks: BuiltinTemplatePack[];
    workspaceSourceAuthorizer?: WorkspaceSourceAuthorizer;
  }) {
    this.rootDir = options.rootDir;
    this.builtinPacks = options.builtinPacks;
    this.workspaceSourceAuthorizer = options.workspaceSourceAuthorizer ?? null;
  }

  ensureInitialized(): Promise<void> {
    this.initialized ??= this.syncBuiltins();
    return this.initialized;
  }

  private async syncBuiltins(): Promise<void> {
    const stableRoot = await openOrCreateStableDirectory(this.rootDir);
    try {
      // Bracket the only destructive step the same way the pack loop below does: the root is
      // proven before anything is removed, not only after.
      await assertStableDirectoryIdentity(this.rootDir, stableRoot);
      await this.cleanupStaleInstallTemporaries();
      await assertStableDirectoryIdentity(this.rootDir, stableRoot);
      for (const pack of this.builtinPacks) {
        const dir = path.join(this.rootDir, pack.manifest.id);
        let stablePack: StableDirectory | null = null;
        try {
          const manifest = validateTemplateManifest(pack.manifest);
          await assertStableDirectoryIdentity(this.rootDir, stableRoot);
          stablePack = await openOrCreateStableDirectory(dir);
          await assertStableDirectoryIdentity(this.rootDir, stableRoot);

          const installed = await this.readManifestForSync(dir, stablePack);
          if (installed && installed.version >= manifest.version) continue;
          const referenceBytes =
            manifest.referenceFile && pack.referenceSourcePath ? await readFile(pack.referenceSourcePath()) : null;

          await writeStableFile(dir, stablePack, manifest.themeFile, pack.themeMd);
          await writeStableFile(dir, stablePack, manifest.preview, pack.previewSvg);
          if (manifest.referenceFile && referenceBytes) {
            await writeStableFile(dir, stablePack, manifest.referenceFile, referenceBytes);
          }
          await writeStableFile(dir, stablePack, MANIFEST_FILE, JSON.stringify(manifest, null, 2));
        } catch (error) {
          console.warn('[PresentationTemplates] failed to sync builtin pack', pack.manifest.id, error);
        } finally {
          if (stablePack !== null) {
            try {
              await assertStableDirectoryIdentity(dir, stablePack);
            } catch (error) {
              console.warn('[PresentationTemplates] builtin pack changed during sync', pack.manifest.id, error);
            } finally {
              await stablePack.handle.close();
            }
          }
        }
      }
    } finally {
      try {
        await assertStableDirectoryIdentity(this.rootDir, stableRoot);
      } finally {
        await stableRoot.handle.close();
      }
    }
  }

  private async cleanupStaleInstallTemporaries(): Promise<void> {
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory() && INSTALL_TEMP_DIRECTORY_RE.test(entry.name))
      .slice(0, MAX_INSTALL_TEMP_INSPECTIONS);
    let removed = 0;
    for (const candidate of candidates) {
      if (removed >= MAX_INSTALL_TEMP_REMOVALS) break;
      const directory = path.join(this.rootDir, candidate.name);
      try {
        // eslint-disable-next-line no-await-in-loop -- cleanup is bounded and stops at the removal cap
        const metadata = await lstat(directory);
        if (!metadata.isDirectory() || Date.now() - metadata.mtimeMs < INSTALL_TEMP_STALE_MS) continue;
        // eslint-disable-next-line no-await-in-loop -- stale directories are removed serially to enforce the cap
        await rm(directory, { recursive: true, force: true });
        removed += 1;
      } catch (error) {
        console.warn('[PresentationTemplates] failed to clean stale install temporary', candidate.name, error);
      }
    }
  }

  private async readManifestForSync(
    dir: string,
    stableDirectory: StableDirectory
  ): Promise<PresentationTemplateManifest | null> {
    try {
      await assertStableDirectoryIdentity(dir, stableDirectory);
      const manifestFile = await readStableFile(
        path.join(dir, MANIFEST_FILE),
        MANIFEST_FILE,
        PRESENTATION_RUN_LIMITS.MAX_THEME_BYTES
      );
      await assertStableDirectoryIdentity(dir, stableDirectory);
      return validateTemplateManifest(JSON.parse(STRICT_UTF8.decode(manifestFile.bytes)));
    } catch {
      await assertStableDirectoryIdentity(dir, stableDirectory);
      return null;
    }
  }

  private async readManifest(dir: string): Promise<PresentationTemplateManifest | null> {
    try {
      const raw = await readFile(path.join(dir, MANIFEST_FILE), 'utf-8');
      return validateTemplateManifest(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async toSummary(manifest: PresentationTemplateManifest): Promise<PresentationTemplateSummary> {
    const dir = path.join(this.rootDir, manifest.id);
    const previewPath = path.join(dir, manifest.preview);
    let previewDataUrl: string;
    if (manifest.preview.endsWith('.png')) {
      previewDataUrl = `data:image/png;base64,${(await readFile(previewPath)).toString('base64')}`;
    } else {
      previewDataUrl = svgToDataUrl(await readFile(previewPath, 'utf-8'));
    }
    return {
      manifest,
      themePath: path.join(dir, manifest.themeFile),
      referencePath: manifest.referenceFile ? path.join(dir, manifest.referenceFile) : null,
      previewDataUrl,
    };
  }

  async list(): Promise<PresentationTemplateSummary[]> {
    await this.ensureInitialized();
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const summaries: PresentationTemplateSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (INSTALL_TEMP_DIRECTORY_RE.test(entry.name)) continue;
      const manifest = await this.readManifest(path.join(this.rootDir, entry.name));
      if (!manifest || manifest.id !== entry.name) continue;
      try {
        summaries.push(await this.toSummary(manifest));
      } catch {
        // corrupt pack (missing preview/theme) — skip rather than break the gallery
      }
    }
    return summaries.toSorted((a, b) => {
      if (a.manifest.source !== b.manifest.source) return a.manifest.source === 'builtin' ? -1 : 1;
      return a.manifest.name.localeCompare(b.manifest.name);
    });
  }

  /** Resolves one pack into stable bounded bytes for main-process preparation. */
  async getById(id: string): Promise<ResolvedPresentationTemplate | null> {
    if (!TEMPLATE_ID_RE.test(id)) return null;
    await this.ensureInitialized();
    const directory = path.join(this.rootDir, id);
    const stableRoot = await openStableDirectory(this.rootDir);
    let stableDirectory: StableDirectory | null = null;

    try {
      try {
        stableDirectory = await openStableDirectory(directory);
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) return null;
        throw error;
      }
      const manifestFile = await readStableFile(
        path.join(directory, MANIFEST_FILE),
        MANIFEST_FILE,
        PRESENTATION_RUN_LIMITS.MAX_THEME_BYTES
      );

      let manifest: PresentationTemplateManifest;
      try {
        manifest = validateTemplateManifest(JSON.parse(STRICT_UTF8.decode(manifestFile.bytes)));
      } catch (error) {
        throw unsupported(error);
      }
      if (manifest.id !== id) throw unsupported();
      if (
        (manifest.format === 'pptx' && path.extname(manifest.referenceFile ?? '').toLowerCase() !== '.pptx') ||
        (manifest.format === 'docx' && path.extname(manifest.referenceFile ?? '').toLowerCase() !== '.docx')
      ) {
        throw unsupported();
      }

      const theme = await readStableFile(
        path.join(directory, manifest.themeFile),
        manifest.themeFile,
        PRESENTATION_RUN_LIMITS.MAX_THEME_BYTES
      );
      if (theme.byteLength === 0) throw unsupported();
      try {
        STRICT_UTF8.decode(theme.bytes);
      } catch (error) {
        throw unsupported(error);
      }
      const reference =
        manifest.referenceFile === null
          ? null
          : await readStableFile(
              path.join(directory, manifest.referenceFile),
              manifest.referenceFile,
              PRESENTATION_RUN_LIMITS.MAX_REFERENCE_BYTES
            );
      if (reference !== null && reference.byteLength === 0) throw unsupported();
      if (theme.byteLength + (reference?.byteLength ?? 0) > PRESENTATION_RUN_LIMITS.MAX_TEMPLATE_REFERENCE_BYTES) {
        throw new PresentationTemplateResolutionError('RESOURCE_LIMIT_EXCEEDED');
      }

      return { manifest, theme, reference };
    } finally {
      try {
        if (stableDirectory !== null) await assertStableDirectory(directory, stableDirectory);
      } finally {
        try {
          await assertStableDirectory(this.rootDir, stableRoot);
        } finally {
          try {
            if (stableDirectory !== null) await stableDirectory.handle.close();
          } finally {
            await stableRoot.handle.close();
          }
        }
      }
    }
  }

  private async uniqueId(base: string): Promise<string> {
    const existing = new Set((await readdir(this.rootDir, { withFileTypes: true })).map((e) => e.name));
    if (!existing.has(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base}-${n}`;
      if (!existing.has(candidate)) return candidate;
    }
  }

  private candidateRelativePath(input: CandidateInput): string {
    if (
      normalizePresentationConversationId(input.conversationId) !== input.conversationId ||
      !path.isAbsolute(input.workspaceRoot) ||
      path.resolve(input.workspaceRoot) !== input.workspaceRoot ||
      !path.isAbsolute(input.filePath) ||
      path.resolve(input.filePath) !== input.filePath ||
      !input.filePath.toLowerCase().endsWith('.md')
    ) {
      throw new PresentationTemplateCandidateError('CANDIDATE_OUTSIDE_WORKSPACE');
    }
    const relativePath = path.relative(input.workspaceRoot, input.filePath);
    if (
      relativePath.length === 0 ||
      path.isAbsolute(relativePath) ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`)
    ) {
      throw new PresentationTemplateCandidateError('CANDIDATE_OUTSIDE_WORKSPACE');
    }
    return relativePath.split(path.sep).join('/');
  }

  private async readCandidate(input: CandidateInput): Promise<{
    file: ResolvedPresentationTemplateFile;
    authorization: PresentationSourcePathAuthorization;
  }> {
    const relativePath = this.candidateRelativePath(input);
    if (this.workspaceSourceAuthorizer === null) {
      throw new PresentationTemplateCandidateError('CANDIDATE_OUTSIDE_WORKSPACE');
    }
    try {
      const authorization = await this.workspaceSourceAuthorizer.authorizeWorkspaceSourcePath(
        input.workspaceRoot,
        relativePath
      );
      const file = await readStableFile(
        authorization.canonicalSourcePath,
        path.basename(authorization.canonicalSourcePath),
        PRESENTATION_RUN_LIMITS.MAX_THEME_BYTES
      );
      const currentAuthorization = await this.workspaceSourceAuthorizer.authorizeWorkspaceSourcePath(
        input.workspaceRoot,
        relativePath
      );
      if (!sameAuthorization(authorization, currentAuthorization)) {
        throw new PresentationTemplateCandidateError('CANDIDATE_CHANGED');
      }
      return { file, authorization };
    } catch (error) {
      if (error instanceof PresentationTemplateCandidateError) throw error;
      if (error instanceof PresentationTemplateResolutionError && error.code === 'RESOURCE_LIMIT_EXCEEDED') {
        throw new PresentationTemplateCandidateError('CANDIDATE_TOO_LARGE', { cause: error });
      }
      throw new PresentationTemplateCandidateError('CANDIDATE_OUTSIDE_WORKSPACE', { cause: error });
    }
  }

  private confirmationKey(input: { conversationId: string; canonicalFilePath: string; sha256: string }): string {
    return `${input.conversationId}\0${input.canonicalFilePath}\0${input.sha256}`;
  }

  private rememberConfirmation(key: string, confirmation: CandidateConfirmation): void {
    this.candidateConfirmations.delete(key);
    this.candidateConfirmations.set(key, confirmation);
    while (this.candidateConfirmations.size > MAX_CANDIDATE_CONFIRMATIONS) {
      const oldest = this.candidateConfirmations.keys().next().value;
      if (oldest === undefined) break;
      this.candidateConfirmations.delete(oldest);
    }
  }

  /** Reads and previews one authorized workspace theme while minting its content confirmation. */
  async describeThemeSpec(input: CandidateInput): Promise<PresentationTemplateCandidateDescription> {
    const conversationId = normalizePresentationConversationId(input.conversationId);
    if (conversationId === null) throw new PresentationTemplateCandidateError('CANDIDATE_OUTSIDE_WORKSPACE');
    const normalizedInput = { ...input, conversationId };
    const { file, authorization } = await this.readCandidate(normalizedInput);
    if (file.byteLength === 0) throw new PresentationTemplateCandidateError('CANDIDATE_UNSUPPORTED');
    let themeMd: string;
    try {
      themeMd = STRICT_UTF8.decode(file.bytes);
    } catch (error) {
      throw new PresentationTemplateCandidateError('CANDIDATE_UNSUPPORTED', { cause: error });
    }
    const name = parseThemeName(themeMd, file.fileName);
    if (name.length === 0) throw new PresentationTemplateCandidateError('CANDIDATE_UNSUPPORTED');
    const tokens = parseThemeTokens(themeMd);
    const confirmation: CandidateConfirmation = {
      conversationId,
      workspaceRoot: authorization.allowedRootPath,
      canonicalFilePath: authorization.canonicalSourcePath,
      sha256: file.sha256,
    };
    this.rememberConfirmation(this.confirmationKey(confirmation), confirmation);
    return {
      name,
      tokens,
      preview_data_url: svgToDataUrl(
        renderThemeThumbnailSvg({ name, format: 'html', colors: tokens.colors, fonts: tokens.fonts })
      ),
      sha256: file.sha256,
      byte_length: file.byteLength,
    };
  }

  /** Installs only bytes that still match a main-minted workspace confirmation. */
  async importThemeSpecBound(input: CandidateInput & { expectedSha256: string }): Promise<PresentationTemplateSummary> {
    if (!SHA256_RE.test(input.expectedSha256)) {
      throw new PresentationTemplateCandidateError('CONFIRMATION_NOT_MINTED');
    }
    const conversationId = normalizePresentationConversationId(input.conversationId);
    if (conversationId === null) throw new PresentationTemplateCandidateError('CANDIDATE_OUTSIDE_WORKSPACE');
    const { file, authorization } = await this.readCandidate({ ...input, conversationId });
    if (file.sha256 !== input.expectedSha256) {
      throw new PresentationTemplateCandidateError('CANDIDATE_CHANGED');
    }
    const key = this.confirmationKey({
      conversationId,
      canonicalFilePath: authorization.canonicalSourcePath,
      sha256: input.expectedSha256,
    });
    const confirmation = this.candidateConfirmations.get(key);
    if (
      confirmation === undefined ||
      confirmation.workspaceRoot !== authorization.allowedRootPath ||
      confirmation.canonicalFilePath !== authorization.canonicalSourcePath
    ) {
      throw new PresentationTemplateCandidateError('CONFIRMATION_NOT_MINTED');
    }
    if (confirmation.installPromise !== undefined) return confirmation.installPromise;
    if (confirmation.installedId !== undefined) {
      const installed = (await this.list()).find((template) => template.manifest.id === confirmation.installedId);
      if (installed !== undefined) return installed;
    }

    const installPromise = this.installThemeSpecBytes(file.bytes, file.fileName).then((installed) => {
      confirmation.installedId = installed.manifest.id;
      return installed;
    });
    confirmation.installPromise = installPromise;
    try {
      return await installPromise;
    } finally {
      confirmation.installPromise = undefined;
    }
  }

  async importThemeSpec(filePath: string): Promise<PresentationTemplateSummary> {
    await this.ensureInitialized();
    if (!filePath.toLowerCase().endsWith('.md')) throw new Error('unsupported file type');
    return this.installThemeSpecBytes(await readFile(filePath), filePath);
  }

  private async installThemeSpecBytes(themeBytes: Buffer, sourcePath: string): Promise<PresentationTemplateSummary> {
    await this.ensureInitialized();
    const themeMd = themeBytes.toString('utf-8');
    const name = parseThemeName(themeMd, sourcePath);
    const id = await this.uniqueId(slugify(name));
    if (!TEMPLATE_ID_RE.test(id)) throw new Error(`invalid manifest: bad id: ${id}`);

    const tokens = parseThemeTokens(themeMd);
    const manifest: PresentationTemplateManifest = {
      id,
      name,
      description: tokens.fonts.length > 0 ? `Custom theme · ${tokens.fonts.join(', ')}` : 'Custom imported theme',
      format: 'html',
      kind: 'report',
      source: 'user',
      themeFile: 'THEME.md',
      referenceFile: null,
      preview: 'preview.svg',
      version: 1,
      createdAt: new Date().toISOString(),
    };
    const dir = path.join(this.rootDir, id);
    const temporaryDir = await mkdtemp(path.join(this.rootDir, `${INSTALL_TEMP_PREFIX}${id}-`));
    let committed = false;
    try {
      await writeFile(path.join(temporaryDir, 'THEME.md'), themeBytes);
      await writeFile(
        path.join(temporaryDir, 'preview.svg'),
        renderThemeThumbnailSvg({ name, format: 'html', colors: tokens.colors, fonts: tokens.fonts }),
        'utf-8'
      );
      await writeFile(path.join(temporaryDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8');
      await rename(temporaryDir, dir);
      committed = true;
    } finally {
      if (!committed) await rm(temporaryDir, { recursive: true, force: true });
    }
    return this.toSummary(manifest);
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!TEMPLATE_ID_RE.test(id)) return false;
    const dir = path.join(this.rootDir, id);
    const manifest = await this.readManifest(dir);
    if (!manifest) return false;
    if (manifest.source === 'builtin') throw new Error('builtin template cannot be removed');
    await rm(dir, { recursive: true, force: true });
    return true;
  }
}
