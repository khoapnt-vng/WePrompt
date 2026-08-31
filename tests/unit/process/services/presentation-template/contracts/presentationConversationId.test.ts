/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  isPresentationConversationId,
  normalizePresentationConversationId,
} from '@/common/types/office/presentationConversationId';

describe('presentation conversation ids', () => {
  it.each([
    ['d0921953', 'd0921953'],
    ['D0921953', 'd0921953'],
    ['2be7b8fc-6af5-42b8-aed5-03644735c730', '2be7b8fc-6af5-42b8-aed5-03644735c730'],
    ['2BE7B8FC-6AF5-42B8-AED5-03644735C730', '2be7b8fc-6af5-42b8-aed5-03644735c730'],
  ])('normalizes supported backend and legacy ids without changing their identity', (input, expected) => {
    expect(normalizePresentationConversationId(input)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    0,
    '',
    'd092195',
    'd09219533',
    'g0921953',
    ' d0921953',
    'd0921953 ',
    'd092/953',
    'd092\\953',
    'd092.953',
    'd092\u00001953',
    '{2be7b8fc-6af5-42b8-aed5-03644735c730}',
    '2be7b8fc-6af5-02b8-aed5-03644735c730',
    '2be7b8fc-6af5-62b8-aed5-03644735c730',
    '2be7b8fc-6af5-42b8-7ed5-03644735c730',
  ])('rejects unsafe, coerced, or unsupported values: %j', (input) => {
    expect(normalizePresentationConversationId(input)).toBeNull();
  });

  it('recognizes only already-canonical values', () => {
    expect(isPresentationConversationId('d0921953')).toBe(true);
    expect(isPresentationConversationId('D0921953')).toBe(false);
    expect(isPresentationConversationId('not-an-id')).toBe(false);
  });
});
