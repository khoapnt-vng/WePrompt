import { describe, expect, it } from 'vitest';

import {
  isStudioMutationReasonV2,
  isStudioPricingRefusalDetailsV2,
  isStudioPricingRefusalReasonV2,
} from '@/common/types/project/creativeStudioTypes';

describe('Creative Studio bounded legacy refusal guards', () => {
  it('accepts only exact pricing and mutation reason members', () => {
    expect(isStudioPricingRefusalReasonV2('invalid_quote')).toBe(true);
    expect(isStudioPricingRefusalReasonV2('private_provider_body')).toBe(false);
    expect(isStudioPricingRefusalReasonV2(null)).toBe(false);
    expect(isStudioMutationReasonV2('validation_failed')).toBe(true);
    expect(isStudioMutationReasonV2('unknown')).toBe(false);
    expect(isStudioMutationReasonV2(1)).toBe(false);
  });

  it.each([
    null,
    [],
    { kind: 'reference_binding', shotId: '../shot', reason: 'missing_asset' },
    { kind: 'other', shotId: 'shot_1', reason: 'missing_asset' },
    { kind: 'reference_binding', shotId: 'shot_1', reason: 'other' },
    { kind: 'reference_binding', shotId: 'shot_1', reason: 'missing_asset', private: true },
  ])('rejects malformed pricing refusal details %#', (value) => {
    expect(isStudioPricingRefusalDetailsV2(value)).toBe(false);
  });

  it('accepts one exact reference-binding refusal', () => {
    expect(
      isStudioPricingRefusalDetailsV2({
        kind: 'reference_binding',
        shotId: 'shot_1',
        reason: 'missing_asset',
      })
    ).toBe(true);
  });
});
