/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in seeds Forge ships enabled by default: the GreenNode (VNG Cloud)
 * LLM provider and, further down, the default HTTP MCP servers.
 *
 * Forge ships with the GreenNode MaaS provider preconfigured so a fresh
 * install is chat-ready without manual provider setup. The same seed is
 * mirrored into the local OpenCode CLI config so the OpenCode agent exposes
 * the identical model set.
 *
 * SECURITY: no credential lives in this repository. The shared team API key
 * is injected at packaging time from the FORGE_GREENNODE_API_KEY environment
 * variable (electron-vite `define`). Builds without it seed no key.
 */

export const GREENNODE_PROVIDER_NAME = 'GreenNode';

export const GREENNODE_BASE_URL = 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1';

/** Exactly the models Forge ships with — keep this list to the approved set. */
export const GREENNODE_MODELS = ['minimax/minimax-m2.5', 'openai/gpt-5'] as const;

/** Model OpenCode should default to for new sessions. */
export const GREENNODE_OPENCODE_DEFAULT_MODEL = 'vngcloud/minimax/minimax-m2.5';

/** Provider id OpenCode uses for this endpoint (namespaces its model ids). */
export const GREENNODE_OPENCODE_PROVIDER_ID = 'vngcloud';

/**
 * GreenNode API key, injected at build time from FORGE_GREENNODE_API_KEY via
 * electron-vite `define` (in dev and tests this reads the real process env).
 * Empty string when the build/environment provides no key.
 */
export function getGreenNodeApiKey(): string {
  return (process.env.FORGE_GREENNODE_API_KEY || '').trim();
}

// GreenNode IDP OCR ingest endpoint. The `user-111470` tenant segment is not
// part of the chat provider's base_url, so it is captured here explicitly.
export const GREENNODE_IDP_BASE_URL =
  'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/maas/user-111470/greennode/idp/v1/ocr/ingest';

export const MOONSHOT_PROVIDER_NAME = 'Moonshot (Kimi)';

export const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';

/** Exactly the models Forge ships with for the Moonshot provider — keep to the approved set. */
export const MOONSHOT_MODELS = ['kimi-k2.6', 'kimi-k2.5'] as const;

/** Model the built-in image-analysis (vision) MCP server uses. */
export const MOONSHOT_VISION_MODEL = 'kimi-k2.6';

/** Provider id OpenCode uses for this endpoint (namespaces its model ids). */
export const MOONSHOT_OPENCODE_PROVIDER_ID = 'moonshot';

/**
 * Built-in HTTP MCP servers Forge ships enabled by default.
 *
 * Intentionally empty: the previously bundled `tse-datahub` and
 * `outlook-advanced` endpoints were removed from the default install (WP
 * #24096), so a fresh install ships with no preconfigured HTTP MCP server —
 * users add their own via Settings > Tools. Any entry added back here is
 * expected to be OAuth-protected (standard MCP authorization flow) with no
 * credential baked into this repo.
 */
export const BUILTIN_HTTP_MCP_SERVERS: readonly {
  name: string;
  description: string;
  url: string;
}[] = [];

/**
 * Tavily API key for the built-in web-search capability, injected at build
 * time from FORGE_TAVILY_API_KEY via electron-vite `define` (in dev and tests
 * this reads the real process env). Empty string when the build/environment
 * provides no key.
 */
export function getTavilyApiKey(): string {
  return (process.env.FORGE_TAVILY_API_KEY || '').trim();
}
