/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { appendFile, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PresentationRunFiles } from '@/process/services/presentation-template/run/storage/presentationRunFiles';
import {
  PresentationRunJournal,
  type PresentationRunDurableBoundary,
} from '@/process/services/presentation-template/run/storage/presentationRunJournal';

const RUN_ID = '434393ce-dd45-44fe-a51c-262b2b181cc5';
const GRANT_A = '745b7d43-a0aa-4bb7-b0cc-283f2db4873d';
const GRANT_B = 'ab82a45e-f426-41d0-bdda-4e151a78a399';

const manifest = (revision: number, state: string): Record<string, unknown> => ({
  version: 2,
  runId: RUN_ID,
  revision,
  state,
});

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function prepareRunAssets(files: PresentationRunFiles) {
  const candidateBytes = Buffer.from('prepared reference candidate');
  const grounding = '# Grounding\n\nVerified source evidence.';
  const themeBytes = Buffer.from('{"name":"journal-test-theme"}');
  const prepared = await files.prepareRunAssets({
    runId: RUN_ID,
    candidateBytes,
    grounding,
    rawInput: 'Prepare the quarterly review.',
    directive: 'Edit the prepared candidate and write plan.json.',
    sourceRefs: [],
    injectSkills: ['officecli'],
    template: {
      theme: {
        fileName: 'theme.json',
        sha256: sha256(themeBytes),
        byteLength: themeBytes.byteLength,
      },
      reference: {
        fileName: 'reference.pptx',
        sha256: sha256(candidateBytes),
        byteLength: candidateBytes.byteLength,
      },
    },
  });
  return { candidateBytes, grounding, prepared };
}

describe('PresentationRunJournal', () => {
  let fixtureRoot: string;
  let files: PresentationRunFiles;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), 'presentation-run-journal-'));
    const userDataDir = path.join(fixtureRoot, 'user-data');
    const systemTempDir = path.join(fixtureRoot, 'system-temp');
    await Promise.all([mkdir(userDataDir), mkdir(systemTempDir)]);
    files = new PresentationRunFiles({ userDataDir, tempDir: systemTempDir });
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('serializes competing compare-and-swap mutations so only one revision wins', async () => {
    const journal = new PresentationRunJournal({ files });
    await journal.transaction({
      mutations: [
        { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
      ],
    });

    const results = await Promise.allSettled([
      journal.transaction({
        mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: 0, nextManifest: manifest(1, 'first') }],
      }),
      journal.transaction({
        mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: 0, nextManifest: manifest(1, 'second') }],
      }),
    ]);

    expect(results.map((result) => result.status).toSorted()).toEqual(['fulfilled', 'rejected']);
    expect((await journal.readCanonical<Record<string, unknown>>('run', RUN_ID))?.revision).toBe(1);
  });

  it('compacts a successful prepared-run transaction so raw payloads do not accumulate', async () => {
    const { prepared } = await prepareRunAssets(files);
    const journal = new PresentationRunJournal({ files });
    const nextManifest = {
      version: 2,
      runId: RUN_ID,
      revision: 0,
      dispatchStatus: 'committed',
      artifactPhase: 'sources_extracted',
      preparation: prepared.record,
    };

    await journal.transaction({
      preparedRunAssetPromotions: [prepared],
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest }],
    });

    await expect(journal.readCanonical('run', RUN_ID)).resolves.toEqual(nextManifest);
    await expect(readFile(files.getJournalPath(), 'utf8')).resolves.toBe('');
  });

  it('compacts a crash-durable commit during recovery', async () => {
    let injected = false;
    const crashing = new PresentationRunJournal({
      files,
      failureInjector: ({ boundary }) => {
        if (injected || boundary !== 'after-commit-fsync') return;
        injected = true;
        throw new Error('crash after durable commit');
      },
    });
    const nextManifest = manifest(0, 'allocated');

    await expect(
      crashing.transaction({
        mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest }],
      })
    ).rejects.toThrow('crash after durable commit');
    await expect(readFile(files.getJournalPath(), 'utf8')).resolves.toContain('"type":"commit"');

    const restarted = new PresentationRunJournal({ files });
    await restarted.recover();

    await expect(restarted.readCanonical('run', RUN_ID)).resolves.toEqual(nextManifest);
    await expect(readFile(files.getJournalPath(), 'utf8')).resolves.toBe('');
  });

  it('reads an absent canonical record without creating its entity layout', async () => {
    const runDirectory = path.join(files.roots.runRoot, RUN_ID);
    const journal = new PresentationRunJournal({ files });

    await expect(journal.readCanonical('run', RUN_ID)).resolves.toBeNull();

    await expect(lstat(runDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers one authoritative revision after a crash at every journal or manifest boundary', async () => {
    const boundaries: PresentationRunDurableBoundary[] = [
      'before-intent-append',
      'after-intent-append',
      'before-intent-fsync',
      'after-intent-fsync',
      'before-manifest-write',
      'after-manifest-write',
      'before-manifest-fsync',
      'after-manifest-fsync',
      'before-manifest-rename',
      'after-manifest-rename',
      'before-manifest-directory-fsync',
      'after-manifest-directory-fsync',
      'before-commit-append',
      'after-commit-append',
      'before-commit-fsync',
      'after-commit-fsync',
    ];

    for (const boundary of boundaries) {
      const boundaryRoot = path.join(fixtureRoot, boundary);
      const userDataDir = path.join(boundaryRoot, 'user-data');
      const systemTempDir = path.join(boundaryRoot, 'system-temp');
      await Promise.all([mkdir(userDataDir, { recursive: true }), mkdir(systemTempDir, { recursive: true })]);
      const boundaryFiles = new PresentationRunFiles({ userDataDir, tempDir: systemTempDir });
      const seed = new PresentationRunJournal({ files: boundaryFiles });
      await seed.transaction({
        mutations: [
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
        ],
      });
      let injected = false;
      const crashing = new PresentationRunJournal({
        files: boundaryFiles,
        failureInjector: (point) => {
          if (!injected && point.boundary === boundary) {
            injected = true;
            throw new Error(`crash:${boundary}`);
          }
        },
      });

      await expect(
        crashing.transaction({
          mutations: [
            { entityKind: 'run', entityId: RUN_ID, expectedRevision: 0, nextManifest: manifest(1, 'committed') },
          ],
        })
      ).rejects.toThrow(`crash:${boundary}`);

      const restarted = new PresentationRunJournal({ files: boundaryFiles });
      await restarted.recover();
      const recovered = await restarted.readCanonical<Record<string, unknown>>('run', RUN_ID);
      expect(recovered).toEqual(
        boundary === 'before-intent-append' ? manifest(0, 'allocated') : manifest(1, 'committed')
      );
      await restarted.recover();
      expect(await restarted.readCanonical('run', RUN_ID)).toEqual(recovered);
    }
  });

  it('recovers an uncommitted intent with a crash-persisted manifest temp', async () => {
    const layout = await files.createRunLayout(RUN_ID);
    const nextManifest = manifest(0, 'allocated');
    const temporaryPath = path.join(layout.runDirectory, `.manifest-${GRANT_A}-0.tmp`);
    await writeFile(
      files.getJournalPath(),
      `${JSON.stringify({
        version: 1,
        type: 'intent',
        transactionId: GRANT_A,
        createdAt: '2026-08-04T00:00:00.000Z',
        mutations: [
          {
            entityKind: 'run',
            entityId: RUN_ID,
            expectedRevision: null,
            nextManifest,
          },
        ],
        retainedCandidatePromotions: [],
      })}\n`,
      { mode: 0o600 }
    );
    await writeFile(temporaryPath, 'crash residue', { mode: 0o600 });
    const restarted = new PresentationRunJournal({ files });

    await expect(restarted.recover()).resolves.toBeUndefined();

    await expect(lstat(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(restarted.readCanonical('run', RUN_ID)).resolves.toEqual(nextManifest);
  });

  it('rejects committed source extraction without the matching prepared-run promotion', async () => {
    const { prepared } = await prepareRunAssets(files);
    const journal = new PresentationRunJournal({ files });
    const nextManifest = {
      version: 2,
      runId: RUN_ID,
      revision: 0,
      dispatchStatus: 'committed',
      artifactPhase: 'sources_extracted',
      preparation: prepared.record,
    };

    await expect(
      journal.transaction({
        mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest }],
      })
    ).rejects.toThrow('Presentation run journal is corrupt');
    await expect(
      journal.transaction({
        preparedRunAssetPromotions: [prepared],
        mutations: [
          {
            entityKind: 'run',
            entityId: RUN_ID,
            expectedRevision: null,
            nextManifest: {
              ...nextManifest,
              preparation: { ...prepared.record, sha256: '0'.repeat(64) },
            },
          },
        ],
      })
    ).rejects.toThrow('Presentation run journal is corrupt');
    await expect(journal.readCanonical('run', RUN_ID)).resolves.toBeNull();
  });

  it('recovers and publishes prepared-run assets after a post-intent crash', async () => {
    const { candidateBytes, grounding, prepared } = await prepareRunAssets(files);
    const nextManifest = {
      version: 2,
      runId: RUN_ID,
      revision: 0,
      dispatchStatus: 'committed',
      artifactPhase: 'sources_extracted',
      preparation: prepared.record,
    };
    let injected = false;
    const crashing = new PresentationRunJournal({
      files,
      failureInjector: ({ boundary }) => {
        if (injected || boundary !== 'after-intent-fsync') return;
        injected = true;
        throw new Error('post-intent crash');
      },
    });

    await expect(
      crashing.transaction({
        preparedRunAssetPromotions: [prepared],
        mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest }],
      })
    ).rejects.toThrow('post-intent crash');

    const restarted = new PresentationRunJournal({ files });
    await restarted.recover();
    const paths = files.getStagingRunPaths(RUN_ID);
    const [publishedCandidate, publishedGrounding, publishedPreparation] = await Promise.all([
      readFile(paths.candidatePath),
      readFile(paths.groundingPath, 'utf8'),
      readFile(path.join(files.roots.runRoot, RUN_ID, prepared.record.relativePath), 'utf8'),
    ]);

    expect({
      candidate: publishedCandidate,
      grounding: publishedGrounding,
      preparation: JSON.parse(publishedPreparation),
    }).toEqual({
      candidate: candidateBytes,
      grounding,
      preparation: prepared.record.payload,
    });
    await expect(restarted.readCanonical('run', RUN_ID)).resolves.toEqual(nextManifest);
  });

  it('rejects a persistent replacement created while an open manifest temp cleanup is synced', async () => {
    const runDirectory = path.join(fixtureRoot, 'user-data', 'presentation-runs', RUN_ID);
    const temporaryPath = path.join(runDirectory, `.manifest-${GRANT_A}-0.tmp`);
    let replaceDuringCleanup = false;
    const cleanupFiles = new PresentationRunFiles({
      userDataDir: path.join(fixtureRoot, 'user-data'),
      tempDir: path.join(fixtureRoot, 'system-temp'),
      syncDirectory: async (directory) => {
        if (!replaceDuringCleanup || directory !== runDirectory) return;
        replaceDuringCleanup = false;
        await writeFile(temporaryPath, 'persistent replacement', { mode: 0o600 });
      },
    });
    const journal = new PresentationRunJournal({
      files: cleanupFiles,
      randomUUID: () => GRANT_A,
      failureInjector: ({ boundary }) => {
        if (boundary !== 'before-manifest-rename') return;
        replaceDuringCleanup = true;
        throw new Error('forced manifest failure');
      },
    });

    await expect(
      journal.transaction({
        mutations: [
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
        ],
      })
    ).rejects.toThrow('Presentation storage file changed while in use');

    await expect(readFile(temporaryPath, 'utf8')).resolves.toBe('persistent replacement');
  });

  it('replays every manifest in an interrupted multi-entity intent', async () => {
    const seed = new PresentationRunJournal({ files });
    await seed.transaction({
      mutations: [
        {
          entityKind: 'grant',
          entityId: GRANT_A,
          expectedRevision: null,
          nextManifest: { version: 2, grantId: GRANT_A, revision: 0, state: 'active' },
        },
        {
          entityKind: 'grant',
          entityId: GRANT_B,
          expectedRevision: null,
          nextManifest: { version: 2, grantId: GRANT_B, revision: 0, state: 'active' },
        },
      ],
    });
    let injected = false;
    const crashing = new PresentationRunJournal({
      files,
      failureInjector: (point) => {
        if (!injected && point.boundary === 'after-manifest-rename' && point.mutationIndex === 0) {
          injected = true;
          throw new Error('crash after first manifest');
        }
      },
    });

    await expect(
      crashing.transaction({
        mutations: [
          {
            entityKind: 'grant',
            entityId: GRANT_A,
            expectedRevision: 0,
            nextManifest: { version: 2, grantId: GRANT_A, revision: 1, state: 'claimed' },
          },
          {
            entityKind: 'grant',
            entityId: GRANT_B,
            expectedRevision: 0,
            nextManifest: { version: 2, grantId: GRANT_B, revision: 1, state: 'claimed' },
          },
        ],
      })
    ).rejects.toThrow('crash after first manifest');

    const restarted = new PresentationRunJournal({ files });
    await restarted.recover();
    expect((await restarted.readCanonical<Record<string, unknown>>('grant', GRANT_A))?.state).toBe('claimed');
    expect((await restarted.readCanonical<Record<string, unknown>>('grant', GRANT_B))?.state).toBe('claimed');
  });

  it('writes every durable file with owner-only permissions', async () => {
    const journal = new PresentationRunJournal({ files });
    await journal.transaction({
      mutations: [
        { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
      ],
    });

    expect((await lstat(files.getEntityManifestPath('run', RUN_ID))).mode & 0o777).toBe(0o600);
    expect((await lstat(files.getJournalPath())).mode & 0o777).toBe(0o600);
  });

  it('syncs a newly created journal entry before reporting the intent fsync boundary durable', async () => {
    const events: string[] = [];
    const durableFiles = new PresentationRunFiles({
      userDataDir: path.join(fixtureRoot, 'user-data'),
      tempDir: path.join(fixtureRoot, 'system-temp'),
      syncDirectory: async (directory) => {
        events.push(`sync:${directory}`);
      },
    });
    await durableFiles.initialize();
    events.length = 0;
    const journal = new PresentationRunJournal({
      files: durableFiles,
      failureInjector: ({ boundary }) => {
        events.push(boundary);
      },
    });

    await journal.transaction({
      mutations: [
        { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
      ],
    });

    const beforeFsync = events.indexOf('before-intent-fsync');
    const rootSync = events.indexOf(`sync:${durableFiles.roots.journalRoot}`);
    const afterFsync = events.indexOf('after-intent-fsync');
    expect(beforeFsync).toBeLessThan(rootSync);
    expect(rootSync).toBeLessThan(afterFsync);
    expect(events.filter((event) => event === `sync:${durableFiles.roots.journalRoot}`)).toHaveLength(1);
  });

  it('does not resync the journal root for ordinary appends', async () => {
    const syncedDirectories: string[] = [];
    const durableFiles = new PresentationRunFiles({
      userDataDir: path.join(fixtureRoot, 'user-data'),
      tempDir: path.join(fixtureRoot, 'system-temp'),
      syncDirectory: async (directory) => {
        syncedDirectories.push(directory);
      },
    });
    const journal = new PresentationRunJournal({ files: durableFiles });
    await journal.transaction({
      mutations: [
        { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
      ],
    });
    syncedDirectories.length = 0;

    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: 0, nextManifest: manifest(1, 'committed') }],
    });

    expect(syncedDirectories).not.toContain(durableFiles.roots.journalRoot);
  });

  it('does not commit a transaction through a replaced journal root', async () => {
    const displacedJournalRoot = `${files.roots.journalRoot}.displaced`;
    let swapped = false;
    const journal = new PresentationRunJournal({
      files,
      failureInjector: async ({ boundary }) => {
        if (swapped || boundary !== 'before-commit-append') return;
        swapped = true;
        await rename(files.roots.journalRoot, displacedJournalRoot);
        await mkdir(files.roots.journalRoot, { mode: 0o700 });
      },
    });

    await expect(
      journal.transaction({
        mutations: [
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
        ],
      })
    ).rejects.toThrow('Presentation storage directory changed while leased');

    expect(await readFile(path.join(displacedJournalRoot, 'journal.jsonl'), 'utf8')).toContain('"type":"intent"');
    await expect(readFile(files.getJournalPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not commit a transaction through a replaced journal file', async () => {
    const journalPath = files.getJournalPath();
    const displacedJournalPath = `${journalPath}.displaced`;
    let swapped = false;
    const journal = new PresentationRunJournal({
      files,
      failureInjector: async ({ boundary }) => {
        if (swapped || boundary !== 'before-commit-append') return;
        swapped = true;
        await rename(journalPath, displacedJournalPath);
        await writeFile(journalPath, await readFile(displacedJournalPath), { mode: 0o600 });
      },
    });

    await expect(
      journal.transaction({
        mutations: [
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
        ],
      })
    ).rejects.toThrow('Presentation storage file changed while in use');

    expect(await readFile(displacedJournalPath, 'utf8')).toContain('"type":"intent"');
    expect(await readFile(journalPath, 'utf8')).not.toContain('"type":"commit"');
  });

  it('does not commit recovery through a replaced journal root', async () => {
    let crashInjected = false;
    const crashing = new PresentationRunJournal({
      files,
      failureInjector: ({ boundary }) => {
        if (crashInjected || boundary !== 'before-commit-append') return;
        crashInjected = true;
        throw new Error('crash before recovery commit');
      },
    });
    await expect(
      crashing.transaction({
        mutations: [
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
        ],
      })
    ).rejects.toThrow('crash before recovery commit');
    const displacedJournalRoot = `${files.roots.journalRoot}.displaced`;
    let swapped = false;
    const recovering = new PresentationRunJournal({
      files,
      failureInjector: async ({ boundary }) => {
        if (swapped || boundary !== 'before-commit-append') return;
        swapped = true;
        await rename(files.roots.journalRoot, displacedJournalRoot);
        await mkdir(files.roots.journalRoot, { mode: 0o700 });
      },
    });

    await expect(recovering.recover()).rejects.toThrow('Presentation storage directory changed while leased');

    expect(await readFile(path.join(displacedJournalRoot, 'journal.jsonl'), 'utf8')).toContain('"type":"intent"');
    await expect(readFile(files.getJournalPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not commit recovery through a replaced journal file', async () => {
    let crashInjected = false;
    const crashing = new PresentationRunJournal({
      files,
      failureInjector: ({ boundary }) => {
        if (crashInjected || boundary !== 'before-commit-append') return;
        crashInjected = true;
        throw new Error('crash before recovery commit');
      },
    });
    await expect(
      crashing.transaction({
        mutations: [
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
        ],
      })
    ).rejects.toThrow('crash before recovery commit');
    const journalPath = files.getJournalPath();
    const displacedJournalPath = `${journalPath}.displaced`;
    let swapped = false;
    const recovering = new PresentationRunJournal({
      files,
      failureInjector: async ({ boundary }) => {
        if (swapped || boundary !== 'before-commit-append') return;
        swapped = true;
        await rename(journalPath, displacedJournalPath);
        await writeFile(journalPath, await readFile(displacedJournalPath), { mode: 0o600 });
      },
    });

    await expect(recovering.recover()).rejects.toThrow('Presentation storage file changed while in use');

    expect(await readFile(displacedJournalPath, 'utf8')).toContain('"type":"intent"');
    expect(await readFile(journalPath, 'utf8')).not.toContain('"type":"commit"');
  });

  it('does not rename a manifest through a replaced run directory', async () => {
    const runDirectory = path.join(files.roots.runRoot, RUN_ID);
    const displacedRunDirectory = `${runDirectory}.displaced`;
    let replacementTemporaryPath: string | null = null;
    const journal = new PresentationRunJournal({
      files,
      failureInjector: async ({ boundary, transactionId, mutationIndex }) => {
        if (boundary !== 'before-manifest-rename' || transactionId === undefined || mutationIndex === undefined) return;
        await rename(runDirectory, displacedRunDirectory);
        await mkdir(runDirectory, { mode: 0o700 });
        const temporaryName = `.manifest-${transactionId}-${mutationIndex}.tmp`;
        replacementTemporaryPath = path.join(runDirectory, temporaryName);
        await writeFile(replacementTemporaryPath, await readFile(path.join(displacedRunDirectory, temporaryName)), {
          mode: 0o600,
        });
      },
    });

    await expect(
      journal.transaction({
        mutations: [
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
        ],
      })
    ).rejects.toThrow('Presentation storage directory changed while leased');

    expect(replacementTemporaryPath).not.toBeNull();
    await expect(readFile(path.join(runDirectory, 'manifest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(replacementTemporaryPath!, 'utf8')).resolves.toContain('"state": "allocated"');
  });

  it('does not rename an index through a replaced index root', async () => {
    const displacedIndexRoot = `${files.roots.indexRoot}.displaced`;
    const temporaryName = `.index-${GRANT_A}.tmp`;
    const replacementTemporaryPath = path.join(files.roots.indexRoot, temporaryName);
    let swapped = false;
    const journal = new PresentationRunJournal({
      files,
      randomUUID: () => GRANT_A,
      failureInjector: async ({ boundary }) => {
        if (swapped || boundary !== 'before-index-rename') return;
        swapped = true;
        await rename(files.roots.indexRoot, displacedIndexRoot);
        await mkdir(files.roots.indexRoot, { mode: 0o700 });
        await writeFile(replacementTemporaryPath, await readFile(path.join(displacedIndexRoot, temporaryName)), {
          mode: 0o600,
        });
      },
    });

    await expect(journal.writeDerivedIndex({ runIds: [RUN_ID] })).rejects.toThrow(
      'Presentation storage directory changed while leased'
    );

    await expect(readFile(files.getIndexPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(replacementTemporaryPath, 'utf8')).resolves.toContain(RUN_ID);
  });

  it('rejects a changed retained temp before persisting its promotion intent', async () => {
    const layout = await files.createRunLayout(RUN_ID);
    await writeFile(path.join(layout.stagingDirectory, 'candidate.pptx'), 'stable candidate');
    const prepared = await files.prepareRetainedCandidate(RUN_ID);
    const temporaryPath = path.join(layout.runDirectory, prepared.temporaryRelativePath);
    await writeFile(temporaryPath, 'mutated candidat');
    const journal = new PresentationRunJournal({ files });

    await expect(
      journal.transaction({
        retainedCandidatePromotions: [prepared],
        mutations: [
          {
            entityKind: 'run',
            entityId: RUN_ID,
            expectedRevision: null,
            nextManifest: {
              version: 2,
              runId: RUN_ID,
              revision: 0,
              dispatchStatus: 'terminal_verified',
              artifactPhase: 'candidate_retained',
              retainedCandidate: {
                relativePath: prepared.finalRelativePath,
                sha256: prepared.sha256,
                byteLength: prepared.byteLength,
              },
            },
          },
        ],
      })
    ).rejects.toThrow('Retained candidate temporary file changed');
    await expect(readFile(files.getJournalPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('revalidates the prepared inode after the intent hook and before any journal byte can persist', async () => {
    const layout = await files.createRunLayout(RUN_ID);
    await writeFile(path.join(layout.stagingDirectory, 'candidate.pptx'), 'stable candidate');
    const prepared = await files.prepareRetainedCandidate(RUN_ID);
    const temporaryPath = path.join(layout.runDirectory, prepared.temporaryRelativePath);
    const displacedTemporaryPath = `${temporaryPath}.displaced`;
    const journal = new PresentationRunJournal({
      files,
      failureInjector: async ({ boundary }) => {
        if (boundary !== 'before-intent-append') return;
        await rename(temporaryPath, displacedTemporaryPath);
        await writeFile(temporaryPath, 'stable candidate', { mode: 0o600 });
      },
    });

    await expect(
      journal.transaction({
        retainedCandidatePromotions: [prepared],
        mutations: [
          {
            entityKind: 'run',
            entityId: RUN_ID,
            expectedRevision: null,
            nextManifest: {
              version: 2,
              runId: RUN_ID,
              revision: 0,
              dispatchStatus: 'terminal_verified',
              artifactPhase: 'candidate_retained',
              retainedCandidate: {
                relativePath: prepared.finalRelativePath,
                sha256: prepared.sha256,
                byteLength: prepared.byteLength,
              },
            },
          },
        ],
      })
    ).rejects.toThrow('Retained candidate temporary file is unsafe');
    await expect(readFile(files.getJournalPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(temporaryPath, 'utf8')).resolves.toBe('stable candidate');
    await expect(readFile(displacedTemporaryPath, 'utf8')).resolves.toBe('stable candidate');
  });

  it('does not report success when the prepared inode changes while its intent is being fsynced', async () => {
    const layout = await files.createRunLayout(RUN_ID);
    await writeFile(path.join(layout.stagingDirectory, 'candidate.pptx'), 'stable candidate');
    const prepared = await files.prepareRetainedCandidate(RUN_ID);
    const temporaryPath = path.join(layout.runDirectory, prepared.temporaryRelativePath);
    const displacedTemporaryPath = `${temporaryPath}.displaced`;
    const finalPath = path.join(layout.runDirectory, prepared.finalRelativePath);
    const journal = new PresentationRunJournal({
      files,
      failureInjector: async ({ boundary }) => {
        if (boundary !== 'after-intent-fsync') return;
        await rename(temporaryPath, displacedTemporaryPath);
        await writeFile(temporaryPath, 'stable candidate', { mode: 0o600 });
      },
    });

    await expect(
      journal.transaction({
        retainedCandidatePromotions: [prepared],
        mutations: [
          {
            entityKind: 'run',
            entityId: RUN_ID,
            expectedRevision: null,
            nextManifest: {
              version: 2,
              runId: RUN_ID,
              revision: 0,
              dispatchStatus: 'terminal_verified',
              artifactPhase: 'candidate_retained',
              retainedCandidate: {
                relativePath: prepared.finalRelativePath,
                sha256: prepared.sha256,
                byteLength: prepared.byteLength,
              },
            },
          },
        ],
      })
    ).rejects.toThrow('Retained candidate temporary file is unsafe');
    const records = (await readFile(files.getJournalPath(), 'utf8')).trim().split('\n').map(JSON.parse);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ type: 'intent' });
    await expect(readFile(finalPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('propagates a manifest-directory sync failure instead of treating it as durable', async () => {
    let failRunDirectorySync = false;
    const strictFiles = new PresentationRunFiles({
      userDataDir: path.join(fixtureRoot, 'user-data'),
      tempDir: path.join(fixtureRoot, 'system-temp'),
      syncDirectory: async (directory) => {
        if (failRunDirectorySync && directory === path.join(fixtureRoot, 'user-data', 'presentation-runs', RUN_ID)) {
          throw new Error('manifest parent sync failed');
        }
      },
    });
    const journal = new PresentationRunJournal({ files: strictFiles });
    await journal.transaction({
      mutations: [
        { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
      ],
    });
    failRunDirectorySync = true;

    await expect(
      journal.transaction({
        mutations: [
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: 0, nextManifest: manifest(1, 'committed') },
        ],
      })
    ).rejects.toThrow('manifest parent sync failed');
  });

  it('rejects duplicate canonical participants before appending an intent', async () => {
    const journal = new PresentationRunJournal({ files });

    await expect(
      journal.transaction({
        mutations: [
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'one') },
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'two') },
        ],
      })
    ).rejects.toThrow('Presentation run journal is corrupt');
    await expect(journal.readCanonical('run', RUN_ID)).resolves.toBeNull();
  });

  it('rejects malformed recovered entity kinds before touching an attacker-controlled path', async () => {
    await files.initialize();
    await writeFile(
      files.getJournalPath(),
      `${JSON.stringify({
        version: 1,
        type: 'intent',
        transactionId: RUN_ID,
        createdAt: '2026-08-04T00:00:00.000Z',
        mutations: [
          {
            entityKind: '../../outside',
            entityId: RUN_ID,
            expectedRevision: null,
            nextManifest: manifest(0, 'allocated'),
          },
        ],
        retainedCandidatePromotions: [],
      })}\n`,
      'utf8'
    );

    await expect(new PresentationRunJournal({ files }).recover()).rejects.toThrow(
      'Presentation run journal is corrupt'
    );
  });

  it.each([
    [{ retainedCandidatePromotions: undefined }, 'malformed promotions'],
    [
      {
        retainedCandidatePromotions: [
          {
            runId: RUN_ID,
            temporaryRelativePath: `retained/.candidate-${GRANT_A}.tmp`,
            finalRelativePath: 'retained/candidate.pptx',
            sha256: 'a'.repeat(64),
            byteLength: 12,
            dev: '0',
            ino: '1',
          },
        ],
      },
      'orphan promotion',
    ],
  ] as const)('rejects %s in a recovered intent', async (override) => {
    await files.initialize();
    const record = {
      version: 1,
      type: 'intent',
      transactionId: RUN_ID,
      createdAt: '2026-08-04T00:00:00.000Z',
      mutations: [
        { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
      ],
      retainedCandidatePromotions: [],
      ...override,
    };
    await writeFile(files.getJournalPath(), `${JSON.stringify(record)}\n`, 'utf8');

    await expect(new PresentationRunJournal({ files }).recover()).rejects.toThrow(
      'Presentation run journal is corrupt'
    );
  });

  it('blocks later mutations after a partial intent until recovery completes', async () => {
    const seed = new PresentationRunJournal({ files });
    await seed.transaction({
      mutations: [
        {
          entityKind: 'grant',
          entityId: GRANT_A,
          expectedRevision: null,
          nextManifest: { grantId: GRANT_A, revision: 0 },
        },
        {
          entityKind: 'grant',
          entityId: GRANT_B,
          expectedRevision: null,
          nextManifest: { grantId: GRANT_B, revision: 0 },
        },
      ],
    });
    let injected = false;
    const journal = new PresentationRunJournal({
      files,
      failureInjector: ({ boundary, mutationIndex }) => {
        if (!injected && boundary === 'after-manifest-rename' && mutationIndex === 0) {
          injected = true;
          throw new Error('partial intent');
        }
      },
    });
    const revisionOne = [GRANT_A, GRANT_B].map((grantId) => ({
      entityKind: 'grant' as const,
      entityId: grantId,
      expectedRevision: 0,
      nextManifest: { grantId, revision: 1 },
    }));

    await expect(journal.transaction({ mutations: revisionOne })).rejects.toThrow('partial intent');
    await expect(journal.transaction({ mutations: revisionOne })).rejects.toThrow(
      'Presentation run journal recovery required'
    );
    await journal.recover();
    await journal.transaction({
      mutations: [GRANT_A, GRANT_B].map((grantId) => ({
        entityKind: 'grant',
        entityId: grantId,
        expectedRevision: 1,
        nextManifest: { grantId, revision: 2 },
      })),
    });
    expect(await journal.readCanonical('grant', GRANT_A)).toMatchObject({ revision: 2 });
    expect(await journal.readCanonical('grant', GRANT_B)).toMatchObject({ revision: 2 });
  });

  it('truncates and syncs an incomplete journal tail before any later append', async () => {
    const journal = new PresentationRunJournal({ files });
    await journal.transaction({
      mutations: [
        { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
      ],
    });
    await appendFile(files.getJournalPath(), '{"version":1', 'utf8');

    await journal.recover();
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: 0, nextManifest: manifest(1, 'committed') }],
    });

    expect(await readFile(files.getJournalPath(), 'utf8')).toBe('');
    await expect(new PresentationRunJournal({ files }).recover()).resolves.toBeUndefined();
    expect(await journal.readCanonical('run', RUN_ID)).toEqual(manifest(1, 'committed'));
  });

  it('never follows symlinks for canonical, journal, or derived-index files', async () => {
    await files.createRunLayout(RUN_ID);
    const outsider = path.join(fixtureRoot, 'outsider.json');
    await writeFile(outsider, '{"revision":99}\n', 'utf8');
    await symlink(outsider, files.getEntityManifestPath('run', RUN_ID));
    const journal = new PresentationRunJournal({ files });

    await expect(journal.readCanonical('run', RUN_ID)).rejects.toThrow();
    await rm(files.getEntityManifestPath('run', RUN_ID));
    await symlink(outsider, files.getJournalPath());
    await expect(
      journal.transaction({
        mutations: [
          { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: manifest(0, 'allocated') },
        ],
      })
    ).rejects.toThrow();
    expect(await readFile(outsider, 'utf8')).toBe('{"revision":99}\n');
    await rm(files.getJournalPath());
    await symlink(outsider, files.getIndexPath());
    await expect(journal.readDerivedIndex()).rejects.toThrow();
  });

  it('snapshots transaction input before waiting for journal serialization', async () => {
    const journal = new PresentationRunJournal({ files });
    const nextManifest = manifest(0, 'original');
    const transaction = journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest }],
    });
    nextManifest.state = 'mutated';

    await transaction;

    await expect(journal.readCanonical('run', RUN_ID)).resolves.toEqual(manifest(0, 'original'));
  });
});
