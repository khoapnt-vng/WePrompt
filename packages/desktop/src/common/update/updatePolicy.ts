const SENTRY_BUILD_VARIABLES = [
  'SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_UPLOAD_SOURCE_MAPS',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_RELEASE',
] as const;

type SentryBuildVariable = (typeof SENTRY_BUILD_VARIABLES)[number];

export type DesktopReleaseBuildEnvironment = Partial<
  Record<
    SentryBuildVariable | 'AIONUI_ENABLE_CREATIVE_STUDIO' | 'WEPROMPT_INTERNAL_RELEASE' | 'WEPROMPT_UPDATE_BASE_URL',
    string | undefined
  >
>;

export type DesktopUpdateRuntimeEnvironment = Partial<
  Record<
    | 'AIONUI_DISABLE_AUTO_UPDATE'
    | 'AIONUI_E2E_TEST'
    | 'CI'
    | 'GITHUB_ACTIONS'
    | 'WEPROMPT_INTERNAL_RELEASE'
    | 'WEPROMPT_UPDATE_BASE_URL',
    string | undefined
  >
>;

export type DesktopReleaseBuildPolicy = {
  internalRelease: boolean;
  creativeStudioEnabled: boolean;
  updateBaseUrl: string | null;
  enableSentrySourceMaps: boolean;
  sentry: {
    dsn: string;
    authToken: string;
    org: string;
    project: string;
    release: string;
  };
};

const trimmed = (value: string | undefined): string => value?.trim() ?? '';

const AMBIGUOUS_UPDATE_PATH_ENCODING = /%(?:25|2e|2f|5c)/i;

const canonicalUpdatePath = (url: URL): string | null => {
  // A proxy may decode these values differently from WHATWG URL handling.
  // Reject encoded percent, dot, and path separators instead of allowing a
  // downstream normalization step to move a request outside the feed root.
  if (AMBIGUOUS_UPDATE_PATH_ENCODING.test(url.pathname)) return null;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  if (decodedPath.includes('\\')) return null;
  if (decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  return decodedPath;
};

export function isUpdateUrlWithinBase(targetUrl: URL, configuredBaseUrl: string): boolean {
  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredBaseUrl);
  } catch {
    return false;
  }

  const targetPath = canonicalUpdatePath(targetUrl);
  const baseCanonicalPath = canonicalUpdatePath(baseUrl);
  if (!targetPath || !baseCanonicalPath) return false;

  const basePath = baseCanonicalPath.endsWith('/') ? baseCanonicalPath : `${baseCanonicalPath}/`;
  const basePathWithoutSlash = basePath.slice(0, -1) || '/';

  return (
    targetUrl.protocol === 'https:' &&
    !targetUrl.username &&
    !targetUrl.password &&
    baseUrl.protocol === 'https:' &&
    !baseUrl.username &&
    !baseUrl.password &&
    targetUrl.origin === baseUrl.origin &&
    (targetPath === basePathWithoutSlash || targetPath.startsWith(basePath))
  );
}

const isUpstreamAionUiDestination = (url: URL): boolean => {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const pathname = url.pathname.toLowerCase();

  if (hostname === 'aionui.com' || hostname.endsWith('.aionui.com')) {
    return true;
  }

  if (hostname === 'github.com' && pathname.startsWith('/iofficeai/aionui')) {
    return true;
  }

  return hostname === 'api.github.com' && pathname.startsWith('/repos/iofficeai/aionui');
};

export function resolveUpdateBaseUrl(value: string | undefined): string | null {
  const rawValue = trimmed(value);
  if (!rawValue) return null;

  let url: URL;
  try {
    url = new URL(rawValue);
  } catch (error) {
    throw new Error('WEPROMPT_UPDATE_BASE_URL must be a valid URL', { cause: error });
  }

  if (url.protocol !== 'https:') {
    throw new Error('WEPROMPT_UPDATE_BASE_URL must use HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('WEPROMPT_UPDATE_BASE_URL must not contain credentials, query parameters, or a fragment');
  }
  if (!canonicalUpdatePath(url)) {
    throw new Error('WEPROMPT_UPDATE_BASE_URL must not contain ambiguous path encoding');
  }
  if (isUpstreamAionUiDestination(url)) {
    throw new Error('WEPROMPT_UPDATE_BASE_URL must not use a public AionUi destination');
  }

  return url.toString().replace(/\/$/, '');
}

export function resolveDesktopReleaseBuildPolicy(
  environment: DesktopReleaseBuildEnvironment,
  options: { isDevelopment: boolean }
): DesktopReleaseBuildPolicy {
  const internalRelease = trimmed(environment.WEPROMPT_INTERNAL_RELEASE) === '1';
  const rawCreativeStudioFlag = trimmed(environment.AIONUI_ENABLE_CREATIVE_STUDIO);
  const rawUpdateBaseUrl = trimmed(environment.WEPROMPT_UPDATE_BASE_URL);

  if (internalRelease && rawCreativeStudioFlag) {
    throw new Error('AIONUI_ENABLE_CREATIVE_STUDIO must be unset when WEPROMPT_INTERNAL_RELEASE=1');
  }

  if (internalRelease && rawUpdateBaseUrl) {
    throw new Error('WEPROMPT_UPDATE_BASE_URL must be unset when WEPROMPT_INTERNAL_RELEASE=1');
  }

  const configuredSentryVariables = SENTRY_BUILD_VARIABLES.filter((key) => trimmed(environment[key]));
  if (internalRelease && configuredSentryVariables.length > 0) {
    throw new Error(`${configuredSentryVariables.join(', ')} must be unset when WEPROMPT_INTERNAL_RELEASE=1`);
  }

  const updateBaseUrl = resolveUpdateBaseUrl(rawUpdateBaseUrl);
  const explicitSourceMapUpload = trimmed(environment.SENTRY_UPLOAD_SOURCE_MAPS) === 'true';
  const enableSentrySourceMaps = !options.isDevelopment && !internalRelease && explicitSourceMapUpload;

  if (enableSentrySourceMaps) {
    const requiredVariables = [
      'SENTRY_DSN',
      'SENTRY_AUTH_TOKEN',
      'SENTRY_ORG',
      'SENTRY_PROJECT',
      'SENTRY_RELEASE',
    ] as const;
    const missingVariables = requiredVariables.filter((key) => !trimmed(environment[key]));
    if (missingVariables.length > 0) {
      throw new Error(`Sentry source-map upload requires ${missingVariables.join(', ')}`);
    }
  }

  return {
    internalRelease,
    creativeStudioEnabled: !internalRelease && rawCreativeStudioFlag === '1',
    updateBaseUrl,
    enableSentrySourceMaps,
    sentry: {
      dsn: internalRelease ? '' : trimmed(environment.SENTRY_DSN),
      authToken: trimmed(environment.SENTRY_AUTH_TOKEN),
      org: trimmed(environment.SENTRY_ORG),
      project: trimmed(environment.SENTRY_PROJECT),
      release: trimmed(environment.SENTRY_RELEASE),
    },
  };
}

export function getConfiguredUpdateBaseUrl(
  value: string | undefined = process.env.WEPROMPT_UPDATE_BASE_URL
): string | null {
  return resolveUpdateBaseUrl(value);
}

export function isUpdateFeatureEnabled(
  value: string | undefined = process.env.WEPROMPT_UPDATE_BASE_URL,
  environment: DesktopUpdateRuntimeEnvironment = process.env
): boolean {
  const isCiRuntime = environment.CI === 'true' || environment.CI === '1' || environment.GITHUB_ACTIONS === 'true';
  return (
    getConfiguredUpdateBaseUrl(value) !== null &&
    environment.WEPROMPT_INTERNAL_RELEASE !== '1' &&
    environment.AIONUI_DISABLE_AUTO_UPDATE !== '1' &&
    environment.AIONUI_E2E_TEST !== '1' &&
    !isCiRuntime
  );
}
