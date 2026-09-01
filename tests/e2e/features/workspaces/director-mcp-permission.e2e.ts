/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime proof for BUG-190's authenticated read-only MCP path.
 *
 * This runs real Director conversations and the built-in Studio MCP server against a loopback-only
 * OpenAI-compatible provider. The provider asks for exact tool names advertised by the runtime and
 * never calls a paid model. Two authenticated read-only tools must execute without approval, while
 * both a trusted mutator and an unattested server's self-declared read-only tool must stop for an
 * exact MCP permission decision.
 *
 * Build and run:
 * AIONUI_ENABLE_CREATIVE_STUDIO=1 bun run package
 * node scripts/build-mcp-servers.js
 * AIONUI_BACKEND_BINARY=/absolute/path/to/the/BUG-190/aioncore \
 *   AIONUI_ENABLE_CREATIVE_STUDIO=1 AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_DEV=1 \
 *   bunx playwright test --config playwright.config.ts \
 *   tests/e2e/features/workspaces/director-mcp-permission.e2e.ts --reporter=list
 */
import { expect, test } from '../../fixtures';
import { httpDelete, httpInvoke, httpPost, invokeBridge, navigateTo, ROUTES } from '../../helpers';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

type JsonObject = Record<string, unknown>;

type ProviderScenarioName = 'trusted-status' | 'trusted-conditioning' | 'trusted-mutator' | 'untrusted-read';

type ProviderScenarioState = {
  targetTool: string;
  callId: string;
  arguments: string;
  finalText: string;
  advertisedToolName: string | null;
  turnCount: number;
  toolResultContent: string | null;
};

type CapturedPermission = {
  scenario: ProviderScenarioName;
  payload: JsonObject;
};

const LOOPBACK_PROVIDER_ID = 'director-permission-loopback-provider';
type PriorProviderState = { id: string; enabled: boolean };

let server: Server;
let providerPort = 0;
let providerProtocolFailure: string | null = null;
let activeProviderScenario: ProviderScenarioName | null = null;
const providerRequestLog: string[] = [];
let priorProviderStates: PriorProviderState[] = [];
let createdConversationIds: string[] = [];
let createdProject: { id: string; revision: number } | null = null;
const providerScenarios: Record<ProviderScenarioName, ProviderScenarioState> = {
  'trusted-status': {
    targetTool: 'studio_get_project_status',
    callId: 'call_director_permission_status',
    arguments: '{"detail":false}',
    finalText: 'Director status read completed without approval.',
    advertisedToolName: null,
    turnCount: 0,
    toolResultContent: null,
  },
  'trusted-conditioning': {
    targetTool: 'studio_get_conditioning_frame',
    callId: 'call_director_permission_conditioning',
    arguments: '{"shotId":"missing-shot-for-trust-oracle"}',
    finalText: 'Director conditioning read returned without approval.',
    advertisedToolName: null,
    turnCount: 0,
    toolResultContent: null,
  },
  'trusted-mutator': {
    targetTool: 'studio_request_reference_images',
    callId: 'call_director_permission_mutator',
    arguments: '{"referenceIds":["missing-reference-for-trust-oracle"]}',
    finalText: 'Director mutation was denied and the turn continued.',
    advertisedToolName: null,
    turnCount: 0,
    toolResultContent: null,
  },
  'untrusted-read': {
    targetTool: 'studio_get_project_status',
    callId: 'call_director_permission_untrusted_read',
    arguments: '{"detail":false}',
    finalText: 'Untrusted read was denied and the turn continued.',
    advertisedToolName: null,
    turnCount: 0,
    toolResultContent: null,
  },
};

const jsonObject = (value: unknown, label: string): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} was malformed`);
  }
  return value as JsonObject;
};

const backendJson = async <T>(page: Page, method: 'GET' | 'POST', requestPath: string, body?: unknown): Promise<T> =>
  page.evaluate(
    async ({ method: requestMethod, path: pathValue, requestBody }) => {
      const port = (window as unknown as { __backendPort: number }).__backendPort;
      const init: RequestInit = {
        method: requestMethod,
        headers: requestBody === undefined ? undefined : { 'Content-Type': 'application/json' },
      };
      if (requestBody !== undefined) init.body = JSON.stringify(requestBody);
      const response = await fetch(`http://127.0.0.1:${port}${pathValue}`, init);
      if (!response.ok) {
        throw new Error(`${requestMethod} ${pathValue} failed: ${response.status} ${await response.text()}`);
      }
      const envelope = (await response.json()) as Record<string, unknown>;
      return ('data' in envelope ? envelope.data : envelope) as T;
    },
    { method, path: requestPath, requestBody: body }
  );

type PermissionEnvelope = { conversation_id?: unknown; msg_id?: unknown; turn_id?: unknown };

const findMcpPermission = (value: unknown, inherited: PermissionEnvelope = {}): JsonObject | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findMcpPermission(item, inherited);
      if (match !== null) return match;
    }
    return null;
  }
  if (typeof value === 'string') {
    try {
      return findMcpPermission(JSON.parse(value), inherited);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as JsonObject;
  const envelope = {
    conversation_id: record.conversation_id ?? inherited.conversation_id,
    msg_id: record.msg_id ?? inherited.msg_id,
    turn_id: record.turn_id ?? inherited.turn_id,
  };
  if (record.command_type === 'mcp' && typeof record.action === 'string') {
    return { ...record, ...envelope };
  }
  for (const child of Object.values(record)) {
    const match = findMcpPermission(child, envelope);
    if (match !== null) return match;
  }
  return null;
};

const beginProviderScenario = (name: ProviderScenarioName): ProviderScenarioState => {
  const scenario = providerScenarios[name];
  if (scenario.turnCount !== 0) throw new Error(`Provider scenario ${name} was started more than once`);
  activeProviderScenario = name;
  return scenario;
};

const waitForProviderScenario = async (name: ProviderScenarioName): Promise<ProviderScenarioState> => {
  await expect
    .poll(() => providerScenarios[name].turnCount >= 2 || providerProtocolFailure !== null, { timeout: 60_000 })
    .toBe(true);
  expect(providerProtocolFailure).toBeNull();
  const scenario = providerScenarios[name];
  expect(scenario.turnCount).toBe(2);
  expect(scenario.advertisedToolName).toContain(scenario.targetTool);
  expect(scenario.toolResultContent).not.toBeNull();
  return scenario;
};

const waitForConversationFinished = async (page: Page, conversationId: string): Promise<void> => {
  await expect
    .poll(
      async () => {
        const current = await backendJson<JsonObject>(
          page,
          'GET',
          `/api/conversations/${encodeURIComponent(conversationId)}`
        );
        return current.status;
      },
      { timeout: 60_000 }
    )
    .toBe('finished');
};

const permissionOptionValues = (payload: JsonObject): string[] => {
  const options = Array.isArray(payload.options) ? payload.options : [];
  return options.map((candidate) => String(jsonObject(candidate, 'permission option').value ?? ''));
};

const assertExactMcpPermission = async (
  page: Page,
  captured: CapturedPermission[],
  scenarioName: ProviderScenarioName,
  expectedServerName: string,
  expectedToolName: string,
  assertRenderedCard = true
): Promise<JsonObject> => {
  await expect.poll(() => captured.some((entry) => entry.scenario === scenarioName), { timeout: 60_000 }).toBe(true);
  const payload = captured.findLast((entry) => entry.scenario === scenarioName)?.payload;
  if (payload === undefined) throw new Error(`No MCP permission was captured for ${scenarioName}`);

  expect(payload.command_type).toBe('mcp');
  expect(String(payload.action ?? '')).toContain(expectedToolName);
  expect(jsonObject(payload.mcp_identity, `${scenarioName} MCP identity`)).toEqual({
    server_name: expectedServerName,
    tool_name: expectedToolName,
  });
  expect(permissionOptionValues(payload)).toEqual(['proceed_once', 'proceed_always', 'cancel']);
  expect(permissionOptionValues(payload)).not.toContain('proceed_always_server');
  const options = Array.isArray(payload.options) ? payload.options : [];
  const always = options
    .map((candidate) => jsonObject(candidate, `${scenarioName} permission option`))
    .find((option) => option.value === 'proceed_always');
  expect(always?.label).toBe('messages.confirmation.yesAlwaysAllowTool');
  expect(jsonObject(always?.params, `${scenarioName} exact-tool option params`)).toEqual({
    server_name: expectedServerName,
    tool_name: expectedToolName,
  });

  if (assertRenderedCard) {
    const card = page.getByTestId('message-permission-card').last();
    await expect(card).toBeVisible();
    const visibleIdentity = card.getByTestId('permission-mcp-identity');
    await expect(visibleIdentity).toContainText(expectedServerName);
    await expect(visibleIdentity).toContainText(expectedToolName);
    await expect(card.getByTestId('permission-icon-mcp')).toBeVisible();
    await expect(card.getByText("I'd like to use a tool", { exact: true })).toBeVisible();
    await expect(card.getByText("I'd like to run a command", { exact: true })).toHaveCount(0);
    await expect(card.getByTestId('message-permission-option-proceed_always')).toHaveText(
      `Yes, always allow tool "${expectedToolName}" from server "${expectedServerName}"`
    );
    await expect(card.getByTestId('message-permission-option-proceed_always_server')).toHaveCount(0);
  }
  return payload;
};

test.describe('Director MCP authenticated read-only execution', () => {
  test.describe.configure({ timeout: 300_000 });
  test.skip(
    process.env.AIONUI_E2E_TEST !== '1' || process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
    'Director permission verification requires the isolated Studio E2E profile.'
  );

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      let rawBody = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        rawBody += chunk;
      });
      request.on('end', () => {
        providerRequestLog.push(`${request.method ?? 'UNKNOWN'} ${request.url ?? ''}`);
        console.log(`DIRECTOR_MCP_PROVIDER_REQUEST ${providerRequestLog.at(-1)}`);
        if (request.method === 'GET' && request.url === '/v1/models') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({ object: 'list', data: [{ id: 'director-permission-model', object: 'model' }] })
          );
          return;
        }
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
          response.writeHead(404, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'not found' }));
          return;
        }

        if (activeProviderScenario === null) {
          providerProtocolFailure = 'The mock provider received a turn without an active scenario';
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: providerProtocolFailure }));
          return;
        }
        const scenarioName = activeProviderScenario;
        const scenario = providerScenarios[scenarioName];
        const requestBody = jsonObject(JSON.parse(rawBody), `${scenarioName} mock provider request`);
        const tools = Array.isArray(requestBody.tools) ? requestBody.tools : [];
        const toolNames = tools.map((candidate) => {
          const tool = jsonObject(candidate, 'provider tool');
          const fn = jsonObject(tool.function, 'provider function');
          return String(fn.name ?? '');
        });
        console.log(`DIRECTOR_MCP_ADVERTISED_TOOLS ${scenarioName} ${JSON.stringify(toolNames)}`);
        const requestedTool = tools.find((candidate) => {
          const tool = jsonObject(candidate, 'provider tool');
          const fn = jsonObject(tool.function, 'provider function');
          return typeof fn.name === 'string' && fn.name.includes(scenario.targetTool);
        });
        if (requestedTool === undefined) {
          providerProtocolFailure = `${scenario.targetTool} was not advertised for ${scenarioName}; received ${JSON.stringify(toolNames)}`;
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: providerProtocolFailure }));
          return;
        }
        const fn = jsonObject(jsonObject(requestedTool, 'requested tool').function, 'requested function');
        const advertisedToolName = String(fn.name);
        scenario.advertisedToolName = advertisedToolName;
        scenario.turnCount += 1;

        let chunks: JsonObject[];
        if (scenario.turnCount === 1) {
          chunks = [
            {
              id: `director-permission-${scenarioName}-1`,
              object: 'chat.completion.chunk',
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: 0,
                        id: scenario.callId,
                        type: 'function',
                        function: { name: advertisedToolName, arguments: scenario.arguments },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              id: `director-permission-${scenarioName}-1`,
              object: 'chat.completion.chunk',
              choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
              usage: { prompt_tokens: 8, completion_tokens: 4 },
            },
          ];
        } else if (scenario.turnCount === 2) {
          const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
          const matchingToolResult = messages.find((candidate) => {
            const message = jsonObject(candidate, 'provider message');
            return message.role === 'tool' && message.tool_call_id === scenario.callId;
          });
          if (matchingToolResult === undefined) {
            providerProtocolFailure = `The second ${scenarioName} provider turn did not contain ${scenario.callId}`;
            response.writeHead(400, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: providerProtocolFailure }));
            return;
          }
          const toolResult = jsonObject(matchingToolResult, `${scenarioName} provider tool result`);
          scenario.toolResultContent =
            typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
          chunks = [
            {
              id: `director-permission-${scenarioName}-2`,
              object: 'chat.completion.chunk',
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: scenario.finalText },
                  finish_reason: null,
                },
              ],
            },
            {
              id: `director-permission-${scenarioName}-2`,
              object: 'chat.completion.chunk',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 8, completion_tokens: 4 },
            },
          ];
        } else {
          providerProtocolFailure = `Unexpected ${scenarioName} provider turn ${scenario.turnCount}`;
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: providerProtocolFailure }));
          return;
        }
        const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Content-Length': Buffer.byteLength(body) });
        response.end(body);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') return reject(new Error('mock provider did not bind'));
        providerPort = address.port;
        resolve();
      });
    });
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test.beforeEach(() => {
    providerProtocolFailure = null;
    activeProviderScenario = null;
    providerRequestLog.length = 0;
    priorProviderStates = [];
    createdConversationIds = [];
    createdProject = null;
    for (const scenario of Object.values(providerScenarios)) {
      scenario.advertisedToolName = null;
      scenario.turnCount = 0;
      scenario.toolResultContent = null;
    }
  });

  test.afterEach(async ({ page }) => {
    if (createdProject !== null) {
      await invokeBridge(page, 'creative-studio.delete-project', {
        projectId: createdProject.id,
        expectedRevision: createdProject.revision,
      }).catch(() => {});
    }
    await Promise.all(
      createdConversationIds
        .toReversed()
        .map((conversationId) =>
          httpDelete(page, `/api/conversations/${encodeURIComponent(conversationId)}`).catch(() => {})
        )
    );
    await httpDelete(page, `/api/providers/${encodeURIComponent(LOOPBACK_PROVIDER_ID)}`).catch(() => {});
    await Promise.all(
      priorProviderStates.map((provider) =>
        httpInvoke(page, 'PUT', `/api/providers/${encodeURIComponent(provider.id)}`, {
          enabled: provider.enabled,
        }).catch(() => {})
      )
    );
  });

  test('bypasses only authenticated read-only Studio tools and prompts for every negative control', async ({
    electronApp,
    page,
  }) => {
    const existingProviders = await backendJson<JsonObject[]>(page, 'GET', '/api/providers');
    priorProviderStates = existingProviders
      .filter((provider) => provider.id !== LOOPBACK_PROVIDER_ID && typeof provider.id === 'string')
      .map((provider) => ({ id: String(provider.id), enabled: provider.enabled === true }));
    await httpDelete(page, `/api/providers/${encodeURIComponent(LOOPBACK_PROVIDER_ID)}`).catch(() => {});
    await Promise.all(
      priorProviderStates
        .filter((provider) => provider.enabled)
        .map((provider) =>
          httpInvoke(page, 'PUT', `/api/providers/${encodeURIComponent(provider.id)}`, { enabled: false })
        )
    );
    await httpPost(page, '/api/providers', {
      id: LOOPBACK_PROVIDER_ID,
      platform: 'custom',
      name: 'Director permission loopback provider',
      base_url: `http://127.0.0.1:${providerPort}/v1`,
      api_key: 'loopback-only',
      models: ['director-permission-model'],
      enabled: true,
      model_enabled: { 'director-permission-model': true },
      model_health: { 'director-permission-model': { status: 'healthy' } },
    });

    const rendererMcpPayloads: CapturedPermission[] = [];
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload: frame }) => {
        const match = findMcpPermission(typeof frame === 'string' ? frame : frame.toString());
        if (match !== null) {
          const callId = String(match.call_id ?? '');
          const scenario = (Object.entries(providerScenarios) as [ProviderScenarioName, ProviderScenarioState][]).find(
            ([, state]) => state.callId === callId
          )?.[0];
          if (
            scenario !== undefined &&
            !rendererMcpPayloads.some(
              (entry) => entry.scenario === scenario && String(entry.payload.call_id ?? '') === callId
            )
          ) {
            rendererMcpPayloads.push({ scenario, payload: match });
          }
        }
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await navigateTo(page, ROUTES.studio);
    const workspace = page.locator('[data-studio-workspace]');
    await workspace.getByLabel('What do you want to make?').fill('Read the current project status and stop.');
    // Project creation seeds the brief as the Director's opening turn. Arm the
    // provider before clicking so that real auto-send is the positive oracle;
    // a second manual copy would race or test the wrong turn.
    const trustedStatus = beginProviderScenario('trusted-status');
    await workspace.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+$/);

    const projectId = decodeURIComponent(new URL(page.url()).hash.split('/')[2] ?? '');
    const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    let conversationId = '';
    await expect
      .poll(
        async () => {
          const project = jsonObject(
            JSON.parse(
              await readFile(
                path.join(userDataDirectory, 'config', 'creative-studio', projectId, 'project.json'),
                'utf8'
              )
            ),
            'project'
          );
          if (typeof project.revision === 'number') {
            createdProject = { id: projectId, revision: project.revision };
          }
          conversationId = typeof project.briefConversationId === 'string' ? project.briefConversationId : '';
          return conversationId;
        },
        { timeout: 30_000 }
      )
      .not.toBe('');
    createdConversationIds.push(conversationId);

    const conversation = await backendJson<JsonObject>(
      page,
      'GET',
      `/api/conversations/${encodeURIComponent(conversationId)}`
    );
    const conversationModel = jsonObject(conversation.model, 'Director conversation model');
    const conversationExtra = jsonObject(conversation.extra, 'Director conversation extra');
    console.log(`DIRECTOR_MCP_MODEL ${JSON.stringify(conversationModel)}`);
    expect(conversationModel.provider_id).toBe(LOOPBACK_PROVIDER_ID);
    expect(conversationModel.model).toBe('director-permission-model');
    expect(conversationExtra.selected_session_mcp_trust_claims).toBeUndefined();
    expect(conversationExtra.session_mcp_trust).toEqual([
      {
        server_id: `studio-brief-${projectId}`,
        server_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        resolver_profile: 'aioncore.session-mcp-resolver.v1',
      },
    ]);
    const sessionServers = Array.isArray(conversationExtra.session_mcp_servers)
      ? conversationExtra.session_mcp_servers
      : [];
    expect(sessionServers).toHaveLength(1);
    const trustedSessionServer = jsonObject(sessionServers[0], 'trusted Studio session server');
    const trustedServerName = String(trustedSessionServer.name ?? '');
    expect(trustedServerName).not.toBe('');

    await waitForProviderScenario('trusted-status');
    expect(trustedStatus.toolResultContent).not.toContain('Tool denied:');
    expect(trustedStatus.toolResultContent).not.toBe('');
    await waitForConversationFinished(page, conversationId);
    expect(rendererMcpPayloads.filter((entry) => entry.scenario === 'trusted-status')).toEqual([]);
    await expect(page.getByTestId('message-permission-card')).toHaveCount(0);
    await expect(page.getByText(trustedStatus.finalText, { exact: true })).toBeVisible();

    // A newly introduced read-only tool must inherit the same authenticated policy. Its deliberately
    // missing Shot may yield a domain error, but that error must reach the provider without approval.
    const trustedConditioning = beginProviderScenario('trusted-conditioning');
    await backendJson(page, 'POST', `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      content: 'Read the missing Shot conditioning frame and stop.',
      files: [],
    });
    await waitForProviderScenario('trusted-conditioning');
    expect(trustedConditioning.toolResultContent).not.toContain('Tool denied:');
    expect(trustedConditioning.toolResultContent).not.toBe('');
    await waitForConversationFinished(page, conversationId);
    expect(rendererMcpPayloads.filter((entry) => entry.scenario === 'trusted-conditioning')).toEqual([]);
    await expect(page.getByTestId('message-permission-card')).toHaveCount(0);
    await expect(page.getByText(trustedConditioning.finalText, { exact: true })).toBeVisible();

    // Host authentication is not blanket approval: the same trusted server's mutator must stop,
    // expose its exact raw MCP identity, and accept a bounded one-call denial.
    const trustedMutator = beginProviderScenario('trusted-mutator');
    await backendJson(page, 'POST', `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      content: 'Request a missing reference image and stop.',
      files: [],
    });
    const trustedMutatorPermission = await assertExactMcpPermission(
      page,
      rendererMcpPayloads,
      'trusted-mutator',
      trustedServerName,
      trustedMutator.targetTool
    );
    expect(trustedMutatorPermission.conversation_id).toBe(conversationId);
    expect(trustedMutator.turnCount).toBe(1);
    await page.getByTestId('message-permission-card').last().getByTestId('message-permission-option-cancel').click();
    await waitForProviderScenario('trusted-mutator');
    expect(trustedMutator.toolResultContent).toBe('Tool denied: User denied the tool request');
    await waitForConversationFinished(page, conversationId);
    await expect(page.getByText(trustedMutator.finalText, { exact: true })).toBeVisible();

    const workspacePath = conversationExtra.workspace;
    if (typeof workspacePath !== 'string' || workspacePath.length === 0) {
      throw new Error('Director conversation did not persist its workspace');
    }

    // Reuse the exact authenticated Studio descriptor but omit Main's transient claim. Also replay
    // the exact projected trust snapshot as caller-controlled opaque extra. This proves neither a
    // familiar id/name/transport nor forged persisted-looking metadata can grant authority; only
    // Core's private per-conversation attestation may do so.
    const untrustedServer = trustedSessionServer;
    const untrustedServerName = trustedServerName;
    const forgedTrustSnapshot = conversationExtra.session_mcp_trust;
    const untrustedConversation = await backendJson<JsonObject>(page, 'POST', '/api/conversations', {
      type: 'aionrs',
      name: 'BUG-190 unattested read-only oracle',
      model: conversationModel,
      extra: {
        workspace: workspacePath,
        custom_workspace: true,
        selected_mcp_server_ids: [],
        selected_session_mcp_servers: [untrustedServer],
        session_mcp_trust: forgedTrustSnapshot,
      },
    });
    const untrustedConversationId = String(untrustedConversation.id ?? '');
    expect(untrustedConversationId).not.toBe('');
    createdConversationIds.push(untrustedConversationId);
    const untrustedExtra = jsonObject(untrustedConversation.extra, 'untrusted conversation extra');
    expect(untrustedExtra.selected_session_mcp_trust_claims).toBeUndefined();
    expect(untrustedExtra.session_mcp_trust ?? []).toEqual([]);
    expect(untrustedExtra.session_mcp_servers).toEqual([untrustedServer]);

    const untrustedRead = beginProviderScenario('untrusted-read');
    await backendJson(page, 'POST', `/api/conversations/${encodeURIComponent(untrustedConversationId)}/messages`, {
      content: 'Call the self-declared read-only Studio status tool and stop.',
      files: [],
    });
    const untrustedReadPermission = await assertExactMcpPermission(
      page,
      rendererMcpPayloads,
      'untrusted-read',
      untrustedServerName,
      untrustedRead.targetTool,
      false
    );
    expect(untrustedReadPermission.conversation_id).toBe(untrustedConversationId);
    expect(untrustedRead.turnCount).toBe(1);
    const untrustedMessageId = String(untrustedReadPermission.msg_id ?? '');
    expect(untrustedMessageId).not.toBe('');
    await backendJson(
      page,
      'POST',
      `/api/conversations/${encodeURIComponent(untrustedConversationId)}/confirmations/${encodeURIComponent(untrustedRead.callId)}/confirm`,
      {
        msg_id: untrustedMessageId,
        data: { value: 'cancel' },
        always_allow: false,
      }
    );
    await waitForProviderScenario('untrusted-read');
    expect(untrustedRead.toolResultContent).toBe('Tool denied: User denied the tool request');
    await waitForConversationFinished(page, untrustedConversationId);

    console.log(
      `DIRECTOR_MCP_TRUST_EVIDENCE ${JSON.stringify({
        providerScenarios,
        trustedReadPermissions: rendererMcpPayloads.filter(
          (entry) => entry.scenario === 'trusted-status' || entry.scenario === 'trusted-conditioning'
        ),
        trustedMutatorPermission,
        untrustedReadPermission,
        persistedTrust: conversationExtra.session_mcp_trust,
        untrustedPersistedTrust: untrustedExtra.session_mcp_trust ?? [],
      })}`
    );
  });
});
