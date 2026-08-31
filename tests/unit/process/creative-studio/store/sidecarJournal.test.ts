/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  promises as nodeFs,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store/contracts';
import {
  createStudioSidecarJournalV2,
  type StudioIdentifiedRecordV2,
} from '@process/services/creative-studio/store/sidecarJournal';

type JournalRecord = { id: string };

const MAX_RECORD_BYTES = 4_096;

const parseJournalRecord = (value: unknown): { status: 'valid'; record: JournalRecord } | { status: 'invalid' } => {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === 'string'
  ) {
    return { status: 'valid', record: { id: (value as { id: string }).id } };
  }
  return { status: 'invalid' };
};

const storageError = (error: unknown, fallback: string): CreativeStudioStoreError =>
  new CreativeStudioStoreError('storage_error', error instanceof Error ? `${fallback}: ${error.message}` : fallback);

describe('Creative Studio sidecar journal', () => {
  let root: string;
  let records: string;
  let journal: ReturnType<typeof createStudioSidecarJournalV2>;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-sidecar-journal-')));
    records = path.join(root, 'records');
    mkdirSync(records);
    journal = createStudioSidecarJournalV2({
      fs: nodeFs,
      defaultMaxRecordBytes: MAX_RECORD_BYTES,
      storageError,
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const identifyExisting = async <RecordType>(
    file: string,
    bytes: string,
    record: RecordType,
    quarantined = false
  ): Promise<StudioIdentifiedRecordV2<RecordType>> => {
    const stats = await nodeFs.lstat(file);
    return {
      file,
      bytes,
      identity: { dev: stats.dev, ino: stats.ino },
      record,
      quarantined,
    };
  };

  it('validates cleanup identities and canonical slot bounds exactly', () => {
    const digest = 'a'.repeat(64);
    expect(journal.parseIdentityBoundCleanupNameV2(`record.json.12_34_${digest}.cleanup`)).toEqual({
      namedFileName: 'record.json',
      identity: { dev: 12, ino: 34 },
      digest,
    });
    expect(journal.parseIdentityBoundCleanupNameV2(`record.json.01_34_${digest}.cleanup`)).toBeNull();
    expect(journal.parseIdentityBoundCleanupNameV2(`record.json.12_034_${digest}.cleanup`)).toBeNull();
    expect(journal.parseIdentityBoundCleanupNameV2(`record.json.12_34_${'A'.repeat(64)}.cleanup`)).toBeNull();
    expect(
      journal.parseIdentityBoundCleanupNameV2(`record.json.${Number.MAX_SAFE_INTEGER + 1}_34_${digest}.cleanup`)
    ).toBeNull();

    expect(journal.isCanonicalV2SlotFileName('0.slot', 2)).toBe(true);
    expect(journal.isCanonicalV2SlotFileName('1.slot', 2)).toBe(true);
    expect(journal.isCanonicalV2SlotFileName('2.slot', 2)).toBe(false);
    expect(journal.isCanonicalV2SlotFileName('01.slot', 2)).toBe(false);
    expect(journal.isCanonicalV2SlotFileName('-1.slot', 2)).toBe(false);
    expect(journal.isCanonicalV2SlotFileName('not-a-slot', 2)).toBe(false);
    expect(journal.sameIdentityV2({ dev: 1, ino: 2 }, { dev: 1, ino: 2 })).toBe(true);
    expect(journal.sameIdentityV2({ dev: 1, ino: 2 }, { dev: 1, ino: 3 })).toBe(false);
  });

  it('captures stable directory authority, sorts entries, and detects replacement', async () => {
    writeFileSync(path.join(records, 'z.json'), '{}');
    writeFileSync(path.join(records, 'a.json'), '{}');
    const authority = await journal.captureDirectoryAuthorityV2(records);

    await expect(journal.assertPathAbsentV2(path.join(records, 'missing.json'))).resolves.toBeUndefined();
    await expect(journal.assertPathAbsentV2(path.join(records, 'a.json'))).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(journal.readStableDirectoryEntriesV2(authority)).resolves.toSatisfy(
      (entries) => entries.map((entry) => entry.name).join(',') === 'a.json,z.json'
    );

    rmSync(records, { recursive: true });
    mkdirSync(records);
    await expect(journal.assertDirectoryAuthorityV2(authority)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('rejects non-directory and symlink directory authorities', async () => {
    const regularFile = path.join(root, 'regular-file');
    writeFileSync(regularFile, 'not a directory');
    await expect(journal.captureDirectoryAuthorityV2(regularFile)).rejects.toMatchObject({ code: 'storage_error' });

    const link = path.join(root, 'records-link');
    symlinkSync(records, link);
    await expect(journal.captureDirectoryAuthorityV2(link)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('parses identified JSON and fails closed for malformed, unsupported, and stale records', async () => {
    const validFile = path.join(records, 'valid.json');
    const validBytes = JSON.stringify({ id: 'record_1' });
    writeFileSync(validFile, validBytes);
    const identified = await journal.parseIdentifiedJsonV2({
      root,
      file: validFile,
      parse: parseJournalRecord,
      quarantined: true,
    });
    expect(identified.record).toEqual({ id: 'record_1' });
    expect(identified.quarantined).toBe(true);

    const authority = await journal.captureDirectoryAuthorityV2(records);
    await expect(journal.assertIdentifiedRecordCurrentV2({ root, authority, identified })).resolves.toBeUndefined();
    writeFileSync(validFile, JSON.stringify({ id: 'record_2' }));
    await expect(journal.assertIdentifiedRecordCurrentV2({ root, authority, identified })).rejects.toMatchObject({
      code: 'storage_error',
    });

    const malformedFile = path.join(records, 'malformed.json');
    writeFileSync(malformedFile, '{');
    await expect(
      journal.parseIdentifiedJsonV2({ root, file: malformedFile, parse: parseJournalRecord })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const unsupportedFile = path.join(records, 'unsupported.json');
    writeFileSync(unsupportedFile, '{}');
    await expect(
      journal.parseIdentifiedJsonV2({
        root,
        file: unsupportedFile,
        parse: () => ({ status: 'unsupported_prototype_schema' }),
      })
    ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(
      journal.parseIdentifiedJsonV2({ root, file: unsupportedFile, parse: parseJournalRecord })
    ).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('publishes immutable records with the requested companion durability', async () => {
    const authority = await journal.captureDirectoryAuthorityV2(records);
    const firstFile = path.join(records, 'first.json');
    const firstBytes = JSON.stringify({ id: 'first' });
    const authorizeFirst = vi.fn(async () => undefined);

    await journal.publishImmutableJournalRecordV2({
      root,
      authority,
      file: firstFile,
      bytes: firstBytes,
      authorizeBeforeLink: authorizeFirst,
    });
    expect(readFileSync(firstFile, 'utf8')).toBe(firstBytes);
    expect(existsSync(`${firstFile}.publish`)).toBe(false);
    expect(authorizeFirst).toHaveBeenCalledTimes(2);

    const retainedFile = path.join(records, 'retained.json');
    const retainedBytes = JSON.stringify({ id: 'retained' });
    await journal.publishImmutableJournalRecordV2({
      root,
      authority,
      file: retainedFile,
      bytes: retainedBytes,
      retainTemporary: true,
    });
    const namedStats = await nodeFs.lstat(retainedFile);
    const companionStats = await nodeFs.lstat(`${retainedFile}.publish`);
    expect({ dev: namedStats.dev, ino: namedStats.ino }).toEqual({
      dev: companionStats.dev,
      ino: companionStats.ino,
    });
  });

  it('rolls back its owned publication temporary when authorization fails', async () => {
    const authority = await journal.captureDirectoryAuthorityV2(records);
    const file = path.join(records, 'denied.json');

    await expect(
      journal.publishImmutableJournalRecordV2({
        root,
        authority,
        file,
        bytes: JSON.stringify({ id: 'denied' }),
        authorizeBeforeLink: async () => {
          throw new Error('authority expired');
        },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(existsSync(file)).toBe(false);
    expect(existsSync(`${file}.publish`)).toBe(false);

    writeFileSync(file, 'foreign');
    await expect(journal.publishImmutableJournalRecordV2({ root, authority, file, bytes: '{}' })).rejects.toMatchObject(
      { code: 'storage_error' }
    );
    expect(readFileSync(file, 'utf8')).toBe('foreign');
  });

  it('defers, promotes, and terminally removes a journal publication companion', async () => {
    const authority = await journal.captureDirectoryAuthorityV2(records);
    const namedFile = path.join(records, 'record_1.json');
    const publicationFile = `${namedFile}.publish`;
    const bytes = JSON.stringify({ id: 'record_1' });
    writeFileSync(publicationFile, bytes);

    const residues = await journal.reconcileJournalPublicationResiduesV2({
      root,
      authority,
      validateNamedBase: (name) => name === 'record_1.json',
      parseRecord: (_name, value) => {
        const parsed = parseJournalRecord(value);
        return parsed.status === 'valid' ? parsed.record : null;
      },
      deferCleanup: true,
    });
    expect(residues).toHaveLength(1);
    expect(residues[0]?.effective).toBe(true);

    const authorizeProject = vi.fn(async () => undefined);
    const named = await journal.cleanupJournalPublicationResidueV2({
      root,
      authority,
      identified: residues[0]!.identified,
      namedFile,
      effective: true,
      maxBytes: MAX_RECORD_BYTES,
      authorizeProject,
    });
    expect(named.file).toBe(namedFile);
    expect(readFileSync(namedFile, 'utf8')).toBe(bytes);
    expect(existsSync(publicationFile)).toBe(true);

    await journal.removeJournalPublicationCompanionV2({
      root,
      authority,
      named,
      maxBytes: MAX_RECORD_BYTES,
      authorize: async () => undefined,
    });
    expect(existsSync(publicationFile)).toBe(false);
    expect(readFileSync(namedFile, 'utf8')).toBe(bytes);
    await expect(
      journal.removeJournalPublicationCompanionV2({
        root,
        authority,
        named,
        maxBytes: MAX_RECORD_BYTES,
        authorize: async () => undefined,
      })
    ).resolves.toBeUndefined();
  });

  it('rejects malformed and ambiguous journal publication residues', async () => {
    const malformedDirectory = path.join(root, 'malformed-residue');
    mkdirSync(malformedDirectory);
    const malformedAuthority = await journal.captureDirectoryAuthorityV2(malformedDirectory);
    writeFileSync(path.join(malformedDirectory, 'wrong.json.publish'), '{}');
    await expect(
      journal.reconcileJournalPublicationResiduesV2({
        root,
        authority: malformedAuthority,
        validateNamedBase: () => false,
        parseRecord: () => null,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const ambiguousDirectory = path.join(root, 'ambiguous-residue');
    mkdirSync(ambiguousDirectory);
    const ambiguousAuthority = await journal.captureDirectoryAuthorityV2(ambiguousDirectory);
    writeFileSync(path.join(ambiguousDirectory, 'record.json.publish'), JSON.stringify({ id: 'temporary' }));
    writeFileSync(path.join(ambiguousDirectory, 'record.json'), JSON.stringify({ id: 'named' }));
    await expect(
      journal.reconcileJournalPublicationResiduesV2({
        root,
        authority: ambiguousAuthority,
        validateNamedBase: () => true,
        parseRecord: (_name, value) => {
          const parsed = parseJournalRecord(value);
          return parsed.status === 'valid' ? parsed.record : null;
        },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('captures a ready publication pair, promotes it, and removes both owned companions', async () => {
    const authority = await journal.captureDirectoryAuthorityV2(records);
    const namedFile = path.join(records, 'request_1.json');
    const temporaryFile = `${namedFile}.1_2.tmp`;
    const readyFile = `${namedFile}.1_2.ready`;
    const bytes = JSON.stringify({ id: 'request_1' });
    writeFileSync(temporaryFile, bytes);
    linkSync(temporaryFile, readyFile);

    const residues = await journal.reconcileOwnedPendingPublicationResiduesV2({
      root,
      authority,
      maxBytes: MAX_RECORD_BYTES,
      validateNamedBase: (name) => name === 'request_1.json',
      validateRecord: (_name, value) => parseJournalRecord(value).status === 'valid',
      deferCleanup: true,
    });
    expect(residues.map(({ phase, effective }) => ({ phase, effective }))).toEqual([
      { phase: 'ready', effective: true },
      { phase: 'tmp', effective: false },
    ]);

    await journal.cleanupCapturedWriterResiduesV2({
      root,
      pending: authority,
      slots: authority,
      residues: residues.map((residue) => ({
        family: 'pending' as const,
        identified: residue.identified,
        namedFile: residue.namedFile,
        phase: residue.phase,
        effective: residue.effective,
      })),
      maxBytes: MAX_RECORD_BYTES,
      capacity: 2,
      parseSlot: parseJournalRecord,
      recordId: (record) => record.id,
      validatePending: (_recordId, value) => parseJournalRecord(value).status === 'valid',
      authorizeProject: async () => undefined,
      recoveryAction: async () => 'promote',
    });
    expect(readFileSync(namedFile, 'utf8')).toBe(bytes);

    const named = await identifyExisting(namedFile, bytes, { id: 'request_1' });
    const authorize = vi.fn(async () => undefined);
    await journal.removeReadyPublicationCompanionV2({
      root,
      authority,
      named,
      maxBytes: MAX_RECORD_BYTES,
      authorize,
    });
    expect(existsSync(temporaryFile)).toBe(false);
    expect(existsSync(readyFile)).toBe(false);
    expect(existsSync(namedFile)).toBe(true);
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it('accepts a valid foreign pending winner only when requested and rolls back the owned collision', async () => {
    const authority = await journal.captureDirectoryAuthorityV2(records);
    const namedFile = path.join(records, 'request_1.json');
    const temporaryFile = `${namedFile}.1_2.tmp`;
    writeFileSync(temporaryFile, JSON.stringify({ id: 'attempt' }));
    writeFileSync(namedFile, JSON.stringify({ id: 'winner' }));
    const options = {
      root,
      authority,
      maxBytes: MAX_RECORD_BYTES,
      validateNamedBase: (name: string) => name === 'request_1.json',
      validateRecord: (_name: string, value: unknown) => parseJournalRecord(value).status === 'valid',
      deferCleanup: true,
    };

    await expect(journal.reconcileOwnedPendingPublicationResiduesV2(options)).rejects.toMatchObject({
      code: 'storage_error',
    });
    const residues = await journal.reconcileOwnedPendingPublicationResiduesV2({
      ...options,
      allowForeignNamedPhase: true,
    });
    expect(residues).toHaveLength(1);
    expect(residues[0]?.effective).toBe(false);

    await journal.cleanupCapturedWriterResiduesV2({
      root,
      pending: authority,
      slots: authority,
      residues: residues.map((residue) => ({
        family: 'pending' as const,
        identified: residue.identified,
        namedFile: residue.namedFile,
        phase: residue.phase,
        effective: residue.effective,
      })),
      maxBytes: MAX_RECORD_BYTES,
      capacity: 2,
      parseSlot: parseJournalRecord,
      recordId: (record) => record.id,
      validatePending: () => true,
      authorizeProject: async () => undefined,
      recoveryAction: async () => 'retain',
    });
    expect(existsSync(temporaryFile)).toBe(false);
    expect(readFileSync(namedFile, 'utf8')).toBe(JSON.stringify({ id: 'winner' }));
  });

  it('recovers an effective slot cleanup only when its pending relation remains valid', async () => {
    const pendingDirectory = path.join(root, 'pending');
    const slotsDirectory = path.join(root, 'slots');
    mkdirSync(pendingDirectory);
    mkdirSync(slotsDirectory);
    const pending = await journal.captureDirectoryAuthorityV2(pendingDirectory);
    const slots = await journal.captureDirectoryAuthorityV2(slotsDirectory);
    const bytes = JSON.stringify({ id: 'request_1' });
    const cleanupFile = path.join(slotsDirectory, '0.slot.1_2.cleanup');
    writeFileSync(cleanupFile, bytes);
    writeFileSync(path.join(pendingDirectory, 'request_1.json'), bytes);

    const residues = await journal.reconcileOwnedSlotCleanupResiduesV2({
      root,
      pending,
      slots,
      maxBytes: MAX_RECORD_BYTES,
      capacity: 2,
      recordId: (record: JournalRecord) => record.id,
      validatePending: (id, value) => parseJournalRecord(value).status === 'valid' && id === 'request_1',
      parse: parseJournalRecord,
      deferCleanup: true,
    });
    expect(residues).toHaveLength(1);
    expect(residues[0]?.effective).toBe(true);

    await journal.cleanupCapturedWriterResiduesV2({
      root,
      pending,
      slots,
      residues: residues.map((residue) => ({
        family: 'slots' as const,
        identified: { ...residue.identified, record: null },
        namedFile: residue.namedFile,
        phase: 'cleanup' as const,
        effective: residue.effective,
      })),
      maxBytes: MAX_RECORD_BYTES,
      capacity: 2,
      parseSlot: parseJournalRecord,
      recordId: (record) => record.id,
      validatePending: (id, value) => parseJournalRecord(value).status === 'valid' && id === 'request_1',
      authorizeProject: async () => undefined,
      recoveryAction: async () => 'retain',
    });
    expect(existsSync(cleanupFile)).toBe(false);
    expect(readFileSync(path.join(slotsDirectory, '0.slot'), 'utf8')).toBe(bytes);
  });

  it('quarantines before removal and preserves a record when authorization fails', async () => {
    const authority = await journal.captureDirectoryAuthorityV2(records);
    const removableFile = path.join(records, 'remove.json');
    const bytes = JSON.stringify({ id: 'remove' });
    writeFileSync(removableFile, bytes);
    const removable = await identifyExisting(removableFile, bytes, { id: 'remove' });
    const authorize = vi.fn(async () => undefined);

    await journal.quarantineRemoveIdentifiedRecordV2({ root, authority, identified: removable, authorize });
    expect(existsSync(removableFile)).toBe(false);
    expect(readdirSync(records)).toEqual([]);
    expect(authorize).toHaveBeenCalledTimes(4);

    const deniedFile = path.join(records, 'denied.json');
    writeFileSync(deniedFile, bytes);
    const denied = await identifyExisting(deniedFile, bytes, { id: 'denied' });
    await expect(
      journal.quarantineRemoveIdentifiedRecordV2({
        root,
        authority,
        identified: denied,
        authorize: async () => {
          throw new Error('denied');
        },
      })
    ).rejects.toThrow('denied');
    expect(readFileSync(deniedFile, 'utf8')).toBe(bytes);
  });

  it('fails closed for mismatched ready companions', async () => {
    const authority = await journal.captureDirectoryAuthorityV2(records);
    const namedFile = path.join(records, 'named.json');
    const bytes = JSON.stringify({ id: 'named' });
    writeFileSync(namedFile, bytes);
    const named = await identifyExisting(namedFile, bytes, { id: 'named' });
    writeFileSync(`${namedFile}.1_2.ready`, JSON.stringify({ id: 'other' }));

    await expect(
      journal.removeReadyPublicationCompanionV2({
        root,
        authority,
        named,
        maxBytes: MAX_RECORD_BYTES,
        authorize: async () => undefined,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(existsSync(`${namedFile}.1_2.ready`)).toBe(true);
  });
});
