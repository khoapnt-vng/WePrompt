import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioProjectLoadResultV3 } from '@/common/types/project/creativeStudioTypes';

const mocks = vi.hoisted(() => ({
  conversations: [] as unknown[],
  hasLoaded: true,
  currentModel: { id: 'provider_1', name: 'Provider', use_model: 'model_1' } as unknown,
  modelList: ['model_1'] as string[],
  providers: [{ id: 'provider_1' }] as unknown,
  create: vi.fn(),
  update: vi.fn(),
  getServer: vi.fn(),
  getAuthority: vi.fn(),
  bind: vi.fn(),
  translate: (key: string) => key.split('.').at(-1) ?? key,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { create: { invoke: mocks.create }, update: { invoke: mocks.update } },
    creativeStudioPilot: {
      getDirectorSessionServer: { invoke: mocks.getServer },
      getDirectorSessionAuthority: { invoke: mocks.getAuthority },
      bindDirectorConversation: { invoke: mocks.bind },
    },
  },
}));
vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    allConversations: mocks.conversations,
    hasLoadedConversations: mocks.hasLoaded,
  }),
}));
vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => ({ current_model: mocks.currentModel, modelList: mocks.modelList }),
}));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: mocks.providers, error: undefined }),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection', () => ({
  useAionrsModelSelection: () => ({}),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsChat', () => ({
  default: ({ conversation_id }: { conversation_id: string }) => <div>chat:{conversation_id}</div>,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.translate }) }));
import { PilotDirectorRail } from '@/renderer/pages/studio/components/Pilot/PilotDirectorRail';

const supported = (
  briefConversationId: string | null
): Extract<StudioProjectLoadResultV3, { status: 'supported' }> => ({
  status: 'supported',
  summary: {
    id: 'project_1',
    name: 'Pilot project',
    pieceCount: 0,
    currentPieceCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  canvas: { projectId: 'project_1', revision: 1, authoringRevision: 1, pieces: [] },
  director: { brief: 'Make a lantern.', rules: [], briefConversationId },
  activity: { projectId: 'project_1', preparedPhotoQuotes: [], jobs: [] },
  spendPolicy: null,
  lastUndo: null,
});

const conversation = (id: string) => ({
  id,
  type: 'aionrs',
  name: 'Pilot project',
  model: mocks.currentModel,
  extra: {
    studio_project_id: 'project_1',
    workspace: '',
    session_mcp_servers: [
      {
        id: 'studio-pilot-project_1',
        name: 'aionui-creative-studio',
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['/app/out/main/builtin-mcp-studio.js'],
          env: {
            AIONUI_STUDIO_PROJECT_ID: 'project_1',
            AIONUI_STUDIO_PROJECT_DIR: '/studio/project_1',
          },
        },
      },
    ],
    session_mcp_trust: [
      {
        server_id: 'studio-pilot-project_1',
        server_fingerprint: 'a'.repeat(64),
        resolver_profile: 'aioncore.session-mcp-resolver.v1',
      },
    ],
  },
});

const client = (project: StudioProjectLoadResultV3) => ({
  loadProjectV3: vi.fn(async () => project),
  watchProjectUpdatesV3: vi.fn(() => vi.fn()),
});

describe('Pilot Director rail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversations = [];
    mocks.hasLoaded = true;
    mocks.currentModel = { id: 'provider_1', name: 'Provider', use_model: 'model_1' };
    mocks.modelList = ['model_1'];
    mocks.providers = [{ id: 'provider_1' }];
    mocks.getServer.mockResolvedValue({
      ok: true,
      data: {
        server: conversation('descriptor').extra.session_mcp_servers[0],
        serverFingerprint: 'a'.repeat(64),
        trustClaim: { payload: 'p', signature: 's' },
      },
    });
    mocks.getAuthority.mockResolvedValue({
      ok: true,
      data: {
        serverId: 'studio-pilot-project_1',
        serverName: 'aionui-creative-studio',
        scriptPath: '/app/out/main/builtin-mcp-studio.js',
        projectDir: '/studio/project_1',
      },
    });
    mocks.bind.mockResolvedValue({ ok: true, data: { status: 'bound' } });
    mocks.create.mockResolvedValue(conversation('conversation_backend'));
  });

  it('reattaches the exact persisted Director conversation', async () => {
    mocks.conversations = [conversation('conversation_bound')];
    render(<PilotDirectorRail projectId='project_1' client={client(supported('conversation_bound')) as never} />);
    expect(await screen.findByText('chat:conversation_bound')).toBeVisible();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('accepts the backend-owned id when it creates, attests, binds, and seeds a fresh Director', async () => {
    render(<PilotDirectorRail projectId='project_1' client={client(supported(null)) as never} />);
    expect(await screen.findByText('chat:conversation_backend')).toBeVisible();
    expect(mocks.getServer).toHaveBeenCalledWith({ projectId: 'project_1' });
    expect(mocks.create).toHaveBeenCalledWith(expect.not.objectContaining({ id: expect.anything() }));
    expect(mocks.bind).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedAuthoringRevision: 1,
      conversationId: 'conversation_backend',
    });
    expect(window.sessionStorage.getItem('aionrs_initial_message_conversation_backend')).toContain('Make a lantern.');
  });

  it('rejoins one unbound claimant without creating another conversation', async () => {
    mocks.conversations = [conversation('conversation_orphan')];
    render(<PilotDirectorRail projectId='project_1' client={client(supported(null)) as never} />);
    expect(await screen.findByText('chat:conversation_orphan')).toBeVisible();
    expect(mocks.bind).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation_orphan' }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses an unbound claimant whose persisted session authority does not attest', async () => {
    const claimant = conversation('conversation_untrusted');
    claimant.extra.session_mcp_trust[0]!.server_fingerprint = 'b'.repeat(64);
    mocks.conversations = [claimant];

    render(<PilotDirectorRail projectId='project_1' client={client(supported(null)) as never} />);

    expect(await screen.findByText('failed')).toBeVisible();
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('shows bounded recovery copy when no model exists or attachment fails', async () => {
    mocks.currentModel = undefined;
    mocks.modelList = [];
    mocks.providers = [];
    const { unmount } = render(<PilotDirectorRail projectId='project_1' client={client(supported(null)) as never} />);
    expect(await screen.findByText('noModel')).toBeVisible();
    unmount();

    mocks.currentModel = { id: 'provider_1', name: 'Provider', use_model: 'model_1' };
    mocks.modelList = ['model_1'];
    mocks.providers = [{ id: 'provider_1' }];
    mocks.getServer.mockResolvedValueOnce({ ok: false, error: { code: 'storage_error' } });
    render(<PilotDirectorRail projectId='project_1' client={client(supported(null)) as never} />);
    await waitFor(() => expect(screen.getByText('failed')).toBeVisible());
  });
});
