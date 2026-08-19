import { defineConfig } from 'vitest/config';

import baseConfig from './vitest.config';

/**
 * Executable Creative Studio production files changed since the frozen Task 1B baseline
 * (b37e00e4f6c2ca88b1f0b5a47cbb568ff4df92af). Keep this list explicit: delivery gates review the
 * diff and extend the manifest whenever a later task changes another runtime file.
 */
const creativeStudioRuntimeManifest = [
  'packages/desktop/src/common/types/project/creativeStudioCanonicalTake.ts',
  'packages/desktop/src/common/types/project/creativeStudioManagedAssetCollections.ts',
  'packages/desktop/src/common/types/project/creativeStudioOutputRole.ts',
  'packages/desktop/src/common/types/project/creativeStudioProjectSummary.ts',
  'packages/desktop/src/common/types/project/creativeStudioTypes.ts',
  'packages/desktop/src/process/resources/builtinMcp/studioDirectorCommandWriter.ts',
  'packages/desktop/src/process/resources/builtinMcp/studioPendingRecordWriter.ts',
  'packages/desktop/src/process/resources/builtinMcp/studioReferenceRequestWriter.ts',
  'packages/desktop/src/process/resources/builtinMcp/studioServer.ts',
  'packages/desktop/src/process/services/creative-studio/adapters/conditioningFrame.ts',
  'packages/desktop/src/process/services/creative-studio/jobManager.ts',
  'packages/desktop/src/process/services/creative-studio/mediaStore.ts',
  'packages/desktop/src/process/services/creative-studio/renderService.ts',
  'packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts',
  'packages/desktop/src/process/services/creative-studio/service/directorCommandMailbox.ts',
  'packages/desktop/src/process/services/creative-studio/service/directorCommandProcessor.ts',
  'packages/desktop/src/process/services/creative-studio/service/directorCommandService.ts',
  'packages/desktop/src/process/services/creative-studio/service/index.ts',
  'packages/desktop/src/process/services/creative-studio/service/recordIo.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/chain.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/factories.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/generation/frameExtraction.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/generation/generationRequest.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/generation/index.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/generation/spendMath.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/generation/submissionIdentity.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/index.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/lifecycle.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/mutationIdentity.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/mutations.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/preparedSubmissionCache.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/pricing/authorization.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/pricing/estimate.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/pricing/index.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/pricing/rateCard.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts',
  'packages/desktop/src/process/services/creative-studio/service/schema2/workspaceStatus.ts',
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
