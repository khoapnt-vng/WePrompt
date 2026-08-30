/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BUG-163 deterministic restart/recovery verification.
 *
 * Build the opted-in dev artifacts, then run against the fixture-owned profile
 * and this spec's loopback-only OpenAI-compatible provider:
 * AIONUI_ENABLE_CREATIVE_STUDIO=1 bun run package
 * AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_DEV=1 \
 *   bunx playwright test --config playwright.config.ts \
 *   tests/e2e/features/workspaces/bug163-live-verification.e2e.ts --reporter=list
 */
import { expect, test } from '../../fixtures';
import { httpPost, navigateTo, ROUTES } from '../../helpers';
import { DIRECTOR_PRESET_RULES_PROFILE } from '@/renderer/pages/studio/components/Workspace/DirectorRail/openingTurn';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

type StoredState = {
  conversationId: string;
  historyIds: string[];
  preRestartBackendPort: number;
  preRestartProcessPid: number;
  projectId: string;
  userDataDirectory: string;
};

type JsonObject = Record<string, unknown>;

let server: Server;
let providerPort = 0;
let providerTurnCount = 0;
let stored: StoredState | null = null;

const jsonObject = (value: unknown, label: string): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} was malformed`);
  return value as JsonObject;
};

const backendJson = async <T>(
  page: Page,
  method: 'GET' | 'POST' | 'PATCH',
  requestPath: string,
  body?: unknown
): Promise<T> =>
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

const readProject = async (state: Pick<StoredState, 'projectId' | 'userDataDirectory'>): Promise<JsonObject> =>
  jsonObject(
    JSON.parse(
      await readFile(
        path.join(state.userDataDirectory, 'config', 'creative-studio', state.projectId, 'project.json'),
        'utf8'
      )
    ),
    'project'
  );

const requireStored = (): StoredState => {
  if (stored === null) throw new Error('BUG-163 setup did not complete');
  return stored;
};

const getConversationMessages = async (page: Page, conversationId: string): Promise<JsonObject[]> => {
  const result = await backendJson<unknown>(
    page,
    'GET',
    `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`
  );
  if (Array.isArray(result)) return result.map((message) => jsonObject(message, 'conversation message'));
  const pageResult = jsonObject(result, 'conversation messages page');
  if (!Array.isArray(pageResult.items)) throw new Error('conversation messages page did not contain items');
  return pageResult.items.map((message) => jsonObject(message, 'conversation message'));
};

test.describe.serial('BUG-163 live restart recovery', () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(process.env.AIONUI_E2E_TEST !== '1', 'BUG-163 verification requires an isolated E2E profile.');

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      let rawBody = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        rawBody += chunk;
      });
      request.on('end', () => {
        if (request.method === 'GET' && request.url === '/v1/models') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ object: 'list', data: [{ id: 'bug163-local-model', object: 'model' }] }));
          return;
        }
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
          response.writeHead(404, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'not found' }));
          return;
        }
        const parsed = jsonObject(JSON.parse(rawBody), 'mock provider request');
        if (parsed.model !== 'bug163-local-model' || parsed.stream !== true) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'unexpected request' }));
          return;
        }
        providerTurnCount += 1;
        const content = `BUG163 deterministic reply ${providerTurnCount}`;
        const chunks = [
          {
            id: `bug163-${providerTurnCount}`,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null as string | null }],
          },
          {
            id: `bug163-${providerTurnCount}`,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
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
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('loses the create response after persistence, retains history, then kills the app', async ({
    electronApp,
    page,
  }) => {
    const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    expect(userDataDirectory).toContain('aionui-e2e-state-');

    await httpPost(page, '/api/providers', {
      id: 'bug163-loopback-provider',
      platform: 'custom',
      name: 'BUG-163 loopback provider',
      base_url: `http://127.0.0.1:${providerPort}/v1`,
      api_key: 'bug163-local-only',
      models: ['bug163-local-model'],
      enabled: true,
      model_enabled: { 'bug163-local-model': true },
      model_health: { 'bug163-local-model': { status: 'healthy' } },
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    let releaseCreate: (() => void) | null = null;
    const createCommitted = new Promise<JsonObject>((resolve, reject) => {
      void page.route('**/api/conversations', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') return route.continue();
        try {
          const response = await route.fetch();
          const envelope = jsonObject(await response.json(), 'conversation create response');
          const conversation = jsonObject(envelope.data, 'created conversation');
          resolve(conversation);
          await new Promise<void>((release) => {
            releaseCreate = release;
          });
          await route.fulfill({ response });
        } catch (error) {
          reject(error);
        }
      });
    });

    await navigateTo(page, ROUTES.studio);
    const brief = `BUG-163 isolated restart probe ${Date.now()}`;
    const workspace = page.locator('[data-studio-workspace]');
    await workspace.getByLabel('What do you want to make?').fill(brief);
    await workspace.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+$/);
    const projectId = decodeURIComponent(new URL(page.url()).hash.split('/')[2] ?? '');
    expect(projectId).not.toBe('');

    const created = await createCommitted;
    const conversationId = String(created.id ?? '');
    expect(conversationId).not.toBe('');
    expect(jsonObject(created.extra, 'created conversation extra').studio_project_id).toBe(projectId);
    expect((await readProject({ projectId, userDataDirectory })).briefConversationId).toBeNull();

    await backendJson(page, 'POST', `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      content: 'BUG163 retained history sentinel',
      files: [],
    });
    await expect.poll(() => providerTurnCount, { timeout: 60_000 }).toBe(1);
    await expect
      .poll(
        async () => {
          const conversation = await backendJson<JsonObject>(
            page,
            'GET',
            `/api/conversations/${encodeURIComponent(conversationId)}`
          );
          const messages = await getConversationMessages(page, conversationId);
          return conversation.status === 'finished' ? messages.length : 0;
        },
        { timeout: 60_000 }
      )
      .toBeGreaterThanOrEqual(2);
    const history = await getConversationMessages(page, conversationId);
    expect(history.length).toBeGreaterThanOrEqual(2);
    const historyIds = history.map((message) => String(message.id));

    await backendJson(page, 'PATCH', `/api/conversations/${encodeURIComponent(conversationId)}`, {
      extra: { studio_director_rules_profile: 'studio-director-rules-v1:stale-bug163-probe' },
    });
    const stale = await backendJson<JsonObject>(
      page,
      'GET',
      `/api/conversations/${encodeURIComponent(conversationId)}`
    );
    expect(jsonObject(stale.extra, 'stale conversation extra').studio_director_rules_profile).not.toBe(
      DIRECTOR_PRESET_RULES_PROFILE
    );

    const preRestartBackendPort = await page.evaluate(
      () => (window as unknown as { __backendPort: number }).__backendPort
    );
    const child = electronApp.process();
    const preRestartProcessPid = child.pid;
    stored = {
      conversationId,
      historyIds,
      preRestartBackendPort,
      preRestartProcessPid,
      projectId,
      userDataDirectory,
    };
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await exited;
    releaseCreate?.();
  });

  test('reuses the exact conversation after restart and accepts a new turn', async ({ electronApp, page }) => {
    const state = requireStored();
    const postRestartBackendPort = await page.evaluate(
      () => (window as unknown as { __backendPort: number }).__backendPort
    );
    expect(electronApp.process().pid).not.toBe(state.preRestartProcessPid);
    await navigateTo(page, `#/studio/${encodeURIComponent(state.projectId)}`);

    await expect(
      page.getByText('Director setup was interrupted before the conversation could be attached to this project.')
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();

    const director = page.locator('[data-studio-director-rail]');
    const input = director.getByTestId('sendbox-input');
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await readProject(state)).briefConversationId, { timeout: 30_000 })
      .toBe(state.conversationId);

    const recovered = await backendJson<JsonObject>(
      page,
      'GET',
      `/api/conversations/${encodeURIComponent(state.conversationId)}`
    );
    expect(jsonObject(recovered.extra, 'recovered conversation extra').studio_director_rules_profile).toBe(
      DIRECTOR_PRESET_RULES_PROFILE
    );
    const retained = await getConversationMessages(page, state.conversationId);
    expect(state.historyIds.every((id) => retained.some((message) => String(message.id) === id))).toBe(true);

    const beforeTurnCount = retained.length;
    await input.fill('BUG163 post-restart turn sentinel');
    await director.getByTestId('sendbox-send-btn').click();
    await expect.poll(() => providerTurnCount, { timeout: 60_000 }).toBe(2);
    await expect
      .poll(
        async () => {
          const conversation = await backendJson<JsonObject>(
            page,
            'GET',
            `/api/conversations/${encodeURIComponent(state.conversationId)}`
          );
          const messages = await getConversationMessages(page, state.conversationId);
          return conversation.status === 'finished' ? messages.length : 0;
        },
        { timeout: 60_000 }
      )
      .toBeGreaterThan(beforeTurnCount);

    const conversations = await backendJson<JsonObject>(page, 'GET', '/api/conversations?limit=10000');
    const items = Array.isArray(conversations.items) ? conversations.items : [];
    expect(
      items.filter(
        (candidate) =>
          typeof candidate === 'object' &&
          candidate !== null &&
          jsonObject((candidate as JsonObject).extra, 'catalogue conversation extra').studio_project_id ===
            state.projectId
      )
    ).toHaveLength(1);
    expect(providerTurnCount).toBe(2);

    console.log(
      `BUG163_EVIDENCE ${JSON.stringify({
        conversationId: state.conversationId,
        postRestartBackendPort,
        postRestartProcessPid: electronApp.process().pid,
        preRestartBackendPort: state.preRestartBackendPort,
        preRestartProcessPid: state.preRestartProcessPid,
        historyCountBeforeRestart: state.historyIds.length,
        historyCountAfterNewTurn: (await getConversationMessages(page, state.conversationId)).length,
        profile: DIRECTOR_PRESET_RULES_PROFILE,
        projectId: state.projectId,
        providerTurnCount,
        userDataDirectory: state.userDataDirectory,
      })}`
    );
  });
});
