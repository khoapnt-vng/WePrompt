import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const runtime = { start: vi.fn() };
  return {
    runtime,
    get: vi.fn(() => runtime),
    resume: vi.fn(),
    dispose: vi.fn(async () => undefined),
  };
});

vi.mock('@process/services/creative-studio/pilotProductionRuntime', () => ({
  getCreativeStudioPilotProductionRuntimeV3: mocks.get,
  resumeCreativeStudioPilotAfterBackendReadyV3: mocks.resume,
  disposeCreativeStudioPilotProductionRuntimeV3: mocks.dispose,
}));

import {
  disposeCreativeStudioRuntime,
  getCreativeStudioRuntime,
  resumeCreativeStudioAfterBackendReady,
} from '@process/services/creative-studio/runtime';

describe('Creative Studio production runtime facade', () => {
  it('selects the sole schema-6 Pilot runtime', () => {
    expect(getCreativeStudioRuntime()).toBe(mocks.runtime);
    expect(mocks.get).toHaveBeenCalledOnce();
  });

  it('delegates backend recovery to the Pilot lifecycle', () => {
    const runtime = { onBackendReady: vi.fn() };
    const logError = vi.fn();

    resumeCreativeStudioAfterBackendReady(runtime, logError);

    expect(mocks.resume).toHaveBeenCalledExactlyOnceWith(runtime, logError);
  });

  it('delegates disposal without instantiating the retired runtime', async () => {
    await expect(disposeCreativeStudioRuntime()).resolves.toBeUndefined();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
