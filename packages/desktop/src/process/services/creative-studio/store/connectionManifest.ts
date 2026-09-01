/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import type { StudioCancellationPolicy, StudioConnectionBinding } from '@/common/types/project/creativeStudioTypes';
import {
  canonicalizeRecordRoot,
  readBoundedRegularFileWithIdentity,
  resolveConfinedRecordPath,
  type RecordIoFileSystem,
} from '../service/recordIo';
import { durableDirectoryOpenFlags } from '../service/durableDirectory';
import { CreativeStudioStoreError } from './contracts';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const MAX_ID_LENGTH = 256;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MEDIA_KINDS = new Set(['image', 'video']);
const CANCELLATION_POLICIES = new Set<StudioCancellationPolicy>(['none', 'queued_only', 'queued_and_running']);
const ADAPTER_IDS = new Set([
  'weprompt-image-v1',
  'byteplus-seedance-v1',
  'weprompt-media-gateway-v1',
  'openrouter-video-v1',
]);
const CONNECTION_BINDING_KEYS = new Set([
  'schemaVersion',
  'id',
  'providerId',
  'adapterId',
  'model',
  'capabilities',
  'validatedAt',
]);
const CONNECTION_MANIFEST_KEYS = new Set(['schemaVersion', 'connections']);
const CONNECTION_CAPABILITY_KEYS = new Set([
  'mediaKinds',
  'audioModes',
  'aspectRatios',
  'resolutions',
  'minDurationSeconds',
  'maxDurationSeconds',
  'supportedDurationSeconds',
  'supportsFirstFrame',
  'maxConditioningImages',
  'cancellationPolicy',
]);
const FORBIDDEN_CONNECTION_KEY_FRAGMENTS = [
  'authorization',
  'credential',
  'token',
  'secret',
  'key',
  'url',
  'uri',
  'path',
  'base64',
  'bytes',
  'raw',
  'metadata',
] as const;

type JsonRecord = Record<string, unknown>;

export type StudioConnectionManifestV1 = {
  listConnections(): Promise<StudioConnectionBinding[]>;
  saveConnection(binding: StudioConnectionBinding): Promise<StudioConnectionBinding>;
  removeConnection(connectionId: string): Promise<boolean>;
};

export type StudioConnectionManifestDepsV1 = {
  rootDir: string;
  fs?: RecordIoFileSystem;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const isSafeConnectionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_ID_LENGTH && SAFE_ID.test(value);

const isSafeConnectionModel = (value: unknown): value is string => {
  if (!isString(value) || value.length === 0 || value.length > 256 || value !== value.trim()) return false;
  return !value.split('').some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
};

const isCanonicalIsoTimestamp = (value: unknown): value is string => {
  if (!isString(value) || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const normalizeConnectionFieldKey = (key: string): string =>
  key
    .normalize('NFKC')
    .replaceAll(/[^A-Za-z0-9]/g, '')
    .toLowerCase();

const containsForbiddenConnectionField = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsForbiddenConnectionField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nestedValue]) => {
    const normalized = normalizeConnectionFieldKey(key);
    return (
      FORBIDDEN_CONNECTION_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment)) ||
      containsForbiddenConnectionField(nestedValue)
    );
  });
};

const validateConnectionBinding = (value: unknown, allowLegacyOpenRouter = false): value is StudioConnectionBinding => {
  if (!isRecord(value) || !isRecord(value.capabilities)) return false;
  const capabilities = value.capabilities;
  const mediaKinds = capabilities.mediaKinds;
  const validKinds =
    Array.isArray(mediaKinds) &&
    mediaKinds.length > 0 &&
    mediaKinds.length <= 2 &&
    mediaKinds.every((kind) => isString(kind) && MEDIA_KINDS.has(kind)) &&
    new Set(mediaKinds).size === mediaKinds.length;
  const optionalAudioModes =
    capabilities.audioModes === undefined ||
    (Array.isArray(capabilities.audioModes) &&
      capabilities.audioModes.length === 1 &&
      (capabilities.audioModes[0] === 'none' ||
        (value.adapterId === 'openrouter-video-v1' && capabilities.audioModes[0] === 'audio')));
  const optionalAspectRatios =
    capabilities.aspectRatios === undefined ||
    (Array.isArray(capabilities.aspectRatios) &&
      capabilities.aspectRatios.length <= 5 &&
      capabilities.aspectRatios.every((ratio) => isString(ratio) && ASPECT_RATIOS.has(ratio)) &&
      new Set(capabilities.aspectRatios).size === capabilities.aspectRatios.length);
  const optionalResolutions =
    capabilities.resolutions === undefined ||
    (Array.isArray(capabilities.resolutions) &&
      capabilities.resolutions.length <= 2 &&
      capabilities.resolutions.every((resolution) => isString(resolution) && RESOLUTIONS.has(resolution)) &&
      new Set(capabilities.resolutions).size === capabilities.resolutions.length);
  const supportedDurationSeconds = capabilities.supportedDurationSeconds;
  const optionalSupportedDurations =
    supportedDurationSeconds === undefined ||
    (Array.isArray(supportedDurationSeconds) &&
      supportedDurationSeconds.length > 0 &&
      supportedDurationSeconds.length <= 12 &&
      supportedDurationSeconds.every(
        (duration, index) =>
          isIntegerInRange(duration, 4, 15) &&
          (index === 0 || (supportedDurationSeconds[index - 1] as number) < duration)
      ));
  const supportedDurationEndpointsMatch =
    supportedDurationSeconds === undefined ||
    (Array.isArray(supportedDurationSeconds) &&
      capabilities.minDurationSeconds === supportedDurationSeconds[0] &&
      capabilities.maxDurationSeconds === supportedDurationSeconds.at(-1));
  const validAdapterCapabilities =
    value.adapterId === 'weprompt-image-v1'
      ? Array.isArray(mediaKinds) &&
        mediaKinds.length === 1 &&
        mediaKinds[0] === 'image' &&
        capabilities.audioModes === undefined
      : value.adapterId === 'openrouter-video-v1'
        ? Array.isArray(mediaKinds) &&
          mediaKinds.length === 1 &&
          mediaKinds[0] === 'video' &&
          Array.isArray(capabilities.audioModes) &&
          capabilities.audioModes.length === 1 &&
          (capabilities.audioModes[0] === 'none' || capabilities.audioModes[0] === 'audio') &&
          Array.isArray(capabilities.aspectRatios) &&
          capabilities.aspectRatios.length > 0 &&
          Array.isArray(capabilities.resolutions) &&
          capabilities.resolutions.length > 0 &&
          (allowLegacyOpenRouter ||
            (Array.isArray(capabilities.supportedDurationSeconds) &&
              capabilities.supportedDurationSeconds.length > 0)) &&
          capabilities.maxConditioningImages === 0 &&
          capabilities.cancellationPolicy === 'none'
        : (value.adapterId === 'byteplus-seedance-v1' || value.adapterId === 'weprompt-media-gateway-v1') &&
          Array.isArray(mediaKinds) &&
          mediaKinds.length === 1 &&
          mediaKinds[0] === 'video' &&
          Array.isArray(capabilities.audioModes) &&
          capabilities.audioModes.length === 1 &&
          capabilities.audioModes[0] === 'none';
  return (
    Object.keys(value).length === CONNECTION_BINDING_KEYS.size &&
    Object.keys(value).every((key) => CONNECTION_BINDING_KEYS.has(key)) &&
    value.schemaVersion === 1 &&
    isSafeConnectionId(value.id) &&
    isSafeConnectionId(value.providerId) &&
    isString(value.adapterId) &&
    ADAPTER_IDS.has(value.adapterId) &&
    isSafeConnectionModel(value.model) &&
    Object.keys(capabilities).every((key) => CONNECTION_CAPABILITY_KEYS.has(key)) &&
    validKinds &&
    validAdapterCapabilities &&
    optionalAudioModes &&
    optionalAspectRatios &&
    optionalResolutions &&
    (capabilities.supportsFirstFrame === undefined || typeof capabilities.supportsFirstFrame === 'boolean') &&
    (capabilities.maxConditioningImages === undefined || isIntegerInRange(capabilities.maxConditioningImages, 0, 6)) &&
    isString(capabilities.cancellationPolicy) &&
    CANCELLATION_POLICIES.has(capabilities.cancellationPolicy as StudioCancellationPolicy) &&
    (capabilities.minDurationSeconds === undefined || isIntegerInRange(capabilities.minDurationSeconds, 1, 60)) &&
    (capabilities.maxDurationSeconds === undefined || isIntegerInRange(capabilities.maxDurationSeconds, 1, 60)) &&
    optionalSupportedDurations &&
    (capabilities.minDurationSeconds === undefined ||
      capabilities.maxDurationSeconds === undefined ||
      (capabilities.minDurationSeconds as number) <= (capabilities.maxDurationSeconds as number)) &&
    supportedDurationEndpointsMatch &&
    isCanonicalIsoTimestamp(value.validatedAt) &&
    !containsForbiddenConnectionField(value)
  );
};

const canonicalizeConnectionBinding = (
  value: unknown,
  allowLegacyOpenRouter = false
): StudioConnectionBinding | null => {
  if (!isRecord(value) || !isRecord(value.capabilities)) return null;
  const capabilities = value.capabilities;
  const hasPolicy = Object.hasOwn(capabilities, 'cancellationPolicy');
  const hasLegacy = Object.hasOwn(capabilities, 'cancellation');
  if (hasPolicy && hasLegacy) return null;

  let cancellationPolicy: StudioCancellationPolicy;
  if (hasPolicy) {
    if (!isString(capabilities.cancellationPolicy)) return null;
    cancellationPolicy = capabilities.cancellationPolicy as StudioCancellationPolicy;
    if (!CANCELLATION_POLICIES.has(cancellationPolicy)) return null;
  } else if (hasLegacy) {
    if (typeof capabilities.cancellation !== 'boolean') return null;
    cancellationPolicy = capabilities.cancellation ? 'queued_only' : 'none';
  } else {
    cancellationPolicy = 'none';
  }

  const { cancellation: _legacyCancellation, ...canonicalCapabilities } = capabilities;
  const candidate = {
    ...value,
    capabilities: { ...canonicalCapabilities, cancellationPolicy },
  };
  return validateConnectionBinding(candidate, allowLegacyOpenRouter) ? candidate : null;
};

let temporaryFileCounter = 0;

/** Independent schema-1 connection manifest; it never constructs or inspects a Studio project reader. */
export const createStudioConnectionManifestV1 = (deps: StudioConnectionManifestDepsV1): StudioConnectionManifestV1 => {
  const fs = deps.fs ?? nodeFs;
  const rootDir = path.resolve(deps.rootDir);
  let queue: Promise<unknown> = Promise.resolve();

  const fail = (error: unknown, fallback: string): CreativeStudioStoreError =>
    new CreativeStudioStoreError('storage_error', error instanceof Error ? error.message : fallback);

  const canonicalRoot = async (): Promise<string> => {
    try {
      return await canonicalizeRecordRoot({ fs, rootDir });
    } catch (error) {
      throw fail(error, 'Creative Studio root is unavailable');
    }
  };

  const manifestFile = async (root: string): Promise<string> => {
    let file: string;
    try {
      file = resolveConfinedRecordPath(root, root, 'connections.json');
    } catch (error) {
      throw fail(error, 'Creative Studio connection storage escaped its root');
    }
    try {
      const stats = await fs.lstat(file);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio connection manifest is unsafe');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return file;
      throw fail(error, 'Studio connection manifest is unavailable');
    }
    return file;
  };

  const readConnections = async (root: string): Promise<StudioConnectionBinding[]> => {
    const file = await manifestFile(root);
    let persisted: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      persisted = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file,
        maxBytes: MAX_MANIFEST_BYTES,
      });
    } catch (error) {
      throw fail(error, 'Studio connection storage read failed');
    }
    if (persisted === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(persisted.bytes) as unknown;
    } catch (error) {
      throw fail(error, 'Malformed Studio connection manifest');
    }
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).length !== CONNECTION_MANIFEST_KEYS.size ||
      !Object.keys(parsed).every((key) => CONNECTION_MANIFEST_KEYS.has(key)) ||
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.connections)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Malformed Studio connection manifest');
    }
    const connections = parsed.connections.map((connection) => canonicalizeConnectionBinding(connection, true));
    if (connections.some((connection) => connection === null)) {
      throw new CreativeStudioStoreError('storage_error', 'Malformed Studio connection manifest');
    }
    return (connections as StudioConnectionBinding[]).toSorted((left, right) => left.id.localeCompare(right.id));
  };

  const writeConnections = async (root: string, connections: readonly StudioConnectionBinding[]): Promise<void> => {
    const file = await manifestFile(root);
    const bytes = JSON.stringify({ schemaVersion: 1, connections }, null, 2);
    if (Buffer.byteLength(bytes, 'utf8') > MAX_MANIFEST_BYTES) {
      throw new CreativeStudioStoreError('storage_error', 'Studio connection manifest is too large');
    }
    const parent = path.dirname(file);
    const parentStats = await fs.lstat(parent);
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || (await fs.realpath(parent)) !== parent) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage parent is unsafe');
    }
    const temporary = `${file}.${process.pid}.${++temporaryFileCounter}.tmp`;
    let handle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
    let parentHandle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
    let ownedIdentity: { dev: number; ino: number } | undefined;
    let published = false;
    try {
      parentHandle = await fs.open(parent, durableDirectoryOpenFlags());
      const heldParent = await parentHandle.stat();
      if (!heldParent.isDirectory() || heldParent.dev !== parentStats.dev || heldParent.ino !== parentStats.ino) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage parent changed');
      }
      handle = await fs.open(temporary, 'wx');
      await handle.writeFile(bytes, { encoding: 'utf8' });
      await handle.sync();
      const written = await handle.stat();
      const named = await fs.lstat(temporary);
      if (
        !written.isFile() ||
        named.isSymbolicLink() ||
        !named.isFile() ||
        written.dev !== named.dev ||
        written.ino !== named.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio connection temporary changed');
      }
      ownedIdentity = { dev: written.dev, ino: written.ino };
      const proof = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: temporary,
        maxBytes: MAX_MANIFEST_BYTES,
      });
      const currentParent = await fs.lstat(parent);
      if (
        proof === null ||
        proof.bytes !== bytes ||
        proof.identity.dev !== written.dev ||
        proof.identity.ino !== written.ino ||
        currentParent.isSymbolicLink() ||
        !currentParent.isDirectory() ||
        currentParent.dev !== parentStats.dev ||
        currentParent.ino !== parentStats.ino ||
        (await fs.realpath(parent)) !== parent
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio connection publication authority changed');
      }
      await fs.rename(temporary, file);
      published = true;
      const installed = await fs.lstat(file);
      if (
        installed.isSymbolicLink() ||
        !installed.isFile() ||
        installed.dev !== written.dev ||
        installed.ino !== written.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio connection publication changed');
      }
      await handle.close();
      handle = undefined;
      await parentHandle.sync();
      const finalParent = await fs.lstat(parent);
      if (
        finalParent.isSymbolicLink() ||
        !finalParent.isDirectory() ||
        finalParent.dev !== parentStats.dev ||
        finalParent.ino !== parentStats.ino ||
        (await fs.realpath(parent)) !== parent
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage parent changed');
      }
      await parentHandle.close();
      parentHandle = undefined;
    } catch (error) {
      await handle?.close().catch((): undefined => undefined);
      await parentHandle?.close().catch((): undefined => undefined);
      if (!published && ownedIdentity !== undefined) {
        try {
          const current = await readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: root,
            file: temporary,
            maxBytes: MAX_MANIFEST_BYTES,
          });
          if (
            current !== null &&
            current.bytes === bytes &&
            current.identity.dev === ownedIdentity.dev &&
            current.identity.ino === ownedIdentity.ino
          ) {
            await fs.rm(temporary);
          }
        } catch {
          // A replaced or unavailable temporary is no longer ours to remove.
        }
      }
      throw error instanceof CreativeStudioStoreError ? error : fail(error, 'Studio connection storage write failed');
    }
  };

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.catch((): undefined => undefined).then(operation);
    queue = next.catch((): undefined => undefined);
    return next;
  };

  return {
    async listConnections() {
      return readConnections(await canonicalRoot());
    },
    async saveConnection(binding) {
      const canonicalBinding = canonicalizeConnectionBinding(binding);
      if (canonicalBinding === null) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio connection binding');
      }
      return enqueue(async () => {
        const root = await canonicalRoot();
        const current = await readConnections(root);
        const next = [
          ...current.filter(
            (connection) =>
              connection.id !== canonicalBinding.id &&
              !(
                connection.providerId === canonicalBinding.providerId &&
                connection.adapterId === canonicalBinding.adapterId &&
                connection.model === canonicalBinding.model
              )
          ),
          structuredClone(canonicalBinding),
        ].toSorted((left, right) => left.id.localeCompare(right.id));
        await writeConnections(root, next);
        return structuredClone(canonicalBinding);
      });
    },
    async removeConnection(connectionId) {
      if (!isSafeConnectionId(connectionId)) return false;
      return enqueue(async () => {
        const root = await canonicalRoot();
        const current = await readConnections(root);
        const next = current.filter((connection) => connection.id !== connectionId);
        if (next.length === current.length) return false;
        await writeConnections(root, next);
        return true;
      });
    },
  };
};
