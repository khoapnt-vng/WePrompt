/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IProvider, ISessionMcpServer, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { StudioRendererProjectV2 } from '@/common/types/project/creativeStudioTypes';

const harness = vi.hoisted(() => ({
  conversations: [] as TChatConversation[],
  hasLoaded: true,
  providersResolved: true,
  currentModel: undefined as TProviderWithModel | undefined,
  modelList: [] as IProvider[],
  chatMounts: 0,
  chatUnmounts: 0,
  renderedChatConversation: undefined as TChatConversation | undefined,
  uuid: vi.fn(),
  descriptor: vi.fn(),
  authority: vi.fn(),
  create: vi.fn(),
  listConversations: vi.fn(),
  bind: vi.fn(),
  getProject: vi.fn(),
  update: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: {
      getBriefSessionServer: { invoke: harness.descriptor },
      getDirectorSessionAuthority: { invoke: harness.authority },
      bindDirectorConversation: { invoke: harness.bind },
      getProject: { invoke: harness.getProject },
    },
    conversation: {
      create: { invoke: harness.create },
      update: { invoke: harness.update },
      sendMessage: { invoke: harness.send },
    },
    database: {
      getUserConversations: { invoke: harness.listConversations },
    },
  },
}));

vi.mock('@/common/utils', () => ({ uuid: harness.uuid }));

vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    allConversations: harness.conversations,
    conversations: [],
    hasLoadedConversations: harness.hasLoaded,
  }),
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => ({ current_model: harness.currentModel, modelList: harness.modelList }),
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => (harness.providersResolved ? { data: harness.modelList } : {}),
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection', () => ({
  useAionrsModelSelection: ({ initialModel }: { initialModel?: TProviderWithModel }) => ({
    current_model: initialModel,
    providers: [],
    getAvailableModels: () => [],
    handleSelectModel: vi.fn(),
    getDisplayModelName: () => '',
  }),
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsChat', () => ({
  default: ({ conversation_id, conversation }: { conversation_id: string; conversation: TChatConversation }) => {
    harness.renderedChatConversation = conversation;
    const [draft, setDraft] = React.useState('');
    React.useEffect(() => {
      harness.chatMounts += 1;
      return () => {
        harness.chatUnmounts += 1;
      };
    }, []);
    return (
      <label>
        Director composer
        <input
          aria-label='Director composer'
          data-conversation-id={conversation_id}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      </label>
    );
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    icon,
    onClick,
    type: _type,
    shape: _shape,
    ...props
  }: React.PropsWithChildren<{
    icon?: React.ReactNode;
    onClick?: (event: Event) => void;
    type?: string;
    shape?: string;
  }> &
    React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' {...props} onClick={(event) => onClick?.(event.nativeEvent)}>
      {icon}
      {children}
    </button>
  ),
  Spin: () => <span data-testid='spin' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => {
    const english: Record<string, string> = {
      'conversation.creativeStudio.workspace.director.title': 'Creative Director',
      'conversation.creativeStudio.workspace.director.show': 'Show the Creative Director',
      'conversation.creativeStudio.workspace.director.hide': 'Hide the Creative Director',
      'conversation.creativeStudio.workspace.director.starting': 'Starting the Creative Director…',
      'conversation.creativeStudio.workspace.director.retry': 'Retry',
      'conversation.creativeStudio.workspace.director.startFresh': 'Start fresh',
      'conversation.creativeStudio.workspace.director.danglingNotice':
        "This project's Director conversation is no longer available.",
      'conversation.creativeStudio.workspace.director.interruptedNotice':
        'Director setup was interrupted before the conversation could be attached to this project.',
      'conversation.creativeStudio.workspace.director.ownerConflict':
        'Creative Studio found conflicting Director conversation data and will not choose one automatically.',
      'conversation.creativeStudio.workspace.director.sessionVerificationFailed':
        'Creative Studio could not verify the Director session configuration.',
      'conversation.creativeStudio.workspace.director.attachInterrupted':
        'Creative Studio could not complete the Director attachment. Retry to recover it safely.',
      'conversation.creativeStudio.workspace.director.noModelConfigured':
        'Configure a text model before starting the Creative Director.',
      'conversation.creativeStudio.workspace.errors.storage': 'Creative Studio could not read or save this workspace.',
      'conversation.creativeStudio.workspace.errors.staleProject':
        'The project changed elsewhere. Review the current Director before retrying.',
    };
    return { t: (key: string) => english[key] ?? key };
  },
}));

import {
  DirectorRail,
  forgetDirectorConversationStart,
  hasExactDirectorAuthoritySnapshot,
  hasExactDirectorMcpSnapshot,
  hasSafeRouteCatalog,
} from '@/renderer/pages/studio/components/Workspace/DirectorRail';

const provider = {
  id: 'provider_1',
  name: 'Provider',
  platform: 'openai',
  base_url: 'https://example.invalid',
  api_key: 'key',
  models: ['model_1'],
} as IProvider;

const model = { ...provider, use_model: 'model_1' } as TProviderWithModel;

const descriptor: ISessionMcpServer = {
  id: 'studio-brief-project_1',
  name: 'aionui-creative-studio',
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['/repo/out/main/builtin-mcp-studio.js'],
    env: {
      AIONUI_STUDIO_PROJECT_ID: 'project_1',
      AIONUI_STUDIO_PROJECT_DIR: '/tmp/studio/project_1',
      AIONUI_STUDIO_PENDING_DIR: '/tmp/studio/project_1/proposals/pending',
      AIONUI_STUDIO_REFERENCE_PENDING_DIR: '/tmp/studio/project_1/reference-requests/pending',
      AIONUI_STUDIO_ROUTE_CATALOG: JSON.stringify({
        image: {
          status: 'setup_required',
          selected: null,
          selectedRoute: null,
          selectionIssue: null,
          options: [],
        },
        video: {
          status: 'setup_required',
          selected: null,
          selectedRoute: null,
          selectionIssue: null,
          options: [],
        },
        catalogVersion: '0123456789abcdef',
      }),
    },
  },
};

const authority = {
  serverId: descriptor.id,
  serverName: descriptor.name,
  scriptPath: '/repo/out/main/builtin-mcp-studio.js',
  projectDir: '/tmp/studio/project_1',
  pendingDir: '/tmp/studio/project_1/proposals/pending',
  referencePendingDir: '/tmp/studio/project_1/reference-requests/pending',
};

const route = (kind: 'image' | 'video', ordinal = 1) => ({
  choiceId: `choice_${ordinal.toString(16).padStart(24, '0')}`,
  providerId: `provider_${ordinal}`,
  providerName: `Provider ${ordinal}`,
  model: `model_${ordinal}`,
  integrationLabelKey: kind === 'image' ? 'imageApi' : 'openRouterVideo',
  health: 'available',
  kind,
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['1080p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    maxConditioningImages: kind === 'image' ? 1 : 0,
    silentOutput: true,
  },
});

const project = (overrides: Partial<StudioRendererProjectV2> = {}): StudioRendererProjectV2 => ({
  schemaVersion: 2,
  revision: 3,
  id: 'project_1',
  name: 'Launch film',
  brief: 'A small launch film.',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '720p',
  beatOrder: [],
  beats: {},
  shots: {},
  bin: [],
  bedAssetId: null,
  matchToShotId: null,
  spendPolicy: null,
  imageRouteId: null,
  videoRouteId: null,
  assets: {},
  jobs: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const exactConversation = (
  id = 'conversation_director',
  extra: Partial<Extract<TChatConversation, { type: 'aionrs' }>['extra']> = {}
): Extract<TChatConversation, { type: 'aionrs' }> =>
  ({
    id,
    name: 'Launch film',
    type: 'aionrs',
    model,
    created_at: 1,
    modified_at: 1,
    extra: {
      workspace: '',
      studio_project_id: 'project_1',
      mcp_server_ids: [],
      mcp_servers: [descriptor.name],
      mcp_statuses: [{ id: descriptor.id, name: descriptor.name, status: 'loaded' }],
      session_mcp_servers: [descriptor],
      ...extra,
    },
  }) as Extract<TChatConversation, { type: 'aionrs' }>;

const ok = <T,>(data: T) => ({ ok: true as const, data });
const failed = (messageKey = 'conversation.creativeStudio.workspace.errors.storage') => ({
  ok: false as const,
  error: { code: 'storage_error' as const, messageKey },
});
const commit = () => ok({ projectId: 'project_1', projectRevision: 4, createdBeatIds: [], createdShotIds: [] });

const supportedProject = (briefConversationId: string | null) =>
  ok({ status: 'supported' as const, project: project({ briefConversationId }) });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('DirectorRail', () => {
  beforeEach(() => {
    forgetDirectorConversationStart();
    vi.clearAllMocks();
    harness.conversations = [];
    harness.hasLoaded = true;
    harness.providersResolved = true;
    harness.currentModel = model;
    harness.modelList = [provider];
    harness.chatMounts = 0;
    harness.chatUnmounts = 0;
    harness.renderedChatConversation = undefined;
    harness.uuid
      .mockReset()
      .mockReturnValueOnce('conversation_director')
      .mockReturnValue('conversation_director_retry');
    harness.descriptor.mockReset().mockResolvedValue(ok(descriptor));
    harness.authority.mockReset().mockResolvedValue(ok(authority));
    harness.create
      .mockReset()
      .mockImplementation(async (input: { id?: string }) => exactConversation(input.id ?? 'conversation_director'));
    harness.listConversations.mockReset().mockResolvedValue({ items: [], total: 0, has_more: false });
    harness.bind.mockReset().mockResolvedValue(commit());
    harness.getProject.mockReset().mockResolvedValue(supportedProject(null));
    harness.update.mockReset().mockResolvedValue(true);
    harness.send.mockReset();
  });

  it('accepts a persisted session whose keys came back in a different order', () => {
    // The conversation store returns object keys alphabetically, while the freshly built descriptor
    // is in insertion order. Every value is identical; only the serialisation differs. Comparing the
    // two by JSON.stringify therefore rejects a session that matches exactly, which is what stopped
    // every new project from binding its Director.
    const sortKeys = (value: unknown): unknown =>
      value === null || typeof value !== 'object'
        ? value
        : Array.isArray(value)
          ? value.map(sortKeys)
          : Object.fromEntries(
              Object.keys(value as Record<string, unknown>)
                .sort()
                .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
            );

    const exact = exactConversation();
    const server = exact.extra.session_mcp_servers![0]!;
    const reordered = {
      ...exact,
      extra: { ...exact.extra, session_mcp_servers: [{ ...server, transport: sortKeys(server.transport) }] },
    } as TChatConversation;

    // Same data, different key order.
    expect(JSON.stringify(reordered.extra.session_mcp_servers![0]!.transport)).not.toBe(
      JSON.stringify(server.transport)
    );
    expect(hasExactDirectorMcpSnapshot(reordered, 'project_1', descriptor)).toBe(true);

    // Ignoring key order must not start ignoring the values themselves. A changed env value, an
    // added one, and an extra args entry are all still rejected.
    const withTransport = (transport: unknown): TChatConversation =>
      ({
        ...exact,
        extra: { ...exact.extra, session_mcp_servers: [{ ...server, transport }] },
      }) as TChatConversation;
    const base = server.transport as { args: string[]; env: Record<string, string> };

    expect(
      hasExactDirectorMcpSnapshot(
        withTransport({ ...base, env: { ...base.env, AIONUI_STUDIO_PROJECT_DIR: '/tmp/elsewhere' } }),
        'project_1',
        descriptor
      )
    ).toBe(false);
    expect(
      hasExactDirectorMcpSnapshot(
        withTransport({ ...base, env: { ...base.env, AIONUI_STUDIO_EXTRA: 'smuggled' } }),
        'project_1',
        descriptor
      )
    ).toBe(false);
    expect(
      hasExactDirectorMcpSnapshot(
        withTransport({ ...base, args: ['/repo/out/main/other-server.js', ...base.args] }),
        'project_1',
        descriptor
      )
    ).toBe(false);
  });

  it('accepts only a reciprocal Aionrs owner with the exact curated MCP snapshot', () => {
    const exact = exactConversation();
    expect(hasExactDirectorMcpSnapshot(exact, 'project_1', descriptor)).toBe(true);
    expect(hasExactDirectorMcpSnapshot(exact, 'project_2')).toBe(false);
    expect(hasExactDirectorMcpSnapshot({ ...exact, type: 'acp' } as TChatConversation, 'project_1')).toBe(false);
    expect(hasExactDirectorMcpSnapshot(exact, 'project_1', { ...descriptor, name: 'not-studio' })).toBe(false);
    expect(
      hasExactDirectorMcpSnapshot(
        exactConversation('conversation_director', { mcp_servers: [descriptor.name, descriptor.name] }),
        'project_1'
      )
    ).toBe(false);
    expect(
      hasExactDirectorMcpSnapshot(
        exactConversation('conversation_director', {
          session_mcp_servers: [{ ...descriptor, name: 'ambient-server' }],
        }),
        'project_1'
      )
    ).toBe(false);
    expect(
      hasExactDirectorMcpSnapshot(exact, 'project_1', {
        ...descriptor,
        transport: { type: 'stdio', command: 'node', args: ['/tmp/other.js'] },
      })
    ).toBe(false);
    expect(
      hasExactDirectorMcpSnapshot(
        exactConversation('conversation_hostile', {
          session_mcp_servers: [
            {
              ...descriptor,
              transport: {
                type: 'stdio',
                command: 'sh',
                args: ['/tmp/studio-server.js'],
                env: descriptor.transport.type === 'stdio' ? descriptor.transport.env : undefined,
              },
            },
          ],
        }),
        'project_1'
      )
    ).toBe(false);
    expect(
      hasExactDirectorMcpSnapshot(
        exactConversation('conversation_evil_script', {
          session_mcp_servers: [
            {
              ...descriptor,
              transport: {
                ...(descriptor.transport.type === 'stdio' ? descriptor.transport : {}),
                type: 'stdio',
                command: 'node',
                args: ['/tmp/evil.js'],
              },
            },
          ],
        }),
        'project_1'
      )
    ).toBe(false);
    const forgedAuthority = exactConversation('conversation_forged_authority', {
      session_mcp_servers: [
        {
          ...descriptor,
          transport: {
            ...(descriptor.transport.type === 'stdio' ? descriptor.transport : {}),
            type: 'stdio',
            command: 'node',
            args: ['/tmp/attacker/out/main/builtin-mcp-studio.js'],
            env: {
              ...(descriptor.transport.type === 'stdio' ? descriptor.transport.env : {}),
              AIONUI_STUDIO_PROJECT_DIR: '/tmp/attacker/project_1',
              AIONUI_STUDIO_PENDING_DIR: '/tmp/attacker/project_1/proposals/pending',
              AIONUI_STUDIO_REFERENCE_PENDING_DIR: '/tmp/attacker/project_1/reference-requests/pending',
            },
          },
        },
      ],
    });
    expect(hasExactDirectorMcpSnapshot(forgedAuthority, 'project_1')).toBe(true);
    expect(hasExactDirectorAuthoritySnapshot(forgedAuthority, 'project_1', authority)).toBe(false);
  });

  it('accepts only a bounded, coherent, deeply exact route catalog', () => {
    const imageRoute = route('image');
    const videoRoute = {
      ...route('video', 2),
      constraints: {
        ...route('video', 2).constraints,
        minDurationSeconds: 4,
        maxDurationSeconds: 8,
        supportedDurationSeconds: [4, 6, 8],
      },
    };
    const valid = {
      image: {
        status: 'ready',
        selected: {
          choiceId: imageRoute.choiceId,
          providerId: imageRoute.providerId,
          model: imageRoute.model,
        },
        selectedRoute: imageRoute,
        selectionIssue: null,
        options: [imageRoute],
      },
      video: {
        status: 'unavailable',
        selected: null,
        selectedRoute: null,
        selectionIssue: { code: 'frame', aspectRatio: '16:9', resolution: '1080p' },
        options: [videoRoute],
      },
      catalogVersion: '0123456789abcdef',
    };
    expect(hasSafeRouteCatalog(JSON.stringify(valid))).toBe(true);
    for (const supportedDurationSeconds of [
      [4, 8, 6],
      [4, 6, 6, 8],
      [3, 4, 6, 8],
      [4, 6],
    ]) {
      expect(
        hasSafeRouteCatalog(
          JSON.stringify({
            ...valid,
            video: {
              ...valid.video,
              options: [{ ...videoRoute, constraints: { ...videoRoute.constraints, supportedDurationSeconds } }],
            },
          })
        )
      ).toBe(false);
    }
    expect(
      hasSafeRouteCatalog(
        JSON.stringify({
          ...valid,
          video: {
            ...valid.video,
            selectedRoute: videoRoute,
            selected: {
              choiceId: videoRoute.choiceId,
              providerId: videoRoute.providerId,
              model: videoRoute.model,
            },
            status: 'ready',
            selectionIssue: null,
            options: [
              {
                ...videoRoute,
                constraints: { ...videoRoute.constraints, supportedDurationSeconds: [4, 8] },
              },
            ],
          },
        })
      )
    ).toBe(false);
    expect(
      hasSafeRouteCatalog(
        JSON.stringify({
          ...valid,
          image: {
            ...valid.image,
            selectedRoute: { ...imageRoute, constraints: { ...imageRoute.constraints, shell: true } },
          },
        })
      )
    ).toBe(false);
    expect(
      hasSafeRouteCatalog(
        JSON.stringify({
          ...valid,
          image: { ...valid.image, options: Array.from({ length: 257 }, (_, index) => route('image', index + 1)) },
        })
      )
    ).toBe(false);
    expect(
      hasSafeRouteCatalog(
        JSON.stringify({ ...valid, image: { ...valid.image, selectedRoute: { ...imageRoute, kind: 'video' } } })
      )
    ).toBe(false);
    expect(
      hasSafeRouteCatalog(
        JSON.stringify({ ...valid, image: { ...valid.image, selected: { ...valid.image.selected, model: 'other' } } })
      )
    ).toBe(false);
  });

  it('waits for history, then creates and binds one exact conversation without an initial message', async () => {
    harness.hasLoaded = false;
    const rendered = render(<DirectorRail project={project()} />);
    expect(harness.create).not.toHaveBeenCalled();

    harness.hasLoaded = true;
    rendered.rerender(<DirectorRail project={project({ revision: 7 })} />);
    await screen.findByRole('textbox', { name: 'Director composer' });

    expect(harness.descriptor).toHaveBeenCalledWith({ projectId: 'project_1' });
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.create.mock.calls[0][0]).toMatchObject({
      type: 'aionrs',
      id: 'conversation_director',
      name: 'Launch film',
      extra: {
        studio_project_id: 'project_1',
        selected_mcp_server_ids: [],
        selected_session_mcp_servers: [descriptor],
      },
    });
    expect(harness.bind).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 7,
      conversationId: 'conversation_director',
    });
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('waits for a complete claimant catalogue before an automatic fresh create', async () => {
    const catalogue = deferred<{ items: TChatConversation[]; total: number; has_more: boolean }>();
    harness.listConversations.mockReturnValueOnce(catalogue.promise);
    render(<DirectorRail project={project()} />);

    await waitFor(() => expect(harness.listConversations).toHaveBeenCalledWith({ limit: 10_000 }));
    expect(harness.create).not.toHaveBeenCalled();

    await act(async () => catalogue.resolve({ items: [], total: 0, has_more: false }));
    await screen.findByRole('textbox', { name: 'Director composer' });
    expect(harness.create).toHaveBeenCalledOnce();
  });

  it('fails closed when the cold-start claimant catalogue is incomplete', async () => {
    harness.listConversations.mockResolvedValueOnce({ items: [], total: 1, has_more: false });
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not complete the Director attachment. Retry to recover it safely.'
    );
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('fails closed when the cold-start claimant catalogue has inconsistent pagination metadata', async () => {
    harness.listConversations.mockResolvedValueOnce({
      items: [exactConversation('unrelated', { studio_project_id: 'project_2' })],
      total: 0,
      has_more: false,
    });
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not complete the Director attachment. Retry to recover it safely.'
    );
    expect(harness.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      new Error('bridge unavailable'),
      'Creative Studio could not complete the Director attachment. Retry to recover it safely.',
    ],
    [
      new Error('conversation.creativeStudio.workspace.errors.storage'),
      'Creative Studio could not read or save this workspace.',
    ],
  ])('fails closed when the cold-start claimant catalogue cannot be read', async (error, expectedMessage) => {
    harness.listConversations.mockRejectedValueOnce(error);
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(expectedMessage);
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('binds one trusted claimant hidden from cold-start history instead of creating a duplicate', async () => {
    const recovered = exactConversation('47b03580');
    harness.listConversations.mockResolvedValueOnce({ items: [recovered], total: 1, has_more: false });
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      '47b03580'
    );
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.bind).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      conversationId: '47b03580',
    });
  });

  it('treats a valid server-assigned short id as authoritative and binds that id', async () => {
    harness.create.mockResolvedValueOnce(exactConversation('8a49d04b'));
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      '8a49d04b'
    );
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      conversationId: '8a49d04b',
    });
  });

  it('rejects a server-assigned conversation owned by another project', async () => {
    harness.create.mockResolvedValueOnce(
      exactConversation('8a49d04b', {
        studio_project_id: 'project_2',
      })
    );
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio found conflicting Director conversation data and will not choose one automatically.'
    );
    expect(screen.getByRole('button', { name: 'Start fresh' })).toBeVisible();
    expect(harness.bind).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      'conversation_director_retry'
    );
    expect(harness.listConversations).toHaveBeenCalledOnce();
    expect(harness.create).toHaveBeenCalledTimes(2);
  });

  it.each(['../conversation', 'conversation\0evil', 'x'.repeat(257), 123])(
    'rejects an unsafe server-assigned conversation id: %s',
    async (conversationId) => {
      harness.create.mockResolvedValueOnce({
        ...exactConversation('conversation_director'),
        id: conversationId,
      } as unknown as Extract<TChatConversation, { type: 'aionrs' }>);
      render(<DirectorRail project={project()} />);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Creative Studio found conflicting Director conversation data and will not choose one automatically.'
      );
      expect(screen.getByRole('button', { name: 'Start fresh' })).toBeVisible();
      expect(harness.bind).not.toHaveBeenCalled();
    }
  );

  it('reports an unverifiable descriptor as a session error', async () => {
    harness.descriptor.mockResolvedValueOnce(ok({ ...descriptor, name: 'ambient-server' }));
    render(<DirectorRail project={project()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not verify the Director session configuration.'
    );
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('reports an unverifiable created MCP snapshot as a session error', async () => {
    const drifted = exactConversation('8a49d04b', {
      session_mcp_servers: [
        {
          ...descriptor,
          transport: {
            ...(descriptor.transport.type === 'stdio' ? descriptor.transport : {}),
            type: 'stdio',
            command: 'node',
            args: ['/tmp/attacker/out/main/builtin-mcp-studio.js'],
          },
        },
      ],
    });
    harness.listConversations
      .mockResolvedValueOnce({ items: [], total: 0, has_more: false })
      .mockResolvedValueOnce({ items: [drifted], total: 1, has_more: false });
    harness.create.mockResolvedValueOnce(drifted);
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not verify the Director session configuration.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio found conflicting Director conversation data and will not choose one automatically.'
    );
    expect(screen.getByRole('button', { name: 'Start fresh' })).toBeVisible();
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('offers deliberate Start fresh when an invalid successful create has no recoverable claimant', async () => {
    const drifted = exactConversation('8a49d04b', {
      mcp_servers: [descriptor.name, 'ambient-server'],
    });
    harness.create.mockResolvedValueOnce(drifted);
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not verify the Director session configuration.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio found conflicting Director conversation data and will not choose one automatically.'
    );
    expect(screen.getByRole('button', { name: 'Start fresh' })).toBeVisible();
    expect(harness.listConversations).toHaveBeenCalledTimes(2);
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('keeps claimant-only recovery after a transient descriptor failure', async () => {
    const drifted = exactConversation('8a49d04b', {
      mcp_servers: [descriptor.name, 'ambient-server'],
    });
    harness.descriptor
      .mockResolvedValueOnce(ok(descriptor))
      .mockRejectedValueOnce(new Error('descriptor bridge unavailable'));
    harness.create.mockResolvedValueOnce(drifted);
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not verify the Director session configuration.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Creative Studio could not complete the Director attachment. Retry to recover it safely.'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Creative Studio found conflicting Director conversation data and will not choose one automatically.'
      )
    );
    expect(screen.getByRole('button', { name: 'Start fresh' })).toBeVisible();
    expect(harness.listConversations).toHaveBeenCalledTimes(2);
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('keeps claimant-only recovery while the text model is temporarily unavailable', async () => {
    const drifted = exactConversation('8a49d04b', {
      mcp_servers: [descriptor.name, 'ambient-server'],
    });
    harness.create.mockResolvedValueOnce(drifted);
    const rendered = render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not verify the Director session configuration.'
    );
    harness.currentModel = undefined;
    harness.modelList = [];
    rendered.rerender(<DirectorRail project={project({ revision: 4 })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Configure a text model before starting the Creative Director.'
      )
    );

    harness.currentModel = model;
    harness.modelList = [provider];
    rendered.rerender(<DirectorRail project={project({ revision: 5 })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Creative Studio found conflicting Director conversation data and will not choose one automatically.'
      )
    );
    expect(screen.getByRole('button', { name: 'Start fresh' })).toBeVisible();
    expect(harness.listConversations).toHaveBeenCalledTimes(2);
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('recovers exactly one trusted project claimant after an ambiguous create without creating twice', async () => {
    const recovered = exactConversation('47b03580');
    harness.create.mockRejectedValueOnce(new Error('response lost after commit'));
    harness.listConversations
      .mockResolvedValueOnce({ items: [], total: 0, has_more: false })
      .mockResolvedValueOnce({ items: [recovered], total: 1, has_more: false });
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      '47b03580'
    );
    expect(harness.listConversations).toHaveBeenCalledWith({ limit: 10_000 });
    expect(harness.authority).toHaveBeenCalledWith({ projectId: 'project_1' });
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      conversationId: '47b03580',
    });
  });

  it('fails closed instead of choosing the first duplicate recovery claimant', async () => {
    harness.create.mockRejectedValueOnce(new Error('response lost after commit'));
    harness.listConversations.mockResolvedValueOnce({ items: [], total: 0, has_more: false }).mockResolvedValueOnce({
      items: [exactConversation('47b03580'), exactConversation('a49d04be')],
      total: 2,
      has_more: false,
    });
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio found conflicting Director conversation data and will not choose one automatically.'
    );
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('fails closed on a recovery claimant with a forged MCP snapshot', async () => {
    harness.create.mockRejectedValueOnce(new Error('response lost after commit'));
    harness.listConversations.mockResolvedValueOnce({ items: [], total: 0, has_more: false }).mockResolvedValueOnce({
      items: [exactConversation('47b03580', { mcp_servers: [descriptor.name, 'ambient-server'] })],
      total: 1,
      has_more: false,
    });
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio found conflicting Director conversation data and will not choose one automatically.'
    );
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('requires exact main-process authority for claimant recovery', async () => {
    harness.create.mockRejectedValueOnce(new Error('response lost after commit'));
    harness.listConversations.mockResolvedValueOnce({ items: [], total: 0, has_more: false }).mockResolvedValueOnce({
      items: [exactConversation('47b03580')],
      total: 1,
      has_more: false,
    });
    harness.authority.mockResolvedValueOnce(ok({ ...authority, projectDir: '/tmp/attacker/project_1' }));
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio found conflicting Director conversation data and will not choose one automatically.'
    );
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('does not trust claimant recovery from an incomplete catalogue', async () => {
    harness.create.mockRejectedValueOnce(new Error('response lost after commit'));
    harness.listConversations.mockResolvedValueOnce({ items: [], total: 0, has_more: false }).mockResolvedValueOnce({
      items: [exactConversation('47b03580')],
      total: 2,
      has_more: true,
    });
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not complete the Director attachment. Retry to recover it safely.'
    );
    expect(harness.authority).not.toHaveBeenCalled();
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('preserves a real storage error when ambiguous-create recovery finds no claimant', async () => {
    harness.create.mockRejectedValueOnce(new Error('conversation.creativeStudio.workspace.errors.storage'));
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not read or save this workspace.'
    );
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('keeps one module-level start across an in-flight remount', async () => {
    const pending = deferred<Extract<TChatConversation, { type: 'aionrs' }>>();
    harness.create.mockReturnValueOnce(pending.promise);
    const first = render(<DirectorRail project={project()} />);
    await waitFor(() => expect(harness.create).toHaveBeenCalledOnce());
    first.unmount();
    render(<DirectorRail project={project()} />);

    await act(async () => pending.resolve(exactConversation()));
    await screen.findByRole('textbox', { name: 'Director composer' });
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledOnce();
  });

  it('does not let an in-flight automatic create replace an owner that won at a newer revision', async () => {
    const pending = deferred<Extract<TChatConversation, { type: 'aionrs' }>>();
    harness.create.mockReturnValueOnce(pending.promise);
    const rendered = render(<DirectorRail project={project({ revision: 3, briefConversationId: null })} />);
    await waitFor(() => expect(harness.create).toHaveBeenCalledOnce());

    const winner = exactConversation('conversation_winner');
    harness.conversations = [winner];
    rendered.rerender(<DirectorRail project={project({ revision: 4, briefConversationId: 'conversation_winner' })} />);
    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      'conversation_winner'
    );

    await act(async () => pending.resolve(exactConversation()));
    expect(harness.bind).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      'conversation_winner'
    );
  });

  it('reuses a reciprocal owner and collapsing never unmounts it or loses composer focus state', async () => {
    harness.conversations = [exactConversation()];
    const rendered = render(
      <DirectorRail
        project={project({ briefConversationId: 'conversation_director' })}
        reviewedOutput={<button type='button'>Reviewed proposal</button>}
      />
    );
    const composer = await screen.findByRole('textbox', { name: 'Director composer' });
    expect(screen.getByRole('complementary', { name: 'Creative Director' })).toBeVisible();
    fireEvent.change(composer, { target: { value: 'Keep this draft' } });
    composer.focus();
    const hide = screen.getByRole('button', { name: 'Hide the Creative Director' });
    fireEvent.click(hide);

    expect(hide).toHaveFocus();
    expect(composer).toBeInTheDocument();
    expect(composer).toHaveValue('Keep this draft');
    expect(harness.chatMounts).toBe(1);
    expect(harness.chatUnmounts).toBe(0);
    expect(screen.getByText('Reviewed proposal')).toBeInTheDocument();
    expect(screen.getByText('Reviewed proposal').closest('[data-studio-director-reviewed-output]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Show the Creative Director' })).toBe(hide);

    rendered.rerender(
      <DirectorRail project={project({ revision: 4, briefConversationId: 'conversation_director' })} />
    );
    expect(harness.chatMounts).toBe(1);
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('applies fresh same-owner history props without remounting the chat or losing its draft', async () => {
    const rendered = render(<DirectorRail project={project()} />);
    const composer = await screen.findByRole('textbox', { name: 'Director composer' });
    fireEvent.change(composer, { target: { value: 'Keep the live draft' } });
    composer.focus();

    const refreshed = exactConversation('conversation_director');
    refreshed.model = { ...model, use_model: 'model_2' };
    refreshed.extra = { ...refreshed.extra, session_mode: 'yolo' };
    harness.conversations = [refreshed];
    rendered.rerender(
      <DirectorRail project={project({ revision: 4, briefConversationId: 'conversation_director' })} />
    );

    await waitFor(() => expect(harness.renderedChatConversation).toBe(refreshed));
    expect(screen.getByRole('textbox', { name: 'Director composer' })).toBe(composer);
    expect(composer).toHaveValue('Keep the live draft');
    expect(composer).toHaveFocus();
    expect(harness.chatMounts).toBe(1);
    expect(harness.chatUnmounts).toBe(0);
    expect(harness.authority).toHaveBeenCalledOnce();
  });

  it('keeps the settled owner mounted when history refreshes before the project binding prop', async () => {
    const rendered = render(<DirectorRail project={project()} />);
    const composer = await screen.findByRole('textbox', { name: 'Director composer' });
    fireEvent.change(composer, { target: { value: 'History arrived first' } });
    composer.focus();

    const refreshed = exactConversation();
    refreshed.extra = { ...refreshed.extra, session_mode: 'yolo' };
    harness.conversations = [refreshed];
    rendered.rerender(<DirectorRail project={project({ revision: 4, briefConversationId: null })} />);
    await act(async () => undefined);

    expect(screen.getByRole('textbox', { name: 'Director composer' })).toBe(composer);
    expect(composer).toHaveValue('History arrived first');
    expect(composer).toHaveFocus();
    expect(harness.chatMounts).toBe(1);
    expect(harness.chatUnmounts).toBe(0);
    expect(harness.authority).not.toHaveBeenCalled();

    rendered.rerender(
      <DirectorRail project={project({ revision: 5, briefConversationId: 'conversation_director' })} />
    );
    await waitFor(() => expect(harness.renderedChatConversation).toBe(refreshed));
    expect(composer).toHaveValue('History arrived first');
    expect(harness.chatMounts).toBe(1);
    expect(harness.chatUnmounts).toBe(0);
  });

  it('keeps a trusted same-owner chat mounted when fresh-history authority is temporarily unavailable', async () => {
    harness.authority.mockResolvedValueOnce(failed());
    const rendered = render(<DirectorRail project={project()} />);
    const composer = await screen.findByRole('textbox', { name: 'Director composer' });
    const trustedConversation = harness.renderedChatConversation;
    fireEvent.change(composer, { target: { value: 'Do not lose this draft' } });
    composer.focus();

    const firstRefresh = exactConversation();
    firstRefresh.extra = { ...firstRefresh.extra, session_mode: 'yolo' };
    harness.conversations = [firstRefresh];
    rendered.rerender(<DirectorRail project={project({ revision: 4, briefConversationId: firstRefresh.id })} />);
    await waitFor(() => expect(harness.authority).toHaveBeenCalledOnce());

    expect(harness.renderedChatConversation).toBe(trustedConversation);
    expect(composer).toHaveValue('Do not lose this draft');
    expect(composer).toHaveFocus();
    expect(harness.chatMounts).toBe(1);
    expect(harness.chatUnmounts).toBe(0);

    const nextRefresh = exactConversation();
    nextRefresh.extra = { ...nextRefresh.extra, session_mode: 'plan' };
    harness.conversations = [nextRefresh];
    rendered.rerender(<DirectorRail project={project({ revision: 5, briefConversationId: nextRefresh.id })} />);
    await waitFor(() => expect(harness.renderedChatConversation).toBe(nextRefresh));
    expect(harness.authority).toHaveBeenCalledTimes(2);
    expect(composer).toHaveValue('Do not lose this draft');
    expect(harness.chatMounts).toBe(1);
    expect(harness.chatUnmounts).toBe(0);
  });

  it('retries a transient persisted-authority read without creating or replacing the bound owner', async () => {
    harness.conversations = [exactConversation()];
    harness.authority.mockResolvedValueOnce(failed()).mockResolvedValueOnce(ok(authority));
    render(<DirectorRail project={project({ briefConversationId: 'conversation_director' })} />);

    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.bind).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      'conversation_director'
    );
    expect(harness.authority).toHaveBeenCalledTimes(2);
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('requires an explicit retry for an unbound restart candidate and reuses it without creating', async () => {
    harness.conversations = [exactConversation('conversation_interrupted')];
    render(<DirectorRail project={project()} />);

    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    expect(harness.bind).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByRole('textbox', { name: 'Director composer' });
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.bind).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      conversationId: 'conversation_interrupted',
    });
  });

  it('does not auto-retry a refused bind and explicit Retry reuses the created candidate', async () => {
    harness.bind.mockResolvedValueOnce(failed()).mockResolvedValueOnce(commit());
    render(<DirectorRail project={project()} />);

    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByRole('textbox', { name: 'Director composer' });
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledTimes(2);
    expect(harness.getProject).toHaveBeenCalledOnce();
  });

  it('offers Start fresh for a dangling authority and replaces it only after the click', async () => {
    render(<DirectorRail project={project({ briefConversationId: 'conversation_deleted' })} />);
    expect(await screen.findByText("This project's Director conversation is no longer available.")).toBeVisible();
    expect(harness.create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    await screen.findByRole('textbox', { name: 'Director composer' });
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      conversationId: 'conversation_director',
    });
  });

  it('reuses the created replacement after a failed bind against the unchanged dangling authority', async () => {
    harness.bind.mockResolvedValueOnce(failed()).mockResolvedValueOnce(commit());
    harness.getProject.mockResolvedValue(supportedProject('conversation_deleted'));
    const rendered = render(
      <DirectorRail project={project({ revision: 3, briefConversationId: 'conversation_deleted' })} />
    );
    await screen.findByText("This project's Director conversation is no longer available.");
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));

    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledOnce();
    rendered.rerender(<DirectorRail project={project({ revision: 4, briefConversationId: 'conversation_deleted' })} />);
    await screen.findByText(
      'Director setup was interrupted before the conversation could be attached to this project.'
    );
    expect(harness.bind).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      'conversation_director'
    );
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledTimes(2);
    expect(harness.bind.mock.calls[1][0]).toEqual({
      projectId: 'project_1',
      expectedRevision: 4,
      conversationId: 'conversation_director',
    });
  });

  it('reuses the created replacement when reconciliation cannot read the project', async () => {
    harness.bind.mockRejectedValueOnce(new Error('bridge unavailable')).mockResolvedValueOnce(commit());
    harness.getProject.mockRejectedValueOnce(new Error('project read unavailable'));
    const rendered = render(
      <DirectorRail project={project({ revision: 3, briefConversationId: 'conversation_deleted' })} />
    );
    await screen.findByText("This project's Director conversation is no longer available.");
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    await screen.findByText(
      'Director setup was interrupted before the conversation could be attached to this project.'
    );

    rendered.rerender(<DirectorRail project={project({ revision: 4, briefConversationId: 'conversation_deleted' })} />);
    await screen.findByText(
      'Director setup was interrupted before the conversation could be attached to this project.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByRole('textbox', { name: 'Director composer' });
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledTimes(2);
    expect(harness.bind.mock.calls[1][0]).toMatchObject({
      expectedRevision: 4,
      conversationId: 'conversation_director',
    });
  });

  it('does not let Start fresh replace a different owner that wins while creation is in flight', async () => {
    const pending = deferred<Extract<TChatConversation, { type: 'aionrs' }>>();
    harness.create.mockReturnValueOnce(pending.promise);
    const rendered = render(
      <DirectorRail project={project({ revision: 3, briefConversationId: 'conversation_deleted' })} />
    );
    await screen.findByText("This project's Director conversation is no longer available.");
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    await waitFor(() => expect(harness.create).toHaveBeenCalledOnce());

    harness.conversations = [exactConversation('conversation_winner')];
    rendered.rerender(<DirectorRail project={project({ revision: 4, briefConversationId: 'conversation_winner' })} />);
    await act(async () => pending.resolve(exactConversation()));

    expect(harness.bind).not.toHaveBeenCalled();
    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      'conversation_winner'
    );
    expect(screen.queryByText("This project's Director conversation is no longer available.")).toBeNull();
  });

  it('reuses a claimant that appears after an ambiguous create failure instead of creating twice', async () => {
    harness.create.mockRejectedValueOnce(new Error('response lost after commit'));
    const rendered = render(<DirectorRail project={project()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not complete the Director attachment. Retry to recover it safely.'
    );
    expect(harness.create).toHaveBeenCalledOnce();

    harness.conversations = [exactConversation()];
    rendered.rerender(<DirectorRail project={project({ revision: 4 })} />);
    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByRole('textbox', { name: 'Director composer' });
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledOnce();
  });

  it('rechecks project claimants on Retry and does not duplicate a delayed ambiguous-create commit', async () => {
    const recovered = exactConversation('47b03580');
    harness.create.mockRejectedValueOnce(new Error('response lost after commit'));
    harness.listConversations
      .mockResolvedValueOnce({ items: [], total: 0, has_more: false })
      .mockResolvedValueOnce({ items: [], total: 0, has_more: false })
      .mockResolvedValueOnce({ items: [recovered], total: 1, has_more: false });
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio could not complete the Director attachment. Retry to recover it safely.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      '47b03580'
    );
    expect(harness.listConversations).toHaveBeenCalledTimes(3);
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.bind).toHaveBeenCalledOnce();
  });

  it('fails closed for conflicting claimants and for a resolved empty model inventory', async () => {
    harness.conversations = [exactConversation('bad_candidate', { mcp_server_ids: ['ambient-server'] })];
    const rendered = render(<DirectorRail project={project()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Creative Studio found conflicting Director conversation data and will not choose one automatically.'
    );
    expect(harness.create).not.toHaveBeenCalled();

    harness.conversations = [];
    harness.currentModel = undefined;
    harness.modelList = [];
    rendered.rerender(<DirectorRail project={project()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Configure a text model before starting the Creative Director.'
    );
  });

  it('preserves context-handoff metadata and user pins while replacing the Studio rules pin', async () => {
    const conversation = exactConversation('conversation_director', {
      context_handoff: {
        revision: 4,
        context_file_path: '/tmp/context.md',
        pinned_context: [
          {
            id: 'user_pin',
            title: 'User pin',
            content: 'Remember launch day.',
            source: 'manual',
            created_at: 1,
            updated_at: 1,
          },
          {
            id: 'studio_brief_rules',
            title: 'Project rules',
            content: 'STALE',
            source: 'manual',
            created_at: 1,
            updated_at: 1,
          },
        ],
      },
    });
    harness.conversations = [conversation];
    render(
      <DirectorRail
        project={project({
          briefConversationId: conversation.id,
          rules: [
            {
              id: 'rule_1',
              scope: 'project',
              text: 'No competitor logos.',
              predicate: null,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        })}
      />
    );

    await waitFor(() => expect(harness.update).toHaveBeenCalledOnce());
    const payload = harness.update.mock.calls[0][0];
    expect(payload).toMatchObject({ id: conversation.id, merge_extra: true });
    const handoff = payload.updates.extra.context_handoff;
    expect(handoff.revision).toBe(4);
    expect(handoff.context_file_path).toBe('/tmp/context.md');
    expect(handoff.pinned_context.map((pin: { id: string }) => pin.id)).toEqual(['user_pin', 'studio_brief_rules']);
    expect(handoff.pinned_context[1].content).toContain('No competitor logos.');
  });
});
