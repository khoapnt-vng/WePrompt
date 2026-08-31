/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const PRESENTATION_CONVERSATION_ID_PATTERN =
  /^(?:[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

declare const presentationConversationIdBrand: unique symbol;

export type PresentationConversationId = string & {
  readonly [presentationConversationIdBrand]: true;
};

/** Returns the canonical lowercase id for supported presentation conversations. */
export function normalizePresentationConversationId(value: unknown): PresentationConversationId | null {
  if (typeof value !== 'string' || !PRESENTATION_CONVERSATION_ID_PATTERN.test(value)) return null;
  return value.toLowerCase() as PresentationConversationId;
}

/** Returns whether a value is already a canonical presentation conversation id. */
export function isPresentationConversationId(value: unknown): value is PresentationConversationId {
  return typeof value === 'string' && value === value.toLowerCase() && PRESENTATION_CONVERSATION_ID_PATTERN.test(value);
}
