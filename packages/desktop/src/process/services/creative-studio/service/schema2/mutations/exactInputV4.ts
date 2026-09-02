/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { types as nodeTypes } from 'node:util';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;

export const isPlainInputRecordV4 = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const hasExactInputKeysV4 = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.size || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))) return false;
  return ownKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
};

export const isDenseInputArrayV4 = (value: unknown): value is unknown[] =>
  Array.isArray(value) &&
  !nodeTypes.isProxy(value) &&
  Reflect.ownKeys(value).length === value.length + 1 &&
  Reflect.ownKeys(value).at(-1) === 'length' &&
  Reflect.ownKeys(value)
    .slice(0, -1)
    .every((key, index) => key === String(index));

export const isSafeInputIdV4 = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

export const isCanonicalInputTimestampV4 = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};
