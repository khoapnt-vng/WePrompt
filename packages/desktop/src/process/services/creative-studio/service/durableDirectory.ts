/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { constants as fsConstants, type promises as nodeFs } from 'node:fs';

export type DurableDirectoryFileSystem = Pick<typeof nodeFs, 'open'>;

/**
 * Windows implements FileHandle.sync() with FlushFileBuffers, which requires
 * GENERIC_WRITE. libuv's read-only directory handle does not carry it. POSIX
 * directories stay read-only because write-open is not portable there.
 */
export const durableDirectoryOpenFlags = (platform: NodeJS.Platform = process.platform, additionalFlags = 0): number =>
  (platform === 'win32' ? fsConstants.O_RDWR : fsConstants.O_RDONLY) | additionalFlags;

export const syncDurableDirectory = async (
  fs: DurableDirectoryFileSystem,
  directory: string,
  options: { platform?: NodeJS.Platform; additionalFlags?: number } = {}
): Promise<void> => {
  const platform = options.platform ?? process.platform;
  const additionalFlags = options.additionalFlags ?? 0;
  // Keep the established POSIX call shape so injected filesystems can observe
  // durability barriers without having to reinterpret Node's numeric flags.
  const flags =
    platform !== 'win32' && additionalFlags === 0 ? 'r' : durableDirectoryOpenFlags(platform, additionalFlags);
  const handle = await fs.open(directory, flags);
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory()) throw new Error('Durability target is not a directory');
    await handle.sync();
  } finally {
    await handle.close();
  }
};
