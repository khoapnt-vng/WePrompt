import { defineConfig } from 'vitest/config';
import path from 'path';

const aliases = {
  '@/': path.resolve(__dirname, './packages/desktop/src') + '/',
  '@aionui/web-host': path.resolve(__dirname, './packages/web-host/src/index.ts'),
  '@process/': path.resolve(__dirname, './packages/desktop/src/process') + '/',
  '@renderer/': path.resolve(__dirname, './packages/desktop/src/renderer') + '/',
  '@worker/': path.resolve(__dirname, './packages/desktop/src/process/worker') + '/',
  '@mcp/models/': path.resolve(__dirname, './packages/desktop/src/common/models') + '/',
  '@mcp/types/': path.resolve(__dirname, './packages/desktop/src/common') + '/',
  '@mcp/': path.resolve(__dirname, './packages/desktop/src/common') + '/',
};

export default defineConfig({
  resolve: {
    alias: aliases,
  },
  test: {
    globals: true,
    testTimeout: 10000,
    // Use projects to run different environments (Vitest 4+)
    projects: [
      // Node environment tests (existing tests)
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'packages/web-host/src/**/*.test.ts',
            'packages/web-cli/src/**/*.test.ts',
            'packages/desktop/src/**/*.test.ts',
            'tests/unit/**/*.test.ts',
            'tests/unit/**/test_*.ts',
            'tests/integration/**/*.test.ts',
            'tests/regression/**/*.test.ts',
          ],
          exclude: [
            'tests/unit/**/*.dom.test.ts',
            'tests/unit/**/*.dom.test.tsx',
            'tests/integration/creative-studio/directorCommandLatency.integration.test.ts',
            'tests/unit/process/creative-studio/service/directorCommandMailbox.test.ts',
          ],
          setupFiles: ['./tests/vitest.setup.ts'],
          sequence: { groupOrder: 2 },
        },
      },
      // jsdom environment tests (React component/hook tests)
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/unit/**/*.dom.test.ts', 'tests/unit/**/*.dom.test.tsx'],
          setupFiles: ['./tests/vitest.dom.setup.ts'],
          sequence: { groupOrder: 2 },
        },
      },
      // Wall-clock latency and mailbox-load calibrations must not compete with unrelated
      // repository workers. They still run as part of the full suite, before the functional
      // node/jsdom group, and retain their frozen production thresholds.
      {
        extends: true,
        test: {
          name: 'creative-studio-timing',
          environment: 'node',
          include: [
            'tests/integration/creative-studio/directorCommandLatency.integration.test.ts',
            'tests/unit/process/creative-studio/service/directorCommandMailbox.test.ts',
          ],
          setupFiles: ['./tests/vitest.setup.ts'],
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      },
    ],
    benchmark: {
      include: ['tests/bench/**/*.bench.ts'],
      outputFile: './bench-results.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Cover ALL source code by default — new files are automatically included.
      // Only exclude files that genuinely cannot be unit-tested (entry points,
      // type-only files, static assets, etc.).
      include: ['packages/desktop/src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}'],
      exclude: [
        // Type declaration files (no runtime code)
        'packages/**/src/**/*.d.ts',

        // Electron entry points (require Electron runtime)
        'packages/desktop/src/index.ts',
        'packages/desktop/src/preload.ts',

        // Shims / polyfills
        'packages/desktop/src/common/utils/shims/**',

        // Pure type / constant files
        'packages/desktop/src/common/types/**',

        // Static assets and i18n JSON (no logic)
        'packages/desktop/src/renderer/**/*.json',
        'packages/desktop/src/renderer/**/*.svg',
        'packages/desktop/src/renderer/**/*.css',

        // i18n config (JSON-only)
        'packages/desktop/src/common/config/i18n-config.json',
      ],
      // Thresholds apply to the included file set.
      // Ratchet toward the project's ≥80% target (AGENTS.md): use
      // floor(measured) - 1, leaving between 1 and less than 2 percentage
      // points of headroom. Remeasure when raising; test:coverage fails
      // on regression below this configured floor. Raise as coverage grows
      // — never lower. NOTE: GitHub coverage remains non-blocking
      // (continue-on-error), and the repository has no tracked GitLab CI
      // configuration. This is a manual guard, not CI enforcement, until
      // the team wires a blocking CI step.
      thresholds: {
        statements: 54,
        branches: 50,
        functions: 50,
        lines: 55,
      },
    },
  },
});
