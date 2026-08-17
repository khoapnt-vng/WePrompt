import { defineConfig } from 'vitest/config';

import baseConfig from './vitest.config';

/**
 * Executable Creative Studio production files changed since the frozen Phase 2B baseline
 * (21bf87ae1674598bd42ea88c5f13c74e8389b3c0). Keep this list explicit: delivery gates review the
 * diff and extend the manifest whenever a later task changes another runtime file.
 */
const creativeStudioRuntimeManifest = [
  'packages/desktop/src/common/types/project/creativeStudioCanonicalTake.ts',
  'packages/desktop/src/common/types/project/creativeStudioOutputRole.ts',
  'packages/desktop/src/common/types/project/creativeStudioProjectSummary.ts',
  'packages/desktop/src/common/types/project/creativeStudioTypes.ts',
  'packages/desktop/src/process/bridge/creativeStudioBridge.ts',
  'packages/desktop/src/process/resources/builtinMcp/studioDirectorCommandWriter.ts',
  'packages/desktop/src/process/resources/builtinMcp/studioPendingRecordWriter.ts',
  'packages/desktop/src/process/resources/builtinMcp/studioProposalWriter.ts',
  'packages/desktop/src/process/resources/builtinMcp/studioReferenceRequestWriter.ts',
  'packages/desktop/src/process/resources/builtinMcp/studioServer.ts',
  'packages/desktop/src/process/services/creative-studio/adapters/types.ts',
  'packages/desktop/src/process/services/creative-studio/index.ts',
  'packages/desktop/src/process/services/creative-studio/jobManager.ts',
  'packages/desktop/src/process/services/creative-studio/mediaStore.ts',
  'packages/desktop/src/process/services/creative-studio/renderService.ts',
  'packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts',
  'packages/desktop/src/process/services/creative-studio/service/directorCommandMailbox.ts',
  'packages/desktop/src/process/services/creative-studio/service/directorCommandProcessor.ts',
  'packages/desktop/src/process/services/creative-studio/service/directorCommandService.ts',
  'packages/desktop/src/process/services/creative-studio/service/index.ts',
  'packages/desktop/src/process/services/creative-studio/service/projectMutations.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/cuts.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/factories.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/index.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/mutations.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts',
  'packages/desktop/src/process/services/creative-studio/service/v2Service.ts',
  'packages/desktop/src/process/services/creative-studio/store.ts',
] as const;

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage/creative-studio',
      include: [...creativeStudioRuntimeManifest],
      // The root config excludes common/types as type-only. This reviewed manifest deliberately
      // includes the executable Studio helpers in that directory, so it must own an empty exclude.
      exclude: [],
      thresholds: {
        perFile: true,
        lines: 80,
        branches: 80,
      },
    },
  },
});
