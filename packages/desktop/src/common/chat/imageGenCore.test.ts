/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { ClientFactory, type RotatingClient } from '@/common/api/ClientFactory';
import type { TProviderWithModel } from '@/common/config/storage';
import { executeImageGeneration, extractImagesApiDataUrl, processImageUri, saveGeneratedImage } from './imageGenCore';

const asResponse = (data: unknown) => data as OpenAI.Images.ImagesResponse;

const temporaryDirectories: string[] = [];
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MANAGED_IMAGE_DATA_URLS = [
  'data:image/jpeg;base64,/9j/',
  `data:image/png;base64,${PNG_SIGNATURE.toString('base64')}`,
  `data:image/webp;base64,${Buffer.from('524946460000000057454250', 'hex').toString('base64')}`,
];

const provider: TProviderWithModel = {
  id: 'provider_1',
  name: 'Provider One',
  platform: 'gemini',
  base_url: 'https://generativelanguage.googleapis.com',
  api_key: 'secret-key',
  use_model: 'gemini-2.5-flash-image',
};

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'weprompt-image-core-'));
  temporaryDirectories.push(directory);
  return directory;
};

const rejectingHostedDownloader = async (): Promise<void> => {
  throw Object.assign(new Error('signed provider detail'), { code: 'remote_too_large' });
};

const emptyHostedDownloader = async (): Promise<void> => undefined;

const oversizedHostedDownloader = async ({
  maxBytes,
  write,
}: {
  maxBytes: number;
  write: (chunk: Buffer) => Promise<void>;
}): Promise<void> => {
  await write(Buffer.alloc(maxBytes + 1));
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

describe('managed image inputs', () => {
  it('preserves strict JPEG, PNG and WebP data URLs in order without filesystem reads', async () => {
    const root = await createTemporaryDirectory();
    const access = vi.spyOn(fs, 'access');
    const createChatCompletion = vi.fn(async (_input: unknown) => ({
      choices: [
        {
          message: {
            content: 'generated',
            images: [{ type: 'image_url', image_url: { url: MANAGED_IMAGE_DATA_URLS[1] } }],
          },
        },
      ],
    }));
    vi.spyOn(ClientFactory, 'createRotatingClient').mockResolvedValue({
      createChatCompletion,
    } as unknown as RotatingClient);

    const result = await executeImageGeneration(
      { prompt: 'A safe prompt', image_uris: MANAGED_IMAGE_DATA_URLS },
      provider,
      root
    );

    expect(result.success).toBe(true);
    expect(access).not.toHaveBeenCalled();
    expect(createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze/Edit image: A safe prompt' },
            ...MANAGED_IMAGE_DATA_URLS.map((url) => ({ type: 'image_url', image_url: { url, detail: 'auto' } })),
          ],
        },
      ],
    });
  });

  it.each([
    'data:image/png;base64,',
    'data:image/png;base64,not*base64',
    `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
    `data:image/jpeg;base64,${PNG_SIGNATURE.toString('base64')}`,
  ])('rejects malformed or unsupported managed data URL input', async (imageUri) => {
    await expect(processImageUri(imageUri, '/private/studio')).rejects.toThrow('Invalid image data URL');
  });

  it('rejects the whole ordered input set when one image is invalid', async () => {
    const root = await createTemporaryDirectory();
    const createChatCompletion = vi.fn(async (_input: unknown) => ({
      choices: [
        {
          message: {
            content: 'generated',
            images: [{ type: 'image_url', image_url: { url: MANAGED_IMAGE_DATA_URLS[1] } }],
          },
        },
      ],
    }));
    const createRotatingClient = vi.spyOn(ClientFactory, 'createRotatingClient').mockResolvedValue({
      createChatCompletion,
    } as unknown as RotatingClient);
    const secretInput = 'data:image/png;base64,not*base64';

    const result = await executeImageGeneration(
      { prompt: 'A safe prompt', image_uris: ['https://cdn.example/valid.png', secretInput] },
      provider,
      root
    );

    expect(result).toMatchObject({ success: false, error: 'invalid_image_input' });
    expect(createRotatingClient).not.toHaveBeenCalled();
    expect(createChatCompletion).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(secretInput);
  });
});

describe('extractImagesApiDataUrl', () => {
  it('wraps b64_json output as a PNG data URL', () => {
    expect(extractImagesApiDataUrl(asResponse({ data: [{ b64_json: 'QUJD' }] }))).toBe('data:image/png;base64,QUJD');
  });

  it('returns a direct url when the model returns one', () => {
    expect(extractImagesApiDataUrl(asResponse({ data: [{ url: 'https://cdn.example/img.png' }] }))).toBe(
      'https://cdn.example/img.png'
    );
  });

  it('prefers b64_json over url when both are present', () => {
    expect(extractImagesApiDataUrl(asResponse({ data: [{ b64_json: 'QUJD', url: 'https://x/y.png' }] }))).toBe(
      'data:image/png;base64,QUJD'
    );
  });

  it('returns null when there is no image payload', () => {
    expect(extractImagesApiDataUrl(asResponse({ data: [] }))).toBeNull();
    expect(extractImagesApiDataUrl(asResponse({}))).toBeNull();
    expect(extractImagesApiDataUrl(asResponse({ data: [{}] }))).toBeNull();
  });
});

describe('saveGeneratedImage', () => {
  it('creates a missing output directory and preserves valid base64 image bytes', async () => {
    const root = await createTemporaryDirectory();
    const output = await saveGeneratedImage(
      `data:image/png;base64,${PNG_SIGNATURE.toString('base64')}`,
      path.join(root, 'nested', 'images')
    );

    await expect(fs.readFile(output)).resolves.toEqual(PNG_SIGNATURE);
  });

  it('routes a hosted URL through the injected bounded downloader instead of base64-decoding URL text', async () => {
    const root = await createTemporaryDirectory();
    const downloader = vi.fn(async ({ write }: { write: (chunk: Buffer) => Promise<void> }) => write(PNG_SIGNATURE));

    const output = await saveGeneratedImage('https://cdn.example/image.png', root, downloader);

    expect(downloader).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://cdn.example/image.png', maxBytes: 50 * 1024 * 1024 })
    );
    await expect(fs.readFile(output)).resolves.toEqual(PNG_SIGNATURE);
  });

  it('propagates a hosted downloader rejection and leaves no completed file behind', async () => {
    const root = await createTemporaryDirectory();
    await expect(
      saveGeneratedImage('https://cdn.example/too-large.png', root, rejectingHostedDownloader)
    ).rejects.toThrow('remote_too_large');
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('rejects a hosted body that exceeds the bounded downloader maximum', async () => {
    const root = await createTemporaryDirectory();
    await expect(
      saveGeneratedImage('https://cdn.example/oversized.png', root, oversizedHostedDownloader)
    ).rejects.toThrow('Hosted image exceeds the allowed size');
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('rejects zero-byte hosted output and empty or malformed data URLs', async () => {
    const root = await createTemporaryDirectory();

    await expect(saveGeneratedImage('https://cdn.example/empty.png', root, emptyHostedDownloader)).rejects.toThrow(
      'Hosted image did not contain data'
    );
    await expect(saveGeneratedImage('data:image/png;base64,', root)).rejects.toThrow('Invalid image data URL');
    await expect(saveGeneratedImage('data:image/png;base64,not*base64', root)).rejects.toThrow(
      'Invalid image data URL'
    );
    await expect(
      saveGeneratedImage(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`, root)
    ).rejects.toThrow('Invalid image data URL');
    await expect(
      saveGeneratedImage(`data:image/jpeg;base64,${PNG_SIGNATURE.toString('base64')}`, root)
    ).rejects.toThrow('Invalid image data URL');
    await expect(
      saveGeneratedImage(`data:image/png;base64,${PNG_SIGNATURE.toString('base64')}`, root, undefined, undefined, 4)
    ).rejects.toThrow('Invalid image data URL');
  });

  it('allocates collision-safe output names for same-millisecond generations', async () => {
    const root = await createTemporaryDirectory();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1234);
    try {
      const [first, second] = await Promise.all([
        saveGeneratedImage(`data:image/png;base64,${PNG_SIGNATURE.toString('base64')}`, root),
        saveGeneratedImage('data:image/jpeg;base64,/9j/', root),
      ]);

      expect(first).not.toBe(second);
      await expect(Promise.all([fs.readFile(first), fs.readFile(second)])).resolves.toEqual(
        expect.arrayContaining([PNG_SIGNATURE, Buffer.from('ffd8ff', 'hex')])
      );
    } finally {
      now.mockRestore();
    }
  });

  it('rejects a non-image hosted body before publishing a completed file', async () => {
    const root = await createTemporaryDirectory();
    await expect(
      saveGeneratedImage('https://cdn.example/not-image.png', root, async ({ write }) => {
        await write(Buffer.from('<html>provider error</html>'));
      })
    ).rejects.toThrow('Hosted output is not a supported image');
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('never logs a raw hosted downloader error or signed URL', async () => {
    const root = await createTemporaryDirectory();
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'https://cdn.example/image.png?signature=never-log-this';
    try {
      await expect(
        saveGeneratedImage(secret, root, async () => {
          throw new Error(`download failed for ${secret}`);
        })
      ).rejects.toThrow('hosted_image_download_failed');

      expect(JSON.stringify(logger.mock.calls)).not.toContain('never-log-this');
      expect(logger).toHaveBeenCalledWith('[ImageGen] Failed to save image file');
    } finally {
      logger.mockRestore();
    }
  });
});
