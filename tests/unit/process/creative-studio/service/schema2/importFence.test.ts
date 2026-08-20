/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schema2Directory = path.join(
  process.cwd(),
  'packages/desktop/src/process/services/creative-studio/service/schema2'
);

const importSpecifiers = (source: string): string[] =>
  Array.from(
    source.matchAll(/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g),
    (match) => match[1]!
  );

const FORBIDDEN_IMPORT =
  /^(?:node:)?fs(?:\/|$)|electron|ipc|job[-_]?manager|resolver|(?:^|\/)adapters?(?:\/|$)|poll|retry|cancel|render/i;

const MAIN_ONLY_SCHEMA2_IMPORTS = new Map([['exports/catalog.ts', new Set(['node:fs'])]]);

describe('schema2 import fence', () => {
  it('recognizes static, dynamic, and CommonJS dependency forms', () => {
    const source = `
      import value from 'static-dependency';
      import('dynamic-dependency');
      require('commonjs-dependency');
      export type { Value } from 'exported-dependency';
    `;

    expect(importSpecifiers(source)).toEqual([
      'static-dependency',
      'dynamic-dependency',
      'commonjs-dependency',
      'exported-dependency',
    ]);
  });

  it('recognizes every forbidden dependency family', () => {
    const forbidden = [
      'node:fs/promises',
      'electron',
      '@/bridge/ipc',
      '@/services/job-manager',
      '@/providers/resolver',
      '@/providers/adapter',
      '@/jobs/polling',
      '@/jobs/retry',
      '@/jobs/cancel',
      '@/render/service',
    ];

    expect(forbidden.filter((specifier) => !FORBIDDEN_IMPORT.test(specifier))).toEqual([]);
  });

  it('keeps pure schema modules free of operational dependencies except the exact export catalog store', () => {
    // Recursive: the fence must cover every module under schema2, not only its top level.
    // generation/, pricing/, and mutations/ all hold fenced code, and a non-recursive walk
    // silently exempts a module the moment it moves into a subdirectory.
    const permitted: string[] = [];
    const violations = readdirSync(schema2Directory, { recursive: true })
      .map((entry) => String(entry))
      .filter((fileName) => fileName.endsWith('.ts'))
      .flatMap((fileName) =>
        importSpecifiers(readFileSync(path.join(schema2Directory, fileName), 'utf8'))
          .filter((specifier) => FORBIDDEN_IMPORT.test(specifier))
          .map((specifier) => {
            const fact = `${fileName}: ${specifier}`;
            if (MAIN_ONLY_SCHEMA2_IMPORTS.get(fileName)?.has(specifier) === true) {
              permitted.push(fact);
              return null;
            }
            return fact;
          })
          .filter((fact): fact is string => fact !== null)
      );

    expect(violations).toEqual([]);
    expect(permitted).toEqual(['exports/catalog.ts: node:fs']);
  });
});
