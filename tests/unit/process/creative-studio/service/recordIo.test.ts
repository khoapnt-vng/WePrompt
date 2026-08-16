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

  it('rejects a regular path swapped to a symlink around the opened handle', async () => {
    const records = path.join(canonicalRoot, 'records');
    await nodeFs.mkdir(records);
    const target = path.join(records, 'record.json');
    const outside = path.join(canonicalRoot, 'outside.json');
    await nodeFs.writeFile(target, '{"safe":true}');
    await nodeFs.writeFile(outside, '{"credential":"outside"}');
    let swapped = false;
    const swappingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (String(args[0]) === target && !swapped) {
              swapped = true;
              await nodeFs.rm(target);
              await nodeFs.symlink(outside, target);
            }
            return stats;
          };
        }
        if (property === 'open') {
          return async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await nodeFs.open(...args);
            if (String(args[0]) === target && !swapped) {
              swapped = true;
              await nodeFs.rm(target);
              await nodeFs.symlink(outside, target);
            }
            return handle;
          };
        }
        return Reflect.get(realFs, property, receiver);
      },
    }) as typeof nodeFs;

    await expect(
      readBoundedRegularFile({ fs: swappingFs, canonicalRoot, file: target, maxBytes: 64 })
    ).rejects.toMatchObject({ code: 'unsafe_file', message: 'Record IO failed' });
  });

  it('reads at most max plus one bytes from the same handle after metadata-time growth', async () => {
    const records = path.join(canonicalRoot, 'records');
    await nodeFs.mkdir(records);
    const target = path.join(records, 'record.json');
    await nodeFs.writeFile(target, '{}');
    let grew = false;
    let usedPathReadFile = false;
    const readLengths: number[] = [];
    const growingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (String(args[0]) === target && !grew) {
              grew = true;
              await nodeFs.appendFile(target, 'x'.repeat(128));
            }
            return stats;
          };
        }
        if (property === 'readFile') {
          return async (...args: Parameters<typeof nodeFs.readFile>) => {
            usedPathReadFile = true;
            return nodeFs.readFile(...args);
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          if (String(args[0]) !== target) return handle;
          return new Proxy(handle, {
            get(realHandle, handleProperty, handleReceiver) {
              if (handleProperty === 'stat') {
                return async (...statArgs: Parameters<typeof handle.stat>) => {
                  const stats = await handle.stat(...statArgs);
                  if (!grew) {
                    grew = true;
                    await nodeFs.appendFile(target, 'x'.repeat(128));
                  }
                  return stats;
                };
              }
              if (handleProperty === 'read') {
                return async (...readArgs: Parameters<typeof handle.read>) => {
                  readLengths.push(Number(readArgs[2]));
                  return handle.read(...readArgs);
                };
              }
              return Reflect.get(realHandle, handleProperty, handleReceiver);
            },
          });
        };
      },
    }) as typeof nodeFs;

    await expect(
      readBoundedRegularFile({ fs: growingFs, canonicalRoot, file: target, maxBytes: 64 })
    ).rejects.toMatchObject({ code: 'record_too_large' });
    expect(usedPathReadFile).toBe(false);
    expect(readLengths.length).toBeGreaterThan(0);
    expect(Math.max(...readLengths)).toBe(65);
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
            const removed = String(args[0]);
            if (removed.endsWith('.unconfirmed')) events.push('guard-rm');
            else if (removed.endsWith('.tmp')) events.push('temp-rm');
            return nodeFs.rm(...args);
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          const opened = String(args[0]);
          const kind = opened === records ? 'directory' : opened.endsWith('.unconfirmed') ? 'guard' : 'temp';
          events.push(`${kind}-open`);
          return new Proxy(handle, {
            get(realHandle, handleProperty, handleReceiver) {
              if (handleProperty === 'writeFile') {
                return async (...writeArgs: Parameters<typeof handle.writeFile>) => {
                  events.push(`${kind}-write`);
                  return handle.writeFile(...writeArgs);
                };
              }
              if (handleProperty === 'sync') {
                return async () => {
                  events.push(`${kind}-sync`);
                  return handle.sync();
                };
              }
              if (handleProperty === 'close') {
                return async () => {
                  events.push(`${kind}-close`);
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
      'guard-open',
      'guard-write',
      'guard-sync',
      'guard-close',
      'directory-open',
      'directory-sync',
      'directory-close',
      'link',
      'directory-open',
      'directory-sync',
      'directory-close',
      'guard-rm',
      'temp-rm',
    ]);
  });

  it.each(['directory-open', 'directory-sync'])('rolls back a final link when post-link %s fails', async (kind) => {
    const records = path.join(canonicalRoot, 'records');
    await nodeFs.mkdir(records);
    const target = path.join(records, 'receipt.json');
    let linked = false;
    const failingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            linked = true;
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          if (String(args[0]) === records && linked && kind === 'directory-open') {
            throw new Error('path=/private/receipt directory open failed');
          }
          const handle = await nodeFs.open(...args);
          if (String(args[0]) !== records || !linked || kind !== 'directory-sync') return handle;
          return new Proxy(handle, {
            get(realHandle, handleProperty, handleReceiver) {
              if (handleProperty === 'sync') {
                return async () => {
                  throw new Error('credential=secret directory sync failed');
                };
              }
              return Reflect.get(realHandle, handleProperty, handleReceiver);
            },
          });
        };
      },
    }) as typeof nodeFs;

    await expect(
      publishImmutableRecord({
        fs: failingFs,
        canonicalRoot,
        file: target,
        bytes: '{"status":"applied"}',
        temporaryId: `post_link_${kind.replace('-', '_')}`,
      })
    ).rejects.toMatchObject({ code: 'storage_error', message: 'Record IO failed' });
    expect(existsSync(target)).toBe(false);
  });

  it('treats temp cleanup after the post-link directory sync as non-authoritative', async () => {
    const records = path.join(canonicalRoot, 'records');
    await nodeFs.mkdir(records);
    const target = path.join(records, 'receipt.json');
    let linked = false;
    const failingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            linked = true;
          };
        }
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>) => {
            if (linked && String(args[0]).endsWith('.tmp')) throw new Error('temp cleanup failed');
            return nodeFs.rm(...args);
          };
        }
        return Reflect.get(realFs, property, receiver);
      },
    }) as typeof nodeFs;

    await expect(
      publishImmutableRecord({
        fs: failingFs,
        canonicalRoot,
        file: target,
        bytes: '{"status":"applied"}',
        temporaryId: 'cleanup_failure',
      })
    ).resolves.toBeUndefined();
    await expect(readBoundedRegularFile({ fs: nodeFs, canonicalRoot, file: target, maxBytes: 64 })).resolves.toBe(
      '{"status":"applied"}'
    );
  });

  it('leaves a rollback-resistant final link distinguishable as unconfirmed', async () => {
    const records = path.join(canonicalRoot, 'records');
    await nodeFs.mkdir(records);
    const target = path.join(records, 'receipt.json');
    let linked = false;
    const failingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            linked = true;
          };
        }
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>) => {
            if (linked && (String(args[0]) === target || String(args[0]).endsWith('.tmp'))) {
              throw new Error('rollback and cleanup failed at /private/receipt');
            }
            return nodeFs.rm(...args);
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          if (String(args[0]) !== records || !linked) return handle;
          return new Proxy(handle, {
            get(realHandle, handleProperty, handleReceiver) {
              if (handleProperty === 'sync') {
                return async () => {
                  throw new Error('post-link sync failed');
                };
              }
              return Reflect.get(realHandle, handleProperty, handleReceiver);
            },
          });
        };
      },
    }) as typeof nodeFs;

    await expect(
      publishImmutableRecord({
        fs: failingFs,
        canonicalRoot,
        file: target,
        bytes: '{"status":"applied"}',
        temporaryId: 'rollback_failure',
      })
    ).rejects.toMatchObject({ code: 'storage_error', message: 'Record IO failed' });
    expect(existsSync(target)).toBe(true);
    await expect(
      readBoundedRegularFile({ fs: nodeFs, canonicalRoot, file: target, maxBytes: 64 })
    ).rejects.toMatchObject({ code: 'unsafe_file', message: 'Record IO failed' });
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
