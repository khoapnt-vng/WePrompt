import { z } from 'zod';
import type { IProvider } from '@/common/config/storage';
import type { AppOperationResult, AppOperationsModelResponse } from '@/common/types/appOperations';
import { AppOperationsBroker } from '@/process/services/app-operations/broker';
import { createTaskRegistry } from '@/process/services/app-operations/taskRegistry';
import type {
  AppOperationTaskDefinition,
  AppOperationsAuditEvent,
  AppOperationsBrokerDependencies,
  AppOperationsClient,
  AppOperationsCompletion,
} from '@/process/services/app-operations/types';

type EchoInput = { value: string };

// The broker arms a REAL setTimeout for a task's deadline (broker.ts:424) and races it
// against the provider request, so it is wall-clock time and the injected `now` does not
// govern it. Most tests here hold a request pending across two or more `vi.waitFor`
// polls — 50ms each by default — while asserting on the operation still in flight. At
// the previous value of 100ms that left a margin of about two polls, so under load the
// broker gave up mid-choreography and the operation resolved as provider_timeout
// instead of the expected success. That is what made this file intermittent (BUG-046).
//
// 30s sits above vitest's own `testTimeout` of 10s, so this deadline can no longer be
// reached inside a passing test: anything that genuinely hangs now fails on the test
// timeout, loudly and at a stable place, rather than silently changing an operation's
// result. Raising a `vi.waitFor` budget instead would have made this WORSE — more
// elapsed wall-clock before a test resolves its deferred is exactly what blows the
// deadline.
//
// Tests that assert deadline behaviour override it; see 'normalizes broker deadline
// expiration as provider_timeout', which passes `timeoutMs: 5`.
const TASK_TIMEOUT_MS = 30_000;

const provider: IProvider = {
  id: 'provider-a',
  platform: 'openai',
  name: 'Provider A',
  base_url: 'https://provider.example/v1',
  api_key: 'sk-secret-key',
  models: ['model-a'],
};

const readyResolution: AppOperationsModelResponse = {
  setting: { mode: 'fixed', provider_id: 'provider-a', model_id: 'model-a' },
  resolved_model: { provider_id: 'provider-a', model_id: 'model-a' },
  health: 'ready',
};

const completion = (content = 'model output'): AppOperationsCompletion => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 11, completion_tokens: 7 },
});

const echoTask = (
  overrides: Partial<AppOperationTaskDefinition<EchoInput, EchoInput, string>> = {}
): AppOperationTaskDefinition<EchoInput, EchoInput, string> => ({
  id: 'test.echo',
  promptVersion: '1',
  inputSchema: z.object({ value: z.string().min(1) }),
  prepare: async (input) => input,
  buildMessages: (prepared) => [{ role: 'user', content: prepared.value }],
  parseOutput: (raw) => {
    if (!raw.trim()) throw new Error('empty output');
    return raw.trim();
  },
  responseMode: 'text',
  temperature: 0.2,
  maxOutputTokens: 100,
  timeoutMs: TASK_TIMEOUT_MS,
  maxTransientRetries: 0,
  ...overrides,
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createHarness = (
  options: {
    task?: AppOperationTaskDefinition<EchoInput, EchoInput, string>;
    dependencies?: Partial<AppOperationsBrokerDependencies>;
    concurrency?: number;
    maxQueue?: number;
  } = {}
) => {
  const registry = createTaskRegistry();
  registry.register(options.task ?? echoTask());
  const createChatCompletion = vi.fn(async () => completion());
  const client: AppOperationsClient = { createChatCompletion };
  const audits: AppOperationsAuditEvent[] = [];
  const dependencies: AppOperationsBrokerDependencies = {
    resolveModel: vi.fn(async () => readyResolution),
    listProviders: vi.fn(async () => [provider]),
    createClient: vi.fn(async () => client),
    sleep: vi.fn(async () => undefined),
    now: vi.fn(() => 1_000),
    jitter: vi.fn(() => 0),
    emitAudit: vi.fn((event) => audits.push(event)),
    ...options.dependencies,
  };
  const broker = new AppOperationsBroker(registry, {
    concurrency: options.concurrency,
    maxQueue: options.maxQueue,
    dependencies,
  });
  return { broker, registry, dependencies, createChatCompletion, audits };
};

const expectFailureCode = <Output>(result: AppOperationResult<Output>, code: string): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
};

describe('app operations broker validation and resolution', () => {
  it('rejects invalid input before resolving a model', async () => {
    const { broker, dependencies } = createHarness();

    const result = await broker.runTask('test.echo', { value: '' });

    expectFailureCode(result, 'invalid_input');
    expect(dependencies.resolveModel).not.toHaveBeenCalled();
  });

  it('normalizes a runtime unknown task id before resolving a model', async () => {
    const { broker, dependencies } = createHarness();

    const result = await broker.runTask('missing', { value: 'hello' });

    expectFailureCode(result, 'invalid_input');
    expect(result.operation.prompt_version).toBe('unknown');
    expect(dependencies.resolveModel).not.toHaveBeenCalled();
  });

  it.each([404, 501])('returns not_configured when model resolution responds with %s', async (status) => {
    const { broker, dependencies } = createHarness({
      dependencies: { resolveModel: vi.fn(async () => Promise.reject({ status })) },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expectFailureCode(result, 'not_configured');
    expect(dependencies.listProviders).not.toHaveBeenCalled();
  });

  it('returns not_configured when backend setup is required', async () => {
    const { broker, dependencies } = createHarness({
      dependencies: {
        resolveModel: vi.fn(async () => ({ setting: { mode: 'auto' }, health: 'setup_required' })),
      },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expectFailureCode(result, 'not_configured');
    expect(dependencies.listProviders).not.toHaveBeenCalled();
  });

  it('returns model_unavailable for an unavailable fixed selection', async () => {
    const { broker, dependencies } = createHarness({
      dependencies: {
        resolveModel: vi.fn(async () => ({
          setting: { mode: 'fixed', provider_id: 'provider-a', model_id: 'model-a' },
          resolved_model: { provider_id: 'provider-a', model_id: 'model-a' },
          health: 'unavailable',
        })),
      },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expectFailureCode(result, 'model_unavailable');
    expect(dependencies.listProviders).not.toHaveBeenCalled();
  });

  it('requires the exact resolved provider and model', async () => {
    const { broker, dependencies } = createHarness({
      dependencies: {
        listProviders: vi.fn(async () => [{ ...provider, id: 'provider-b' }]),
      },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expectFailureCode(result, 'model_unavailable');
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });
});

describe('app operations broker provider execution', () => {
  it('captures one provider and model for every broker-owned retry', async () => {
    const prepare = vi.fn(async (input: EchoInput) => input);
    const buildMessages = vi.fn((prepared: EchoInput) => [{ role: 'user' as const, content: prepared.value }]);
    const request = vi
      .fn<AppOperationsClient['createChatCompletion']>()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce(completion('done'));
    const task = echoTask({ prepare, buildMessages, maxTransientRetries: 2 });
    const { broker, dependencies } = createHarness({
      task,
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expect(result).toMatchObject({ ok: true, output: 'done', operation: { attempts: 3 } });
    expect(dependencies.resolveModel).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(buildMessages).toHaveBeenCalledTimes(1);
    expect(dependencies.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider-a', use_model: 'model-a' }),
      { timeout: TASK_TIMEOUT_MS, rotatingOptions: { maxRetries: 1, retryDelay: 0 } }
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map(([params]) => params.model)).toEqual(['model-a', 'model-a', 'model-a']);
    expect(dependencies.sleep).toHaveBeenNthCalledWith(1, 500);
    expect(dependencies.sleep).toHaveBeenNthCalledWith(2, 1_000);
  });

  it.each([
    ['provider timeout', Object.assign(new Error('timeout'), { name: 'AbortError' })],
    ['rate limit', { status: 429 }],
    ['transient request failure', { status: 503 }],
  ])('retries %s', async (_label, firstError) => {
    const request = vi
      .fn<AppOperationsClient['createChatCompletion']>()
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce(completion('recovered'));
    const { broker } = createHarness({
      task: echoTask({ maxTransientRetries: 1 }),
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expect(result).toMatchObject({ ok: true, output: 'recovered', operation: { attempts: 2 } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not retry authentication failures', async () => {
    const request = vi.fn<AppOperationsClient['createChatCompletion']>().mockRejectedValue({ status: 401 });
    const { broker } = createHarness({
      task: echoTask({ maxTransientRetries: 2 }),
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expectFailureCode(result, 'provider_auth_failed');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('marks a non-transient provider request failure as not retryable', async () => {
    const request = vi
      .fn<AppOperationsClient['createChatCompletion']>()
      .mockRejectedValue(Object.assign(new Error('private bad request detail'), { status: 400 }));
    const { broker } = createHarness({
      task: echoTask({ maxTransientRetries: 2 }),
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'provider_request_failed', retryable: false },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private bad request detail');
  });

  it('marks an exhausted transient provider request failure as retryable', async () => {
    const request = vi.fn<AppOperationsClient['createChatCompletion']>().mockRejectedValue({ status: 503 });
    const { broker } = createHarness({
      task: echoTask({ maxTransientRetries: 1 }),
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'provider_request_failed', retryable: true },
      operation: { attempts: 2 },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('accepts validated text output and maps token usage', async () => {
    const { broker } = createHarness();

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expect(result).toMatchObject({
      ok: true,
      output: 'model output',
      operation: { usage: { input_tokens: 11, output_tokens: 7 } },
    });
  });

  it('accepts validated JSON output and requests JSON response mode', async () => {
    const schema = z.object({ answer: z.string() });
    const jsonTask: AppOperationTaskDefinition<EchoInput, EchoInput, { answer: string }> = {
      ...echoTask(),
      id: 'test.json',
      responseMode: 'json',
      parseOutput: (raw) => schema.parse(JSON.parse(raw)),
    };
    const registry = createTaskRegistry();
    registry.register(jsonTask);
    const request = vi.fn(async () => completion('{"answer":"yes"}'));
    const dependencies: Partial<AppOperationsBrokerDependencies> = {
      resolveModel: vi.fn(async () => readyResolution),
      listProviders: vi.fn(async () => [provider]),
      createClient: vi.fn(async () => ({ createChatCompletion: request })),
      now: vi.fn(() => 1_000),
    };
    const broker = new AppOperationsBroker(registry, { dependencies });

    const result = await broker.runTask('test.json', { value: 'hello' });

    expect(result).toMatchObject({ ok: true, output: { answer: 'yes' } });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ response_format: { type: 'json_object' } }), {
      signal: expect.any(AbortSignal),
      timeout: TASK_TIMEOUT_MS,
    });
  });

  it('rejects invalid output without retrying or exposing the parser error', async () => {
    const request = vi.fn(async () => completion('not-json'));
    const { broker } = createHarness({
      task: echoTask({
        responseMode: 'json',
        maxTransientRetries: 2,
        parseOutput: () => {
          throw new Error('secret parser detail');
        },
      }),
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expectFailureCode(result, 'invalid_output');
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('secret parser detail');
  });
});

describe('app operations broker queue and deduplication', () => {
  it('runs at most two operations and rejects the fifty-first waiting operation', async () => {
    const gate = deferred<AppOperationsCompletion>();
    let active = 0;
    let maxActive = 0;
    const request = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await gate.promise;
      } finally {
        active -= 1;
      }
    });
    const { broker } = createHarness({
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const admitted = Array.from({ length: 52 }, (_, index) =>
      broker.runTask('test.echo', { value: `operation-${index}` })
    );
    const overflow = await broker.runTask('test.echo', { value: 'overflow' });

    expectFailureCode(overflow, 'queue_full');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(maxActive).toBe(2);
    gate.resolve(completion('done'));
    await Promise.all(admitted);
    expect(request).toHaveBeenCalledTimes(52);
  });

  it('coalesces equal task and dedupe keys into one provider request', async () => {
    const gate = deferred<AppOperationsCompletion>();
    const request = vi.fn(() => gate.promise);
    const { broker, dependencies } = createHarness({
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const first = broker.runTask('test.echo', { value: 'hello' }, { dedupeKey: 'same' });
    const joined = broker.runTask('test.echo', { value: 'hello' }, { dedupeKey: 'same' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    gate.resolve(completion('shared'));

    expect(await first).toMatchObject({ ok: true, operation: { deduplicated: false } });
    expect(await joined).toMatchObject({ ok: true, operation: { deduplicated: true } });
    expect(dependencies.resolveModel).toHaveBeenCalledTimes(1);
  });

  it('attaches to existing work before checking queue capacity', async () => {
    const gates = [deferred<AppOperationsCompletion>(), deferred<AppOperationsCompletion>()];
    const request = vi.fn(() => gates[request.mock.calls.length - 1]?.promise ?? Promise.resolve(completion()));
    const { broker } = createHarness({
      concurrency: 1,
      maxQueue: 1,
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const running = broker.runTask('test.echo', { value: 'running' });
    const queued = broker.runTask('test.echo', { value: 'queued' }, { dedupeKey: 'queued-key' });
    const joined = broker.runTask('test.echo', { value: 'queued' }, { dedupeKey: 'queued-key' });

    gates[0].resolve(completion('running done'));
    await running;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    gates[1].resolve(completion('queued done'));
    expect(await queued).toMatchObject({ ok: true, operation: { deduplicated: false } });
    expect(await joined).toMatchObject({ ok: true, operation: { deduplicated: true } });
  });

  it('starts fresh same-key work immediately after the last running joiner cancels', async () => {
    const abandoned = deferred<AppOperationsCompletion>();
    const request = vi
      .fn<AppOperationsClient['createChatCompletion']>()
      .mockImplementationOnce(() => abandoned.promise)
      .mockResolvedValueOnce(completion('fresh result'));
    const controller = new AbortController();
    const { broker } = createHarness({
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const canceled = broker.runTask(
      'test.echo',
      { value: 'abandoned' },
      { signal: controller.signal, dedupeKey: 'same' }
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    controller.abort();
    expectFailureCode(await canceled, 'canceled');

    const fresh = broker.runTask('test.echo', { value: 'fresh' }, { dedupeKey: 'same' });

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(await fresh).toMatchObject({ ok: true, output: 'fresh result', operation: { deduplicated: false } });
    abandoned.reject(Object.assign(new Error('abandoned'), { name: 'AbortError' }));
  });

  it('does not let stale finalization remove a newer same-key operation', async () => {
    const abandoned = deferred<AppOperationsCompletion>();
    const current = deferred<AppOperationsCompletion>();
    const request = vi
      .fn<AppOperationsClient['createChatCompletion']>()
      .mockImplementationOnce(() => abandoned.promise)
      .mockImplementationOnce(() => current.promise);
    const controller = new AbortController();
    const { broker, audits } = createHarness({
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const canceled = broker.runTask(
      'test.echo',
      { value: 'abandoned' },
      { signal: controller.signal, dedupeKey: 'same' }
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    controller.abort();
    expectFailureCode(await canceled, 'canceled');
    const currentResult = broker.runTask('test.echo', { value: 'current' }, { dedupeKey: 'same' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    abandoned.reject(Object.assign(new Error('abandoned'), { name: 'AbortError' }));
    await vi.waitFor(() => expect(audits).toContainEqual(expect.objectContaining({ error_code: 'canceled' })));
    const joined = broker.runTask('test.echo', { value: 'current' }, { dedupeKey: 'same' });
    current.resolve(completion('current result'));

    expect(await currentResult).toMatchObject({ ok: true, operation: { deduplicated: false } });
    expect(await joined).toMatchObject({ ok: true, operation: { deduplicated: true } });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('app operations broker cancellation', () => {
  it('detaches one canceled joiner without aborting the shared request', async () => {
    const gate = deferred<AppOperationsCompletion>();
    let providerSignal: AbortSignal | undefined;
    const request = vi.fn((_params, options) => {
      providerSignal = options?.signal;
      return gate.promise;
    });
    const firstController = new AbortController();
    const joinedController = new AbortController();
    const { broker } = createHarness({
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const first = broker.runTask(
      'test.echo',
      { value: 'hello' },
      { signal: firstController.signal, dedupeKey: 'same' }
    );
    const joined = broker.runTask(
      'test.echo',
      { value: 'hello' },
      { signal: joinedController.signal, dedupeKey: 'same' }
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    firstController.abort();

    expectFailureCode(await first, 'canceled');
    expect(providerSignal?.aborted).toBe(false);
    gate.resolve(completion('shared'));
    expect(await joined).toMatchObject({ ok: true, output: 'shared' });
  });

  it('aborts the shared provider request after every joiner cancels', async () => {
    let providerSignal: AbortSignal | undefined;
    const request = vi.fn((_params, options) => {
      providerSignal = options?.signal;
      return new Promise<AppOperationsCompletion>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    const firstController = new AbortController();
    const joinedController = new AbortController();
    const { broker } = createHarness({
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const first = broker.runTask(
      'test.echo',
      { value: 'hello' },
      { signal: firstController.signal, dedupeKey: 'same' }
    );
    const joined = broker.runTask(
      'test.echo',
      { value: 'hello' },
      { signal: joinedController.signal, dedupeKey: 'same' }
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    firstController.abort();
    joinedController.abort();

    expectFailureCode(await first, 'canceled');
    expectFailureCode(await joined, 'canceled');
    expect(providerSignal?.aborted).toBe(true);
  });

  it('cancels queued work before model resolution or client creation', async () => {
    const gate = deferred<AppOperationsCompletion>();
    const request = vi.fn(() => gate.promise);
    const queuedController = new AbortController();
    const { broker, dependencies } = createHarness({
      concurrency: 1,
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const running = broker.runTask('test.echo', { value: 'running' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const queued = broker.runTask('test.echo', { value: 'queued' }, { signal: queuedController.signal });
    queuedController.abort();

    expectFailureCode(await queued, 'canceled');
    expect(dependencies.resolveModel).toHaveBeenCalledTimes(1);
    expect(dependencies.createClient).toHaveBeenCalledTimes(1);
    gate.resolve(completion('done'));
    await running;
  });

  it('normalizes caller cancellation as canceled instead of provider_timeout', async () => {
    const controller = new AbortController();
    const request = vi.fn(
      (_params, options) =>
        new Promise<AppOperationsCompletion>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
        })
    );
    const { broker } = createHarness({
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const resultPromise = broker.runTask('test.echo', { value: 'hello' }, { signal: controller.signal });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    controller.abort();

    expectFailureCode(await resultPromise, 'canceled');
  });

  it('normalizes broker deadline expiration as provider_timeout', async () => {
    const request = vi.fn(
      (_params, options) =>
        new Promise<AppOperationsCompletion>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('deadline'), { name: 'AbortError' }))
          );
        })
    );
    const { broker } = createHarness({
      task: echoTask({ timeoutMs: 5 }),
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    const result = await broker.runTask('test.echo', { value: 'hello' });

    expectFailureCode(result, 'provider_timeout');
  });

  it('cancelAll cancels queued and running operations', async () => {
    const request = vi.fn(
      (_params, options) =>
        new Promise<AppOperationsCompletion>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
        })
    );
    const { broker } = createHarness({
      concurrency: 1,
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });
    const running = broker.runTask('test.echo', { value: 'running' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const queued = broker.runTask('test.echo', { value: 'queued' });

    broker.cancelAll();

    expectFailureCode(await running, 'canceled');
    expectFailureCode(await queued, 'canceled');
  });

  it('keeps cancelAll authoritative when model resolution later rejects', async () => {
    const resolution = deferred<AppOperationsModelResponse>();
    const { broker, dependencies } = createHarness({
      dependencies: { resolveModel: vi.fn(() => resolution.promise) },
    });
    const running = broker.runTask('test.echo', { value: 'hello' });
    await vi.waitFor(() => expect(dependencies.resolveModel).toHaveBeenCalledTimes(1));

    broker.cancelAll();
    resolution.reject({ status: 404 });

    expectFailureCode(await running, 'canceled');
    expect(dependencies.listProviders).not.toHaveBeenCalled();
  });

  it('keeps cancelAll authoritative when provider listing later rejects', async () => {
    const providers = deferred<IProvider[]>();
    const { broker, dependencies } = createHarness({
      dependencies: { listProviders: vi.fn(() => providers.promise) },
    });
    const running = broker.runTask('test.echo', { value: 'hello' });
    await vi.waitFor(() => expect(dependencies.listProviders).toHaveBeenCalledTimes(1));

    broker.cancelAll();
    providers.reject({ status: 500 });

    expectFailureCode(await running, 'canceled');
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });

  it('promptly cancels never-settling client creation and releases the slot', async () => {
    const clientCreation = deferred<AppOperationsClient>();
    const createClient = vi
      .fn<AppOperationsBrokerDependencies['createClient']>()
      .mockImplementationOnce(() => clientCreation.promise)
      .mockResolvedValue({ createChatCompletion: vi.fn(async () => completion('fresh result')) });
    const { broker } = createHarness({ concurrency: 1, dependencies: { createClient } });

    const running = broker.runTask('test.echo', { value: 'running' });
    await vi.waitFor(() => expect(createClient).toHaveBeenCalledOnce());

    broker.cancelAll();
    const fresh = broker.runTask('test.echo', { value: 'fresh' });
    let runningResult: AppOperationResult<string> | undefined;
    let freshResult: AppOperationResult<string> | undefined;
    void running.then((result) => {
      runningResult = result;
    });
    void fresh.then((result) => {
      freshResult = result;
    });

    await vi.waitFor(
      () => {
        expect(runningResult).toBeDefined();
        expect(freshResult).toBeDefined();
      },
      { timeout: 1_000 }
    );
    expectFailureCode(runningResult!, 'canceled');
    expect(freshResult).toMatchObject({ ok: true, output: 'fresh result' });
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it.each(['model resolution', 'provider listing', 'task preparation'] as const)(
    'promptly cancels never-settling %s, releases the slot, and ignores late completion',
    async (stage) => {
      const modelResolution = deferred<AppOperationsModelResponse>();
      const providers = deferred<IProvider[]>();
      const preparation = deferred<EchoInput>();
      const resolveModel =
        stage === 'model resolution'
          ? vi
              .fn<AppOperationsBrokerDependencies['resolveModel']>()
              .mockImplementationOnce(() => modelResolution.promise)
              .mockResolvedValue(readyResolution)
          : vi.fn<AppOperationsBrokerDependencies['resolveModel']>(async () => readyResolution);
      const listProviders =
        stage === 'provider listing'
          ? vi
              .fn<AppOperationsBrokerDependencies['listProviders']>()
              .mockImplementationOnce(() => providers.promise)
              .mockResolvedValue([provider])
          : vi.fn<AppOperationsBrokerDependencies['listProviders']>(async () => [provider]);
      const prepare =
        stage === 'task preparation'
          ? vi
              .fn<AppOperationTaskDefinition<EchoInput, EchoInput, string>['prepare']>()
              .mockImplementationOnce(() => preparation.promise)
              .mockImplementation(async (input) => input)
          : vi.fn<AppOperationTaskDefinition<EchoInput, EchoInput, string>['prepare']>(async (input) => input);
      const enteredStage = {
        'model resolution': resolveModel,
        'provider listing': listProviders,
        'task preparation': prepare,
      }[stage];
      const { broker, audits } = createHarness({
        concurrency: 1,
        task: echoTask({ prepare }),
        dependencies: { resolveModel, listProviders },
      });

      const running = broker.runTask('test.echo', { value: 'running' }, { dedupeKey: 'shared-cancellation' });
      const joined = broker.runTask('test.echo', { value: 'running' }, { dedupeKey: 'shared-cancellation' });
      await vi.waitFor(() => expect(enteredStage).toHaveBeenCalledOnce());

      broker.cancelAll();
      const fresh = broker.runTask('test.echo', { value: 'fresh' }, { dedupeKey: 'shared-cancellation' });
      let runningResult: AppOperationResult<string> | undefined;
      let joinedResult: AppOperationResult<string> | undefined;
      void running.then((result) => {
        runningResult = result;
      });
      void joined.then((result) => {
        joinedResult = result;
      });

      await vi.waitFor(
        () => {
          expect(runningResult).toBeDefined();
          expect(joinedResult).toBeDefined();
        },
        { timeout: 1_000 }
      );
      expectFailureCode(runningResult!, 'canceled');
      expectFailureCode(joinedResult!, 'canceled');
      expect(await fresh).toMatchObject({ ok: true, output: 'model output' });
      expect(audits).toHaveLength(2);

      if (stage === 'model resolution') modelResolution.resolve(readyResolution);
      if (stage === 'provider listing') providers.resolve([provider]);
      if (stage === 'task preparation') preparation.resolve({ value: 'late' });
      await Promise.resolve();
      await Promise.resolve();

      expect(audits).toHaveLength(2);
    }
  );
});

describe('app operations broker audit privacy', () => {
  it('emits metadata without input, messages, output, credentials, url, or raw error', async () => {
    const rawError = 'raw-provider-secret';
    const request = vi
      .fn<AppOperationsClient['createChatCompletion']>()
      .mockResolvedValueOnce(completion('private-model-output'))
      .mockRejectedValueOnce(Object.assign(new Error(rawError), { status: 401 }));
    const { broker, audits } = createHarness({
      dependencies: { createClient: vi.fn(async () => ({ createChatCompletion: request })) },
    });

    await broker.runTask('test.echo', { value: 'private-conversation-input' });
    await broker.runTask('test.echo', { value: 'second-private-input' });

    const serialized = JSON.stringify(audits);
    expect(audits).toHaveLength(2);
    for (const secret of [
      'private-conversation-input',
      'second-private-input',
      'private-model-output',
      'sk-secret-key',
      'https://provider.example/v1',
      rawError,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(audits).toEqual([
      expect.objectContaining({ status: 'succeeded', task_id: 'test.echo', attempts: 1 }),
      expect.objectContaining({ status: 'failed', error_code: 'provider_auth_failed', attempts: 1 }),
    ]);
  });
});
