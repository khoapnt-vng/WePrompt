/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Keep this constant local to avoid pulling in common/config/storage side effects
// when the built-in MCP server boots in a standalone stdio process.
export const BUILTIN_IMAGE_GEN_ID = 'builtin-image-gen';
export const BUILTIN_IMAGE_GEN_NAME = 'aionui-image-generation';
export const BUILTIN_IMAGE_GEN_LEGACY_NAMES = ['AionUi Image Generation', BUILTIN_IMAGE_GEN_ID] as const;

export function isBuiltinImageGenName(name?: string | null): boolean {
  if (!name) return false;
  return (
    name === BUILTIN_IMAGE_GEN_NAME ||
    BUILTIN_IMAGE_GEN_LEGACY_NAMES.includes(name as (typeof BUILTIN_IMAGE_GEN_LEGACY_NAMES)[number])
  );
}

export function isBuiltinImageGenTransport(transport?: {
  type?: string;
  command?: string;
  args?: string[] | null;
}): boolean {
  if (!transport || transport.type !== 'stdio' || transport.command !== 'node') {
    return false;
  }

  return (transport.args || []).some((arg) => typeof arg === 'string' && arg.includes('builtin-mcp-image-gen.js'));
}

export const BUILTIN_IDP_ID = 'builtin-idp';
export const BUILTIN_IDP_NAME = 'greennode-idp';
export const BUILTIN_IDP_SCRIPT = 'builtin-mcp-idp';

export function isBuiltinIdpTransport(
  transport: { type?: string; command?: string; args?: string[] } | undefined
): boolean {
  return (
    transport?.type === 'stdio' &&
    transport?.command === 'node' &&
    Array.isArray(transport?.args) &&
    transport.args.some((a) => typeof a === 'string' && a.includes(`${BUILTIN_IDP_SCRIPT}.js`))
  );
}

export const BUILTIN_VISION_ID = 'builtin-vision';
export const BUILTIN_VISION_NAME = 'aionui-image-analysis';
export const BUILTIN_VISION_SCRIPT = 'builtin-mcp-vision';

export function isBuiltinVisionTransport(
  transport: { type?: string; command?: string; args?: string[] } | undefined
): boolean {
  return (
    transport?.type === 'stdio' &&
    transport?.command === 'node' &&
    Array.isArray(transport?.args) &&
    transport.args.some((a) => typeof a === 'string' && a.includes(`${BUILTIN_VISION_SCRIPT}.js`))
  );
}

export const BUILTIN_KNOWLEDGE_ID = 'builtin-project-knowledge';
// BUILTIN_KNOWLEDGE_NAME lives in `@/common/knowledge/constants`: the renderer
// matches conversations against it and may not import from `process/`.
export const BUILTIN_KNOWLEDGE_SCRIPT = 'builtin-mcp-knowledge';

export const BUILTIN_STUDIO_NAME = 'aionui-creative-studio';
export const BUILTIN_STUDIO_SCRIPT = 'builtin-mcp-studio';
