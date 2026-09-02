/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { StudioProjectV4 } from '@/common/types/project/creativeStudioTypes';
import {
  studioCanvasHandleIsTakenV4,
  studioPersistentIdentitiesV4,
} from '@/process/services/creative-studio/service/schema2/mutations/projectAuthorityV4';

const authorityFixture = (): StudioProjectV4 =>
  ({
    id: 'project_7',
    rules: [{ id: 'rule_1' }],
    pieces: { piece_1: { handle: 'piece_now', priorHandles: ['piece_before'] } },
    assets: { asset_1: {} },
    jobs: { job_1: {} },
    undoHistory: [{ id: 'undo_1' }],
    bin: [{ id: 'bin_1' }],
    spendAuthorizations: [
      {
        id: 'authorization_1',
        quote: {
          id: 'quote_1',
          reservationId: 'reservation_1',
          item: { id: 'quote_item_1' },
        },
        idempotencyKey: { key: 'idempotency_1' },
      },
    ],
    boards: {
      board_1: {
        id: 'board_1',
        handle: 'board_now',
        priorHandles: ['board_before'],
        beats: { beat_1: {} },
        shots: { shot_1: {} },
      },
    },
    assemblies: {
      assembly_1: {
        id: 'assembly_1',
        handle: 'assembly_now',
        priorHandles: ['assembly_before'],
        soundBindings: { sound_binding_1: {} },
      },
    },
  }) as unknown as StudioProjectV4;

describe('schema-7 shared project authority', () => {
  it('collects every durable identity namespace used by Main-issued mutations', () => {
    expect([...studioPersistentIdentitiesV4(authorityFixture())].toSorted()).toEqual(
      [
        'project_7',
        'rule_1',
        'piece_1',
        'asset_1',
        'job_1',
        'undo_1',
        'bin_1',
        'authorization_1',
        'quote_1',
        'reservation_1',
        'quote_item_1',
        'idempotency_1',
        'board_1',
        'beat_1',
        'shot_1',
        'assembly_1',
        'sound_binding_1',
      ].toSorted()
    );
  });

  it('reserves current handles and aliases across every canvas subject kind', () => {
    const project = authorityFixture();
    for (const handle of [
      'piece_now',
      'piece_before',
      'board_now',
      'board_before',
      'assembly_now',
      'assembly_before',
    ]) {
      expect(studioCanvasHandleIsTakenV4(project, handle)).toBe(true);
    }
    expect(studioCanvasHandleIsTakenV4(project, 'available_handle')).toBe(false);
  });
});
