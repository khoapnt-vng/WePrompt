/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { Dirent, promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { readBoundedRegularFileWithIdentity, resolveCompleteDirectorySet } from '../service/recordIo';
import { CreativeStudioStoreError } from './contracts';
import type { StudioDirectoryAuthorityV2, StudioFileIdentityV2 } from './projectTransactions';

/* eslint-disable no-await-in-loop -- journal recovery is intentionally reconciled in lexical durable-phase order. */

const IDENTITY_BOUND_CLEANUP_PATTERN = /^(.*)\.(0|[1-9]\d*)_(0|[1-9]\d*)_([a-f0-9]{64})\.cleanup$/;

type StudioRecordParseResult<RecordType> =
  | { status: 'valid'; record: RecordType }
  | { status: 'unsupported_prototype_schema' }
  | { status: 'invalid' };

export type StudioIdentifiedRecordV2<RecordType> = {
  file: string;
  bytes: string;
  identity: StudioFileIdentityV2;
  record: RecordType;
  quarantined: boolean;
};

export type StudioCapturedWriterResidueV2 = {
  family: 'pending' | 'slots';
  identified: StudioIdentifiedRecordV2<null>;
  namedFile: string;
  phase: 'tmp' | 'ready' | 'cleanup';
  effective: boolean;
};

export type StudioWriterPublicationResidueV2 = Omit<StudioCapturedWriterResidueV2, 'family'>;

type SidecarJournalDepsV2 = {
  fs: typeof nodeFs;
  defaultMaxRecordBytes: number;
  storageError: (error: unknown, fallback: string) => CreativeStudioStoreError;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sha256Utf8 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');

const sameIdentityV2 = (left: StudioFileIdentityV2, right: StudioFileIdentityV2): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const isCanonicalV2SlotFileName = (value: string, capacity: number): boolean => {
  const match = /^(0|[1-9]\d*)\.slot$/.exec(value);
  if (match?.[1] === undefined) return false;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index >= 0 && index < capacity;
};

export const createStudioSidecarJournalV2 = (deps: SidecarJournalDepsV2) => {
  const { fs, defaultMaxRecordBytes, storageError } = deps;

  const identityBoundCleanupNameV2 = (identified: StudioIdentifiedRecordV2<unknown>): string =>
    `${identified.file}.${identified.identity.dev}_${identified.identity.ino}_${sha256Utf8(identified.bytes)}.cleanup`;

  const parseIdentityBoundCleanupNameV2 = (
    name: string
  ): { namedFileName: string; identity: StudioFileIdentityV2; digest: string } | null => {
    const match = IDENTITY_BOUND_CLEANUP_PATTERN.exec(name);
    if (
      match === null ||
      match[1] === undefined ||
      match[2] === undefined ||
      match[3] === undefined ||
      match[4] === undefined
    ) {
      return null;
    }
    const dev = Number(match[2]);
    const ino = Number(match[3]);
    if (!Number.isSafeInteger(dev) || !Number.isSafeInteger(ino)) return null;
    return { namedFileName: match[1], identity: { dev, ino }, digest: match[4] };
  };

  const captureDirectoryAuthorityV2 = async (directory: string): Promise<StudioDirectoryAuthorityV2> => {
    try {
      const stats = await fs.lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio directory authority changed');
      }
      return { path: directory, dev: stats.dev, ino: stats.ino };
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio directory authority is unavailable');
    }
  };

  const assertDirectoryAuthorityV2 = async (authority: StudioDirectoryAuthorityV2): Promise<void> => {
    const current = await captureDirectoryAuthorityV2(authority.path);
    if (!sameIdentityV2(current, authority)) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio directory authority changed');
    }
  };

  const syncDirectoryAuthorityV2 = async (authority: StudioDirectoryAuthorityV2): Promise<void> => {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      await assertDirectoryAuthorityV2(authority);
      handle = await fs.open(authority.path, 'r');
      const stats = await handle.stat();
      if (!stats.isDirectory() || !sameIdentityV2(stats, authority)) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio directory authority changed');
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      await assertDirectoryAuthorityV2(authority);
    } catch (error) {
      await handle?.close().catch((): undefined => undefined);
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio directory sync failed');
    }
  };

  const assertPathAbsentV2 = async (file: string): Promise<void> => {
    try {
      await fs.lstat(file);
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal authority changed');
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw storageError(error, 'Studio proposal authority could not be verified');
      }
    }
  };

  const readStableDirectoryEntriesV2 = async (authority: StudioDirectoryAuthorityV2): Promise<Dirent[]> => {
    try {
      await assertDirectoryAuthorityV2(authority);
      const entries = await fs.readdir(authority.path, { withFileTypes: true });
      await assertDirectoryAuthorityV2(authority);
      return entries.toSorted((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Schema-2 Studio proposal directory could not be read');
    }
  };

  const assertIdentifiedRecordCurrentV2 = async (input: {
    root: string;
    authority: StudioDirectoryAuthorityV2;
    identified: StudioIdentifiedRecordV2<unknown>;
    maxBytes?: number;
  }): Promise<void> => {
    const maxBytes = input.maxBytes ?? defaultMaxRecordBytes;
    await assertDirectoryAuthorityV2(input.authority);
    let current: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      current = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.identified.file,
        maxBytes,
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio proposal authority changed');
    }
    if (
      current === null ||
      current.bytes !== input.identified.bytes ||
      !sameIdentityV2(current.identity, input.identified.identity)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal authority changed');
    }
    await assertDirectoryAuthorityV2(input.authority);
  };

  const parseIdentifiedJsonV2 = async <RecordType>(input: {
    root: string;
    file: string;
    quarantined?: boolean;
    maxBytes?: number;
    parse: (value: unknown) => StudioRecordParseResult<RecordType>;
  }): Promise<StudioIdentifiedRecordV2<RecordType>> => {
    const maxBytes = input.maxBytes ?? defaultMaxRecordBytes;
    let identified: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      identified = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.file,
        maxBytes,
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio proposal record is unsafe');
    }
    if (identified === null) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal record changed during read');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(identified.bytes) as unknown;
    } catch {
      throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal record');
    }
    const result = input.parse(parsed);
    if (result.status === 'unsupported_prototype_schema') {
      throw new CreativeStudioStoreError(
        'unsupported_prototype_schema',
        'Unsupported prototype Studio proposal schema'
      );
    }
    if (result.status !== 'valid') {
      throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal record');
    }
    return {
      file: input.file,
      bytes: identified.bytes,
      identity: identified.identity,
      record: result.record,
      quarantined: input.quarantined ?? false,
    };
  };

  const resolveCompleteSidecarDirectoryFamilyV2 = async <ChildName extends string>(input: {
    root: string;
    project: StudioDirectoryAuthorityV2;
    rootName: string;
    childNames: readonly ChildName[];
    createIfWhollyAbsent: boolean;
    authorizeBeforePublish?: () => Promise<void>;
    unavailableMessage: string;
  }): Promise<{
    project: StudioDirectoryAuthorityV2;
    root: StudioDirectoryAuthorityV2;
    children: Record<ChildName, StudioDirectoryAuthorityV2>;
  } | null> => {
    await assertDirectoryAuthorityV2(input.project);
    let resolved: ({ root: string } & Record<ChildName, string>) | null;
    try {
      resolved = await resolveCompleteDirectorySet({
        fs,
        canonicalRoot: input.root,
        parent: input.project.path,
        rootName: input.rootName,
        childNames: input.childNames,
        createIfWhollyAbsent: input.createIfWhollyAbsent,
        authorizeBeforePublish: input.authorizeBeforePublish,
      });
    } catch (error) {
      throw storageError(error, input.unavailableMessage);
    }
    if (resolved === null) {
      await input.authorizeBeforePublish?.();
      return null;
    }
    await input.authorizeBeforePublish?.();
    const root = await captureDirectoryAuthorityV2(resolved.root);
    const children = {} as Record<ChildName, StudioDirectoryAuthorityV2>;
    for (const childName of input.childNames) {
      // eslint-disable-next-line no-await-in-loop -- preserve the established family capture order.
      children[childName] = await captureDirectoryAuthorityV2(resolved[childName]);
    }
    await Promise.all([
      assertDirectoryAuthorityV2(input.project),
      assertDirectoryAuthorityV2(root),
      ...input.childNames.map((childName) => assertDirectoryAuthorityV2(children[childName])),
    ]);
    await input.authorizeBeforePublish?.();
    return { project: input.project, root, children };
  };

  const publishImmutableJournalRecordV2 = async (input: {
    root: string;
    authority: StudioDirectoryAuthorityV2;
    file: string;
    bytes: string;
    maxBytes?: number;
    authorizeBeforeLink?: (temporary: StudioIdentifiedRecordV2<null>) => Promise<void>;
    retainTemporary?: boolean;
  }): Promise<void> => {
    const maxBytes = input.maxBytes ?? defaultMaxRecordBytes;
    const temporaryFile = `${input.file}.publish`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let temporaryOwned = false;
    let linked = false;
    let temporaryIdentity: Awaited<ReturnType<Awaited<ReturnType<typeof fs.open>>['stat']>> | undefined;
    let identifiedTemporary: StudioIdentifiedRecordV2<null> | undefined;
    try {
      await assertDirectoryAuthorityV2(input.authority);
      await Promise.all([assertPathAbsentV2(input.file), assertPathAbsentV2(temporaryFile)]);
      handle = await fs.open(temporaryFile, 'wx');
      temporaryOwned = true;
      temporaryIdentity = await handle.stat();
      if (!temporaryIdentity.isFile()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication temporary is unsafe');
      }
      await handle.writeFile(input.bytes, { encoding: 'utf8' });
      await handle.sync();
      const writtenIdentity = await handle.stat();
      if (
        !writtenIdentity.isFile() ||
        writtenIdentity.dev !== temporaryIdentity.dev ||
        writtenIdentity.ino !== temporaryIdentity.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication temporary is unsafe');
      }
      await handle.close();
      handle = undefined;
      await assertDirectoryAuthorityV2(input.authority);
      identifiedTemporary = {
        file: temporaryFile,
        bytes: input.bytes,
        identity: temporaryIdentity,
        record: null,
        quarantined: false,
      };
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: identifiedTemporary,
        maxBytes,
      });
      await input.authorizeBeforeLink?.(identifiedTemporary);
      await Promise.all([
        assertDirectoryAuthorityV2(input.authority),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.authority,
          identified: identifiedTemporary,
          maxBytes,
        }),
        assertPathAbsentV2(input.file),
      ]);
      // Re-run caller authority after every asynchronous publication proof. The only remaining
      // source race is the adjacent lstat/link syscall edge, and the hard link itself still
      // enforces exclusive destination publication.
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: identifiedTemporary,
        maxBytes,
      });
      await input.authorizeBeforeLink?.(identifiedTemporary);
      await fs.link(temporaryFile, input.file);
      linked = true;
      await syncDirectoryAuthorityV2(input.authority);
      const named = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.file,
        maxBytes,
      });
      if (
        named === null ||
        named.bytes !== input.bytes ||
        named.identity.dev !== temporaryIdentity.dev ||
        named.identity.ino !== temporaryIdentity.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication changed');
      }
      if (!input.retainTemporary) {
        const namedAuthority: StudioIdentifiedRecordV2<null> = { ...identifiedTemporary, file: input.file };
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.authority,
            identified: identifiedTemporary,
            maxBytes,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.authority,
            identified: namedAuthority,
            maxBytes,
          }),
        ]);
        await fs.rm(temporaryFile);
        await syncDirectoryAuthorityV2(input.authority);
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.authority,
          identified: namedAuthority,
          maxBytes,
        });
      }
    } catch (error) {
      await handle?.close().catch((): undefined => undefined);
      if (temporaryOwned && !linked && temporaryIdentity !== undefined) {
        try {
          const current = await fs.lstat(temporaryFile);
          if (
            current.isSymbolicLink() ||
            !current.isFile() ||
            current.dev !== temporaryIdentity.dev ||
            current.ino !== temporaryIdentity.ino
          ) {
            throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication temporary changed');
          }
          await fs.rm(temporaryFile);
        } catch {
          // A replaced or ambiguous temporary is foreign authority and must be preserved.
        }
      }
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Studio proposal immutable publication failed');
    }
  };

  const reconcileJournalPublicationResiduesV2 = async <RecordType>(input: {
    root: string;
    authority: StudioDirectoryAuthorityV2;
    maxBytes?: number;
    validateNamedBase: (namedBase: string) => boolean;
    parseRecord: (namedBase: string, value: unknown) => RecordType | null;
    deferCleanup?: boolean;
  }): Promise<Array<{ identified: StudioIdentifiedRecordV2<RecordType>; namedFile: string; effective: boolean }>> => {
    const maxBytes = input.maxBytes ?? defaultMaxRecordBytes;
    const deferred: Array<{
      identified: StudioIdentifiedRecordV2<RecordType>;
      namedFile: string;
      effective: boolean;
    }> = [];
    const entries = await readStableDirectoryEntriesV2(input.authority);
    for (const entry of entries) {
      if (!entry.name.endsWith('.publish')) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is unsafe');
      }
      const temporaryFile = path.join(input.authority.path, entry.name);
      const namedFile = temporaryFile.slice(0, -'.publish'.length);
      const namedBase = path.basename(namedFile);
      if (!input.validateNamedBase(namedBase)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is malformed');
      }
      let temporary: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        [temporary, named] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: temporaryFile,
            maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes,
          }),
        ]);
      } catch (error) {
        throw storageError(error, 'Studio proposal publication residue could not be inspected');
      }
      if (temporary === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue changed');
      }
      if (named !== null && (!sameIdentityV2(temporary.identity, named.identity) || temporary.bytes !== named.bytes)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is ambiguous');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(temporary.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is malformed');
      }
      const record = input.parseRecord(namedBase, decoded);
      if (record === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is malformed');
      }
      const identified: StudioIdentifiedRecordV2<RecordType> = {
        file: temporaryFile,
        bytes: temporary.bytes,
        identity: temporary.identity,
        record,
        quarantined: false,
      };
      // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
      await assertIdentifiedRecordCurrentV2({ root: input.root, authority: input.authority, identified, maxBytes });
      if (input.deferCleanup) {
        deferred.push({ identified, namedFile, effective: named === null });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
        await fs.rm(temporaryFile);
      } catch (error) {
        throw storageError(error, 'Studio proposal publication residue could not be removed');
      }
      // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
      await syncDirectoryAuthorityV2(input.authority);
    }
    return deferred;
  };

  const reconcileOwnedPendingPublicationResiduesV2 = async (input: {
    root: string;
    authority: StudioDirectoryAuthorityV2;
    maxBytes: number;
    validateNamedBase: (namedBase: string) => boolean;
    validateRecord: (namedBase: string, value: unknown) => boolean;
    allowForeignNamedPhase?: boolean;
    deferCleanup?: boolean;
  }): Promise<StudioWriterPublicationResidueV2[]> => {
    const deferred: StudioWriterPublicationResidueV2[] = [];
    const entries = await readStableDirectoryEntriesV2(input.authority);
    for (const entry of entries) {
      const match = /^(.*)\.\d+_\d+\.(tmp|ready)$/.exec(entry.name);
      if (match === null) continue;
      const namedBase = match[1];
      if (namedBase === undefined || !input.validateNamedBase(namedBase) || !entry.isFile() || entry.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is malformed');
      }
      const temporaryFile = path.join(input.authority.path, entry.name);
      const namedFile = path.join(input.authority.path, namedBase);
      let temporary: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        [temporary, named] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: temporaryFile,
            maxBytes: input.maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes: input.maxBytes,
          }),
        ]);
      } catch (error) {
        throw storageError(error, 'Studio pending publication residue could not be inspected');
      }
      const foreignNamedPhase =
        named !== null &&
        (temporary === null || temporary.bytes !== named.bytes || !sameIdentityV2(temporary.identity, named.identity));
      if (temporary === null || (foreignNamedPhase && input.allowForeignNamedPhase !== true)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is ambiguous');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(temporary.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is malformed');
      }
      if (!input.validateRecord(namedBase, decoded)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is malformed');
      }
      if (match[2] === 'ready') {
        // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
        const preparation = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: input.root,
          file: `${temporaryFile.slice(0, -'.ready'.length)}.tmp`,
          maxBytes: input.maxBytes,
        });
        if (
          preparation === null ||
          preparation.bytes !== temporary.bytes ||
          !sameIdentityV2(preparation.identity, temporary.identity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is ambiguous');
        }
      }
      const identified: StudioIdentifiedRecordV2<null> = {
        file: temporaryFile,
        bytes: temporary.bytes,
        identity: temporary.identity,
        record: null,
        quarantined: false,
      };
      // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified,
        maxBytes: input.maxBytes,
      });
      if (input.deferCleanup) {
        deferred.push({
          identified,
          namedFile,
          phase: match[2] === 'ready' ? 'ready' : 'tmp',
          effective: match[2] === 'ready' && named === null,
        });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
      await syncDirectoryAuthorityV2(input.authority);
      // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified,
        maxBytes: input.maxBytes,
      });
      try {
        // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
        await fs.rm(temporaryFile);
      } catch (error) {
        throw storageError(error, 'Studio pending publication residue could not be removed');
      }
      // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
      await syncDirectoryAuthorityV2(input.authority);
    }
    return deferred;
  };

  const reconcileOwnedSlotCleanupResiduesV2 = async <SlotRecord>(input: {
    root: string;
    pending: StudioDirectoryAuthorityV2;
    slots: StudioDirectoryAuthorityV2;
    maxBytes: number;
    capacity: number;
    recordId: (record: SlotRecord) => string;
    validatePending: (recordId: string, value: unknown) => boolean;
    parse: (value: unknown) => StudioRecordParseResult<SlotRecord>;
    deferCleanup?: boolean;
  }): Promise<Array<{ identified: StudioIdentifiedRecordV2<SlotRecord>; namedFile: string; effective: boolean }>> => {
    const deferred: Array<{
      identified: StudioIdentifiedRecordV2<SlotRecord>;
      namedFile: string;
      effective: boolean;
    }> = [];
    const entries = await readStableDirectoryEntriesV2(input.slots);
    for (const entry of entries) {
      const match = /^((?:0|[1-9]\d*)\.slot)\.\d+_\d+\.cleanup$/.exec(entry.name);
      if (match === null) continue;
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        match[1] === undefined ||
        !isCanonicalV2SlotFileName(match[1], input.capacity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup residue is malformed');
      }
      const quarantineFile = path.join(input.slots.path, entry.name);
      const namedFile = path.join(input.slots.path, match[1]);
      // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
      const quarantined = await parseIdentifiedJsonV2({
        root: input.root,
        file: quarantineFile,
        maxBytes: input.maxBytes,
        parse: input.parse,
      });
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
        named = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: input.root,
          file: namedFile,
          maxBytes: input.maxBytes,
        });
      } catch (error) {
        throw storageError(error, 'Studio slot cleanup named authority could not be inspected');
      }
      if (named !== null) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(named.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup named record is malformed');
        }
        const parsed = input.parse(decoded);
        if (
          parsed.status !== 'valid' ||
          input.recordId(parsed.record) !== input.recordId(quarantined.record) ||
          named.bytes !== quarantined.bytes ||
          !sameIdentityV2(named.identity, quarantined.identity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup residue is ambiguous');
        }
      }
      // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
      await assertDirectoryAuthorityV2(input.pending);
      const pendingFile = path.join(input.pending.path, `${input.recordId(quarantined.record)}.json`);
      let pending: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
        pending = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: input.root,
          file: pendingFile,
          maxBytes: input.maxBytes,
        });
      } catch (error) {
        throw storageError(error, 'Studio slot cleanup residue pending authority could not be inspected');
      }
      if (pending !== null) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(pending.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup pending record is malformed');
        }
        if (!input.validatePending(input.recordId(quarantined.record), decoded)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup pending record is malformed');
        }
      }
      // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
      await Promise.all([
        assertDirectoryAuthorityV2(input.pending),
        assertDirectoryAuthorityV2(input.slots),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.slots,
          identified: quarantined,
          maxBytes: input.maxBytes,
        }),
        ...(pending === null
          ? []
          : [
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.pending,
                identified: {
                  file: pendingFile,
                  bytes: pending.bytes,
                  identity: pending.identity,
                  record: null,
                  quarantined: false,
                },
                maxBytes: input.maxBytes,
              }),
            ]),
        ...(named === null
          ? [assertPathAbsentV2(namedFile)]
          : [
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.slots,
                identified: {
                  file: namedFile,
                  bytes: named.bytes,
                  identity: named.identity,
                  record: null,
                  quarantined: false,
                },
                maxBytes: input.maxBytes,
              }),
            ]),
      ]);
      if (input.deferCleanup) {
        deferred.push({ identified: quarantined, namedFile, effective: named === null && pending !== null });
        continue;
      }
      try {
        if (named !== null || pending === null) {
          // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
          await fs.rm(quarantineFile);
        } else {
          // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
          await fs.rename(quarantineFile, namedFile);
        }
      } catch (error) {
        throw storageError(error, 'Studio slot cleanup residue could not be reconciled');
      }
      // eslint-disable-next-line no-await-in-loop -- residue reconciliation is intentionally lexical.
      await syncDirectoryAuthorityV2(input.slots);
    }
    return deferred;
  };

  const cleanupJournalPublicationResidueV2 = async <RecordType>(input: {
    root: string;
    authority: StudioDirectoryAuthorityV2;
    identified: StudioIdentifiedRecordV2<RecordType>;
    namedFile: string;
    effective: boolean;
    maxBytes: number;
    authorizeProject: () => Promise<void>;
  }): Promise<StudioIdentifiedRecordV2<RecordType>> => {
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: input.identified,
      maxBytes: input.maxBytes,
    });
    if (input.effective) {
      await assertPathAbsentV2(input.namedFile);
      await input.authorizeProject();
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: input.identified,
        maxBytes: input.maxBytes,
      });
      try {
        await fs.link(input.identified.file, input.namedFile);
      } catch (error) {
        if (!isRecord(error) || error.code !== 'EEXIST') {
          throw storageError(error, 'Studio journal publication residue could not be promoted');
        }
      }
      await syncDirectoryAuthorityV2(input.authority);
      const named = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.namedFile,
        maxBytes: input.maxBytes,
      });
      if (
        named === null ||
        named.bytes !== input.identified.bytes ||
        !sameIdentityV2(named.identity, input.identified.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio journal publication promotion changed');
      }
    }
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: input.identified,
      maxBytes: input.maxBytes,
    });
    const named = await readBoundedRegularFileWithIdentity({
      fs,
      canonicalRoot: input.root,
      file: input.namedFile,
      maxBytes: input.maxBytes,
    });
    if (
      named === null ||
      named.bytes !== input.identified.bytes ||
      !sameIdentityV2(named.identity, input.identified.identity)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio journal publication authority changed');
    }
    await input.authorizeProject();
    const identifiedNamed: StudioIdentifiedRecordV2<RecordType> = {
      ...input.identified,
      file: input.namedFile,
    };
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: identifiedNamed,
      maxBytes: input.maxBytes,
    });
    // Keep the recognized publication companion as a durable recovery hardlink. It is removed
    // only with the terminal relation that makes the underlying journal record unnecessary.
    return identifiedNamed;
  };

  const removeJournalPublicationCompanionV2 = async (input: {
    root: string;
    authority: StudioDirectoryAuthorityV2;
    named: StudioIdentifiedRecordV2<unknown>;
    maxBytes: number;
    authorize: () => Promise<void>;
  }): Promise<void> => {
    const companionFile = `${input.named.file}.publish`;
    let companion: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      companion = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: companionFile,
        maxBytes: input.maxBytes,
      });
    } catch (error) {
      throw storageError(error, 'Studio journal recovery companion could not be inspected');
    }
    if (companion === null) return;
    if (companion.bytes !== input.named.bytes || !sameIdentityV2(companion.identity, input.named.identity)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio journal recovery companion is ambiguous');
    }
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: input.named,
        maxBytes: input.maxBytes,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: {
          file: companionFile,
          bytes: companion.bytes,
          identity: companion.identity,
          record: null,
          quarantined: false,
        },
        maxBytes: input.maxBytes,
      }),
    ]);
    await input.authorize();
    try {
      await fs.rm(companionFile);
    } catch (error) {
      throw storageError(error, 'Studio journal recovery companion could not be removed');
    }
    await syncDirectoryAuthorityV2(input.authority);
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: input.named,
      maxBytes: input.maxBytes,
    });
  };

  const cleanupCapturedWriterResiduesV2 = async <SlotRecord>(input: {
    root: string;
    pending: StudioDirectoryAuthorityV2;
    slots: StudioDirectoryAuthorityV2;
    residues: Array<{
      family: 'pending' | 'slots';
      identified: StudioIdentifiedRecordV2<null>;
      namedFile: string;
      phase: 'tmp' | 'ready' | 'cleanup';
      effective: boolean;
    }>;
    maxBytes: number;
    capacity: number;
    parseSlot: (
      value: unknown
    ) => { status: 'valid'; record: SlotRecord } | { status: 'unsupported_prototype_schema' } | { status: 'invalid' };
    recordId: (record: SlotRecord) => string;
    validatePending: (recordId: string, value: unknown) => boolean;
    authorizeProject: () => Promise<void>;
    recoveryAction: (residue: {
      family: 'pending' | 'slots';
      identified: StudioIdentifiedRecordV2<null>;
      namedFile: string;
      phase: 'tmp' | 'ready' | 'cleanup';
      effective: boolean;
    }) => Promise<'promote' | 'rollback' | 'retain'>;
  }): Promise<void> => {
    const orderedResidues = [...input.residues].toSorted(
      (left, right) => Number(right.phase === 'ready') - Number(left.phase === 'ready')
    );
    const removedResidueFiles = new Set<string>();
    const assertValidForeignNamedPhaseV2 = (collision: {
      family: 'pending' | 'slots';
      namedFile: string;
      phaseBytes: string;
      namedBytes: string;
    }): void => {
      let phaseValue: unknown;
      let namedValue: unknown;
      try {
        phaseValue = JSON.parse(collision.phaseBytes) as unknown;
        namedValue = JSON.parse(collision.namedBytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
      }
      if (collision.family === 'pending') {
        const namedBase = path.basename(collision.namedFile);
        if (!namedBase.endsWith('.json')) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
        }
        const recordId = namedBase.slice(0, -'.json'.length);
        if (!input.validatePending(recordId, phaseValue) || !input.validatePending(recordId, namedValue)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
        }
        return;
      }
      const phaseSlot = input.parseSlot(phaseValue);
      const namedSlot = input.parseSlot(namedValue);
      if (
        phaseSlot.status !== 'valid' ||
        namedSlot.status !== 'valid' ||
        input.recordId(phaseSlot.record) === input.recordId(namedSlot.record)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
      }
    };
    for (const residue of orderedResidues) {
      if (removedResidueFiles.has(residue.identified.file)) continue;
      const authority = residue.family === 'pending' ? input.pending : input.slots;
      if (residue.identified.file.endsWith('.tmp')) {
        const readyFile = `${residue.identified.file.slice(0, -'.tmp'.length)}.ready`;
        const namedFile = residue.identified.file.replace(/\.\d+_\d+\.tmp$/, '');
        const [ready, named] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: readyFile,
            maxBytes: input.maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes: input.maxBytes,
          }),
        ]);
        const namedIsExact =
          named !== null &&
          named.bytes === residue.identified.bytes &&
          sameIdentityV2(named.identity, residue.identified.identity);
        if (named !== null && !namedIsExact) {
          assertValidForeignNamedPhaseV2({
            family: residue.family,
            namedFile,
            phaseBytes: residue.identified.bytes,
            namedBytes: named.bytes,
          });
        }
        if (ready !== null) {
          if (
            ready.bytes !== residue.identified.bytes ||
            !sameIdentityV2(ready.identity, residue.identified.identity) ||
            named === null
          ) {
            throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
          }
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          continue;
        }
        if (named !== null && !namedIsExact) {
          const identifiedNamed: StudioIdentifiedRecordV2<null> = {
            file: namedFile,
            bytes: named.bytes,
            identity: named.identity,
            record: null,
            quarantined: false,
          };
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedNamed,
              maxBytes: input.maxBytes,
            }),
          ]);
          await input.authorizeProject();
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedNamed,
              maxBytes: input.maxBytes,
            }),
          ]);
          await input.authorizeProject();
          try {
            await fs.rm(residue.identified.file);
            await syncDirectoryAuthorityV2(authority);
          } catch (error) {
            throw storageError(error, 'Studio writer collision residue could not be rolled back');
          }
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: identifiedNamed,
            maxBytes: input.maxBytes,
          });
          removedResidueFiles.add(residue.identified.file);
          continue;
        }
      }
      const readyMatch = /^(.*)\.\d+_\d+\.ready$/.exec(path.basename(residue.identified.file));
      if (readyMatch?.[1] !== undefined) {
        const namedFile = residue.namedFile;
        let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
        let temporary: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
        try {
          // eslint-disable-next-line no-await-in-loop
          [named, temporary] = await Promise.all([
            readBoundedRegularFileWithIdentity({
              fs,
              canonicalRoot: input.root,
              file: namedFile,
              maxBytes: input.maxBytes,
            }),
            readBoundedRegularFileWithIdentity({
              fs,
              canonicalRoot: input.root,
              file: `${residue.identified.file.slice(0, -'.ready'.length)}.tmp`,
              maxBytes: input.maxBytes,
            }),
          ]);
        } catch (error) {
          throw storageError(error, 'Studio writer recovery authority could not be inspected');
        }
        if (
          temporary === null ||
          temporary.bytes !== residue.identified.bytes ||
          !sameIdentityV2(temporary.identity, residue.identified.identity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
        }
        if (
          named !== null &&
          (named.bytes !== residue.identified.bytes || !sameIdentityV2(named.identity, residue.identified.identity))
        ) {
          assertValidForeignNamedPhaseV2({
            family: residue.family,
            namedFile,
            phaseBytes: residue.identified.bytes,
            namedBytes: named.bytes,
          });

          const temporaryFile = `${residue.identified.file.slice(0, -'.ready'.length)}.tmp`;
          const identifiedTemporary: StudioIdentifiedRecordV2<null> = {
            file: temporaryFile,
            bytes: temporary.bytes,
            identity: temporary.identity,
            record: null,
            quarantined: false,
          };
          const identifiedNamed: StudioIdentifiedRecordV2<null> = {
            file: namedFile,
            bytes: named.bytes,
            identity: named.identity,
            record: null,
            quarantined: false,
          };
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedTemporary,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedNamed,
              maxBytes: input.maxBytes,
            }),
          ]);
          // A distinct valid inode owns the exclusive canonical name, proving this phase never
          // committed. Roll back only the exact owned pair, ready first so an interrupted cleanup
          // leaves canonical + tmp, which remains safely recoverable on the next fence.
          await input.authorizeProject();
          try {
            await fs.rm(residue.identified.file);
            await syncDirectoryAuthorityV2(authority);
            await input.authorizeProject();
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority,
                identified: identifiedTemporary,
                maxBytes: input.maxBytes,
              }),
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority,
                identified: identifiedNamed,
                maxBytes: input.maxBytes,
              }),
            ]);
            await fs.rm(temporaryFile);
            await syncDirectoryAuthorityV2(authority);
          } catch (error) {
            throw storageError(error, 'Studio writer collision residue could not be rolled back');
          }
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: identifiedNamed,
            maxBytes: input.maxBytes,
          });
          removedResidueFiles.add(residue.identified.file);
          removedResidueFiles.add(temporaryFile);
          continue;
        }
        // The durable ready hardlink remains beside the immutable pending record. It is recovery
        // authority if the canonical name is lost; terminal slot cleanup removes its own twin.
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority,
          identified: residue.identified,
          maxBytes: input.maxBytes,
        });
        if (named === null) {
          if (!residue.effective) {
            throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery phase is not committed');
          }
          // eslint-disable-next-line no-await-in-loop
          const action = await input.recoveryAction(residue);
          if (action === 'rollback') {
            // eslint-disable-next-line no-await-in-loop
            await input.authorizeProject();
            // eslint-disable-next-line no-await-in-loop
            await assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            });
            // eslint-disable-next-line no-await-in-loop
            await input.authorizeProject();
            try {
              // eslint-disable-next-line no-await-in-loop
              await fs.rm(residue.identified.file);
            } catch (error) {
              throw storageError(error, 'Studio writer recovery reservation could not be rolled back');
            }
            // eslint-disable-next-line no-await-in-loop
            await syncDirectoryAuthorityV2(authority);
            continue;
          }
          if (action !== 'promote') {
            throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery relation is incomplete');
          }
          // eslint-disable-next-line no-await-in-loop
          await assertPathAbsentV2(namedFile);
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          // Re-prove the phase inode after the asynchronous project/relation fence. A live writer
          // may be completing the same phase concurrently, so exclusive-link EEXIST is accepted
          // only when it already names this exact inode.
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: residue.identified,
            maxBytes: input.maxBytes,
          });
          // Project/schema authority is the terminal cooperative fence before the exclusive link.
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          try {
            // eslint-disable-next-line no-await-in-loop
            await fs.link(residue.identified.file, namedFile);
          } catch (error) {
            if (!isRecord(error) || error.code !== 'EEXIST') {
              throw storageError(error, 'Studio writer recovery authority could not be promoted');
            }
            // eslint-disable-next-line no-await-in-loop
            const existing = await readBoundedRegularFileWithIdentity({
              fs,
              canonicalRoot: input.root,
              file: namedFile,
              maxBytes: input.maxBytes,
            });
            if (
              existing === null ||
              existing.bytes !== residue.identified.bytes ||
              !sameIdentityV2(existing.identity, residue.identified.identity)
            ) {
              throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority changed');
            }
          }
          // eslint-disable-next-line no-await-in-loop
          await syncDirectoryAuthorityV2(authority);
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: { ...residue.identified, file: namedFile },
            maxBytes: input.maxBytes,
          });
        }
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeProject();
        continue;
      }
      if (residue.family === 'pending' || residue.identified.file.endsWith('.tmp')) {
        // The complete ledger already classified this exact temporary. Never rescan the family:
        // a subprocess may be publishing a different record concurrently.
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority,
          identified: residue.identified,
          maxBytes: input.maxBytes,
        });
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeProject();
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority,
          identified: residue.identified,
          maxBytes: input.maxBytes,
        });
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeProject();
        try {
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(residue.identified.file);
        } catch (error) {
          throw storageError(error, 'Studio writer publication residue could not be removed');
        }
        // eslint-disable-next-line no-await-in-loop
        await syncDirectoryAuthorityV2(authority);
        continue;
      }

      const cleanupMatch = /^((?:0|[1-9]\d*)\.slot)\.\d+_\d+\.cleanup$/.exec(path.basename(residue.identified.file));
      let decoded: unknown;
      try {
        decoded = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer slot cleanup residue is malformed');
      }
      const parsed = input.parseSlot(decoded);
      if (
        cleanupMatch?.[1] === undefined ||
        !isCanonicalV2SlotFileName(cleanupMatch[1], input.capacity) ||
        parsed.status !== 'valid'
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer slot cleanup residue is malformed');
      }
      const namedFile = path.join(input.slots.path, cleanupMatch[1]);
      const pendingFile = path.join(input.pending.path, `${input.recordId(parsed.record)}.json`);
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      let pending: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        // eslint-disable-next-line no-await-in-loop
        [named, pending] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes: input.maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: pendingFile,
            maxBytes: input.maxBytes,
          }),
        ]);
      } catch (error) {
        throw storageError(error, 'Studio writer slot cleanup authority could not be inspected');
      }
      if (
        named !== null &&
        (named.bytes !== residue.identified.bytes || !sameIdentityV2(named.identity, residue.identified.identity))
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer slot cleanup authority is ambiguous');
      }
      if (pending !== null) {
        let pendingValue: unknown;
        try {
          pendingValue = JSON.parse(pending.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer pending authority is malformed');
        }
        if (!input.validatePending(input.recordId(parsed.record), pendingValue)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer pending authority is malformed');
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await input.authorizeProject();
      // eslint-disable-next-line no-await-in-loop
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.slots,
        identified: residue.identified,
        maxBytes: input.maxBytes,
      });
      if (named !== null) {
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.slots,
          identified: { ...residue.identified, file: namedFile },
          maxBytes: input.maxBytes,
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await assertPathAbsentV2(namedFile);
      }
      if (pending !== null) {
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.pending,
          identified: {
            file: pendingFile,
            bytes: pending.bytes,
            identity: pending.identity,
            record: null,
            quarantined: false,
          },
          maxBytes: input.maxBytes,
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await assertPathAbsentV2(pendingFile);
      }
      // Project/schema authority is the last awaited fence before changing the captured slot
      // pathname. New writer residues outside this frozen ledger are never consulted or touched.
      // eslint-disable-next-line no-await-in-loop
      await input.authorizeProject();
      try {
        if (named === null && pending !== null) {
          // eslint-disable-next-line no-await-in-loop
          await fs.link(residue.identified.file, namedFile);
          // eslint-disable-next-line no-await-in-loop
          await syncDirectoryAuthorityV2(input.slots);
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.slots,
            identified: { ...residue.identified, file: namedFile },
            maxBytes: input.maxBytes,
          });
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.slots,
            identified: residue.identified,
            maxBytes: input.maxBytes,
          });
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(residue.identified.file);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(residue.identified.file);
        }
      } catch (error) {
        throw storageError(error, 'Studio writer slot cleanup residue could not be reconciled');
      }
      // eslint-disable-next-line no-await-in-loop
      await syncDirectoryAuthorityV2(input.slots);
    }
  };

  const removeReadyPublicationCompanionV2 = async (input: {
    root: string;
    authority: StudioDirectoryAuthorityV2;
    named: StudioIdentifiedRecordV2<unknown>;
    maxBytes: number;
    authorize: () => Promise<void>;
  }): Promise<void> => {
    const namedBase = path.basename(input.named.file);
    const entries = await readStableDirectoryEntriesV2(input.authority);
    const candidates = entries.filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.name.startsWith(`${namedBase}.`) &&
        /^\d+_\d+\.(tmp|ready)$/.test(entry.name.slice(namedBase.length + 1))
    );
    if (candidates.length > 2) {
      throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
    }
    // Remove the durable ready phase before its temporary hardlink. If cleanup is
    // interrupted between the two unlinks, canonical + tmp remains a recoverable
    // state; canonical + ready without its required tmp twin is intentionally not.
    const ordered = candidates.toSorted(
      (left, right) => Number(right.name.endsWith('.ready')) - Number(left.name.endsWith('.ready'))
    );
    for (const candidate of ordered) {
      const companionFile = path.join(input.authority.path, candidate.name);
      // eslint-disable-next-line no-await-in-loop -- companions are removed in durable-phase order.
      const companion = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: companionFile,
        maxBytes: input.maxBytes,
      });
      if (
        companion === null ||
        companion.bytes !== input.named.bytes ||
        !sameIdentityV2(companion.identity, input.named.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
      }
      // eslint-disable-next-line no-await-in-loop -- companions are removed in durable-phase order.
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: input.named,
        maxBytes: input.maxBytes,
      });
      // eslint-disable-next-line no-await-in-loop -- companions are removed in durable-phase order.
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: {
          file: companionFile,
          bytes: companion.bytes,
          identity: companion.identity,
          record: null,
          quarantined: false,
        },
        maxBytes: input.maxBytes,
      });
      // eslint-disable-next-line no-await-in-loop -- companions are removed in durable-phase order.
      await input.authorize();
      // eslint-disable-next-line no-await-in-loop -- companions are removed in durable-phase order.
      await fs.rm(companionFile);
      // eslint-disable-next-line no-await-in-loop -- companions are removed in durable-phase order.
      await syncDirectoryAuthorityV2(input.authority);
    }
  };

  const quarantineRemoveIdentifiedRecordV2 = async <RecordType>(input: {
    root: string;
    authority: StudioDirectoryAuthorityV2;
    identified: StudioIdentifiedRecordV2<RecordType>;
    authorize: () => Promise<void>;
    maxBytes?: number;
  }): Promise<void> => {
    const maxBytes = input.maxBytes ?? defaultMaxRecordBytes;
    let quarantineFile = input.identified.file;
    if (!input.identified.quarantined) {
      quarantineFile = identityBoundCleanupNameV2(input.identified);
      await assertIdentifiedRecordCurrentV2({ ...input, maxBytes });
      await input.authorize();
      await Promise.all([assertIdentifiedRecordCurrentV2({ ...input, maxBytes }), assertPathAbsentV2(quarantineFile)]);
      await input.authorize();
      try {
        await fs.rename(input.identified.file, quarantineFile);
      } catch (error) {
        throw storageError(error, 'Studio proposal record could not be quarantined');
      }
      await syncDirectoryAuthorityV2(input.authority);
      const renamed: StudioIdentifiedRecordV2<RecordType> = {
        ...input.identified,
        file: quarantineFile,
        quarantined: true,
      };
      try {
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.authority,
          identified: renamed,
          maxBytes,
        });
      } catch (error) {
        try {
          await Promise.all([assertDirectoryAuthorityV2(input.authority), assertPathAbsentV2(input.identified.file)]);
          await fs.rename(quarantineFile, input.identified.file);
          await syncDirectoryAuthorityV2(input.authority);
        } catch (restoreError) {
          throw storageError(restoreError, 'Studio proposal quarantine replacement could not be restored');
        }
        if (error instanceof CreativeStudioStoreError) throw error;
        throw storageError(error, 'Studio proposal record changed while being quarantined');
      }
    }

    const quarantined: StudioIdentifiedRecordV2<RecordType> = {
      ...input.identified,
      file: quarantineFile,
      quarantined: true,
    };
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: quarantined,
      maxBytes,
    });
    await input.authorize();
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: quarantined,
      maxBytes,
    });
    await input.authorize();
    try {
      await fs.rm(quarantineFile);
    } catch (error) {
      throw storageError(error, 'Studio proposal quarantine could not be removed');
    }
    await syncDirectoryAuthorityV2(input.authority);
  };

  return {
    assertDirectoryAuthorityV2,
    assertIdentifiedRecordCurrentV2,
    assertPathAbsentV2,
    captureDirectoryAuthorityV2,
    cleanupCapturedWriterResiduesV2,
    cleanupJournalPublicationResidueV2,
    isCanonicalV2SlotFileName,
    parseIdentifiedJsonV2,
    parseIdentityBoundCleanupNameV2,
    publishImmutableJournalRecordV2,
    quarantineRemoveIdentifiedRecordV2,
    readStableDirectoryEntriesV2,
    reconcileJournalPublicationResiduesV2,
    reconcileOwnedPendingPublicationResiduesV2,
    reconcileOwnedSlotCleanupResiduesV2,
    removeJournalPublicationCompanionV2,
    removeReadyPublicationCompanionV2,
    resolveCompleteSidecarDirectoryFamilyV2,
    sameIdentityV2,
    syncDirectoryAuthorityV2,
  };
};
