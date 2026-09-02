/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { types as nodeTypes } from 'node:util';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;

export const isPlainInputRecordV4 = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || nodeTypes.isProxy(value) || Array.isArray(value)) return false;
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

export const isDenseInputArrayV4 = (value: unknown): value is unknown[] => {
  if (nodeTypes.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.at(-1) !== 'length') return false;
  return ownKeys.slice(0, -1).every((key, index) => {
    if (key !== String(index)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
};

export const isSafeInputIdV4 = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

export const isCanonicalInputTimestampV4 = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};
