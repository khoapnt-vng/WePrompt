/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { formatStudioJobLog } from '@process/services/creative-studio/jobManager';

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
