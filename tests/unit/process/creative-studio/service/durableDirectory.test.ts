import { constants as fsConstants } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  durableDirectoryOpenFlags,
  syncDurableDirectory,
} from '@process/services/creative-studio/service/durableDirectory';

describe('Creative Studio durable directory boundary', () => {
  it('uses read authority on POSIX and write authority for Windows FlushFileBuffers', () => {
    expect(durableDirectoryOpenFlags('darwin')).toBe(fsConstants.O_RDONLY);
    expect(durableDirectoryOpenFlags('linux')).toBe(fsConstants.O_RDONLY);
    expect(durableDirectoryOpenFlags('win32')).toBe(fsConstants.O_RDWR);
  });

  it('preserves additional no-follow flags', () => {
    expect(durableDirectoryOpenFlags('win32', 0x20)).toBe(fsConstants.O_RDWR | 0x20);
  });

  it('syncs and closes a verified Windows directory handle', async () => {
    const sync = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({
      stat: async () => ({ isDirectory: () => true }),
      sync,
      close,
    }));

    await syncDurableDirectory({ open } as never, 'C:\\studio', { platform: 'win32' });

    expect(open).toHaveBeenCalledWith('C:\\studio', fsConstants.O_RDWR);
    expect(sync).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed and closes when the opened target is not a directory', async () => {
    const sync = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({
      stat: async () => ({ isDirectory: () => false }),
      sync,
      close,
    }));

    await expect(syncDurableDirectory({ open } as never, '/studio', { platform: 'darwin' })).rejects.toThrow(
      'Durability target is not a directory'
    );
    expect(sync).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
