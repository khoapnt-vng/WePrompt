/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime proof for BUG-190's permission-copy path.
 *
 * This runs a real Director conversation and the built-in Studio MCP server against a loopback-only
 * OpenAI-compatible provider. The provider asks for the exact Studio status tool advertised by the
 * runtime, never calls a paid model, and deliberately leaves the Studio MCP permission unanswered.
 *
 * Build and run:
 * AIONUI_ENABLE_CREATIVE_STUDIO=1 bun run package
 * node scripts/build-mcp-servers.js
 * AIONUI_ENABLE_CREATIVE_STUDIO=1 AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_DEV=1 \
 *   bunx playwright test --config playwright.config.ts \
 *   tests/e2e/features/workspaces/director-mcp-permission.e2e.ts --reporter=list
 */
import { expect, test } from '../../fixtures';
import { httpPost, navigateTo, ROUTES } from '../../helpers';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

type JsonObject = Record<string, unknown>;

let server: Server;
let providerPort = 0;
let providerTurnCount = 0;
let advertisedToolName: string | null = null;
let providerProtocolFailure: string | null = null;
const providerRequestLog: string[] = [];

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

const findMcpPermission = (value: unknown): JsonObject | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findMcpPermission(item);
      if (match !== null) return match;
    }
    return null;
  }
  if (typeof value === 'string') {
    try {
      return findMcpPermission(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as JsonObject;
  if (record.command_type === 'mcp' && typeof record.action === 'string') return record;
  for (const child of Object.values(record)) {
    const match = findMcpPermission(child);
    if (match !== null) return match;
  }
  return null;
};

test.describe('Director MCP permission payload', () => {
  test.describe.configure({ timeout: 180_000 });
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

        const requestBody = jsonObject(JSON.parse(rawBody), 'mock provider request');
        const tools = Array.isArray(requestBody.tools) ? requestBody.tools : [];
        const toolNames = tools.map((candidate) => {
          const tool = jsonObject(candidate, 'provider tool');
          const fn = jsonObject(tool.function, 'provider function');
          return String(fn.name ?? '');
        });
        console.log(`DIRECTOR_MCP_ADVERTISED_TOOLS ${JSON.stringify(toolNames)}`);
        const statusTool = tools.find((candidate) => {
          const tool = jsonObject(candidate, 'provider tool');
          const fn = jsonObject(tool.function, 'provider function');
          return typeof fn.name === 'string' && fn.name.includes('studio_get_project_status');
        });
        if (statusTool === undefined) {
          providerProtocolFailure = `Studio status tool was not advertised; received ${JSON.stringify(toolNames)}`;
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: providerProtocolFailure }));
          return;
        }
        const fn = jsonObject(jsonObject(statusTool, 'status tool').function, 'status function');
        const statusToolName = String(fn.name);
        advertisedToolName = statusToolName;
        providerTurnCount += 1;

        const chunks = [
          {
            id: `director-permission-${providerTurnCount}`,
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_director_permission_status',
                      type: 'function',
                      function: { name: statusToolName, arguments: '{"detail":false}' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            id: `director-permission-${providerTurnCount}`,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 8, completion_tokens: 4 },
          },
        ];
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

  test('carries command_type=mcp into the renderer intent branch', async ({ electronApp, page }) => {
    await httpPost(page, '/api/providers', {
      id: 'director-permission-loopback-provider',
      platform: 'custom',
      name: 'Director permission loopback provider',
      base_url: `http://127.0.0.1:${providerPort}/v1`,
      api_key: 'loopback-only',
      models: ['director-permission-model'],
      enabled: true,
      model_enabled: { 'director-permission-model': true },
      model_health: { 'director-permission-model': { status: 'healthy' } },
    });

    let rendererMcpPayload: JsonObject | null = null;
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload: frame }) => {
        const match = findMcpPermission(typeof frame === 'string' ? frame : frame.toString());
        if (match !== null) rendererMcpPayload = match;
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await navigateTo(page, ROUTES.studio);
    const workspace = page.locator('[data-studio-workspace]');
    await workspace.getByLabel('What do you want to make?').fill('Read the current project status and stop.');
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
          conversationId = typeof project.briefConversationId === 'string' ? project.briefConversationId : '';
          return conversationId;
        },
        { timeout: 30_000 }
      )
      .not.toBe('');

    const conversation = await backendJson<JsonObject>(
      page,
      'GET',
      `/api/conversations/${encodeURIComponent(conversationId)}`
    );
    const conversationModel = jsonObject(conversation.model, 'Director conversation model');
    console.log(`DIRECTOR_MCP_MODEL ${JSON.stringify(conversationModel)}`);
    expect(conversationModel.provider_id).toBe('director-permission-loopback-provider');
    expect(conversationModel.model).toBe('director-permission-model');

    await backendJson(page, 'POST', `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      content: 'Read the current project status and stop.',
      files: [],
    });

    await expect
      .poll(() => providerTurnCount === 1 || providerProtocolFailure !== null, { timeout: 60_000 })
      .toBe(true);
    expect(providerProtocolFailure).toBeNull();
    expect(providerTurnCount).toBe(1);
    expect(advertisedToolName).toContain('studio_get_project_status');

    await expect.poll(() => rendererMcpPayload, { timeout: 30_000 }).not.toBeNull();
    expect(rendererMcpPayload?.command_type).toBe('mcp');
    expect(String(rendererMcpPayload?.action)).toContain('studio_get_project_status');

    const card = page.getByTestId('message-permission-card').last();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("I'd like to use a tool", { exact: true })).toBeVisible();
    await expect(card.getByText("I'd like to run a command", { exact: true })).toHaveCount(0);

    console.log(
      `DIRECTOR_MCP_PERMISSION_EVIDENCE ${JSON.stringify({
        advertisedToolName,
        payload: rendererMcpPayload,
        providerTurnCount,
        rendererIntent: "I'd like to use a tool",
      })}`
    );
  });
});
