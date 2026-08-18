/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { execFile as execFileCallback, spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import type {
  StudioAsset,
  StudioAssetV2,
  StudioShot,
  StudioCut,
  StudioCutClipV2,
  StudioEditableCutClip,
  StudioMediaKind,
  StudioProjectV2,
  StudioRenderProgressEvent,
  StudioScene,
  StudioBeat,
} from '@/common/types/project/creativeStudioTypes';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';
import { createCreativeStudioService } from '@process/services/creative-studio/service';
import type { StudioStoryboardPlanner } from '@process/services/creative-studio/planning/storyboardPlanner';
import {
  createStudioRenderRunner,
  CreativeStudioRenderError,
  renderCut,
  resolveActiveStudioRenderCutV2,
  resolvePersistedStudioRenderCutV2,
  resolveStudioRenderDimensions,
  type StudioRenderOperation,
  type StudioRenderSpawn,
  type StudioRenderResult,
} from '@process/services/creative-studio/renderService';
import { createEmptyStudioProjectV2 } from '@process/services/creative-studio/service/schema2';
import { createCreativeStudioStore, type CreativeStudioStore } from '@process/services/creative-studio/store';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const execFile = promisify(execFileCallback);
const ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobePath = ffmpegPath.includes(path.sep) ? path.join(path.dirname(ffmpegPath), 'ffprobe') : 'ffprobe';
const ffmpegAvailable =
  spawnSync(ffmpegPath, ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync(ffprobePath, ['-version'], { stdio: 'ignore' }).status === 0;

type FixturePaths = {
  cropImage: string;
  image: string;
  pixelImage: string;
  longVideoWithAudio: string;
  silentVideo: string;
  videoWithAudio: string;
};

type SceneInput = {
  id: string;
  mediaKind: StudioMediaKind;
  durationSeconds: number;
  fixture?: keyof FixturePaths;
  assetDurationSeconds?: number;
  collection?: StudioAsset['managedAsset']['collection'];
};

type RenderHarness = {
  rootDir: string;
  temporaryRoot: string;
  store: CreativeStudioStore;
  mediaStore: ReturnType<typeof createStudioMediaStore>;
  projectRevision: number;
  outputPath: string;
};

let fixtureRoot = '';
let fixtures: FixturePaths;
const createdRoots: string[] = [];

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const fakeChild = (
  onKill: (signal: NodeJS.Signals, child: EventEmitter) => void = (_signal, child) => {
    queueMicrotask(() => child.emit('close', null));
  }
): ReturnType<StudioRenderSpawn> => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill(signal?: NodeJS.Signals): boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal = 'SIGTERM') => {
    onKill(signal, child);
    return true;
  };
  return child as ReturnType<StudioRenderSpawn>;
};

const completeFakeChild = (child: ReturnType<StudioRenderSpawn>, code = 0, stdout = ''): void => {
  queueMicrotask(() => {
    if (stdout) child.stdout.write(stdout);
    child.stdout.end();
    child.stderr.end();
    child.emit('close', code);
  });
};

const run = async (command: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
  const result = await execFile(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return { stdout: result.stdout, stderr: result.stderr };
};

const runBuffer = async (command: string, args: string[]): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(Buffer.concat(stderr).toString('utf8')));
    });
  });

const createPpm = (
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => readonly [number, number, number]
): Buffer => {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixelAt(x, y);
      const offset = (y * width + x) * 3;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii'), pixels]);
};

const renderProjectionTimestamp = '2026-08-17T00:00:00.000Z';

const makeProjectionBeat = (id: string, shotOrder: string[]): StudioBeat => ({
  id,
  title: id,
  action: '',
  look: '',
  shotOrder,
});

const makeProjectionShot = (id: string, selectedTakeId: string): StudioShot => ({
  id,
  line: id,
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedTakeId,
  assetIds: [selectedTakeId],
  jobIds: [],
});

const makeProjectionAsset = (id: string, shotId: string): StudioAssetV2 => ({
  id,
  projectId: 'projection_project',
  shotId,
  mediaKind: 'video',
  mimeType: 'video/mp4',
  managedAsset: { collection: 'assets', fileName: `${id}.mp4` },
  byteSize: 1,
  sha256: 'a'.repeat(64),
  durationSeconds: 10,
  createdAt: renderProjectionTimestamp,
});

const makeProjectionPlacement = (id: string, shotId: string, assetId: string): StudioCutClipV2 => ({
  id,
  clipId: shotId,
  assetId,
  sourceInSeconds: 1,
  sourceOutSeconds: 8,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  filters: [{ id: 'contrast', amount: 0.25 }],
});

const makeRenderProjectionProjectV2 = (): StudioProjectV2 => {
  const project = createEmptyStudioProjectV2(
    {
      name: 'Projection project',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
    },
    'projection_project',
    renderProjectionTimestamp
  );
  project.beatOrder = ['section_a', 'section_b'];
  project.beats = {
    section_a: makeProjectionBeat('section_a', ['clip_a']),
    section_b: makeProjectionBeat('section_b', ['clip_b']),
    section_c: makeProjectionBeat('section_c', ['clip_c']),
  };
  project.shots = {
    clip_a: makeProjectionShot('clip_a', 'asset_a'),
    clip_b: makeProjectionShot('clip_b', 'asset_b'),
    clip_c: makeProjectionShot('clip_c', 'asset_c'),
  };
  project.assets = {
    asset_a: makeProjectionAsset('asset_a', 'clip_a'),
    asset_b: makeProjectionAsset('asset_b', 'clip_b'),
    asset_c: makeProjectionAsset('asset_c', 'clip_c'),
  };
  project.bin = [{ kind: 'beat', beatId: 'section_c' }];
  project.cuts.cut_1 = {
    id: 'cut_1',
    name: 'Projection cut',
    orderMode: 'storyboard',
    clipOrder: ['placement_a', 'placement_b', 'placement_c'],
    clips: {
      placement_a: makeProjectionPlacement('placement_a', 'clip_a', 'asset_a'),
      placement_b: makeProjectionPlacement('placement_b', 'clip_b', 'asset_b'),
      placement_c: makeProjectionPlacement('placement_c', 'clip_c', 'asset_c'),
    },
  };
  project.activeCutId = 'cut_1';
  return project;
};

const createFixtures = async (): Promise<FixturePaths> => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-studio-render-fixtures-'));
  const cropImage = path.join(fixtureRoot, 'crop.png');
  const cropPpm = path.join(fixtureRoot, 'crop.ppm');
  const image = path.join(fixtureRoot, 'frame.png');
  const pixelImage = path.join(fixtureRoot, 'pixel.png');
  const pixelPpm = path.join(fixtureRoot, 'pixel.ppm');
  const longVideoWithAudio = path.join(fixtureRoot, 'long-with-audio.mp4');
  const silentVideo = path.join(fixtureRoot, 'silent.mp4');
  const videoWithAudio = path.join(fixtureRoot, 'with-audio.mp4');
  await fs.writeFile(
    cropPpm,
    createPpm(320, 180, (x, y) => (x >= 80 && x < 240 && y >= 45 && y < 135 ? [0, 255, 0] : [255, 0, 0]))
  );
  await fs.writeFile(
    pixelPpm,
    createPpm(320, 180, () => [128, 64, 32])
  );
  await Promise.all(
    [
      [cropPpm, cropImage],
      [pixelPpm, pixelImage],
    ].map(([source, destination]) =>
      run(ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        source!,
        '-frames:v',
        '1',
        '-c:v',
        'png',
        '-pix_fmt',
        'rgb24',
        destination!,
      ])
    )
  );
  await Promise.all([fs.rm(cropPpm), fs.rm(pixelPpm)]);
  await run(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x336699:s=320x240',
    '-frames:v',
    '1',
    image,
  ]);
  await run(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x240:r=30:d=1',
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    silentVideo,
  ]);
  await run(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=640x360:r=24:d=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=44100:duration=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    videoWithAudio,
  ]);
  await run(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=24:d=6',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=48000:duration=6',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    longVideoWithAudio,
  ]);
  return { cropImage, image, pixelImage, longVideoWithAudio, silentVideo, videoWithAudio };
};

const makeScene = (input: SceneInput, assetId: string | null): StudioScene => ({
  id: input.id,
  title: input.id,
  purpose: '',
  visualPrompt: '',
  narration: '',
  onScreenText: '',
  mediaKind: input.mediaKind,
  durationSeconds: input.durationSeconds,
  referenceAssetId: null,
  selectedAssetId: assetId,
  assetIds: assetId === null ? [] : [assetId],
  jobIds: [],
  reviewState: assetId === null ? 'draft' : 'complete',
});

const createHarness = async (
  sceneInputs: SceneInput[],
  options: { aspectRatio?: '16:9' | '9:16'; resolution?: '720p' | '1080p' } = {}
): Promise<RenderHarness> => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-studio-render-store-'));
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-studio-render-temp-root-'));
  createdRoots.push(rootDir, temporaryRoot);
  const store = createCreativeStudioStore({ rootDir, createId: () => 'project_1' });
  await store.createProject({
    name: 'Fixture project',
    brief: '',
    aspectRatio: options.aspectRatio ?? '16:9',
    targetDurationSeconds: 5,
    resolution: options.resolution ?? '720p',
  });
  const projectDirectory = (await store.getVerifiedProjectDirectory('project_1'))!;
  const assetsDirectory = path.join(projectDirectory, 'assets');
  const importsDirectory = path.join(projectDirectory, 'imports');
  await Promise.all([fs.mkdir(assetsDirectory), fs.mkdir(importsDirectory)]);

  const assets: Record<string, StudioAsset> = {};
  const scenes: Record<string, StudioScene> = {};
  await Promise.all(
    sceneInputs.map(async (input) => {
      const assetId = input.fixture === undefined ? null : `asset_${input.id}`;
      scenes[input.id] = makeScene(input, assetId);
      if (assetId === null) return;
      const source = fixtures[input.fixture];
      const extension = path.extname(source);
      const collection = input.collection ?? 'assets';
      const fileName = `${assetId}${extension}`;
      const destination = path.join(collection === 'imports' ? importsDirectory : assetsDirectory, fileName);
      const bytes = await fs.readFile(source);
      await fs.writeFile(destination, bytes);
      assets[assetId] = {
        id: assetId,
        projectId: 'project_1',
        sceneId: input.id,
        mediaKind: input.mediaKind,
        mimeType:
          input.mediaKind === 'image' ? (extension === '.ppm' ? 'image/x-portable-pixmap' : 'image/png') : 'video/mp4',
        managedAsset: { collection, fileName },
        byteSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...(input.assetDurationSeconds === undefined ? {} : { durationSeconds: input.assetDurationSeconds }),
        createdAt: '2026-08-06T00:00:00.000Z',
      };
    })
  );
  const project = await store.updateProject('project_1', (current) => ({
    ...current,
    sceneOrder: sceneInputs.map((scene) => scene.id),
    scenes,
    assets,
  }));
  const mediaStore = createStudioMediaStore({
    store,
    createId: () => 'render_asset',
    now: () => '2026-08-06T00:00:00.000Z',
  });
  return {
    rootDir,
    temporaryRoot,
    store,
    mediaStore,
    projectRevision: project.revision,
    outputPath: path.join(assetsDirectory, 'render_asset.mp4'),
  };
};

const setActiveCut = async (
  harness: RenderHarness,
  input: {
    orderMode: StudioCut['orderMode'];
    clipSceneIds: string[];
    clipOrderSceneIds?: string[];
    clipEdits?: Record<string, Partial<StudioEditableCutClip>>;
  }
): Promise<void> => {
  const project = await harness.store.getProject('project_1');
  if (project === null) throw new Error('Missing render fixture project');
  const clips: StudioCut['clips'] = {};
  for (const sceneId of input.clipSceneIds) {
    const scene = project.scenes[sceneId];
    const assetId = scene?.selectedAssetId;
    if (!scene || !assetId) throw new Error(`Missing cut fixture for ${sceneId}`);
    const clipId = `clip_${sceneId}`;
    clips[clipId] = {
      id: clipId,
      sceneId,
      assetId,
      sourceInSeconds: null,
      sourceOutSeconds: null,
      crop: null,
      filters: [],
      ...input.clipEdits?.[sceneId],
    };
  }
  const cut: StudioCut = {
    id: 'cut_1',
    name: 'Fixture cut',
    orderMode: input.orderMode,
    clipOrder: (input.clipOrderSceneIds ?? input.clipSceneIds).map((sceneId) => `clip_${sceneId}`),
    clips,
  };
  await harness.store.updateProject('project_1', (current) => ({
    ...current,
    cuts: { [cut.id]: cut },
    activeCutId: cut.id,
  }));
};

const storeWithNonCanonicalClipAssets = async (
  harness: RenderHarness,
  sceneIds: string[]
): Promise<Pick<CreativeStudioStore, 'getProject'>> => {
  const project = structuredClone(await harness.store.getProject('project_1'));
  if (project === null || project.activeCutId === null || project.activeCutId === undefined) {
    throw new Error('Missing active cut fixture');
  }
  const cut = project.cuts?.[project.activeCutId];
  if (cut === undefined) throw new Error('Missing active cut fixture');
  for (const sceneId of sceneIds) {
    const scene = project.scenes[sceneId];
    const selected = scene?.selectedAssetId === null ? undefined : project.assets[scene?.selectedAssetId ?? ''];
    const clip = cut.clips[`clip_${sceneId}`];
    if (!scene || !selected || !clip) throw new Error(`Missing cut fixture for ${sceneId}`);
    const assetId = `import_${sceneId}`;
    project.assets[assetId] = {
      ...selected,
      id: assetId,
      managedAsset: { collection: 'imports', fileName: `${assetId}${path.extname(selected.managedAsset.fileName)}` },
    };
    scene.assetIds.push(assetId);
    clip.assetId = assetId;
  }
  return { getProject: async (projectId) => (projectId === project.id ? project : null) };
};

const probe = async (
  filePath: string
): Promise<{
  streams: Array<{
    codec_type: string;
    codec_name?: string;
    profile?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    duration?: string;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    time_base?: string;
    sample_rate?: string;
    channels?: number;
  }>;
  format: { duration: string };
}> => {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,profile,pix_fmt,width,height,duration,r_frame_rate,avg_frame_rate,time_base,sample_rate,channels:format=duration',
    '-of',
    'json',
    filePath,
  ]);
  return JSON.parse(stdout) as {
    streams: Array<{
      codec_type: string;
      codec_name?: string;
      profile?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      duration?: string;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      time_base?: string;
      sample_rate?: string;
      channels?: number;
    }>;
    format: { duration: string };
  };
};

const probeVideoKeyframeTimes = async (filePath: string): Promise<number[]> => {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_packets',
    '-show_entries',
    'packet=pts_time,flags',
    '-of',
    'json',
    filePath,
  ]);
  const result = JSON.parse(stdout) as { packets: Array<{ pts_time?: string; flags?: string }> };
  return result.packets
    .filter((packet) => packet.flags?.includes('K'))
    .map((packet) => Number(packet.pts_time))
    .filter(Number.isFinite);
};

const probeVideoPacketTimes = async (filePath: string): Promise<number[]> => {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_packets',
    '-show_entries',
    'packet=pts_time',
    '-of',
    'json',
    filePath,
  ]);
  const result = JSON.parse(stdout) as { packets: Array<{ pts_time?: string }> };
  return result.packets.map((packet) => Number(packet.pts_time)).filter(Number.isFinite);
};

const probeCountedStreams = async (
  filePath: string
): Promise<Array<{ codec_type: string; duration?: string; nb_read_frames?: string }>> => {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-count_frames',
    '-show_entries',
    'stream=codec_type,duration,nb_read_frames',
    '-of',
    'json',
    filePath,
  ]);
  return (JSON.parse(stdout) as { streams: Array<{ codec_type: string; duration?: string; nb_read_frames?: string }> })
    .streams;
};

const probeRgbPixel = async (
  filePath: string,
  timeSeconds: number,
  x: number,
  y: number,
  width: number
): Promise<[number, number, number]> => {
  const frame = await runBuffer(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(timeSeconds),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  const offset = (y * width + x) * 3;
  return [frame[offset]!, frame[offset + 1]!, frame[offset + 2]!];
};

const captureSegmentVideoFilters = (): {
  filters: string[];
  spawnProcess: StudioRenderSpawn;
} => {
  const filters: string[] = [];
  return {
    filters,
    spawnProcess: (command, args, options) => {
      const filterIndex = args.indexOf('-vf');
      if (filterIndex !== -1 && args.some((argument) => argument.includes('segment-'))) {
        filters.push(args[filterIndex + 1]!);
      }
      return spawn(command, args, options);
    },
  };
};

const matrixFromVideoFilter = (videoFilter: string): number[] | null => {
  const mixer = videoFilter.split(',').find((part) => part.startsWith('colorchannelmixer='));
  if (mixer === undefined) return null;
  const values = new Map(
    mixer
      .slice('colorchannelmixer='.length)
      .split(':')
      .map((entry): [string, number] => {
        const [key, value] = entry.split('=');
        return [key!, Number(value)];
      })
  );
  const get = (key: string, fallback: number): number => values.get(key) ?? fallback;
  return [
    get('rr', 1),
    get('rg', 0),
    get('rb', 0),
    0,
    get('ra', 0),
    get('gr', 0),
    get('gg', 1),
    get('gb', 0),
    0,
    get('ga', 0),
    get('br', 0),
    get('bg', 0),
    get('bb', 1),
    0,
    get('ba', 0),
    0,
    0,
    0,
    1,
    0,
  ];
};

/**
 * Colour-conformance probes use the tight default: the golden-pixel table is the
 * contract and must hold to within a codec rounding step.
 *
 * Spatial probes near a frame edge need a wider window. 4:2:0 chroma is subsampled,
 * and how an encoder reconstructs it at the boundary differs between `libx264` and
 * `h264_videotoolbox` — the same crop assertion measures 3 on the hardware encoder
 * and passes on the software one. Widening it there costs nothing, because those
 * probes distinguish a saturated colour from its absence (a gap of ~200), not one
 * rounding step from another.
 */
const expectPixelNear = (actual: readonly number[], expected: readonly number[], tolerance = 2): void => {
  expect(actual).toHaveLength(3);
  for (const [index, value] of actual.entries()) {
    expect(Math.abs(value - expected[index]!)).toBeLessThanOrEqual(tolerance);
  }
};

beforeAll(async () => {
  if (ffmpegAvailable) fixtures = await createFixtures();
}, 30_000);

afterAll(async () => {
  await Promise.all(
    [...createdRoots.splice(0), fixtureRoot]
      .filter(Boolean)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('resolveStudioRenderDimensions', () => {
  it.each([
    ['720p', '16:9', 1280, 720],
    ['720p', '9:16', 720, 1280],
    ['720p', '1:1', 720, 720],
    ['720p', '4:3', 960, 720],
    ['720p', '3:4', 720, 960],
    ['1080p', '16:9', 1920, 1080],
    ['1080p', '9:16', 1080, 1920],
    ['1080p', '1:1', 1080, 1080],
    ['1080p', '4:3', 1440, 1080],
    ['1080p', '3:4', 1080, 1440],
  ] as const)('maps %s %s to an even %sx%s frame', (resolution, aspectRatio, width, height) => {
    expect(resolveStudioRenderDimensions(resolution, aspectRatio)).toEqual({ width, height });
  });
});

describe('schema-2 render cut projections', () => {
  it('does not synthesize the schema-1 implicit cut when schema 2 has no active cut', () => {
    const project = createEmptyStudioProjectV2(
      {
        name: 'Empty projection',
        brief: '',
        aspectRatio: '16:9',
        targetDurationSeconds: 30,
        resolution: '1080p',
      },
      'empty_projection',
      renderProjectionTimestamp
    );

    expect(resolvePersistedStudioRenderCutV2(project)).toBeNull();
    expect(resolveActiveStudioRenderCutV2(project)).toBeNull();
  });

  it('retains parked placements in persistence while filtering them from active rendering', () => {
    const project = makeRenderProjectionProjectV2();
    const before = structuredClone(project);

    const persisted = resolvePersistedStudioRenderCutV2(project);
    const active = resolveActiveStudioRenderCutV2(project);

    expect(persisted).toMatchObject({ scope: 'persisted', projectId: project.id, cutId: 'cut_1' });
    expect(persisted?.placements.map(({ id }) => id)).toEqual(['placement_a', 'placement_b', 'placement_c']);
    expect(active?.placements.map(({ id }) => id)).toEqual(['placement_a', 'placement_b']);
    expect(project).toEqual(before);
  });

  it('deep-clones persisted crop and filter decisions', () => {
    const project = makeRenderProjectionProjectV2();
    const source = project.cuts.cut_1!.clips.placement_a!;

    const projected = resolvePersistedStudioRenderCutV2(project)!.placements[0]!;

    expect(projected).not.toBe(source);
    expect(projected.crop).not.toBe(source.crop);
    expect(projected.filters).not.toBe(source.filters);
    expect(projected.filters[0]).not.toBe(source.filters[0]);
  });

  it('preserves manual placement order as a filtered subsequence instead of storyboard order', () => {
    const project = makeRenderProjectionProjectV2();
    const cut = project.cuts.cut_1!;
    cut.orderMode = 'manual';
    cut.clipOrder = ['placement_c', 'placement_b', 'placement_a'];

    const persisted = resolvePersistedStudioRenderCutV2(project);
    const active = resolveActiveStudioRenderCutV2(project);

    expect(persisted?.placements.map(({ id }) => id)).toEqual(['placement_c', 'placement_b', 'placement_a']);
    expect(active?.placements.map(({ id }) => id)).toEqual(['placement_b', 'placement_a']);
  });

  it('restores a dormant placement when its owning section becomes active', () => {
    const project = makeRenderProjectionProjectV2();
    expect(resolveActiveStudioRenderCutV2(project)?.placements.map(({ id }) => id)).toEqual([
      'placement_a',
      'placement_b',
    ]);

    project.beatOrder.push('section_c');
    project.bin = [];

    expect(resolveActiveStudioRenderCutV2(project)?.placements.map(({ id }) => id)).toEqual([
      'placement_a',
      'placement_b',
      'placement_c',
    ]);
  });

  it.each([
    [
      'missing selection',
      (project: StudioProjectV2) => {
        project.shots.clip_a!.selectedTakeId = null;
      },
    ],
    [
      'foreign-clip selection',
      (project: StudioProjectV2) => {
        project.assets.foreign_selected = makeProjectionAsset('foreign_selected', 'clip_b');
        project.shots.clip_a!.assetIds.push('foreign_selected');
        project.shots.clip_a!.selectedTakeId = 'foreign_selected';
      },
    ],
    [
      'wrong-kind selection',
      (project: StudioProjectV2) => {
        project.assets.wrong_kind_selected = {
          ...makeProjectionAsset('wrong_kind_selected', 'clip_a'),
          mediaKind: 'image',
          mimeType: 'image/png',
        };
        project.shots.clip_a!.assetIds.push('wrong_kind_selected');
        project.shots.clip_a!.selectedTakeId = 'wrong_kind_selected';
      },
    ],
  ] as const)('filters an active placement with %s', (_label, mutate) => {
    const project = makeRenderProjectionProjectV2();
    mutate(project);

    expect(resolveActiveStudioRenderCutV2(project)?.placements.map(({ id }) => id)).toEqual(['placement_b']);
  });

  it('filters a placement whose cut asset is not a canonical generated take', () => {
    const project = makeRenderProjectionProjectV2();
    project.assets.imported_placement = {
      ...makeProjectionAsset('imported_placement', 'clip_a'),
      managedAsset: { collection: 'imports', fileName: 'imported_placement.mp4' },
    };
    project.shots.clip_a!.assetIds.push('imported_placement');
    project.cuts.cut_1!.clips.placement_a!.assetId = 'imported_placement';

    expect(resolveActiveStudioRenderCutV2(project)?.placements.map(({ id }) => id)).toEqual(['placement_b']);
  });
});

describe('Studio render runner', () => {
  it('rejects a second render for the same project without starting another operation', async () => {
    const pending = deferred<StudioRenderResult>();
    const startOperation = vi.fn(() => ({ result: pending.promise, cancel: vi.fn() }));
    const runner = createStudioRenderRunner({ startOperation, onStateChanged: vi.fn() });

    const first = runner.renderCut('project_1');

    await expect(runner.renderCut('project_1')).rejects.toMatchObject({ code: 'busy' });
    expect(startOperation).toHaveBeenCalledOnce();
    expect(runner.getState('project_1')).toMatchObject({ status: 'running', progress: 0 });

    pending.resolve({ status: 'rendered', assetId: 'render_1', missingSceneIds: [] });
    await expect(first).resolves.toEqual({ assetId: 'render_1', missingSceneIds: [] });
  });

  it('relays monotonic progress and exposes the succeeded terminal state', async () => {
    const pending = deferred<StudioRenderResult>();
    let reportProgress: ((progress: { progress: number; clipIndex: number; clipTotal: number }) => void) | undefined;
    const states: StudioRenderProgressEvent[] = [];
    const runner = createStudioRenderRunner({
      startOperation: (_projectId, onProgress) => {
        reportProgress = onProgress;
        return { result: pending.promise, cancel: vi.fn() };
      },
      onStateChanged: (state) => states.push(state),
    });

    const result = runner.renderCut('project_1');
    reportProgress?.({ progress: 0.45, clipIndex: 2, clipTotal: 3 });
    reportProgress?.({ progress: 0.2, clipIndex: 1, clipTotal: 3 });
    pending.resolve({ status: 'rendered', assetId: 'render_1', missingSceneIds: ['scene_2'] });

    await expect(result).resolves.toEqual({ assetId: 'render_1', missingSceneIds: ['scene_2'] });
    expect(states.map(({ status, progress }) => [status, progress])).toEqual([
      ['running', 0],
      ['running', 0.45],
      ['succeeded', 1],
    ]);
    expect(states[1]).toMatchObject({ clipIndex: 2, clipTotal: 3 });
    expect(runner.getState('project_1')).toEqual({
      projectId: 'project_1',
      status: 'succeeded',
      progress: 1,
      assetId: 'render_1',
      missingSceneIds: ['scene_2'],
    });
  });

  it('cancels the active operation and exposes cancellation only after it terminates', async () => {
    const pending = deferred<StudioRenderResult>();
    const cancel = vi.fn(() => pending.resolve({ status: 'cancelled', missingSceneIds: ['scene_2'] }));
    const runner = createStudioRenderRunner({
      startOperation: (): StudioRenderOperation => ({ result: pending.promise, cancel }),
      onStateChanged: vi.fn(),
    });

    const result = runner.renderCut('project_1');

    expect(runner.cancelRender('project_1')).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
    expect(runner.getState('project_1')).toEqual({
      projectId: 'project_1',
      status: 'cancelled',
      progress: 0,
      missingSceneIds: ['scene_2'],
    });
  });

  it('cancels every active render and waits for termination during disposal', async () => {
    const first = deferred<StudioRenderResult>();
    const second = deferred<StudioRenderResult>();
    const cancellations: string[] = [];
    const runner = createStudioRenderRunner({
      startOperation: (projectId) => ({
        result: projectId === 'project_1' ? first.promise : second.promise,
        cancel: () => {
          cancellations.push(projectId);
        },
      }),
      onStateChanged: vi.fn(),
    });
    const renderOne = runner.renderCut('project_1');
    const renderTwo = runner.renderCut('project_2');

    let disposed = false;
    const disposal = runner.dispose().then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(cancellations).toEqual(['project_1', 'project_2']);
    expect(disposed).toBe(false);
    first.resolve({ status: 'cancelled', missingSceneIds: [] });
    second.resolve({ status: 'cancelled', missingSceneIds: [] });
    await Promise.allSettled([renderOne, renderTwo]);
    await disposal;
    expect(disposed).toBe(true);
  });

  it.each([
    [
      () => Promise.resolve<StudioRenderResult>({ status: 'no_renderable_scenes', missingSceneIds: ['scene_1'] }),
      'no_renderable_scenes',
      ['scene_1'],
    ],
    [() => Promise.reject(new CreativeStudioRenderError('ffmpeg_unavailable')), 'ffmpeg_unavailable', undefined],
    [() => Promise.reject(new CreativeStudioRenderError('render_failed')), 'render_failed', undefined],
  ] as const)('exposes a failed terminal state for %s', async (createResult, code, missingSceneIds) => {
    const runner = createStudioRenderRunner({
      startOperation: () => ({ result: createResult(), cancel: vi.fn() }),
      onStateChanged: vi.fn(),
    });

    await expect(runner.renderCut('project_1')).rejects.toMatchObject({ code });
    expect(runner.getState('project_1')).toEqual({
      projectId: 'project_1',
      status: 'failed',
      progress: 0,
      errorCode: code,
      ...(missingSceneIds === undefined ? {} : { missingSceneIds }),
    });
  });
});

describe.skipIf(!ffmpegAvailable)('renderCut with real ffmpeg and ffprobe', () => {
  it('persists a guarded cut edit and renders its trim, crop, and colour into the probed file', async () => {
    const harness = await createHarness([
      { id: 'scene_edited', mediaKind: 'image', durationSeconds: 1, fixture: 'cropImage' },
    ]);
    const storyboardPlanner: StudioStoryboardPlanner = {
      listModels: async () => [],
      draft: async () => {
        throw new Error('not used');
      },
      dispose: async () => undefined,
    };
    const service = createCreativeStudioService({
      store: harness.store,
      storyboardPlanner,
      onProjectUpdated: vi.fn(),
    });
    const opened = (await service.getProject('project_1'))!;
    const cutId = opened.activeCutId!;
    const cut = opened.cuts![cutId]!;
    const clipId = cut.clipOrder[0]!;
    const edited = await service.updateCut({
      projectId: opened.id,
      expectedRevision: opened.revision,
      cutId,
      cut: {
        orderMode: cut.orderMode,
        clipOrder: [...cut.clipOrder],
        clips: Object.fromEntries(
          Object.entries(cut.clips).map(([id, clip]) => [
            id,
            id === clipId
              ? {
                  sourceInSeconds: 0.2,
                  sourceOutSeconds: 0.7,
                  crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
                  filters: [{ id: 'saturation', amount: -1 }],
                }
              : {
                  sourceInSeconds: clip.sourceInSeconds,
                  sourceOutSeconds: clip.sourceOutSeconds,
                  crop: clip.crop,
                  filters: clip.filters,
                },
          ])
        ),
      },
    });

    expect(edited.cuts?.[cutId]?.orderMode).toBe('manual');
    expect((await harness.store.getProject('project_1'))?.cuts?.[cutId]?.clips[clipId]).toMatchObject({
      sourceInSeconds: 0.2,
      sourceOutSeconds: 0.7,
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      filters: [{ id: 'saturation', amount: -1 }],
    });

    await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    expect(Number((await probe(harness.outputPath)).format.duration)).toBeCloseTo(0.5, 1);
    const edge = await probeRgbPixel(harness.outputPath, 0.25, 20, 20, 1280);
    const centre = await probeRgbPixel(harness.outputPath, 0.25, 640, 360, 1280);
    expect(Math.max(...edge) - Math.min(...edge)).toBeLessThanOrEqual(3);
    expect(edge).toEqual(centre);
  }, 60_000);

  it('renders a manual cut in clip order instead of scene order', async () => {
    const harness = await createHarness([
      { id: 'scene_short', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
      { id: 'scene_long', mediaKind: 'image', durationSeconds: 2, fixture: 'image' },
    ]);
    await setActiveCut(harness, {
      orderMode: 'manual',
      clipSceneIds: ['scene_short', 'scene_long'],
      clipOrderSceneIds: ['scene_long', 'scene_short'],
    });

    const result = await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    expect(result).toEqual({ status: 'rendered', assetId: 'render_asset', missingSceneIds: [] });
    const keyframeTimes = await probeVideoKeyframeTimes(harness.outputPath);
    // The second segment starts at 2s only when the two-second clip renders first; scene order starts it at 1s.
    expect(keyframeTimes[1]).toBeCloseTo(2, 1);
  }, 60_000);

  it('renders a storyboard cut identically to the legacy no-cut project', async () => {
    const inputs: SceneInput[] = [
      { id: 'scene_short', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
      { id: 'scene_long', mediaKind: 'image', durationSeconds: 2, fixture: 'image' },
    ];
    const legacyHarness = await createHarness(inputs);
    const storyboardHarness = await createHarness(inputs);
    await setActiveCut(storyboardHarness, {
      orderMode: 'storyboard',
      clipSceneIds: ['scene_short', 'scene_long'],
    });

    const [legacyResult, storyboardResult] = await Promise.all(
      [legacyHarness, storyboardHarness].map(
        (harness) =>
          renderCut('project_1', {
            store: harness.store,
            mediaStore: harness.mediaStore,
            environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
            temporaryRoot: harness.temporaryRoot,
          }).result
      )
    );

    expect(storyboardResult).toEqual(legacyResult);
    expect(await probe(storyboardHarness.outputPath)).toEqual(await probe(legacyHarness.outputPath));
    const legacyKeyframes = await probeVideoKeyframeTimes(legacyHarness.outputPath);
    expect(await probeVideoKeyframeTimes(storyboardHarness.outputPath)).toEqual(legacyKeyframes);
    expect(legacyKeyframes[1]).toBeCloseTo(1, 1);
    // R2 edit support must preserve the exact R1 artefact when every edit is at its default.
    expect(await fs.readFile(storyboardHarness.outputPath)).toEqual(await fs.readFile(legacyHarness.outputPath));
  }, 60_000);

  it('snaps an off-grid trim to inclusive sourceIn and exclusive sourceOut frames with aligned audio', async () => {
    const harness = await createHarness([
      {
        id: 'scene_trimmed',
        mediaKind: 'video',
        durationSeconds: 6,
        fixture: 'longVideoWithAudio',
        assetDurationSeconds: 6,
      },
    ]);
    await setActiveCut(harness, {
      orderMode: 'manual',
      clipSceneIds: ['scene_trimmed'],
      clipEdits: {
        scene_trimmed: { sourceInSeconds: 4.99, sourceOutSeconds: 5.5 },
      },
    });

    await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    const streams = await probeCountedStreams(harness.outputPath);
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    // [4.99, 5.5) starts at source frame 120 (5.0s), excludes frame 132 (5.5s), then normalises to 30fps.
    expect(Number(video?.nb_read_frames)).toBe(15);
    expect(Math.abs(Number(video?.duration) - Number(audio?.duration))).toBeLessThan(0.04);
    expect(Number(audio?.duration)).toBeLessThan(0.55);
  }, 60_000);

  it('clamps a trim to decoded EOF when asset duration is absent', async () => {
    const harness = await createHarness([
      {
        id: 'scene_unknown_duration',
        mediaKind: 'video',
        durationSeconds: 6,
        fixture: 'longVideoWithAudio',
      },
    ]);
    await setActiveCut(harness, {
      orderMode: 'manual',
      clipSceneIds: ['scene_unknown_duration'],
      clipEdits: {
        scene_unknown_duration: { sourceInSeconds: 5, sourceOutSeconds: 99 },
      },
    });

    await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    const video = (await probeCountedStreams(harness.outputPath)).find((stream) => stream.codec_type === 'video');
    expect(Number(video?.nb_read_frames)).toBe(30);
  }, 60_000);

  it('concatenates trimmed A/V segments without a frame gap', async () => {
    const sceneIds = ['scene_first_trim', 'scene_second_trim'];
    const harness = await createHarness(
      sceneIds.map((id) => ({
        id,
        mediaKind: 'video',
        durationSeconds: 6,
        fixture: 'longVideoWithAudio',
        assetDurationSeconds: 6,
      }))
    );
    await setActiveCut(harness, {
      orderMode: 'manual',
      clipSceneIds: sceneIds,
      clipEdits: Object.fromEntries(
        sceneIds.map((sceneId) => [sceneId, { sourceInSeconds: 4.99, sourceOutSeconds: 5.5 }])
      ),
    });

    await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    const frameTimes = (await probeVideoPacketTimes(harness.outputPath)).toSorted((left, right) => left - right);
    expect(frameTimes).toHaveLength(30);
    const gaps = frameTimes.flatMap((time, index) =>
      index === 0 || Math.abs(time - frameTimes[index - 1]! - 1 / 30) < 0.000_01
        ? []
        : [{ index, previous: frameTimes[index - 1], time, delta: time - frameTimes[index - 1]! }]
    );
    expect(gaps).toEqual([]);
    const streams = await probeCountedStreams(harness.outputPath);
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    expect(Math.abs(Number(video?.duration) - Number(audio?.duration))).toBeLessThan(0.04);
  }, 60_000);

  it('crops in source-normalised coordinates before aspect-locked scale and pad', async () => {
    const harness = await createHarness([
      { id: 'scene_cropped', mediaKind: 'image', durationSeconds: 1, fixture: 'cropImage' },
    ]);
    await setActiveCut(harness, {
      orderMode: 'manual',
      clipSceneIds: ['scene_cropped'],
      clipEdits: {
        scene_cropped: { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
      },
    });

    await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    const video = (await probe(harness.outputPath)).streams.find((stream) => stream.codec_type === 'video');
    expect(video).toMatchObject({ width: 1280, height: 720 });
    expect(video!.width! % 2).toBe(0);
    expect(video!.height! % 2).toBe(0);
    // Edge-region probe: see expectPixelNear — encoder chroma reconstruction differs there.
    expectPixelNear(await probeRgbPixel(harness.outputPath, 0.5, 20, 20, 1280), [0, 255, 0], 8);
  }, 60_000);

  it('derives the fixed-order 4x5 matrix identically from different filter array orders', async () => {
    const filterOrders: StudioEditableCutClip['filters'][] = [
      [
        { id: 'exposure', amount: 0.5 },
        { id: 'temperature', amount: 0.5 },
        { id: 'contrast', amount: 0.5 },
        { id: 'saturation', amount: -1 },
      ],
      [
        { id: 'saturation', amount: -1 },
        { id: 'contrast', amount: 0.5 },
        { id: 'temperature', amount: 0.5 },
        { id: 'exposure', amount: 0.5 },
      ],
    ];
    const matrices: Array<number[] | null> = [];
    for (const filters of filterOrders) {
      // Sequential fixtures keep the expected matrix-to-filter association explicit.
      // eslint-disable-next-line no-await-in-loop
      const harness = await createHarness([
        { id: 'scene_matrix', mediaKind: 'image', durationSeconds: 1, fixture: 'pixelImage' },
      ]);
      // eslint-disable-next-line no-await-in-loop
      await setActiveCut(harness, {
        orderMode: 'manual',
        clipSceneIds: ['scene_matrix'],
        clipEdits: { scene_matrix: { filters } },
      });
      const capture = captureSegmentVideoFilters();
      // eslint-disable-next-line no-await-in-loop
      await renderCut('project_1', {
        store: harness.store,
        mediaStore: harness.mediaStore,
        spawnProcess: capture.spawnProcess,
        environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
        temporaryRoot: harness.temporaryRoot,
      }).result;
      matrices.push(matrixFromVideoFilter(capture.filters[0]!));
    }

    const expected = [
      0.526185, 1.6092, 0.146205, 0, -0.25, 0.526185, 1.6092, 0.146205, 0, -0.25, 0.526185, 1.6092, 0.146205, 0, -0.25,
      0, 0, 0, 1, 0,
    ];
    expect(matrices[0]).toEqual(expected);
    expect(matrices[1]).toEqual(expected);
  }, 60_000);

  it('matches the Chromium golden pixels including identity and 8-bit clamping', async () => {
    const cases: Array<{
      id: string;
      filters: StudioEditableCutClip['filters'];
      expected: readonly [number, number, number];
    }> = [
      { id: 'exposure', filters: [{ id: 'exposure', amount: 0.5 }], expected: [192, 96, 48] },
      { id: 'contrast', filters: [{ id: 'contrast', amount: 0.5 }], expected: [128, 32, 0] },
      { id: 'saturation', filters: [{ id: 'saturation', amount: -1 }], expected: [75, 75, 75] },
      {
        id: 'identity',
        filters: [
          { id: 'exposure', amount: 0 },
          { id: 'contrast', amount: 0 },
          { id: 'saturation', amount: 0 },
          { id: 'temperature', amount: 0 },
        ],
        expected: [128, 64, 32],
      },
      { id: 'clamp', filters: [{ id: 'exposure', amount: 1 }], expected: [255, 128, 64] },
    ];
    const harness = await createHarness(
      cases.map(({ id }) => ({ id: `scene_${id}`, mediaKind: 'image', durationSeconds: 1, fixture: 'pixelImage' }))
    );
    await setActiveCut(harness, {
      orderMode: 'manual',
      clipSceneIds: cases.map(({ id }) => `scene_${id}`),
      clipEdits: Object.fromEntries(cases.map(({ id, filters }) => [`scene_${id}`, { filters }])),
    });

    await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    for (const [index, golden] of cases.entries()) {
      // Codec round-tripping can move a channel by at most two levels; the matrix boundary is exact 8-bit sRGB.
      // eslint-disable-next-line no-await-in-loop
      const actual = await probeRgbPixel(harness.outputPath, index + 0.5, 640, 360, 1280);
      expectPixelNear(actual, golden.expected);
    }
  }, 60_000);

  it('applies the composed matrix when valid filter amounts exceed colorchannelmixer coefficient limits', async () => {
    const harness = await createHarness([
      { id: 'scene_extreme', mediaKind: 'image', durationSeconds: 1, fixture: 'pixelImage' },
    ]);
    await setActiveCut(harness, {
      orderMode: 'manual',
      clipSceneIds: ['scene_extreme'],
      clipEdits: {
        scene_extreme: {
          filters: [
            { id: 'exposure', amount: 1 },
            { id: 'temperature', amount: 1 },
            { id: 'contrast', amount: 1 },
            { id: 'saturation', amount: 1 },
          ],
        },
      },
    });

    await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    expectPixelNear(await probeRgbPixel(harness.outputPath, 0.5, 640, 360, 1280), [255, 63, 0]);
  }, 60_000);

  it('skips the colour render pass when all four filter amounts are identity', async () => {
    const harness = await createHarness([
      { id: 'scene_identity', mediaKind: 'image', durationSeconds: 1, fixture: 'pixelImage' },
    ]);
    await setActiveCut(harness, {
      orderMode: 'manual',
      clipSceneIds: ['scene_identity'],
      clipEdits: {
        scene_identity: {
          filters: [
            { id: 'exposure', amount: 0 },
            { id: 'contrast', amount: 0 },
            { id: 'saturation', amount: 0 },
            { id: 'temperature', amount: 0 },
          ],
        },
      },
    });
    const capture = captureSegmentVideoFilters();

    await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      spawnProcess: capture.spawnProcess,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    expect(capture.filters).toHaveLength(1);
    expect(capture.filters[0]).not.toContain('colorchannelmixer');
    expect(capture.filters[0]).not.toContain('gbrap');
  }, 60_000);

  it('renders fixed-order filters byte-identically regardless of array order', async () => {
    const filterOrders: StudioEditableCutClip['filters'][] = [
      [
        { id: 'temperature', amount: 0.5 },
        { id: 'exposure', amount: 0.5 },
      ],
      [
        { id: 'exposure', amount: 0.5 },
        { id: 'temperature', amount: 0.5 },
      ],
    ];
    const outputs: Buffer[] = [];
    for (const filters of filterOrders) {
      // Sequential fixtures and renders make byte equality independent of concurrent encoder scheduling.
      // eslint-disable-next-line no-await-in-loop
      const harness = await createHarness([
        { id: 'scene_order', mediaKind: 'image', durationSeconds: 1, fixture: 'pixelImage' },
      ]);
      // eslint-disable-next-line no-await-in-loop
      await setActiveCut(harness, {
        orderMode: 'manual',
        clipSceneIds: ['scene_order'],
        clipEdits: { scene_order: { filters } },
      });
      // eslint-disable-next-line no-await-in-loop
      await renderCut('project_1', {
        store: harness.store,
        mediaStore: harness.mediaStore,
        environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
        temporaryRoot: harness.temporaryRoot,
      }).result;
      // eslint-disable-next-line no-await-in-loop
      outputs.push(await fs.readFile(harness.outputPath));
    }

    expect(outputs[0]).toEqual(outputs[1]);
  }, 60_000);

  it('rejects duplicate filter ids before invoking ffmpeg', async () => {
    const harness = await createHarness([
      { id: 'scene_duplicate', mediaKind: 'image', durationSeconds: 1, fixture: 'pixelImage' },
    ]);
    await setActiveCut(harness, { orderMode: 'manual', clipSceneIds: ['scene_duplicate'] });
    const project = structuredClone(await harness.store.getProject('project_1'))!;
    project.cuts!.cut_1.clips.clip_scene_duplicate.filters = [
      { id: 'exposure', amount: 0.25 },
      { id: 'exposure', amount: 0.5 },
    ];
    let spawnCount = 0;

    await expect(
      renderCut('project_1', {
        store: { getProject: async () => project },
        mediaStore: harness.mediaStore,
        spawnProcess: (command, args, options) => {
          spawnCount += 1;
          return spawn(command, args, options);
        },
        environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
        temporaryRoot: harness.temporaryRoot,
      }).result
    ).rejects.toMatchObject({ code: 'render_failed' });
    expect(spawnCount).toBe(0);
  }, 60_000);

  it('drops a non-canonical clip asset and reports it with scenes that have no clip', async () => {
    const harness = await createHarness([
      { id: 'scene_valid', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
      { id: 'scene_invalid', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
      { id: 'scene_without_clip', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
    ]);
    await setActiveCut(harness, {
      orderMode: 'manual',
      clipSceneIds: ['scene_valid', 'scene_invalid'],
    });
    const store = await storeWithNonCanonicalClipAssets(harness, ['scene_invalid']);

    const result = await renderCut('project_1', {
      store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    // The selected take stays canonical so this fails if render ignores clip.assetId.
    expect(result).toEqual({
      status: 'rendered',
      assetId: 'render_asset',
      missingSceneIds: ['scene_invalid', 'scene_without_clip'],
    });
    expect(Number((await probe(harness.outputPath)).format.duration)).toBeCloseTo(1, 1);
  }, 60_000);

  it('returns no_renderable_scenes when every active-cut clip asset is non-canonical', async () => {
    const harness = await createHarness([
      { id: 'scene_one', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
      { id: 'scene_two', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
    ]);
    await setActiveCut(harness, {
      orderMode: 'manual',
      clipSceneIds: ['scene_one', 'scene_two'],
    });
    const store = await storeWithNonCanonicalClipAssets(harness, ['scene_one', 'scene_two']);
    let spawnCount = 0;
    const spawnProcess: StudioRenderSpawn = (command, args, options) => {
      spawnCount += 1;
      return spawn(command, args, options);
    };

    const result = await renderCut('project_1', {
      store,
      mediaStore: harness.mediaStore,
      spawnProcess,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    expect(result).toEqual({
      status: 'no_renderable_scenes',
      missingSceneIds: ['scene_one', 'scene_two'],
    });
    expect(spawnCount).toBe(0);
    await expect(fs.access(harness.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('renders an image and video into a revision-neutral 720p cut and reports a missing scene', async () => {
    const harness = await createHarness([
      { id: 'scene_image', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
      {
        id: 'scene_video',
        mediaKind: 'video',
        durationSeconds: 1,
        fixture: 'videoWithAudio',
        assetDurationSeconds: 1,
      },
      { id: 'scene_missing', mediaKind: 'video', durationSeconds: 1 },
    ]);

    const operation = renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    });
    const result = await operation.result;

    expect(result).toEqual({
      status: 'rendered',
      assetId: 'render_asset',
      missingSceneIds: ['scene_missing'],
    });
    const details = await probe(harness.outputPath);
    const video = details.streams.find((stream) => stream.codec_type === 'video');
    const audio = details.streams.find((stream) => stream.codec_type === 'audio');
    expect(details.streams.map((stream) => stream.codec_type).toSorted()).toEqual(['audio', 'video']);
    expect(video).toMatchObject({
      codec_name: 'h264',
      profile: 'High',
      pix_fmt: 'yuv420p',
      width: 1280,
      height: 720,
      time_base: '1/90000',
    });
    const [frameRateNumerator, frameRateDenominator] = video?.avg_frame_rate?.split('/').map(Number) ?? [];
    expect(frameRateNumerator! / frameRateDenominator!).toBeCloseTo(30, 0);
    expect(audio).toMatchObject({ codec_name: 'aac', sample_rate: '48000', channels: 2 });
    expect(Number(details.format.duration)).toBeCloseTo(2, 1);

    const stored = await harness.store.getProject('project_1');
    expect(stored?.revision).toBe(harness.projectRevision);
    expect(stored).not.toHaveProperty('cuts');
    await expect(harness.mediaStore.resolveAsset('project_1', 'render_asset')).resolves.toMatchObject({
      asset: { sceneId: null, managedAsset: { collection: 'assets' } },
    });
    await expect(fs.readdir(harness.temporaryRoot)).resolves.toEqual([]);
  }, 60_000);

  it('keeps one aligned audio stream when a silent take precedes a non-silent take', async () => {
    const harness = await createHarness([
      { id: 'scene_silent', mediaKind: 'video', durationSeconds: 1, fixture: 'silentVideo' },
      { id: 'scene_audio', mediaKind: 'video', durationSeconds: 1, fixture: 'videoWithAudio' },
    ]);
    const progress: Array<{ progress: number; clipIndex: number; clipTotal: number }> = [];

    const result = await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
      onProgress: (value) => progress.push(value),
    }).result;

    expect(result.status).toBe('rendered');
    const details = await probe(harness.outputPath);
    const video = details.streams.find((stream) => stream.codec_type === 'video');
    const audio = details.streams.find((stream) => stream.codec_type === 'audio');
    expect(audio).toBeDefined();
    expect(Math.abs(Number(video?.duration) - Number(audio?.duration))).toBeLessThan(0.12);

    const { stderr } = await run(ffmpegPath, [
      '-hide_banner',
      '-ss',
      '1.1',
      '-t',
      '0.7',
      '-i',
      harness.outputPath,
      '-map',
      '0:a:0',
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ]);
    const meanVolume = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
    expect(Number(meanVolume?.[1])).toBeGreaterThan(-50);
    expect(progress.at(-1)).toEqual({ progress: 1, clipIndex: 2, clipTotal: 2 });
    expect(progress.some(({ clipIndex, clipTotal }) => clipIndex === 1 && clipTotal === 2)).toBe(true);
    expect(progress.some(({ clipIndex, clipTotal }) => clipIndex === 2 && clipTotal === 2)).toBe(true);
    expect(progress.every((value, index) => index === 0 || value.progress >= progress[index - 1]!.progress)).toBe(true);
  }, 60_000);

  it('returns no_renderable_scenes without invoking ffmpeg for a selected import', async () => {
    const harness = await createHarness([
      {
        id: 'scene_import',
        mediaKind: 'image',
        durationSeconds: 1,
        fixture: 'image',
        collection: 'imports',
      },
    ]);
    let spawnCount = 0;
    const spawnProcess: StudioRenderSpawn = (command, args, options) => {
      spawnCount += 1;
      return spawn(command, args, options);
    };

    const result = await renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      spawnProcess,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    }).result;

    expect(result).toEqual({ status: 'no_renderable_scenes', missingSceneIds: ['scene_import'] });
    expect(spawnCount).toBe(0);
    await expect(fs.readdir(harness.temporaryRoot)).resolves.toEqual([]);
  });

  it('kills the active ffmpeg process and removes its private temp directory on cancellation', async () => {
    const harness = await createHarness(
      [{ id: 'scene_long', mediaKind: 'image', durationSeconds: 60, fixture: 'image' }],
      { resolution: '1080p' }
    );
    let segmentProcessId: number | undefined;
    let operation: ReturnType<typeof renderCut>;
    const spawnProcess: StudioRenderSpawn = (command, args, options) => {
      const child = spawn(command, args, options);
      if (args.some((argument) => argument.endsWith('segment-0000.mp4'))) {
        segmentProcessId = child.pid;
        queueMicrotask(() => operation.cancel());
      }
      return child;
    };

    operation = renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      spawnProcess,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
    });
    const result = await operation.result;

    expect(result).toEqual({ status: 'cancelled', missingSceneIds: [] });
    expect(segmentProcessId).toBeTypeOf('number');
    expect(() => process.kill(segmentProcessId!, 0)).toThrow();
    await expect(fs.readdir(harness.temporaryRoot)).resolves.toEqual([]);
    await expect(fs.access(harness.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  it('escalates cancellation from SIGTERM to SIGKILL when ffmpeg ignores termination', async () => {
    const harness = await createHarness([
      { id: 'scene_long', mediaKind: 'image', durationSeconds: 60, fixture: 'image' },
    ]);
    const signals: NodeJS.Signals[] = [];
    let operation: ReturnType<typeof renderCut>;
    const spawnProcess: StudioRenderSpawn = (command, args, options) => {
      if (!args.some((argument) => argument.endsWith('segment-0000.mp4'))) return spawn(command, args, options);
      const child = fakeChild((signal, emitter) => {
        signals.push(signal);
        if (signal === 'SIGKILL') queueMicrotask(() => emitter.emit('close', null));
      });
      queueMicrotask(() => operation.cancel());
      return child;
    };

    operation = renderCut('project_1', {
      store: harness.store,
      mediaStore: harness.mediaStore,
      spawnProcess,
      environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
      temporaryRoot: harness.temporaryRoot,
      terminationGraceMs: 5,
    });

    await expect(operation.result).resolves.toEqual({ status: 'cancelled', missingSceneIds: [] });
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  }, 60_000);

  it('finalizes an exited ffmpeg child, cleans its temp directory, and releases the project busy slot', async () => {
    const harness = await createHarness([
      { id: 'scene_exit', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
    ]);
    let failSegment = true;
    const spawnProcess: StudioRenderSpawn = (command, args, options) => {
      if (failSegment && args.some((argument) => argument.endsWith('segment-0000.mp4'))) {
        failSegment = false;
        const child = fakeChild();
        queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
        return child;
      }
      return spawn(command, args, options);
    };
    const runner = createStudioRenderRunner({
      startOperation: (projectId, onProgress) =>
        renderCut(projectId, {
          store: harness.store,
          mediaStore: harness.mediaStore,
          spawnProcess,
          onProgress,
          environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
          temporaryRoot: harness.temporaryRoot,
        }),
      onStateChanged: vi.fn(),
    });

    await expect(runner.renderCut('project_1')).rejects.toMatchObject({ code: 'render_failed' });
    expect(runner.getState('project_1')).toMatchObject({ status: 'failed', errorCode: 'render_failed' });
    await expect(fs.readdir(harness.temporaryRoot)).resolves.toEqual([]);
    await expect(runner.renderCut('project_1')).resolves.toMatchObject({ assetId: 'render_asset' });
  }, 60_000);

  it('rejects a zero-dimension decoded asset before starting its segment encoder', async () => {
    const harness = await createHarness([
      { id: 'scene_zero', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
    ]);
    let segmentStarted = false;
    const spawnProcess: StudioRenderSpawn = (command, args) => {
      const child = fakeChild();
      if (path.basename(command).startsWith('ffprobe')) {
        completeFakeChild(child, 0, JSON.stringify({ streams: [{ width: 0, height: 0 }] }));
      } else if (args.some((argument) => argument.endsWith('segment-0000.mp4'))) {
        segmentStarted = true;
        completeFakeChild(child);
      } else {
        completeFakeChild(child);
      }
      return child;
    };

    await expect(
      renderCut('project_1', {
        store: harness.store,
        mediaStore: harness.mediaStore,
        spawnProcess,
        environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
        temporaryRoot: harness.temporaryRoot,
      }).result
    ).rejects.toMatchObject({ code: 'render_failed' });
    expect(segmentStarted).toBe(false);
    await expect(fs.readdir(harness.temporaryRoot)).resolves.toEqual([]);
  });

  it('bounds a segment that produces no frame and reports render_failed', async () => {
    const harness = await createHarness([
      { id: 'scene_hung', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
    ]);
    const signals: NodeJS.Signals[] = [];
    const spawnProcess: StudioRenderSpawn = (command, args, options) => {
      if (!args.some((argument) => argument.endsWith('segment-0000.mp4'))) return spawn(command, args, options);
      return fakeChild((signal, emitter) => {
        signals.push(signal);
        if (signal === 'SIGKILL') queueMicrotask(() => emitter.emit('close', null));
      });
    };

    await expect(
      renderCut('project_1', {
        store: harness.store,
        mediaStore: harness.mediaStore,
        spawnProcess,
        environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
        temporaryRoot: harness.temporaryRoot,
        segmentTimeoutMs: 5,
        terminationGraceMs: 5,
      }).result
    ).rejects.toMatchObject({ code: 'render_failed' });
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    await expect(fs.readdir(harness.temporaryRoot)).resolves.toEqual([]);
  }, 60_000);

  it('reports ffmpeg_unavailable without changing the project or leaving temporary files', async () => {
    const harness = await createHarness([
      { id: 'scene_image', mediaKind: 'image', durationSeconds: 1, fixture: 'image' },
    ]);
    const before = await harness.store.getProject('project_1');

    await expect(
      renderCut('project_1', {
        store: harness.store,
        mediaStore: harness.mediaStore,
        environment: { ...process.env, FFMPEG_PATH: '/nonexistent' },
        temporaryRoot: harness.temporaryRoot,
      }).result
    ).rejects.toMatchObject<Partial<CreativeStudioRenderError>>({ code: 'ffmpeg_unavailable' });

    await expect(harness.store.getProject('project_1')).resolves.toEqual(before);
    await expect(fs.readdir(harness.temporaryRoot)).resolves.toEqual([]);
    await expect(fs.access(harness.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports render_failed with a sanitized stderr tail and cleans up a bad input', async () => {
    const harness = await createHarness([
      { id: 'scene_video', mediaKind: 'video', durationSeconds: 1, fixture: 'silentVideo' },
    ]);
    const corruptInput = path.join(harness.rootDir, 'corrupt.mp4');
    await fs.writeFile(corruptInput, 'not a media file');
    const resolved = (await harness.mediaStore.resolveAsset('project_1', 'asset_scene_video'))!;

    let caught: CreativeStudioRenderError | undefined;
    try {
      await renderCut('project_1', {
        store: harness.store,
        mediaStore: {
          resolveAsset: async () => ({
            asset: resolved.asset,
            openVerifiedStream: async () => createReadStream(corruptInput),
          }),
          persistProjectOutput: harness.mediaStore.persistProjectOutput,
        },
        environment: { ...process.env, FFMPEG_PATH: ffmpegPath },
        temporaryRoot: harness.temporaryRoot,
      }).result;
    } catch (error) {
      caught = error as CreativeStudioRenderError;
    }

    expect(caught).toMatchObject({ code: 'render_failed', message: 'render_failed' });
    expect(caught?.stderrTail).toContain('[render-temp]');
    expect(caught?.stderrTail).not.toContain('aionui-studio-render-');
    await expect(fs.readdir(harness.temporaryRoot)).resolves.toEqual([]);
    await expect(fs.access(harness.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);
});
