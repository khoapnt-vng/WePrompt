/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { STUDIO_PROJECT_SCHEMA_VERSION } from '@/common/types/project/creativeStudioTypes';

export const SCHEMA5_CAPTURE_SCHEMA_VERSION = 5 as const;
export const SCHEMA5_UNSUPPORTED_DISCRIMINATOR = 4 as const;
export const SCHEMA5_MALFORMED_REVISION = 'malformed_revision';

/** Prevents the historical fixture command from silently following a future project-schema bump. */
export const assertSchema5CaptureBaseline = (): void => {
  if (Number(STUDIO_PROJECT_SCHEMA_VERSION) !== SCHEMA5_CAPTURE_SCHEMA_VERSION) {
    throw new TypeError(
      `Schema-5 capture requires runtime schema ${SCHEMA5_CAPTURE_SCHEMA_VERSION}; received ${STUDIO_PROJECT_SCHEMA_VERSION}`
    );
  }
};

export type Schema5ClassifierTransform = Readonly<{
  source: 'healthy/storage/project_capture/project.json';
  output: string;
  transform: string;
}>;

export const SCHEMA5_CLASSIFIER_TRANSFORMS = {
  unsupported: {
    source: 'healthy/storage/project_capture/project.json',
    output: 'classifiers/unsupported-project.json',
    transform: `Replace only root schemaVersion ${SCHEMA5_CAPTURE_SCHEMA_VERSION} with ${SCHEMA5_UNSUPPORTED_DISCRIMINATOR}.`,
  },
  malformed: {
    source: 'healthy/storage/project_capture/project.json',
    output: 'classifiers/malformed-project.json',
    transform: `Replace only root revision with ${JSON.stringify(SCHEMA5_MALFORMED_REVISION)} while retaining schemaVersion ${SCHEMA5_CAPTURE_SCHEMA_VERSION}.`,
  },
} as const satisfies Record<string, Schema5ClassifierTransform>;

type JsonRecord = Record<string, unknown>;

const parseHealthyManifest = (bytes: Uint8Array): { text: string; value: JsonRecord } => {
  assertSchema5CaptureBaseline();
  const text = Buffer.from(bytes).toString('utf8');
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError('Healthy schema-5 capture is not JSON');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Reflect.get(value, 'schemaVersion') !== SCHEMA5_CAPTURE_SCHEMA_VERSION ||
    !Number.isSafeInteger(Reflect.get(value, 'revision'))
  ) {
    throw new TypeError('Healthy schema-5 capture has unexpected authority');
  }
  return { text, value: value as JsonRecord };
};

const replaceOneRootInteger = (text: string, key: string, replacement: string): Buffer => {
  const pattern = new RegExp(`(^|\\n)(  ${JSON.stringify(key)}[ \\t]*:[ \\t]*)(-?\\d+)([ \\t]*[,}])`, 'u');
  const matches = [...text.matchAll(new RegExp(pattern.source, 'gu'))];
  if (matches.length !== 1) throw new TypeError(`Healthy schema-5 capture has unexpected ${key} encoding`);
  return Buffer.from(text.replace(pattern, `$1$2${replacement}$4`), 'utf8');
};

/** Derives both classifier fixtures independently from the public-runtime manifest bytes. */
export const deriveSchema5ClassifierFixtures = (
  healthyManifestBytes: Uint8Array
): Readonly<{ unsupported: Buffer; malformed: Buffer }> => {
  const healthy = parseHealthyManifest(healthyManifestBytes);
  return {
    unsupported: replaceOneRootInteger(healthy.text, 'schemaVersion', String(SCHEMA5_UNSUPPORTED_DISCRIMINATOR)),
    malformed: replaceOneRootInteger(healthy.text, 'revision', JSON.stringify(SCHEMA5_MALFORMED_REVISION)),
  };
};
