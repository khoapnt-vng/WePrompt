import { describe, expect, it } from 'vitest';
import { NATIVE_BRIDGE_PROVIDER_KEYS } from '@/common/adapter/native/constants';
import { HTTP_ROUTES } from '../e2e/helpers/bridge/routes';

const EXTENSION_HTTP_ROUTES = {
  'extensions.disable': ['POST', '/api/extensions/disable'],
  'extensions.enable': ['POST', '/api/extensions/enable'],
  'extensions.get-acp-adapters': ['GET', '/api/extensions/acp-adapters'],
  'extensions.get-agent-activity-snapshot': ['GET', '/api/extensions/agent-activity'],
  'extensions.get-agents': ['GET', '/api/extensions/agents'],
  'extensions.get-assistants': ['GET', '/api/extensions/assistants'],
  'extensions.get-loaded-extensions': ['GET', '/api/extensions'],
  'extensions.get-mcp-servers': ['GET', '/api/extensions/mcp-servers'],
  'extensions.get-permissions': ['POST', '/api/extensions/permissions'],
  'extensions.get-risk-level': ['POST', '/api/extensions/risk-level'],
  'extensions.get-settings-tabs': ['GET', '/api/extensions/settings-tabs'],
  'extensions.get-skills': ['GET', '/api/extensions/skills'],
  'extensions.get-themes': ['GET', '/api/extensions/themes'],
  'extensions.get-webui-contributions': ['GET', '/api/extensions/webui'],
} as const;

describe('E2E extension bridge routes', () => {
  it('routes every extension query and mutation through the production HTTP boundary', () => {
    const actual = Object.fromEntries(
      Object.entries(HTTP_ROUTES)
        .filter(([key]) => key.startsWith('extensions.'))
        .map(([key, route]) => [key, [route.method, route.path]])
    );

    expect(actual).toEqual(EXTENSION_HTTP_ROUTES);
  });

  it('keeps extension HTTP operations out of the native Electron provider allowlist', () => {
    for (const key of Object.keys(EXTENSION_HTTP_ROUTES)) {
      expect(NATIVE_BRIDGE_PROVIDER_KEYS).not.toContain(key);
    }
  });

  it('forwards extension mutation and query bodies without legacy remapping', () => {
    const enable = HTTP_ROUTES['extensions.enable'];
    const permissions = HTTP_ROUTES['extensions.get-permissions'];
    const payload = { name: 'hello-world', reason: 'e2e-check' };

    expect(enable?.mapBody?.(payload) ?? payload).toEqual(payload);
    expect(permissions?.mapBody?.(payload) ?? payload).toEqual(payload);
  });
});
