/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { constants as fsConstants, type promises as nodeFs } from 'node:fs';
import path from 'node:path';
import {
  isUnsupportedStudioPrototypeSchemaVersion,
  STUDIO_PROJECT_SCHEMA_VERSION,
} from '@/common/types/project/creativeStudioTypes';
import { readBoundedRegularFileWithIdentity } from '../service/recordIo';
import {
  decodeStudioProjectManifestV2,
  STUDIO_BRIEF_FILE_MAX_BYTES,
  STUDIO_BRIEF_FILE_NAME,
} from '../service/briefFile';
import { CreativeStudioStoreError } from './contracts';
import type {
  StudioDirectoryAuthorityV2,
  StudioFileIdentityV2,
  StudioProjectFileInspectionV2,
} from './projectTransactions';

const STUDIO_PROJECT_SCHEMA_SNIFF_CHUNK_BYTES = 64 * 1024;
const STUDIO_PROJECT_SCHEMA_SNIFF_TOKEN_BYTES = 128;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonWhitespaceByte = (value: number): boolean =>
  value === 0x20 || value === 0x09 || value === 0x0a || value === 0x0d;

const isJsonValueDelimiterByte = (value: number): boolean =>
  isJsonWhitespaceByte(value) || value === 0x2c || value === 0x5d || value === 0x7d;

const isJsonHexByte = (value: number): boolean =>
  (value >= 0x30 && value <= 0x39) || (value >= 0x41 && value <= 0x46) || (value >= 0x61 && value <= 0x66);

const isJsonSimpleEscapeByte = (value: number): boolean =>
  value === 0x22 ||
  value === 0x5c ||
  value === 0x2f ||
  value === 0x62 ||
  value === 0x66 ||
  value === 0x6e ||
  value === 0x72 ||
  value === 0x74;

const JSON_STRING_SPECIAL_BYTE_PATTERN = new RegExp(String.raw`["\\\u0000-\u001f]`);

type StudioSchemaSniffRootState =
  | 'before_root'
  | 'first_key_or_end'
  | 'key_after_comma'
  | 'colon'
  | 'value'
  | 'comma_or_end'
  | 'done'
  | 'invalid';

type StudioSchemaSniffStringRole = 'root_key' | 'root_value' | 'nested_key' | 'nested_value';
type StudioSchemaSniffNumberState =
  | 'minus'
  | 'zero'
  | 'integer'
  | 'fraction_start'
  | 'fraction'
  | 'exponent_start'
  | 'exponent_sign'
  | 'exponent';

const STUDIO_SCHEMA_STACK_OBJECT_FIRST_KEY_OR_END = 0;
const STUDIO_SCHEMA_STACK_OBJECT_KEY_AFTER_COMMA = 1;
const STUDIO_SCHEMA_STACK_OBJECT_COLON = 2;
const STUDIO_SCHEMA_STACK_OBJECT_VALUE = 3;
const STUDIO_SCHEMA_STACK_OBJECT_COMMA_OR_END = 4;
const STUDIO_SCHEMA_STACK_ARRAY_FIRST_VALUE_OR_END = 5;
const STUDIO_SCHEMA_STACK_ARRAY_VALUE_AFTER_COMMA = 6;
const STUDIO_SCHEMA_STACK_ARRAY_COMMA_OR_END = 7;
const STUDIO_SCHEMA_STACK_CHUNK_BYTES = 64 * 1024;

type StudioSchemaSniffNestedState = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Two grammar frames per byte; allocation grows in fixed chunks rather than per-depth objects. */
class StudioSchemaSniffNestedStack {
  private readonly chunks: Uint8Array[] = [];
  private frameCount = 0;

  get length(): number {
    return this.frameCount;
  }

  push(state: StudioSchemaSniffNestedState): void {
    const frameIndex = this.frameCount;
    const byteIndex = Math.floor(frameIndex / 2);
    const chunkIndex = Math.floor(byteIndex / STUDIO_SCHEMA_STACK_CHUNK_BYTES);
    const indexInChunk = byteIndex % STUDIO_SCHEMA_STACK_CHUNK_BYTES;
    let chunk = this.chunks[chunkIndex];
    if (chunk === undefined) {
      chunk = new Uint8Array(STUDIO_SCHEMA_STACK_CHUNK_BYTES);
      this.chunks.push(chunk);
    }
    const previous = chunk[indexInChunk]!;
    chunk[indexInChunk] = frameIndex % 2 === 0 ? (previous & 0xf0) | state : (previous & 0x0f) | (state << 4);
    this.frameCount += 1;
  }

  peek(): StudioSchemaSniffNestedState | undefined {
    if (this.frameCount === 0) return undefined;
    const frameIndex = this.frameCount - 1;
    const byteIndex = Math.floor(frameIndex / 2);
    const chunk = this.chunks[Math.floor(byteIndex / STUDIO_SCHEMA_STACK_CHUNK_BYTES)]!;
    const packed = chunk[byteIndex % STUDIO_SCHEMA_STACK_CHUNK_BYTES]!;
    return (frameIndex % 2 === 0 ? packed & 0x0f : packed >>> 4) as StudioSchemaSniffNestedState;
  }

  setTop(state: StudioSchemaSniffNestedState): void {
    const frameIndex = this.frameCount - 1;
    const byteIndex = Math.floor(frameIndex / 2);
    const chunk = this.chunks[Math.floor(byteIndex / STUDIO_SCHEMA_STACK_CHUNK_BYTES)]!;
    const indexInChunk = byteIndex % STUDIO_SCHEMA_STACK_CHUNK_BYTES;
    const previous = chunk[indexInChunk]!;
    chunk[indexInChunk] = frameIndex % 2 === 0 ? (previous & 0xf0) | state : (previous & 0x0f) | (state << 4);
  }

  pop(): StudioSchemaSniffNestedState | undefined {
    const state = this.peek();
    if (state !== undefined) this.frameCount -= 1;
    return state;
  }
}

type StudioSchemaSniffValueOwner = 'root' | 'nested';

/**
 * Streams an oversized JSON object without retaining its payload. Only a direct root property can
 * classify the record; nested grammar uses a compact packed stack instead of per-depth objects.
 */
export const hasTopLevelPriorProjectSchemaVersion = async (
  handle: Awaited<ReturnType<typeof nodeFs.open>>,
  maximumBytes: number
): Promise<boolean> => {
  const chunk = Buffer.alloc(STUDIO_PROJECT_SCHEMA_SNIFF_CHUNK_BYTES);
  let rootState: StudioSchemaSniffRootState = 'before_root';
  let currentKeyIsSchemaVersion = false;
  let observedPriorProjectSchemaVersion: boolean | null = null;
  let inString = false;
  let stringRole: StudioSchemaSniffStringRole | null = null;
  let escaped = false;
  let unicodeEscapeBytesRemaining = 0;
  let capturedStringOverflow = false;
  let capturedStringBytes: number[] = [];
  const nestedContainers = new StudioSchemaSniffNestedStack();
  let literalExpected: 'true' | 'false' | 'null' | null = null;
  let literalIndex = 0;
  let numberState: StudioSchemaSniffNumberState | null = null;
  let scalarValueOwner: StudioSchemaSniffValueOwner | null = null;
  let numberNegative = false;
  let numberSignificandDigits = 0;
  let numberFractionDigits = 0;
  let numberNonzeroDigitPosition = 0;
  let numberNonzeroDigitValue = 0;
  let numberHasMultipleNonzeroDigits = false;
  let numberExponentNegative = false;
  let numberExponentMagnitude = 0;
  let numberCounterOverflow = false;
  let offset = 0;

  const completeRootValue = (priorProjectSchemaVersion: boolean): void => {
    if (currentKeyIsSchemaVersion) observedPriorProjectSchemaVersion = priorProjectSchemaVersion;
    currentKeyIsSchemaVersion = false;
    rootState = 'comma_or_end';
  };

  const completeNestedValue = (): void => {
    const state = nestedContainers.peek();
    if (state === undefined) {
      rootState = 'invalid';
      return;
    }
    if (state <= STUDIO_SCHEMA_STACK_OBJECT_COMMA_OR_END) {
      if (state !== STUDIO_SCHEMA_STACK_OBJECT_VALUE) {
        rootState = 'invalid';
        return;
      }
      nestedContainers.setTop(STUDIO_SCHEMA_STACK_OBJECT_COMMA_OR_END);
      return;
    }
    if (
      state !== STUDIO_SCHEMA_STACK_ARRAY_FIRST_VALUE_OR_END &&
      state !== STUDIO_SCHEMA_STACK_ARRAY_VALUE_AFTER_COMMA
    ) {
      rootState = 'invalid';
      return;
    }
    nestedContainers.setTop(STUDIO_SCHEMA_STACK_ARRAY_COMMA_OR_END);
  };

  const completeScalarValue = (priorProjectSchemaVersion: boolean): void => {
    if (scalarValueOwner === 'root') completeRootValue(priorProjectSchemaVersion);
    else if (scalarValueOwner === 'nested') completeNestedValue();
    else rootState = 'invalid';
    scalarValueOwner = null;
  };

  const closeNestedContainer = (): void => {
    nestedContainers.pop();
    if (nestedContainers.length === 0) completeRootValue(false);
    else completeNestedValue();
  };

  const pushNestedContainer = (byte: number): void => {
    nestedContainers.push(
      byte === 0x7b ? STUDIO_SCHEMA_STACK_OBJECT_FIRST_KEY_OR_END : STUDIO_SCHEMA_STACK_ARRAY_FIRST_VALUE_OR_END
    );
  };

  const beginString = (role: StudioSchemaSniffStringRole): void => {
    inString = true;
    stringRole = role;
    escaped = false;
    unicodeEscapeBytesRemaining = 0;
    capturedStringOverflow = false;
    capturedStringBytes = role === 'root_key' ? [0x22] : [];
  };

  const recordSignificandDigit = (byte: number, fraction: boolean): void => {
    if (numberSignificandDigits === Number.MAX_SAFE_INTEGER) numberCounterOverflow = true;
    else numberSignificandDigits += 1;
    if (fraction) {
      if (numberFractionDigits === Number.MAX_SAFE_INTEGER) numberCounterOverflow = true;
      else numberFractionDigits += 1;
    }
    if (byte !== 0x30) {
      if (numberNonzeroDigitPosition !== 0) numberHasMultipleNonzeroDigits = true;
      else {
        numberNonzeroDigitPosition = numberSignificandDigits;
        numberNonzeroDigitValue = byte - 0x30;
      }
    }
  };

  const recordExponentDigit = (byte: number): void => {
    const digit = byte - 0x30;
    if (numberExponentMagnitude > Math.floor((Number.MAX_SAFE_INTEGER - digit) / 10)) {
      numberCounterOverflow = true;
      return;
    }
    numberExponentMagnitude = numberExponentMagnitude * 10 + digit;
  };

  const beginNumber = (byte: number, owner: StudioSchemaSniffValueOwner): void => {
    scalarValueOwner = owner;
    numberNegative = byte === 0x2d;
    numberSignificandDigits = 0;
    numberFractionDigits = 0;
    numberNonzeroDigitPosition = 0;
    numberNonzeroDigitValue = 0;
    numberHasMultipleNonzeroDigits = false;
    numberExponentNegative = false;
    numberExponentMagnitude = 0;
    numberCounterOverflow = false;
    if (numberNegative) {
      numberState = 'minus';
      return;
    }
    numberState = byte === 0x30 ? 'zero' : 'integer';
    recordSignificandDigit(byte, false);
  };

  const schemaNumberIsPriorProjectSchema = (): boolean => {
    if (
      numberNegative ||
      numberCounterOverflow ||
      numberNonzeroDigitPosition === 0 ||
      numberHasMultipleNonzeroDigits ||
      numberNonzeroDigitValue >= STUDIO_PROJECT_SCHEMA_VERSION
    ) {
      return false;
    }
    const exponent = numberExponentNegative ? -numberExponentMagnitude : numberExponentMagnitude;
    return numberSignificandDigits - numberNonzeroDigitPosition - numberFractionDigits + exponent === 0;
  };

  const numberCanEnd = (): boolean =>
    numberState === 'zero' || numberState === 'integer' || numberState === 'fraction' || numberState === 'exponent';

  const consumeNumberByte = (byte: number): 'consumed' | 'complete' | 'invalid' => {
    if (isJsonValueDelimiterByte(byte)) return numberCanEnd() ? 'complete' : 'invalid';
    if (numberState === 'minus') {
      if (byte < 0x30 || byte > 0x39) return 'invalid';
      numberState = byte === 0x30 ? 'zero' : 'integer';
      recordSignificandDigit(byte, false);
      return 'consumed';
    }
    if (numberState === 'zero' || numberState === 'integer') {
      if (byte >= 0x30 && byte <= 0x39) {
        if (numberState === 'zero') return 'invalid';
        recordSignificandDigit(byte, false);
        return 'consumed';
      }
      if (byte === 0x2e) {
        numberState = 'fraction_start';
        return 'consumed';
      }
      if (byte === 0x45 || byte === 0x65) {
        numberState = 'exponent_start';
        return 'consumed';
      }
      return 'invalid';
    }
    if (numberState === 'fraction_start' || numberState === 'fraction') {
      if (byte >= 0x30 && byte <= 0x39) {
        numberState = 'fraction';
        recordSignificandDigit(byte, true);
        return 'consumed';
      }
      if (numberState === 'fraction' && (byte === 0x45 || byte === 0x65)) {
        numberState = 'exponent_start';
        return 'consumed';
      }
      return 'invalid';
    }
    if (numberState === 'exponent_start') {
      if (byte === 0x2b || byte === 0x2d) {
        numberExponentNegative = byte === 0x2d;
        numberState = 'exponent_sign';
        return 'consumed';
      }
      if (byte < 0x30 || byte > 0x39) return 'invalid';
      numberState = 'exponent';
      recordExponentDigit(byte);
      return 'consumed';
    }
    if (numberState === 'exponent_sign' || numberState === 'exponent') {
      if (byte < 0x30 || byte > 0x39) return 'invalid';
      numberState = 'exponent';
      recordExponentDigit(byte);
      return 'consumed';
    }
    return 'invalid';
  };

  const beginLiteral = (byte: number, owner: StudioSchemaSniffValueOwner): boolean => {
    if (byte === 0x74) literalExpected = 'true';
    else if (byte === 0x66) literalExpected = 'false';
    else if (byte === 0x6e) literalExpected = 'null';
    else return false;
    literalIndex = 1;
    scalarValueOwner = owner;
    return true;
  };

  const beginNestedValue = (byte: number): boolean => {
    if (byte === 0x22) beginString('nested_value');
    else if (byte === 0x7b || byte === 0x5b) pushNestedContainer(byte);
    else if (beginLiteral(byte, 'nested')) return true;
    else if (byte === 0x2d || (byte >= 0x30 && byte <= 0x39)) beginNumber(byte, 'nested');
    else return false;
    return true;
  };

  while (offset < maximumBytes && rootState !== 'invalid') {
    // A fixed reusable buffer keeps memory bounded even when schemaVersion follows a giant value.
    // eslint-disable-next-line no-await-in-loop
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, maximumBytes - offset), offset);
    if (bytesRead === 0) return false;
    offset += bytesRead;

    for (let index = 0; index < bytesRead; index += 1) {
      if (
        inString &&
        (stringRole !== 'root_key' || capturedStringOverflow) &&
        !escaped &&
        unicodeEscapeBytesRemaining === 0
      ) {
        const remaining = chunk.subarray(index, bytesRead);
        const nextSpecialOffset = remaining.toString('latin1').search(JSON_STRING_SPECIAL_BYTE_PATTERN);
        if (nextSpecialOffset === -1) break;
        index += nextSpecialOffset;
      }
      const byte = chunk[index]!;

      if (inString) {
        if (stringRole === 'root_key') {
          if (capturedStringBytes.length < STUDIO_PROJECT_SCHEMA_SNIFF_TOKEN_BYTES) {
            capturedStringBytes.push(byte);
          } else {
            capturedStringOverflow = true;
          }
        }
        if (unicodeEscapeBytesRemaining > 0) {
          if (!isJsonHexByte(byte)) {
            rootState = 'invalid';
            break;
          }
          unicodeEscapeBytesRemaining -= 1;
          continue;
        }
        if (escaped) {
          escaped = false;
          if (byte === 0x75) unicodeEscapeBytesRemaining = 4;
          else if (!isJsonSimpleEscapeByte(byte)) {
            rootState = 'invalid';
            break;
          }
          continue;
        }
        if (byte === 0x5c) {
          escaped = true;
          continue;
        }
        if (byte < 0x20) {
          rootState = 'invalid';
          break;
        }
        if (byte !== 0x22) continue;

        inString = false;
        const completedRole = stringRole;
        stringRole = null;
        if (completedRole === 'nested_key') {
          const state = nestedContainers.peek();
          if (
            state !== STUDIO_SCHEMA_STACK_OBJECT_FIRST_KEY_OR_END &&
            state !== STUDIO_SCHEMA_STACK_OBJECT_KEY_AFTER_COMMA
          ) {
            rootState = 'invalid';
            break;
          }
          nestedContainers.setTop(STUDIO_SCHEMA_STACK_OBJECT_COLON);
          continue;
        }
        if (completedRole === 'nested_value') {
          completeNestedValue();
          continue;
        }
        if (completedRole === 'root_value') {
          completeRootValue(false);
          continue;
        }
        currentKeyIsSchemaVersion = false;
        if (capturedStringOverflow) {
          rootState = 'colon';
          continue;
        }
        try {
          currentKeyIsSchemaVersion = JSON.parse(Buffer.from(capturedStringBytes).toString('utf8')) === 'schemaVersion';
        } catch {
          rootState = 'invalid';
          break;
        }
        rootState = 'colon';
        continue;
      }

      if (literalExpected !== null) {
        if (byte !== literalExpected.charCodeAt(literalIndex)) {
          rootState = 'invalid';
          break;
        }
        literalIndex += 1;
        if (literalIndex === literalExpected.length) {
          literalExpected = null;
          completeScalarValue(false);
        }
        continue;
      }

      if (numberState !== null) {
        const outcome = consumeNumberByte(byte);
        if (outcome === 'consumed') continue;
        if (outcome === 'invalid') {
          rootState = 'invalid';
          break;
        }
        const isPriorProjectSchema = schemaNumberIsPriorProjectSchema();
        numberState = null;
        completeScalarValue(isPriorProjectSchema);
      }

      if (nestedContainers.length > 0) {
        const nestedState = nestedContainers.peek()!;
        if (nestedState <= STUDIO_SCHEMA_STACK_OBJECT_COMMA_OR_END) {
          if (
            nestedState === STUDIO_SCHEMA_STACK_OBJECT_FIRST_KEY_OR_END ||
            nestedState === STUDIO_SCHEMA_STACK_OBJECT_KEY_AFTER_COMMA
          ) {
            if (isJsonWhitespaceByte(byte)) continue;
            if (nestedState === STUDIO_SCHEMA_STACK_OBJECT_FIRST_KEY_OR_END && byte === 0x7d) {
              closeNestedContainer();
              continue;
            }
            if (byte !== 0x22) {
              rootState = 'invalid';
              break;
            }
            beginString('nested_key');
            continue;
          }
          if (nestedState === STUDIO_SCHEMA_STACK_OBJECT_COLON) {
            if (isJsonWhitespaceByte(byte)) continue;
            if (byte !== 0x3a) {
              rootState = 'invalid';
              break;
            }
            nestedContainers.setTop(STUDIO_SCHEMA_STACK_OBJECT_VALUE);
            continue;
          }
          if (nestedState === STUDIO_SCHEMA_STACK_OBJECT_VALUE) {
            if (isJsonWhitespaceByte(byte)) continue;
            if (!beginNestedValue(byte)) {
              rootState = 'invalid';
              break;
            }
            continue;
          }
          if (isJsonWhitespaceByte(byte)) continue;
          if (byte === 0x2c) {
            nestedContainers.setTop(STUDIO_SCHEMA_STACK_OBJECT_KEY_AFTER_COMMA);
            continue;
          }
          if (byte === 0x7d) {
            closeNestedContainer();
            continue;
          }
          rootState = 'invalid';
          break;
        }

        if (
          nestedState === STUDIO_SCHEMA_STACK_ARRAY_FIRST_VALUE_OR_END ||
          nestedState === STUDIO_SCHEMA_STACK_ARRAY_VALUE_AFTER_COMMA
        ) {
          if (isJsonWhitespaceByte(byte)) continue;
          if (nestedState === STUDIO_SCHEMA_STACK_ARRAY_FIRST_VALUE_OR_END && byte === 0x5d) {
            closeNestedContainer();
            continue;
          }
          if (!beginNestedValue(byte)) {
            rootState = 'invalid';
            break;
          }
          continue;
        }
        if (isJsonWhitespaceByte(byte)) continue;
        if (byte === 0x2c) {
          nestedContainers.setTop(STUDIO_SCHEMA_STACK_ARRAY_VALUE_AFTER_COMMA);
          continue;
        }
        if (byte === 0x5d) {
          closeNestedContainer();
          continue;
        }
        rootState = 'invalid';
        break;
      }

      if (rootState === 'before_root') {
        if (isJsonWhitespaceByte(byte)) continue;
        if (byte !== 0x7b) {
          rootState = 'invalid';
          break;
        }
        rootState = 'first_key_or_end';
        continue;
      }
      if (rootState === 'first_key_or_end' || rootState === 'key_after_comma') {
        if (isJsonWhitespaceByte(byte)) continue;
        if (rootState === 'first_key_or_end' && byte === 0x7d) {
          rootState = 'done';
          continue;
        }
        if (byte !== 0x22) {
          rootState = 'invalid';
          break;
        }
        beginString('root_key');
        continue;
      }
      if (rootState === 'colon') {
        if (isJsonWhitespaceByte(byte)) continue;
        if (byte !== 0x3a) {
          rootState = 'invalid';
          break;
        }
        rootState = 'value';
        continue;
      }
      if (rootState === 'value') {
        if (isJsonWhitespaceByte(byte)) continue;
        if (byte === 0x22) beginString('root_value');
        else if (byte === 0x7b || byte === 0x5b) pushNestedContainer(byte);
        else if (beginLiteral(byte, 'root')) {
          // The remaining literal bytes are consumed by the streaming scalar state above.
        } else if (byte === 0x2d || (byte >= 0x30 && byte <= 0x39)) beginNumber(byte, 'root');
        else {
          rootState = 'invalid';
          break;
        }
        continue;
      }
      if ((rootState as StudioSchemaSniffRootState) === 'comma_or_end') {
        if (isJsonWhitespaceByte(byte)) continue;
        if (byte === 0x2c) {
          rootState = 'key_after_comma';
          continue;
        }
        if (byte === 0x7d) {
          rootState = 'done';
          continue;
        }
        rootState = 'invalid';
        break;
      }
      if (rootState === 'done') {
        if (!isJsonWhitespaceByte(byte)) {
          rootState = 'invalid';
          break;
        }
        continue;
      }
    }
  }
  return (
    offset === maximumBytes &&
    rootState === 'done' &&
    !inString &&
    nestedContainers.length === 0 &&
    literalExpected === null &&
    numberState === null &&
    scalarValueOwner === null &&
    observedPriorProjectSchemaVersion === true
  );
};

type StudioProjectRecordV2 = {
  status: 'bytes';
  bytes: string;
  identity: StudioFileIdentityV2;
};

type StudioProjectRecordsDepsV2 = {
  fs: typeof nodeFs;
  maxProjectBytes: number;
  projectDirectory: (root: string, projectId: string, createIfMissing: false) => Promise<string | null>;
  resolveRootChild: (root: string, child: string) => string;
  isInsideRoot: (canonicalRoot: string, target: string) => boolean;
  assertRegularFileOrMissing: (file: string) => Promise<void>;
  captureDirectoryAuthority: (directory: string) => Promise<StudioDirectoryAuthorityV2>;
  assertDirectoryAuthority: (authority: StudioDirectoryAuthorityV2) => Promise<void>;
  recoverBriefTransaction: (
    root: string,
    directory: StudioDirectoryAuthorityV2,
    expectedManifest: { bytes: string; identity: StudioFileIdentityV2 }
  ) => Promise<void>;
  storageError: (error: unknown, fallback: string) => CreativeStudioStoreError;
};

export const createStudioProjectRecordsV2 = (deps: StudioProjectRecordsDepsV2) => {
  const {
    fs,
    maxProjectBytes,
    projectDirectory,
    resolveRootChild,
    isInsideRoot,
    assertRegularFileOrMissing,
    captureDirectoryAuthority,
    assertDirectoryAuthority,
    recoverBriefTransaction,
    storageError,
  } = deps;

  const sniffOversizedStudioProjectSchema = async (
    root: string,
    file: string,
    preliminaryStats: Awaited<ReturnType<typeof fs.lstat>>
  ): Promise<boolean> => {
    const parent = path.dirname(file);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      const parentStats = await fs.lstat(parent);
      if (
        parentStats.isSymbolicLink() ||
        !parentStats.isDirectory() ||
        (await fs.realpath(parent)) !== parent ||
        !isInsideRoot(root, parent)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio project directory is unsafe');
      }
      const flags =
        process.platform === 'win32'
          ? fsConstants.O_RDONLY
          : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
      handle = await fs.open(file, flags);
      const openedStats = await handle.stat();
      if (
        !openedStats.isFile() ||
        openedStats.dev !== preliminaryStats.dev ||
        openedStats.ino !== preliminaryStats.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file changed during schema inspection');
      }

      const isPriorProjectSchema = await hasTopLevelPriorProjectSchemaVersion(handle, openedStats.size);
      const [finalHandleStats, finalPathStats, finalParentStats, finalParent] = await Promise.all([
        handle.stat(),
        fs.lstat(file),
        fs.lstat(parent),
        fs.realpath(parent),
      ]);
      if (
        finalHandleStats.size !== openedStats.size ||
        finalHandleStats.mtimeMs !== openedStats.mtimeMs ||
        finalHandleStats.ctimeMs !== openedStats.ctimeMs ||
        finalPathStats.isSymbolicLink() ||
        !finalPathStats.isFile() ||
        finalPathStats.dev !== openedStats.dev ||
        finalPathStats.ino !== openedStats.ino ||
        finalParentStats.isSymbolicLink() ||
        !finalParentStats.isDirectory() ||
        finalParentStats.dev !== parentStats.dev ||
        finalParentStats.ino !== parentStats.ino ||
        finalParent !== parent
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file changed during schema inspection');
      }
      return isPriorProjectSchema;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Schema-2 Studio file could not be inspected');
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
  };

  const readBoundedStudioV2File = async (
    root: string,
    file: string
  ): Promise<StudioProjectRecordV2 | { status: 'unsupported_prototype_schema' } | null> => {
    let stats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stats = await fs.lstat(file);
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return null;
      throw storageError(error, 'Schema-2 Studio file is unavailable');
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file is unsafe');
    }
    if (stats.size > maxProjectBytes) {
      if (await sniffOversizedStudioProjectSchema(root, file, stats)) {
        return { status: 'unsupported_prototype_schema' };
      }
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file is too large');
    }
    try {
      const record = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file,
        maxBytes: stats.size,
      });
      return record === null ? null : { status: 'bytes', bytes: record.bytes, identity: record.identity };
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio file could not be read');
    }
  };

  const inspectProjectFileV2 = async (root: string, projectId: string): Promise<StudioProjectFileInspectionV2> => {
    const directoryPath = await projectDirectory(root, projectId, false);
    if (directoryPath === null) return { status: 'not_found', projectId };
    const directory = await captureDirectoryAuthority(directoryPath);
    const file = resolveRootChild(directory.path, 'project.json');
    await assertRegularFileOrMissing(file);
    const initialRecord = await readBoundedStudioV2File(root, file);
    if (initialRecord === null) return { status: 'not_found', projectId };
    if (initialRecord.status === 'unsupported_prototype_schema') {
      return { status: 'unsupported_prototype_schema', projectId };
    }
    let initialParsed: unknown;
    try {
      initialParsed = JSON.parse(initialRecord.bytes) as unknown;
    } catch {
      return {
        status: 'malformed_v2',
        projectId,
        error: new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest'),
      };
    }
    if (isRecord(initialParsed) && isUnsupportedStudioPrototypeSchemaVersion(initialParsed.schemaVersion)) {
      return { status: 'unsupported_prototype_schema', projectId };
    }
    if (!isRecord(initialParsed) || initialParsed.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION) {
      return {
        status: 'malformed_v2',
        projectId,
        error: new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest'),
      };
    }
    await recoverBriefTransaction(root, directory, initialRecord);
    await assertRegularFileOrMissing(file);
    const record = await readBoundedStudioV2File(root, file);
    if (record === null) return { status: 'not_found', projectId };
    if (record.status === 'unsupported_prototype_schema') {
      return { status: 'unsupported_prototype_schema', projectId };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(record.bytes) as unknown;
    } catch {
      return {
        status: 'malformed_v2',
        projectId,
        error: new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest'),
      };
    }
    if (isRecord(parsed) && isUnsupportedStudioPrototypeSchemaVersion(parsed.schemaVersion)) {
      return { status: 'unsupported_prototype_schema', projectId };
    }
    let briefFile: Extract<StudioProjectFileInspectionV2, { status: 'supported' }>['briefFile'];
    try {
      const briefRecord = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: resolveRootChild(directory.path, STUDIO_BRIEF_FILE_NAME),
        maxBytes: STUDIO_BRIEF_FILE_MAX_BYTES,
      });
      if (briefRecord === null) {
        return {
          status: 'malformed_v2',
          projectId,
          error: new CreativeStudioStoreError('storage_error', 'Schema-5 Studio Brief is missing'),
        };
      }
      briefFile = { status: 'present', ...briefRecord };
    } catch (error) {
      return {
        status: 'malformed_v2',
        projectId,
        error: storageError(error, 'Schema-2 Studio Brief could not be read'),
      };
    }
    const decoded = decodeStudioProjectManifestV2(parsed, briefFile.status === 'present' ? briefFile.bytes : null);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION ||
      decoded === null ||
      decoded.project.id !== projectId
    ) {
      return {
        status: 'malformed_v2',
        projectId,
        error: new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest'),
      };
    }
    await assertDirectoryAuthority(directory);
    return {
      status: 'supported',
      project: decoded.project,
      bytes: record.bytes,
      identity: record.identity,
      directory,
      briefFile,
      briefSynchronized: decoded.synchronized,
    };
  };

  const requireSupportedProjectInspectionV2 = (
    inspected: StudioProjectFileInspectionV2
  ): Extract<StudioProjectFileInspectionV2, { status: 'supported' }> => {
    if (inspected.status === 'supported') return inspected;
    if (inspected.status === 'not_found') {
      throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    }
    if (inspected.status === 'unsupported_prototype_schema') {
      throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
    }
    throw inspected.error;
  };

  return { inspectProjectFileV2, readBoundedStudioV2File, requireSupportedProjectInspectionV2 };
};
