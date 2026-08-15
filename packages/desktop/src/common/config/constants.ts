/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AionUI应用程序共用常量
 */

// ===== 文件处理相关常量 =====

/** 临时文件时间戳分隔符 */
export const AIONUI_TIMESTAMP_SEPARATOR = '_aionui_';

/** 用于匹配和清理时间戳后缀的正则表达式 */
export const AIONUI_TIMESTAMP_REGEX = /_aionui_\d{13}(\.\w+)?$/;
export const AIONUI_FILES_MARKER = '[[AION_FILES]]';

// ===== 媒体类型相关常量 =====

/** 支持的图片文件扩展名 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'] as const;

/** 文件扩展名到MIME类型的映射 */
export const MIME_TYPE_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
};

/** MIME类型到文件扩展名的映射 */
export const MIME_TO_EXT_MAP: Record<string, string> = {
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  gif: '.gif',
  webp: '.webp',
  bmp: '.bmp',
  tiff: '.tiff',
  'svg+xml': '.svg',
};

/** 默认图片文件扩展名 */
export const DEFAULT_IMAGE_EXTENSION = '.png';

// ===== WebUI 相关常量 =====

/** WebUI default port: 25808 for production, 25809 for development, 25810 for multi-instance dev */
export const WEBUI_DEFAULT_PORT = (() => {
  if (process.env.NODE_ENV === 'production') return 25808;
  if (process.env.AIONUI_MULTI_INSTANCE === '1') return 25810;
  return 25809;
})();

export const TEAM_MODE_ENABLED = true;

// ===== Feature flags =====

/** Creative Studio release gate. Explicitly opt in for development with AIONUI_ENABLE_CREATIVE_STUDIO=1. */
export const CREATIVE_STUDIO_ENABLED =
  process.env.WEPROMPT_INTERNAL_RELEASE !== '1' && process.env.AIONUI_ENABLE_CREATIVE_STUDIO === '1';

/** Desktop Pet feature flag: when false, the pet is hidden from all UI entry points (settings tab, route, tray menu, startup). Backend code stays dormant. */
export const DESKTOP_PET_ENABLED = false;

export const PRESENTATION_RUN_V2_ENABLED = false;

export const PRESENTATION_RUN_DIRECTIVE_PREFIX = 'Create a presentation from the request below.';

export const PRESENTATION_RUN_DISPATCH_STATUSES = [
  'allocating',
  'committed',
  'dispatching',
  'bound',
  'terminal_verified',
  'retained',
  'failed_retained',
  'dispatch_uncertain',
  'discarded',
] as const;

export const PRESENTATION_RUN_ARTIFACT_PHASES = [
  'none',
  'sources_snapshotted',
  'sources_extracted',
  'candidate_retained',
  'candidate_copied',
  'structurally_valid',
  'ooxml_inspected',
  'rendered_exact_hash',
] as const;

export const PRESENTATION_RUN_DISPOSITIONS = ['TRACKING_REQUIRED', 'REVIEW_REQUIRED'] as const;

export const PRESENTATION_RUN_FAILURE_STATES = [
  'preflight',
  'lookup',
  'draft_expired',
  'draft_active',
  'grant_validation',
  'grant_expired',
  'committed',
  'dispatch_uncertain',
  'bound',
  'retained',
] as const;

export { PRESENTATION_RUN_LIMITS } from '@/common/types/office/presentationRunPolicy';

/**
 * Builtin (official) skills hidden from the app UI.
 * These ship inside the aioncore backend and cannot be deleted via its API,
 * so they are filtered out of every skills listing at the bridge layer.
 */
export const HIDDEN_BUILTIN_SKILLS: readonly string[] = ['xiaohongshu-recruiter', 'x-recruiter', 'weixin-file-send'];

// ===== AI Provider 相关常量 =====

// Stable ID for the Google Auth virtual provider.
// Shared between frontend (useModelProviderList) and backend (SystemActions).
export const GOOGLE_AUTH_PROVIDER_ID = 'google-auth-gemini';
