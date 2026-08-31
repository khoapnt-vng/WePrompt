/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatStudioJobLog, logStudioConditioningFrameFailure } from '@process/services/creative-studio/jobManager';
import { StudioConditioningFrameError } from '@process/services/creative-studio/adapters/conditioningFrame';

describe('the studio job log line', () => {
  it('names the event and its identifiers', () => {
    expect(formatStudioJobLog('dispatch', { jobId: 'job_1', shotId: 'shot_1', model: 'seedance-2.0' })).toBe(
      '[CreativeStudio] dispatch jobId=job_1 shotId=shot_1 model=seedance-2.0'
    );
  });

  it('omits absent fields rather than printing null', () => {
    // providerJobId is null until a submission is accepted, and "providerJobId=null" reads as a
    // value rather than as its absence.
    expect(formatStudioJobLog('submitting', { jobId: 'job_1', providerJobId: null, error: undefined })).toBe(
      '[CreativeStudio] submitting jobId=job_1'
    );
  });

  it('truncates any value, so a prompt can never reach the log through this door', () => {
    // Nothing should pass a prompt here, but the log is durable and read by support. A cap means a
    // future caller's mistake costs a truncated line rather than a leak of user content.
    const line = formatStudioJobLog('x', { field: 'a'.repeat(500) });
    expect(line.length).toBeLessThan(200);
    expect(line).toContain('…');
  });

  it('strips newlines, so one job cannot forge a second log line', () => {
    expect(formatStudioJobLog('x', { field: 'one\ntwo\rthree' })).toBe('[CreativeStudio] x field=one two three');
  });

  it('keeps an error code, which is the whole point of the line', () => {
    expect(formatStudioJobLog('failed', { jobId: 'job_1', code: 'provider_unavailable' })).toContain(
      'code=provider_unavailable'
    );
  });

  it('renders an event with no fields without trailing space', () => {
    expect(formatStudioJobLog('drained', {})).toBe('[CreativeStudio] drained');
  });
});

describe('conditioning frame failure logging', () => {
  const warn = (): ReturnType<typeof vi.spyOn> => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the extraction and repeats the decoder's own diagnosis", () => {
    const spy = warn();

    logStudioConditioningFrameFailure(
      'project_1',
      'frame_1',
      new StudioConditioningFrameError('decode_failed', 'stream 0, offset 0x54dc: partial file')
    );

    expect(spy).toHaveBeenCalledWith(
      '[CreativeStudio] conditioning_frame_failed projectId=project_1 extractionId=frame_1 code=decode_failed detail=stream 0, offset 0x54dc: partial file'
    );
  });

  it('still names the extraction when the failure carries no diagnosis', () => {
    const spy = warn();

    logStudioConditioningFrameFailure('project_1', 'frame_1', new StudioConditioningFrameError('source_missing'));

    expect(spy).toHaveBeenCalledWith(
      '[CreativeStudio] conditioning_frame_failed projectId=project_1 extractionId=frame_1 code=source_missing'
    );
  });

  it('reports an unrecognised throw rather than staying silent about it', () => {
    const spy = warn();

    logStudioConditioningFrameFailure('project_1', 'frame_1', 'not an error');

    expect(spy).toHaveBeenCalledWith(
      '[CreativeStudio] conditioning_frame_failed projectId=project_1 extractionId=frame_1 code=unknown'
    );
  });
});
