/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, promises as nodeFs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canonicalizeRecordRoot,
  publishImmutableRecord,
  readBoundedRegularFile,
  RecordIoError,
  resolveCompleteDirectorySet,
  resolveConfinedRecordPath,
  resolveSafeRecordDirectory,
} from '@process/services/creative-studio/service/recordIo';

describe('error-neutral Creative Studio record IO', () => {
  let rootDir: string;
  let canonicalRoot: string;

  beforeEach(async () => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'studio-record-io-'));
    canonicalRoot = await nodeFs.realpath(rootDir);
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('canonicalizes only a real directory and confines every derived target', async () => {
    await expect(canonicalizeRecordRoot({ fs: nodeFs, rootDir })).resolves.toBe(canonicalRoot);
    expect(resolveConfinedRecordPath(canonicalRoot, canonicalRoot, 'project_1')).toBe(
      path.join(canonicalRoot, 'project_1')
    );
    expect(() => resolveConfinedRecordPath(canonicalRoot, canonicalRoot, '..', 'escape')).toThrowError(
      expect.objectContaining({ code: 'unsafe_path' })
    );

    const external = mkdtempSync(path.join(tmpdir(), 'studio-record-external-'));
    try {
      const linked = path.join(rootDir, 'linked');
      await nodeFs.symlink(external, linked);
      await expect(canonicalizeRecordRoot({ fs: nodeFs, rootDir: linked })).rejects.toMatchObject({
        code: 'unsafe_path',
      });
    } finally {
      rmSync(external, { recursive: true, force: true });
    }
  });

  it('resolves or creates one safe canonical directory without following a symlink', async () => {
    const projectDir = path.join(canonicalRoot, 'project_1');
    await nodeFs.mkdir(projectDir);

    await expect(
      resolveSafeRecordDirectory({
        fs: nodeFs,
        canonicalRoot,
        parent: projectDir,
        name: 'proposals',
        createIfMissing: false,
      })
    ).resolves.toBeNull();
    await expect(
      resolveSafeRecordDirectory({
        fs: nodeFs,
        canonicalRoot,
        parent: projectDir,
        name: 'proposals',
        createIfMissing: true,
      })
    ).resolves.toBe(path.join(projectDir, 'proposals'));

    await nodeFs.symlink(projectDir, path.join(projectDir, 'unsafe'));
    await expect(
      resolveSafeRecordDirectory({
        fs: nodeFs,
        canonicalRoot,
        parent: projectDir,
        name: 'unsafe',
        createIfMissing: false,
      })
    ).rejects.toMatchObject({ code: 'unsafe_path' });
  });

  it('lazily creates a wholly absent complete set and rejects every partial set', async () => {
    const projectDir = path.join(canonicalRoot, 'project_1');
    await nodeFs.mkdir(projectDir);

    const created = await resolveCompleteDirectorySet({
      fs: nodeFs,
      canonicalRoot,
      parent: projectDir,
      rootName: 'commands',
      childNames: ['pending', 'slots', 'receipts'],
      createIfWhollyAbsent: true,
    });

    expect(created).toEqual({
      root: path.join(projectDir, 'commands'),
      pending: path.join(projectDir, 'commands', 'pending'),
      slots: path.join(projectDir, 'commands', 'slots'),
      receipts: path.join(projectDir, 'commands', 'receipts'),
    });

    await nodeFs.rm(path.join(projectDir, 'commands', 'receipts'), { recursive: true });
    await expect(
      resolveCompleteDirectorySet({
        fs: nodeFs,
        canonicalRoot,
        parent: projectDir,
        rootName: 'commands',
        childNames: ['pending', 'slots', 'receipts'],
        createIfWhollyAbsent: true,
      })
    ).rejects.toMatchObject({ code: 'partial_directory_set' });
    expect(existsSync(path.join(projectDir, 'commands', 'receipts'))).toBe(false);
  });

  it.each(['root-symlink', 'child-symlink', 'child-file'])(
    'rejects an unsafe complete directory set: %s',
    async (kind) => {
      const projectDir = path.join(canonicalRoot, 'project_1');
      const commandsDir = path.join(projectDir, 'commands');
      await nodeFs.mkdir(projectDir);
      if (kind === 'root-symlink') {
        await nodeFs.mkdir(path.join(projectDir, 'real-commands'));
        await nodeFs.symlink(path.join(projectDir, 'real-commands'), commandsDir);
      } else {
        await nodeFs.mkdir(commandsDir);
        await nodeFs.mkdir(path.join(commandsDir, 'pending'));
        await nodeFs.mkdir(path.join(commandsDir, 'receipts'));
        if (kind === 'child-symlink')
          await nodeFs.symlink(path.join(commandsDir, 'pending'), path.join(commandsDir, 'slots'));
        else await nodeFs.writeFile(path.join(commandsDir, 'slots'), 'not a directory');
      }

      await expect(
        resolveCompleteDirectorySet({
          fs: nodeFs,
          canonicalRoot,
          parent: projectDir,
          rootName: 'commands',
          childNames: ['pending', 'slots', 'receipts'],
          createIfWhollyAbsent: true,
        })
      ).rejects.toMatchObject({ code: 'unsafe_path' });
    }
  );

  it('reads only a bounded lstat-confirmed regular file and reports absence distinctly', async () => {
    const records = path.join(canonicalRoot, 'records');
    await nodeFs.mkdir(records);
    const file = path.join(records, 'record.json');
    await nodeFs.writeFile(file, '{"safe":true}');

    await expect(readBoundedRegularFile({ fs: nodeFs, canonicalRoot, file, maxBytes: 64 })).resolves.toBe(
      '{"safe":true}'
    );
    await expect(
      readBoundedRegularFile({ fs: nodeFs, canonicalRoot, file: path.join(records, 'missing.json'), maxBytes: 64 })
    ).resolves.toBeNull();
  });

  it.each(['symlink', 'directory', 'oversize'])('rejects a %s record before reading bytes', async (kind) => {
    const records = path.join(canonicalRoot, 'records');
    await nodeFs.mkdir(records);
    const target = path.join(records, 'record.json');
    if (kind === 'symlink') {
      await nodeFs.writeFile(path.join(records, 'real.json'), '{}');
      await nodeFs.symlink(path.join(records, 'real.json'), target);
    } else if (kind === 'directory') await nodeFs.mkdir(target);
    else await nodeFs.writeFile(target, 'x'.repeat(65));

    await expect(
      readBoundedRegularFile({ fs: nodeFs, canonicalRoot, file: target, maxBytes: 64 })
    ).rejects.toMatchObject({ code: kind === 'oversize' ? 'record_too_large' : 'unsafe_file' });
  });

  it('publishes immutable bytes only after file sync and then syncs the parent directory', async () => {
    const records = path.join(canonicalRoot, 'records');
    await nodeFs.mkdir(records);
    const target = path.join(records, 'receipt.json');
    const events: string[] = [];
    const observedFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>): ReturnType<typeof nodeFs.link> => {
            events.push('link');
            return nodeFs.link(...args);
          };
        }
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>): ReturnType<typeof nodeFs.rm> => {
            if (String(args[0]).endsWith('.tmp')) events.push('temp-rm');
            return nodeFs.rm(...args);
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          const isDirectory = String(args[0]) === records;
          events.push(isDirectory ? 'directory-open' : 'temp-open');
          return new Proxy(handle, {
            get(realHandle, handleProperty, handleReceiver) {
              if (handleProperty === 'writeFile') {
                return async (...writeArgs: Parameters<typeof handle.writeFile>) => {
                  events.push('temp-write');
                  return handle.writeFile(...writeArgs);
                };
              }
              if (handleProperty === 'sync') {
                return async () => {
                  events.push(isDirectory ? 'directory-sync' : 'temp-sync');
                  return handle.sync();
                };
              }
              if (handleProperty === 'close') {
                return async () => {
                  events.push(isDirectory ? 'directory-close' : 'temp-close');
                  return handle.close();
                };
              }
              return Reflect.get(realHandle, handleProperty, handleReceiver);
            },
          });
        };
      },
    }) as typeof nodeFs;

    await publishImmutableRecord({
      fs: observedFs,
      canonicalRoot,
      file: target,
      bytes: '{"status":"applied"}',
      temporaryId: 'proof',
    });

    expect(await nodeFs.readFile(target, 'utf8')).toBe('{"status":"applied"}');
    expect(events).toEqual([
      'temp-open',
      'temp-write',
      'temp-sync',
      'temp-close',
      'link',
      'temp-rm',
      'directory-open',
      'directory-sync',
      'directory-close',
    ]);
  });

  it('never replaces an immutable target and returns an error-neutral collision', async () => {
    const records = path.join(canonicalRoot, 'records');
    await nodeFs.mkdir(records);
    const target = path.join(records, 'receipt.json');
    await nodeFs.writeFile(target, 'original');

    await expect(
      publishImmutableRecord({
        fs: nodeFs,
        canonicalRoot,
        file: target,
        bytes: 'replacement containing /private/path and credential',
        temporaryId: 'collision',
      })
    ).rejects.toMatchObject({ code: 'already_exists', message: 'Record IO failed' });
    expect(await nodeFs.readFile(target, 'utf8')).toBe('original');
  });

  it('does not expose raw filesystem errors, paths, or record bytes', async () => {
    const target = path.join(canonicalRoot, 'records', 'receipt.json');
    await nodeFs.mkdir(path.dirname(target));
    const failingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async () => {
            throw new Error('credential=secret path=/Users/customer prompt=private');
          };
        }
        return Reflect.get(realFs, property, receiver);
      },
    }) as typeof nodeFs;

    const error = await publishImmutableRecord({
      fs: failingFs,
      canonicalRoot,
      file: target,
      bytes: 'private brief',
      temporaryId: 'failure',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecordIoError);
    expect(error).toMatchObject({ code: 'storage_error', message: 'Record IO failed' });
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(JSON.stringify(error)).not.toContain('private brief');
    expect(JSON.stringify(error)).not.toContain('/Users/customer');
  });
});
