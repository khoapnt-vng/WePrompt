/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const USER_VISIBLE_ERROR_CONSTRUCTORS = new Set([
  'CreativeStudioMediaError',
  'CreativeStudioServiceError',
  'CreativeStudioStoreError',
  'StudioConnectionValidationError',
]);

const bareCatchLaunderingLines = (sourceText: string): number[] => {
  const source = ts.createSourceFile('v2Service.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.variableDeclaration === undefined) {
      const inspectCatch = (candidate: ts.Node): void => {
        if (
          ts.isNewExpression(candidate) &&
          ts.isIdentifier(candidate.expression) &&
          USER_VISIBLE_ERROR_CONSTRUCTORS.has(candidate.expression.text)
        ) {
          violations.push(source.getLineAndCharacterOfPosition(candidate.getStart(source)).line + 1);
        }
        ts.forEachChild(candidate, inspectCatch);
      };
      inspectCatch(node.block);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
};

describe('Creative Studio user-visible error boundary guard', () => {
  it('detects a deliberately reintroduced bare-catch cause launder', () => {
    const source = `
      try {
        await dependency();
      } catch {
        throw new CreativeStudioServiceError('provider_error');
      }
    `;

    expect(bareCatchLaunderingLines(source)).toEqual([5]);
  });

  it('keeps every v2Service user-visible rethrow attached to its caught cause', () => {
    const sourcePath = path.join(
      process.cwd(),
      'packages/desktop/src/process/services/creative-studio/service/v2Service.ts'
    );

    expect(bareCatchLaunderingLines(readFileSync(sourcePath, 'utf8'))).toEqual([]);
  });
});
