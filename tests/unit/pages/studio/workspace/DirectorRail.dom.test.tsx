/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IProvider, ISessionMcpServer, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { IMessageAcpToolCall, IMessageToolGroup } from '@/common/chat/chatLib';
import { normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import { coalesceToolCalls } from '@/common/chat/toolActivity/coalesceToolCalls';
import type { CoalescedStep } from '@/common/chat/toolActivity/types';
import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROJECT_STATUS_STAGE_ORDER_V2,
  type StudioRendererProjectV2,
  type StudioRendererProposalCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  summarizeTurnDomainOutcomes,
  type ToolOutcomeInterpreter,
} from '@/renderer/pages/conversation/Messages/components/toolActivity/buildTurnClose';
import {
  DIRECTOR_PRESET_RULES,
  DIRECTOR_PRESET_RULES_PROFILE,
} from '@/renderer/pages/studio/components/Workspace/DirectorRail/openingTurn';

const harness = vi.hoisted(() => ({
  conversations: [] as TChatConversation[],
  hasLoaded: true,
  providersResolved: true,
  currentModel: undefined as TProviderWithModel | undefined,
  modelList: [] as IProvider[],
  chatMounts: 0,
  chatUnmounts: 0,
  renderedChatConversation: undefined as TChatConversation | undefined,
  beforeSend: undefined as
    | ((input: { message: string; hasAttachments: boolean }) => boolean | Promise<boolean>)
    | undefined,
  toolOutcomeInterpreter: undefined as ToolOutcomeInterpreter | undefined,
  uuid: vi.fn(),
  descriptor: vi.fn(),
  authority: vi.fn(),
  create: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  bind: vi.fn(),
  getProject: vi.fn(),
  update: vi.fn(),
  send: vi.fn(),
  prefill: vi.fn(),
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
      get: { invoke: harness.getConversation },
      update: { invoke: harness.update },
      sendMessage: { invoke: harness.send },
    },
    database: {
      getUserConversations: { invoke: harness.listConversations },
    },
  },
}));

vi.mock('@/common/utils', () => ({ uuid: harness.uuid }));

vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  requestConversationSendBoxPrefill: harness.prefill,
}));

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
  default: ({
    conversation_id,
    conversation,
    beforeSend,
    inlineItems,
    toolOutcomeInterpreter,
  }: {
    conversation_id: string;
    conversation: TChatConversation;
    beforeSend?: (input: { message: string; hasAttachments: boolean }) => boolean | Promise<boolean>;
    inlineItems?: readonly { id: string; createdAt: number; content: React.ReactNode }[];
    toolOutcomeInterpreter?: ToolOutcomeInterpreter;
  }) => {
    harness.renderedChatConversation = conversation;
    harness.beforeSend = beforeSend;
    harness.toolOutcomeInterpreter = toolOutcomeInterpreter;
    const [draft, setDraft] = React.useState('');
    React.useEffect(() => {
      harness.chatMounts += 1;
      return () => {
        harness.chatUnmounts += 1;
      };
    }, []);
    return (
      <div data-testid='message-list-content'>
        {inlineItems?.map((item) => (
          <div data-studio-director-reviewed-output key={item.id}>
            {item.content}
          </div>
        ))}
        <label>
          Director composer
          <input
            aria-label='Director composer'
            data-conversation-id={conversation_id}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        </label>
      </div>
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
      'conversation.creativeStudio.errors.storage': 'Creative Studio could not update its local data.',
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
  parseDirectorProposalChatIntent,
} from '@/renderer/pages/studio/components/Workspace/DirectorRail';
import { createStudioDirectorToolOutcomeInterpreter } from '@/renderer/pages/studio/components/Workspace/DirectorRail/turnRecap';

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
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  revision: 3,
  id: 'project_1',
  name: 'Launch film',
  brief: 'A small launch film.',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '720p',
  boardStyle: null,
  beatOrder: [],
  beats: {},
  shots: {},
  referenceOrder: [],
  references: {},
  bin: [],
  bedAssetId: null,
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
      studio_director_rules_profile: DIRECTOR_PRESET_RULES_PROFILE,
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

const proposalCatalog = (
  input: {
    status?: 'pending' | 'accepted' | 'rejected' | 'expired';
    review?: 'ready' | 'stale' | 'unavailable';
    projectId?: string;
    projectRevision?: number;
    duplicate?: boolean;
  } = {}
): StudioRendererProposalCatalogV2 => {
  const projectId = input.projectId ?? 'project_1';
  const projectRevision = input.projectRevision ?? 3;
  const status = input.status ?? 'pending';
  const reviewStatus = input.review ?? 'ready';
  const review =
    reviewStatus === 'ready'
      ? { status: 'ready', groups: [] }
      : reviewStatus === 'stale'
        ? { status: 'stale', groups: [], currentRevision: projectRevision, baseRevision: 3 }
        : { status: 'unavailable', groups: [], reason: 'reducer_rejected', refusal: null };
  const proposal = {
    schemaVersion: 6,
    id: 'proposal_1',
    projectId,
    status,
    baseRevision: 3,
    payload: { kind: 'mutation_batch', operations: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
    decidedAt: status === 'pending' ? null : '2026-01-01T00:01:00.000Z',
    review,
  };
  return {
    projectId,
    projectRevision,
    proposals: input.duplicate ? [proposal, structuredClone(proposal)] : [proposal],
  } as unknown as StudioRendererProposalCatalogV2;
};

const studioToolObservation = (input: {
  interpreter: ToolOutcomeInterpreter;
  name?: string;
  terminalName?: string;
  description?: string;
  output?: string;
  status?: 'pending' | 'running' | 'completed' | 'error' | 'canceled';
  truncated?: boolean;
  toolInput?: string;
}) => {
  const name = input.name ?? 'propose_storyboard';
  const status = input.status ?? 'completed';
  const step: CoalescedStep = {
    key: 'studio-call-1',
    rawName: name,
    status,
    hadError: status === 'error',
    attempts: 1,
    action: { category: 'generic', purpose: 'changing' },
    calls: [
      {
        key: 'studio-call-1',
        name: input.terminalName ?? name,
        description: input.description,
        input: input.toolInput,
        status,
        output: input.output,
        truncated: input.truncated,
      },
    ],
  };
  return input.interpreter({ step, status });
};

const studioToolOutcome = (input: Parameters<typeof studioToolObservation>[0]) => {
  const interpreted = studioToolObservation(input);
  return typeof interpreted === 'string' ? interpreted : interpreted.outcome;
};

describe('Studio Director turn recap', () => {
  const recordedProposal = 'Proposal proposal_1 recorded for user review; the user decides what happens next.';
  const receiptBase = {
    schemaVersion: 10,
    commandId: 'command_1',
    projectId: 'project_1',
    decidedAt: '2026-01-01T00:01:00.000Z',
  };
  const pendingProposalRecord = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    schemaVersion: 6,
    id: 'proposal_1',
    projectId: 'project_1',
    status: 'pending',
    baseRevision: 3,
    payload: { kind: 'mutation_batch', operations: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
    decidedAt: null,
    ...overrides,
  });
  const paidRecoveryProposal = pendingProposalRecord({
    payload: {
      kind: 'paid_recovery',
      blocker: {
        cause: 'reference_generation_required',
        where: { kind: 'project' },
        remedy: {
          kind: 'proposal',
          prepare: { kind: 'project_references', referenceIds: ['reference_1'] },
          estimatedMinorUnits: null,
          currency: null,
        },
      },
      quote: {
        quoteId: 'quote_1',
        projectRevision: 3,
        expiresAt: '2026-01-01T00:05:00.000Z',
        currency: 'USD',
        lowerMinorUnits: 100,
        upperMinorUnits: 120,
        itemCount: 1,
        includesCascade: false,
      },
    },
  });
  const projectStatusResult = (detail = false) => ({
    projectId: 'project_1',
    projectRevision: 3,
    catalogVersion: null,
    stages: STUDIO_PROJECT_STATUS_STAGE_ORDER_V2.map((id) => ({
      id,
      state: 'complete',
      summary: {},
      blockers: [],
    })),
    blockerCount: 0,
    advisories: [],
    boards: { currentPictureCount: 0, shotCount: 0 },
    detail: detail ? { shots: [], references: [] } : null,
  });
  const routeCatalogResult =
    descriptor.transport.type === 'stdio'
      ? JSON.parse(descriptor.transport.env?.AIONUI_STUDIO_ROUTE_CATALOG ?? '{}')
      : {};
  const receiptOutcome = (interpreter: ToolOutcomeInterpreter, receipt: Record<string, unknown>) =>
    studioToolOutcome({
      interpreter,
      name: 'studio_get_command_status',
      toolInput: JSON.stringify({ commandId: String(receipt.commandId ?? 'command_1') }),
      output: JSON.stringify(receipt),
    });

  it('tracks a pending proposal through authoritative acceptance or refusal', () => {
    const pending = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(studioToolOutcome({ interpreter: pending, output: recordedProposal })).toBe('pending_review');

    const accepted = createStudioDirectorToolOutcomeInterpreter(
      'project_1',
      4,
      proposalCatalog({ status: 'accepted', review: 'stale', projectRevision: 4 })
    );
    expect(studioToolOutcome({ interpreter: accepted, output: recordedProposal })).toBe('committed');

    const rejected = createStudioDirectorToolOutcomeInterpreter(
      'project_1',
      3,
      proposalCatalog({ status: 'rejected' })
    );
    expect(studioToolOutcome({ interpreter: rejected, output: recordedProposal })).toBe('refused');
  });

  it('reports reducer-refused and stale proposals without claiming a commit', () => {
    const refused = createStudioDirectorToolOutcomeInterpreter(
      'project_1',
      3,
      proposalCatalog({ review: 'unavailable' })
    );
    expect(studioToolOutcome({ interpreter: refused, output: recordedProposal })).toBe('refused');

    const stale = createStudioDirectorToolOutcomeInterpreter(
      'project_1',
      4,
      proposalCatalog({ review: 'stale', projectRevision: 4 })
    );
    expect(studioToolOutcome({ interpreter: stale, output: recordedProposal })).toBe('needs_revision');
  });

  it('reports a reference request as waiting for human authorization', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(
      studioToolOutcome({
        interpreter,
        name: 'mcp__aionui-creative-studio__studio_request_reference_images',
        output: 'Queued 2 reference image request(s) for user approval. Nothing was generated.',
      })
    ).toBe('waiting_authorization');
    expect(
      studioToolOutcome({
        interpreter,
        name: 'studio_request_reference_images',
        output: 'Queued zero reference requests.',
      })
    ).toBe('unknown');
  });

  it('correlates a rule proposal through the same authoritative catalog', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(
      studioToolOutcome({
        interpreter,
        name: 'propose_brief_rule',
        output: 'Rule proposal_1 recorded for user review; nothing is pinned until the user accepts it.',
      })
    ).toBe('pending_review');
    expect(studioToolOutcome({ interpreter, name: 'propose_brief_rule', output: 'Rule proposal_1 recorded.' })).toBe(
      'unknown'
    );
  });

  it('uses durable command receipts for committed and refused direct edits', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(
      studioToolOutcome({
        interpreter,
        name: 'studio_apply_edits',
        output: JSON.stringify({
          schemaVersion: 10,
          commandId: 'command_1',
          projectId: 'project_1',
          expectedRevision: 3,
          appliedRevision: 4,
          createdBeatIds: [],
          createdShotIds: [],
          decidedAt: '2026-01-01T00:01:00.000Z',
          status: 'applied',
        }),
      })
    ).toBe('committed');
    expect(
      studioToolOutcome({
        interpreter,
        name: 'studio_apply_edits',
        output: JSON.stringify({
          schemaVersion: 10,
          commandId: 'command_2',
          projectId: 'project_1',
          expectedRevision: 3,
          observedRevision: 3,
          decidedAt: '2026-01-01T00:01:00.000Z',
          reasonCode: 'operation_not_permitted',
          status: 'rejected',
        }),
      })
    ).toBe('refused');
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        expectedRevision: 3,
        appliedRevision: 3,
        createdBeatIds: [],
        createdShotIds: [],
        status: 'applied',
      })
    ).toBe('unknown');
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        expectedRevision: 3,
        appliedRevision: 5,
        createdBeatIds: [],
        createdShotIds: [],
        status: 'applied',
      })
    ).toBe('unknown');
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        expectedRevision: null,
        observedRevision: null,
        reasonCode: '',
        status: 'rejected',
      })
    ).toBe('unknown');
  });

  it('reports recorded paid recovery as waiting for authorization', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        commandId: 'proposal_1',
        expectedRevision: 3,
        status: 'recorded',
        proposal: paidRecoveryProposal,
      })
    ).toBe('waiting_authorization');
    expect(receiptOutcome(interpreter, { ...receiptBase, status: 'recorded', proposal: null })).toBe('unknown');
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        status: 'recorded',
        proposal: {
          schemaVersion: 5,
          id: 'proposal_1',
          projectId: 'project_1',
          status: 'pending',
          baseRevision: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          decidedAt: null,
        },
      })
    ).toBe('unknown');
  });

  it('requires exact independent command and proposal sidecar versions', () => {
    const catalog = structuredClone(proposalCatalog());
    catalog.proposals[0]!.schemaVersion = 5 as 6;
    const staleProposalVersion = createStudioDirectorToolOutcomeInterpreter('project_1', 3, catalog);
    expect(studioToolOutcome({ interpreter: staleProposalVersion, output: recordedProposal })).toBe('unknown');

    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(receiptOutcome(interpreter, { ...receiptBase, schemaVersion: 9, status: 'failed' })).toBe('unknown');

    const malformedReview = structuredClone(proposalCatalog({ status: 'accepted' }));
    (malformedReview.proposals[0] as unknown as { review: null }).review = null;
    expect(
      studioToolOutcome({
        interpreter: createStudioDirectorToolOutcomeInterpreter('project_1', 3, malformedReview),
        output: recordedProposal,
      })
    ).toBe('unknown');
  });

  it.each([
    [{ kind: 'get_project_status', detail: false }, projectStatusResult(), 'observed'],
    [{ kind: 'list_routes' }, routeCatalogResult, 'observed'],
    [{ kind: 'unsupported_query' }, {}, 'unknown'],
  ] as const)('interprets an answered $0 query as $2', (query, result, expected) => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        status: 'answered',
        query,
        result,
      })
    ).toBe(expected);
  });

  it.each([
    [{ status: 'not_found' }, 'observed', 'pending'],
    [{ status: 'no_longer_pending', proposalId: 'proposal_1', decision: 'accepted' }, 'committed', 'accepted'],
    [{ status: 'no_longer_pending', proposalId: 'proposal_1', decision: 'rejected' }, 'refused', 'rejected'],
    [{ status: 'no_longer_pending', proposalId: 'proposal_1', decision: 'expired' }, 'refused', 'expired'],
    [{ status: 'no_longer_pending', proposalId: 'proposal_1', decision: 'accepted' }, 'unknown', 'rejected'],
    [{ status: 'no_longer_pending', proposalId: 'proposal_2', decision: 'accepted' }, 'unknown', 'accepted'],
    [{ status: 'no_longer_pending', proposalId: 'proposal_1', decision: 'pending' }, 'unknown', 'pending'],
    [{ status: 'no_longer_pending', proposalId: 'bad id', decision: 'accepted' }, 'unknown', 'accepted'],
    [
      {
        status: 'pending',
        proposal: pendingProposalRecord(),
      },
      'pending_review',
      'pending',
    ],
    [
      {
        status: 'pending',
        proposal: pendingProposalRecord({ projectId: 'project_2' }),
      },
      'unknown',
      'pending',
    ],
    [{ status: 'unexpected' }, 'unknown', 'pending'],
  ] as const)('interprets proposal lookup result %#', (result, expected, catalogStatus) => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter(
      'project_1',
      3,
      proposalCatalog({ status: catalogStatus })
    );
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        status: 'answered',
        query: { kind: 'get_proposal', proposalId: 'proposal_1' },
        result,
      })
    ).toBe(expected);
  });

  it('fails a proposal lookup closed when the query identity is unsafe', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        status: 'answered',
        query: { kind: 'get_proposal', proposalId: 'bad id' },
        result: { status: 'not_found' },
      })
    ).toBe('unknown');
  });

  it.each([
    ['storage_error', 'failed'],
    ['unsupported_prototype_schema', 'failed'],
    ['pending', 'unconfirmed'],
    ['not_found', 'unconfirmed'],
    ['busy', 'unknown'],
    ['unconfirmed', 'unknown'],
    ['unexpected', 'unknown'],
  ] as const)('interprets the exact status envelope %s as %s', (status, expected) => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(receiptOutcome(interpreter, { commandId: receiptBase.commandId, status })).toBe(expected);
  });

  it('validates terminal query and mutation receipts before reporting their outcome', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        status: 'failed',
        query: { kind: 'list_routes' },
        reasonCode: 'route_inventory_unavailable',
      })
    ).toBe('failed');
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        expectedRevision: 3,
        observedRevision: 3,
        status: 'expired',
        reasonCode: 'deadline_elapsed',
      })
    ).toBe('failed');
    expect(
      receiptOutcome(interpreter, {
        ...receiptBase,
        expectedRevision: 3,
        observedRevision: 3,
        status: 'indeterminate',
        reasonCode: 'commit_attribution_unknown',
      })
    ).toBe('indeterminate');
    expect(receiptOutcome(interpreter, { ...receiptBase, status: 'failed' })).toBe('unknown');
  });

  it('keeps a busy incumbent failure independent from later command-status resolution', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    const busy = studioToolObservation({
      interpreter,
      name: 'studio_apply_edits',
      output: JSON.stringify({ status: 'busy', commandId: 'incumbent_1' }),
    });
    const incumbentStatus = studioToolObservation({
      interpreter,
      name: 'studio_get_command_status',
      toolInput: JSON.stringify({ commandId: 'incumbent_1' }),
      output: JSON.stringify({
        ...receiptBase,
        commandId: 'incumbent_1',
        expectedRevision: 3,
        appliedRevision: 4,
        createdBeatIds: [],
        createdShotIds: [],
        status: 'applied',
      }),
    });
    expect(typeof busy === 'string' ? busy : busy.outcome).toBe('failed');
    expect(summarizeTurnDomainOutcomes([busy, incumbentStatus])).toBe('failed');
  });

  it('reports valid read-only Studio results as observations', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(
      studioToolOutcome({
        interpreter,
        name: 'aionui-creative-studio:read_storyboard',
        output: JSON.stringify({ revision: 3, name: 'Film', brief: 'A film.' }),
      })
    ).toBe('observed');
    expect(
      studioToolOutcome({
        interpreter,
        name: 'read_storyboard',
        output: JSON.stringify({ revision: 0, name: 'Film', brief: 'A film.' }),
      })
    ).toBe('unknown');
    expect(
      studioToolOutcome({
        interpreter,
        name: 'studio_get_conditioning_frame',
        output: JSON.stringify({ status: 'ready', projectRevision: 3, shotId: 'shot_1' }),
      })
    ).toBe('observed');
    expect(
      studioToolOutcome({
        interpreter,
        name: 'studio_get_conditioning_frame',
        output: JSON.stringify({ status: 'unavailable', projectRevision: 3, shotId: 'shot_1' }),
      })
    ).toBe('observed');
    expect(
      studioToolOutcome({
        interpreter,
        name: 'studio_get_conditioning_frame',
        output: JSON.stringify({ status: 'invalid_request', projectRevision: 3, shotId: 'shot_1' }),
      })
    ).toBe('unknown');
  });

  it('treats explicit compaction of a pure observation as benign without weakening uncertain outcomes', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    const committed = studioToolObservation({
      interpreter,
      name: 'studio_apply_edits',
      output: JSON.stringify({
        ...receiptBase,
        expectedRevision: 3,
        appliedRevision: 4,
        createdBeatIds: [],
        createdShotIds: [],
        status: 'applied',
      }),
    });
    const compactedObservation = studioToolObservation({
      interpreter,
      name: 'studio_get_project_status',
      output: '{"schemaVersion":10,"status":"answered",',
      truncated: true,
    });

    expect(typeof committed === 'string' ? committed : committed.outcome).toBe('committed');
    expect(compactedObservation).toBe('observed');
    expect(summarizeTurnDomainOutcomes([committed, compactedObservation])).toBe('committed');
    expect(summarizeTurnDomainOutcomes([compactedObservation, committed])).toBe('committed');
    expect(summarizeTurnDomainOutcomes(['pending_review', compactedObservation])).toBe('pending_review');
    expect(summarizeTurnDomainOutcomes(['waiting_authorization', compactedObservation])).toBe('waiting_authorization');

    const incompleteMutation = studioToolObservation({
      interpreter,
      name: 'studio_apply_edits',
      output: '{"schemaVersion":10,"status":"applied",',
      truncated: true,
    });
    expect(incompleteMutation).toBe('unknown');
    expect(summarizeTurnDomainOutcomes([committed, incompleteMutation])).toBe('unknown');

    const incompleteCommandStatus = studioToolObservation({
      interpreter,
      name: 'studio_get_command_status',
      toolInput: JSON.stringify({ commandId: 'command_1' }),
      output: '{"schemaVersion":10,"commandId":"command_1",',
      truncated: true,
    });
    expect(incompleteCommandStatus).toBe('unknown');
    expect(
      summarizeTurnDomainOutcomes([{ outcome: 'unconfirmed', commandId: 'command_1' }, incompleteCommandStatus])
    ).toBe('unconfirmed');

    expect(
      studioToolObservation({
        interpreter,
        name: 'studio_get_proposal',
        output: '{"schemaVersion":10,"status":"answered",',
        truncated: true,
      })
    ).toBe('unknown');
    expect(studioToolOutcome({ interpreter, name: 'studio_get_project_status', output: '' })).toBe('unknown');
    expect(studioToolOutcome({ interpreter, name: 'studio_get_project_status', output: '{"status":' })).toBe('unknown');
  });

  it('correlates a compacted proposal lookup only through its exact input and current catalogue', () => {
    const truncatedLookup = (interpreter: ToolOutcomeInterpreter, toolInput: string) =>
      studioToolObservation({
        interpreter,
        name: 'studio_get_proposal',
        toolInput,
        output: '{"schemaVersion":10,"status":"answered",',
        truncated: true,
      });
    const exactInput = JSON.stringify({ proposalId: 'proposal_1' });
    const pending = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    const pendingLookup = truncatedLookup(pending, exactInput);

    expect(pendingLookup).toBe('pending_review');
    expect(summarizeTurnDomainOutcomes(['committed', pendingLookup])).toBe('pending_review');
    expect(
      truncatedLookup(
        createStudioDirectorToolOutcomeInterpreter(
          'project_1',
          4,
          proposalCatalog({ status: 'accepted', review: 'stale', projectRevision: 4 })
        ),
        exactInput
      )
    ).toBe('committed');
    expect(
      truncatedLookup(
        createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog({ status: 'rejected' })),
        exactInput
      )
    ).toBe('refused');
    expect(
      truncatedLookup(
        createStudioDirectorToolOutcomeInterpreter(
          'project_1',
          4,
          proposalCatalog({ review: 'stale', projectRevision: 4 })
        ),
        exactInput
      )
    ).toBe('needs_revision');

    expect(truncatedLookup(pending, JSON.stringify({ proposalId: 'proposal_other' }))).toBe('unknown');
    expect(truncatedLookup(pending, JSON.stringify({ proposalId: 'proposal_1', extra: true }))).toBe('unknown');
    expect(truncatedLookup(pending, '{"proposalId":')).toBe('unknown');
    expect(truncatedLookup(createStudioDirectorToolOutcomeInterpreter('project_1', 3, null), exactInput)).toBe(
      'unknown'
    );
    expect(
      truncatedLookup(
        createStudioDirectorToolOutcomeInterpreter('project_1', 4, proposalCatalog({ projectRevision: 3 })),
        exactInput
      )
    ).toBe('unknown');
  });

  it('correlates compacted ACP proposal snapshots across normalize and coalesce only when every input agrees', () => {
    const acpSnapshot = (input: {
      messageId: string;
      rawInput?: Record<string, unknown>;
      status: 'in_progress' | 'completed';
      truncated?: boolean;
    }): IMessageAcpToolCall =>
      ({
        id: input.messageId,
        conversation_id: 'conversation_1',
        type: 'acp_tool_call',
        content: {
          sessionId: 'session_1',
          ...(input.truncated ? { _compact: { truncated: true, original_size: 8192, preview_chars: 4096 } } : {}),
          update: {
            sessionUpdate: 'tool_call_update',
            tool_call_id: 'proposal-lookup-1',
            status: input.status,
            title: 'studio_get_proposal',
            kind: 'custom',
            rawInput: input.rawInput,
            ...(input.status === 'completed'
              ? { rawOutput: { result: '{"schemaVersion":10,"status":"answered",' } }
              : {}),
          },
        },
      }) as unknown as IMessageAcpToolCall;
    const outcome = (...inputs: Array<Record<string, unknown> | undefined>) => {
      const messages = inputs.map((rawInput, index) =>
        acpSnapshot({
          messageId: `proposal-lookup-message-${index}`,
          rawInput,
          status: index === inputs.length - 1 ? 'completed' : 'in_progress',
          truncated: index === inputs.length - 1,
        })
      );
      const step = coalesceToolCalls(normalizeToolMessages(messages))[0]!;
      const interpreted = createStudioDirectorToolOutcomeInterpreter(
        'project_1',
        3,
        proposalCatalog()
      )({
        step,
        status: step.status,
      });
      return typeof interpreted === 'string' ? interpreted : interpreted.outcome;
    };

    expect(outcome({ proposalId: 'proposal_1' }, undefined)).toBe('pending_review');
    expect(outcome({ proposalId: 'proposal_1' }, { proposalId: 'proposal_1' })).toBe('pending_review');
    expect(outcome({ proposalId: 'proposal_1' }, { proposalId: 'proposal_other' })).toBe('unknown');
    expect(outcome({ proposalId: 'proposal_1', extra: true }, undefined)).toBe('unknown');
    expect(outcome(undefined)).toBe('unknown');
  });

  it('reports failed and canceled transport before inspecting output', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(studioToolOutcome({ interpreter, status: 'error', output: recordedProposal })).toBe('failed');
    expect(studioToolOutcome({ interpreter, status: 'canceled', output: recordedProposal })).toBe('canceled');
    expect(studioToolOutcome({ interpreter, status: 'pending', output: recordedProposal })).toBe('unknown');
    expect(studioToolOutcome({ interpreter, status: 'running', output: recordedProposal })).toBe('unknown');
  });

  it.each([
    ['missing catalog', 3, null],
    ['mismatched catalog', 3, proposalCatalog({ projectId: 'project_2' })],
    ['stale catalog revision', 4, proposalCatalog({ projectRevision: 3 })],
    ['duplicate proposal identity', 3, proposalCatalog({ duplicate: true })],
    ['missing project revision', null, proposalCatalog()],
    [
      'malformed proposal catalog',
      3,
      {
        projectId: 'project_1',
        projectRevision: 3,
        proposals: 'not-an-array',
      } as unknown as StudioRendererProposalCatalogV2,
    ],
  ] as const)('fails closed for %s', (_label, revision, catalog) => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', revision, catalog);
    expect(studioToolOutcome({ interpreter, output: recordedProposal })).toBe('unknown');
  });

  it('fails both ordinary and compacted proposal reads closed for malformed catalogue authority', () => {
    const missingPayload = structuredClone(proposalCatalog()) as unknown as {
      proposals: Array<Record<string, unknown>>;
    };
    delete missingPayload.proposals[0]!.payload;

    const missingReviewGroups = structuredClone(proposalCatalog()) as unknown as {
      proposals: Array<Record<string, unknown>>;
    };
    missingReviewGroups.proposals[0]!.review = { status: 'ready' };

    const acceptedWithoutReview = structuredClone(proposalCatalog({ status: 'accepted' })) as unknown as {
      proposals: Array<Record<string, unknown>>;
    };
    acceptedWithoutReview.proposals[0]!.review = {};

    const extraProposalKey = structuredClone(proposalCatalog()) as unknown as {
      proposals: Array<Record<string, unknown>>;
    };
    extraProposalKey.proposals[0]!.unexpected = true;

    for (const catalog of [missingPayload, missingReviewGroups, acceptedWithoutReview, extraProposalKey]) {
      const interpreter = createStudioDirectorToolOutcomeInterpreter(
        'project_1',
        3,
        catalog as unknown as StudioRendererProposalCatalogV2
      );
      expect(studioToolOutcome({ interpreter, output: recordedProposal })).toBe('unknown');
      expect(
        studioToolOutcome({
          interpreter,
          name: 'studio_get_proposal',
          toolInput: JSON.stringify({ proposalId: 'proposal_1' }),
          output: '{"schemaVersion":10,"status":"answered",',
          truncated: true,
        })
      ).toBe('unknown');
    }
  });

  it('fails closed for ambiguous, non-Studio, malformed, and truncated results', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(
      studioToolOutcome({
        interpreter,
        name: 'studio_apply_edits',
        terminalName: 'propose_storyboard',
        output: recordedProposal,
      })
    ).toBe('unknown');
    expect(studioToolOutcome({ interpreter, name: 'external_apply_edits', output: recordedProposal })).toBe('unknown');
    expect(studioToolOutcome({ interpreter, name: 'studio_apply_edits', output: '{"status":' })).toBe('unknown');
    expect(studioToolOutcome({ interpreter, name: 'studio_apply_edits', output: '[]' })).toBe('unknown');
    expect(studioToolOutcome({ interpreter, name: 'studio_apply_edits', output: '' })).toBe('unknown');
    expect(studioToolOutcome({ interpreter, name: 'studio_apply_edits' })).toBe('unknown');
    expect(
      studioToolOutcome({ interpreter, name: 'studio_apply_edits', output: '{"status":"applied"}', truncated: true })
    ).toBe('unknown');
  });

  it('uses exact grouped-MCP provenance without requiring arguments that tool_group does not retain', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    const applied = JSON.stringify({
      ...receiptBase,
      expectedRevision: 3,
      appliedRevision: 4,
      createdBeatIds: [],
      createdShotIds: [],
      status: 'applied',
    });
    expect(
      studioToolOutcome({
        interpreter,
        name: 'Studio command',
        terminalName: 'Studio command',
        description: 'aionui-creative-studio:studio_get_command_status',
        toolInput: JSON.stringify({
          server_name: 'aionui-creative-studio',
          tool_name: 'studio_get_command_status',
          tool_display_name: 'Studio command status',
        }),
        output: applied,
      })
    ).toBe('committed');
    expect(
      studioToolOutcome({
        interpreter,
        name: 'external_tool',
        description: 'aionui-creative-studio:studio_get_command_status',
        output: applied,
      })
    ).toBe('unknown');
  });

  it('interprets a real grouped-MCP normalization path from its exact server/tool provenance', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    const output = JSON.stringify({
      ...receiptBase,
      expectedRevision: 3,
      appliedRevision: 4,
      createdBeatIds: [],
      createdShotIds: [],
      status: 'applied',
    });
    const message: IMessageToolGroup = {
      type: 'tool_group',
      content: [
        {
          call_id: 'grouped-status-1',
          name: 'Studio command status',
          description: 'Read the durable command status',
          render_output_as_markdown: false,
          result_display: output,
          status: 'Success',
          confirmationDetails: {
            type: 'mcp',
            title: 'Studio command status',
            server_name: 'aionui-creative-studio',
            tool_name: 'studio_get_command_status',
            tool_display_name: 'Studio command status',
          },
        },
      ],
    };
    const calls = normalizeToolMessages([message]);
    expect(calls[0]?.input).not.toContain('command_1');
    const step = coalesceToolCalls(calls)[0]!;
    const interpreted = interpreter({ step, status: step.status });
    expect(typeof interpreted === 'string' ? interpreted : interpreted.outcome).toBe('committed');
  });

  it('rejects an available command-status input that disagrees with the returned command', () => {
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    expect(
      studioToolOutcome({
        interpreter,
        name: 'studio_get_command_status',
        toolInput: JSON.stringify({ commandId: 'another_command' }),
        output: JSON.stringify({
          ...receiptBase,
          expectedRevision: 3,
          appliedRevision: 4,
          createdBeatIds: [],
          createdShotIds: [],
          status: 'applied',
        }),
      })
    ).toBe('unknown');
  });
});

describe('DirectorRail', () => {
  beforeEach(() => {
    forgetDirectorConversationStart();
    window.sessionStorage.clear();
    vi.clearAllMocks();
    harness.conversations = [];
    harness.hasLoaded = true;
    harness.providersResolved = true;
    harness.currentModel = model;
    harness.modelList = [provider];
    harness.chatMounts = 0;
    harness.chatUnmounts = 0;
    harness.renderedChatConversation = undefined;
    harness.beforeSend = undefined;
    harness.toolOutcomeInterpreter = undefined;
    harness.uuid
      .mockReset()
      .mockReturnValueOnce('conversation_director')
      .mockReturnValue('conversation_director_retry');
    harness.descriptor.mockReset().mockResolvedValue(ok(descriptor));
    harness.authority.mockReset().mockResolvedValue(ok(authority));
    harness.create
      .mockReset()
      .mockImplementation(async (input: { id?: string }) => exactConversation(input.id ?? 'conversation_director'));
    harness.getConversation
      .mockReset()
      .mockImplementation(async (input: { id: string }) => exactConversation(input.id));
    harness.listConversations.mockReset().mockResolvedValue({ items: [], total: 0, has_more: false });
    harness.bind.mockReset().mockResolvedValue(commit());
    harness.getProject.mockReset().mockResolvedValue(supportedProject(null));
    harness.update.mockReset().mockResolvedValue(true);
    harness.send.mockReset();
    harness.prefill.mockReset();
  });

  it('installs the Studio outcome interpreter only on its owned Director chat', async () => {
    const conversation = exactConversation();
    const interpreter = createStudioDirectorToolOutcomeInterpreter('project_1', 3, proposalCatalog());
    harness.conversations = [conversation];
    harness.getProject.mockResolvedValue(supportedProject(conversation.id));

    render(
      <DirectorRail project={project({ briefConversationId: conversation.id })} toolOutcomeInterpreter={interpreter} />
    );

    await waitFor(() => expect(harness.renderedChatConversation?.id).toBe(conversation.id));
    expect(harness.toolOutcomeInterpreter).toBe(interpreter);
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
                .toSorted()
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

  it('waits for history, then creates and binds one exact conversation without sending directly', async () => {
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

  it('seeds the composer brief as the Director opening turn on a fresh create', async () => {
    // The one question the product asks a new user — "What do you want to make?" — used to be
    // answered into a field the Director could not see, leaving an empty rail that reads as broken.
    render(<DirectorRail project={project()} />);
    await screen.findByRole('textbox', { name: 'Director composer' });

    const seeded = window.sessionStorage.getItem('aionrs_initial_message_conversation_director');
    expect(seeded).not.toBeNull();
    expect(JSON.parse(seeded!)).toEqual({ input: 'A small launch film.' });
  });

  it('does not re-ask a conversation it recovered rather than created', async () => {
    // A recovered claimant has already been briefed. Seeding it again would repeat the brief and
    // spend a second Director turn every time an attach fell back to recovery.
    const recovered = exactConversation('47b03580');
    harness.create.mockRejectedValueOnce(new Error('response lost after commit'));
    harness.listConversations
      .mockResolvedValueOnce({ items: [], total: 0, has_more: false })
      .mockResolvedValueOnce({ items: [recovered], total: 1, has_more: false });
    render(<DirectorRail project={project()} />);

    await screen.findByRole('textbox', { name: 'Director composer' });
    expect(window.sessionStorage.getItem('aionrs_initial_message_47b03580')).toBeNull();
  });

  it('says nothing when the project has no brief to say', async () => {
    render(<DirectorRail project={project({ brief: '   ' })} />);
    await screen.findByRole('textbox', { name: 'Director composer' });
    expect(window.sessionStorage.getItem('aionrs_initial_message_conversation_director')).toBeNull();
  });

  it('carries the ask-first rules into the conversation it creates', async () => {
    render(<DirectorRail project={project()} />);
    await screen.findByRole('textbox', { name: 'Director composer' });
    expect(harness.create.mock.calls[0][0].extra).toMatchObject({
      preset_rules: DIRECTOR_PRESET_RULES,
      studio_director_rules_profile: DIRECTOR_PRESET_RULES_PROFILE,
    });
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.getConversation).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty successful body', undefined],
    ['the persisted conversation record', exactConversation('conversation_director')],
  ] as const)('repairs stale rules when the PATCH returns %s', async (_responseKind, response) => {
    const createdWithoutProfile = exactConversation('conversation_director', {
      studio_director_rules_profile: undefined,
    });
    harness.create.mockResolvedValueOnce(createdWithoutProfile);
    harness.update.mockResolvedValueOnce(response as unknown as boolean);
    harness.getConversation.mockResolvedValueOnce(exactConversation('conversation_director'));

    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      createdWithoutProfile.id
    );
    expect(harness.getConversation).toHaveBeenCalledExactlyOnceWith({ id: createdWithoutProfile.id });
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.bind).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText('Director setup was interrupted before the conversation could be attached to this project.')
    ).toBeNull();
  });

  it('retries one failed fresh-create rules repair without creating another conversation', async () => {
    const createdWithoutProfile = exactConversation('conversation_director', {
      studio_director_rules_profile: undefined,
    });
    harness.create.mockResolvedValueOnce(createdWithoutProfile);
    harness.update.mockRejectedValueOnce(new Error('PATCH failed'));
    harness.getConversation.mockResolvedValueOnce(exactConversation('conversation_director'));

    render(<DirectorRail project={project()} />);

    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.getConversation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      createdWithoutProfile.id
    );
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.update).toHaveBeenCalledTimes(2);
    expect(harness.getConversation).toHaveBeenCalledExactlyOnceWith({ id: createdWithoutProfile.id });
    expect(harness.bind).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Approve', { decision: 'accept', proposalId: null }],
    ['apply it.', { decision: 'accept', proposalId: null }],
    ['/approve', { decision: 'accept', proposalId: null }],
    ['Reject!', { decision: 'reject', proposalId: null }],
    ['/reject', { decision: 'reject', proposalId: null }],
    ['/approve Proposal_EXACT-7', { decision: 'accept', proposalId: 'Proposal_EXACT-7' }],
    ['/reject proposal_other', { decision: 'reject', proposalId: 'proposal_other' }],
  ] as const)('recognizes only an exact proposal decision phrase: %s', (message, intent) => {
    expect(parseDirectorProposalChatIntent(message)).toEqual(intent);
  });

  it.each([
    'yes',
    'okay',
    'approve these proposals',
    'approve and render',
    'do not reject',
    '/approve proposal one',
    '/approve proposal_1 now',
    `/approve ${'a'.repeat(257)}`,
    '',
  ])('does not grant proposal authority to an ambiguous chat phrase: %s', (message) => {
    expect(parseDirectorProposalChatIntent(message)).toBeNull();
  });

  it('consumes one exact human approval without forwarding it to the Director model', async () => {
    const onProposalIntent = vi.fn(async () => undefined);
    render(<DirectorRail project={project()} onProposalIntent={onProposalIntent} />);
    await screen.findByRole('textbox', { name: 'Director composer' });

    await expect(harness.beforeSend?.({ message: 'approve', hasAttachments: false })).resolves.toBe(true);
    expect(onProposalIntent).toHaveBeenCalledOnce();
    expect(onProposalIntent).toHaveBeenCalledWith({ decision: 'accept', proposalId: null });
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('prefills one editable exact-ID re-propose turn without sending it', async () => {
    const bound = exactConversation('conversation_bound');
    harness.conversations = [bound];
    harness.getProject.mockResolvedValue(supportedProject('conversation_bound'));
    const prompt = 'Inspect proposal Proposal_EXACT-7 and draft a replacement.';
    const { rerender } = render(
      <DirectorRail
        project={project({ briefConversationId: 'conversation_bound' })}
        draftRequest={{ requestId: 1, projectId: 'project_1', prompt }}
      />
    );

    await screen.findByRole('textbox', { name: 'Director composer' });
    await waitFor(() => expect(harness.prefill).toHaveBeenCalledWith('conversation_bound', prompt));
    expect(harness.send).not.toHaveBeenCalled();

    rerender(
      <DirectorRail
        project={project({ briefConversationId: 'conversation_bound' })}
        draftRequest={{ requestId: 1, projectId: 'project_1', prompt }}
      />
    );
    expect(harness.prefill).toHaveBeenCalledTimes(1);
  });

  it('leaves ordinary messages and messages with attachments on the normal chat path', async () => {
    const onProposalIntent = vi.fn(async () => undefined);
    render(<DirectorRail project={project()} onProposalIntent={onProposalIntent} />);
    await screen.findByRole('textbox', { name: 'Director composer' });

    await expect(
      harness.beforeSend?.({ message: 'Please make the ending warmer.', hasAttachments: false })
    ).resolves.toBe(false);
    await expect(harness.beforeSend?.({ message: 'approve', hasAttachments: true })).resolves.toBe(false);
    expect(onProposalIntent).not.toHaveBeenCalled();
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

  it('preserves a structured storage failure while loading the Director descriptor', async () => {
    harness.descriptor.mockResolvedValueOnce(failed('conversation.creativeStudio.errors.storage'));
    render(<DirectorRail project={project()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Creative Studio could not update its local data.');
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

  it('redacts a conversation-prefixed diagnostic from an ambiguous create rejection', async () => {
    const diagnostic = 'conversation./Users/alice/private-key';
    harness.create.mockRejectedValueOnce(new Error(diagnostic));
    render(<DirectorRail project={project()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Creative Studio could not complete the Director attachment. Retry to recover it safely.'
    );
    expect(alert).not.toHaveTextContent(diagnostic);
    expect(harness.create).toHaveBeenCalledOnce();
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
    // The collapse control now lives in the app bar, so the rail is collapsed through its prop.
    // What this test guards is unchanged: collapsing must not unmount the owner or lose the draft.
    const rendered = render(
      <DirectorRail
        project={project({ briefConversationId: 'conversation_director' })}
        reviewedOutputs={[
          { id: 'proposal-1', content: <button type='button'>Reviewed proposal</button>, createdAt: 1 },
        ]}
        collapsed={false}
        contentId='director-content'
      />
    );
    const composer = await screen.findByRole('textbox', { name: 'Director composer' });
    const rail = screen.getByRole('complementary', { name: 'Creative Director' });
    const expandedClassName = rail.className;
    const content = document.getElementById('director-content')!;
    expect(rail).toBeVisible();
    expect(content).toHaveAttribute('aria-hidden', 'false');
    expect(content).not.toHaveAttribute('inert');
    fireEvent.change(composer, { target: { value: 'Keep this draft' } });
    composer.focus();

    rendered.rerender(
      <DirectorRail
        project={project({ briefConversationId: 'conversation_director' })}
        reviewedOutputs={[
          { id: 'proposal-1', content: <button type='button'>Reviewed proposal</button>, createdAt: 1 },
        ]}
        collapsed
        contentId='director-content'
      />
    );

    expect(composer).toBeInTheDocument();
    expect(composer).toHaveValue('Keep this draft');
    expect(rail.className).not.toBe(expandedClassName);
    expect(content).toHaveAttribute('aria-hidden', 'true');
    expect(content).toHaveAttribute('inert');
    expect(harness.chatMounts).toBe(1);
    expect(harness.chatUnmounts).toBe(0);
    expect(screen.getByText('Reviewed proposal')).toBeInTheDocument();
    const reviewedOutput = screen.getByText('Reviewed proposal').closest('[data-studio-director-reviewed-output]');
    expect(reviewedOutput).not.toBeNull();
    expect(screen.getByTestId('message-list-content')).toContainElement(reviewedOutput);
    // The rail no longer carries a header of its own; the bar heads the project.
    expect(screen.queryByRole('heading', { name: 'Creative Director' })).toBeNull();

    rendered.rerender(
      <DirectorRail
        project={project({ revision: 4, briefConversationId: 'conversation_director' })}
        collapsed
        contentId='director-content'
      />
    );
    expect(harness.chatMounts).toBe(1);
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('refreshes only stale preset rules before reusing a verified bound conversation', async () => {
    const conversation = exactConversation('conversation_director', {
      studio_director_rules_profile: 'studio-director-rules-v1:old',
      custom_workspace: true,
      proxy: 'http://127.0.0.1:8080',
      session_mode: 'plan',
      skills: ['story-editor'],
    });
    const refreshed = exactConversation('conversation_director', {
      custom_workspace: true,
      proxy: 'http://127.0.0.1:8080',
      session_mode: 'plan',
      skills: ['story-editor'],
    });
    const original = structuredClone(conversation);
    harness.conversations = [conversation];
    // The live backend echoes the full persisted conversation from this PATCH even though the
    // bridge declares a boolean. The echo is intentionally ignored; the separate GET is proof.
    harness.update.mockResolvedValueOnce(refreshed as unknown as boolean);
    harness.getConversation.mockResolvedValueOnce(refreshed);

    render(<DirectorRail project={project({ briefConversationId: conversation.id })} />);

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      conversation.id
    );
    expect(harness.update).toHaveBeenCalledExactlyOnceWith({
      id: conversation.id,
      merge_extra: true,
      updates: {
        extra: {
          preset_rules: DIRECTOR_PRESET_RULES,
          studio_director_rules_profile: DIRECTOR_PRESET_RULES_PROFILE,
        },
      },
    });
    expect(harness.renderedChatConversation).toEqual(refreshed);
    expect(conversation).toEqual(original);
    expect(harness.getConversation).toHaveBeenCalledExactlyOnceWith({ id: conversation.id });
    expect(harness.listConversations).not.toHaveBeenCalled();
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('reuses only the rules proof while preserving a newer same-owner history snapshot', async () => {
    const staleConversation = exactConversation('conversation_director', {
      studio_director_rules_profile: 'studio-director-rules-v1:old',
      session_mode: 'plan',
    });
    harness.conversations = [staleConversation];
    harness.getConversation.mockResolvedValueOnce(exactConversation('conversation_director'));
    const rendered = render(<DirectorRail project={project({ briefConversationId: staleConversation.id })} />);
    await screen.findByRole('textbox', { name: 'Director composer' });

    const newerHistory = exactConversation('conversation_director', {
      studio_director_rules_profile: 'studio-director-rules-v1:old',
      session_mode: 'yolo',
    });
    newerHistory.model = { ...model, use_model: 'model_2' };
    harness.conversations = [newerHistory];
    rendered.rerender(<DirectorRail project={project({ revision: 4, briefConversationId: newerHistory.id })} />);

    await waitFor(() =>
      expect(harness.renderedChatConversation).toMatchObject({
        id: newerHistory.id,
        model: { use_model: 'model_2' },
        extra: {
          session_mode: 'yolo',
          studio_director_rules_profile: DIRECTOR_PRESET_RULES_PROFILE,
        },
      })
    );
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.getConversation).toHaveBeenCalledTimes(1);
  });

  it('trusts the current rules profile when AionCore redacts the rules text', async () => {
    const conversation = exactConversation();
    expect(conversation.extra.preset_rules).toBeUndefined();
    harness.conversations = [conversation];

    render(<DirectorRail project={project({ briefConversationId: conversation.id })} />);

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toBeVisible();
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.getConversation).not.toHaveBeenCalled();
  });

  it('fails closed before rendering a bound conversation when stale rule persistence is interrupted', async () => {
    const conversation = exactConversation('conversation_director', {
      studio_director_rules_profile: 'studio-director-rules-v1:old',
      session_mode: 'plan',
    });
    const refreshed = exactConversation('conversation_director', { session_mode: 'plan' });
    harness.conversations = [conversation];
    harness.update.mockRejectedValueOnce(new Error('PATCH failed'));
    harness.getConversation.mockResolvedValueOnce(refreshed);

    render(<DirectorRail project={project({ briefConversationId: conversation.id })} />);

    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Director composer' })).toBeNull();
    expect(harness.update).toHaveBeenCalledExactlyOnceWith({
      id: conversation.id,
      merge_extra: true,
      updates: {
        extra: {
          preset_rules: DIRECTOR_PRESET_RULES,
          studio_director_rules_profile: DIRECTOR_PRESET_RULES_PROFILE,
        },
      },
    });
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.bind).not.toHaveBeenCalled();
    expect(harness.getConversation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      conversation.id
    );
    expect(harness.update).toHaveBeenCalledTimes(2);
    expect(harness.getConversation).toHaveBeenCalledExactlyOnceWith({ id: conversation.id });
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('trusts only readback when the PATCH echo and persisted rules disagree, then retries the same conversation', async () => {
    const staleConversation = exactConversation('conversation_director', {
      studio_director_rules_profile: 'studio-director-rules-v1:old',
      session_mode: 'plan',
      skills: ['story-editor'],
    });
    const currentConversation = exactConversation('conversation_director', {
      session_mode: 'plan',
      skills: ['story-editor'],
    });
    harness.conversations = [staleConversation];
    // First the PATCH claims success with a trusted-looking record, but the independent GET still
    // sees stale state. Retry then receives an empty success body and a current proving readback.
    harness.update
      .mockResolvedValueOnce(currentConversation as unknown as boolean)
      .mockResolvedValueOnce(undefined as unknown as boolean);
    harness.getConversation.mockResolvedValueOnce(staleConversation).mockResolvedValueOnce(currentConversation);

    render(<DirectorRail project={project({ briefConversationId: staleConversation.id })} />);

    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.getConversation).toHaveBeenCalledExactlyOnceWith({ id: staleConversation.id });
    expect(screen.queryByRole('textbox', { name: 'Director composer' })).toBeNull();
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.bind).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      staleConversation.id
    );
    expect(harness.update).toHaveBeenCalledTimes(2);
    expect(harness.getConversation).toHaveBeenCalledTimes(2);
    expect(harness.renderedChatConversation).toEqual(currentConversation);
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it('bounds stale Director rule readback across repeated history refreshes', async () => {
    const staleConversation = exactConversation('conversation_director', {
      studio_director_rules_profile: 'studio-director-rules-v1:old',
    });
    harness.conversations = [staleConversation];
    harness.getConversation.mockResolvedValue(staleConversation);

    const rendered = render(<DirectorRail project={project({ briefConversationId: staleConversation.id })} />);

    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.getConversation).toHaveBeenCalledTimes(1);

    for (let revision = 4; revision < 24; revision += 1) {
      harness.conversations = [structuredClone(staleConversation)];
      rendered.rerender(<DirectorRail project={project({ revision, briefConversationId: staleConversation.id })} />);
    }
    await act(async () => Promise.resolve());

    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.getConversation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Director composer' })).toBeNull();
  });

  it('shares one in-flight rules proof across an unmount and remount', async () => {
    const staleConversation = exactConversation('conversation_director', {
      studio_director_rules_profile: 'studio-director-rules-v1:old',
    });
    const readback = deferred<TChatConversation>();
    harness.conversations = [staleConversation];
    harness.getConversation.mockReturnValueOnce(readback.promise);

    const first = render(<DirectorRail project={project({ briefConversationId: staleConversation.id })} />);
    await waitFor(() => expect(harness.getConversation).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<DirectorRail project={project({ briefConversationId: staleConversation.id })} />);
    await act(async () => Promise.resolve());
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.getConversation).toHaveBeenCalledTimes(1);

    readback.resolve(exactConversation('conversation_director'));
    expect(await screen.findByRole('textbox', { name: 'Director composer' })).toHaveAttribute(
      'data-conversation-id',
      staleConversation.id
    );
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.getConversation).toHaveBeenCalledTimes(1);
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.bind).not.toHaveBeenCalled();
  });

  it.each([
    ['the wrong conversation', () => exactConversation('conversation_other')],
    ['the wrong project', () => exactConversation('conversation_director', { studio_project_id: 'project_other' })],
    [
      'the wrong MCP authority',
      () =>
        exactConversation('conversation_director', {
          mcp_servers: [],
          mcp_statuses: [],
          session_mcp_servers: [],
        }),
    ],
    [
      'malformed MCP state',
      () => {
        const malformed = exactConversation('conversation_director') as TChatConversation & {
          extra: Record<string, unknown>;
        };
        malformed.extra.mcp_statuses = {};
        return malformed;
      },
    ],
  ])('fails closed when the rules readback returns %s', async (_case, readback) => {
    const staleConversation = exactConversation('conversation_director', {
      studio_director_rules_profile: 'studio-director-rules-v1:old',
    });
    harness.conversations = [staleConversation];
    harness.getConversation.mockResolvedValueOnce(readback());

    render(<DirectorRail project={project({ briefConversationId: staleConversation.id })} />);

    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.getConversation).toHaveBeenCalledExactlyOnceWith({ id: staleConversation.id });
    expect(harness.listConversations).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Director composer' })).toBeNull();
  });

  it('fails closed when the exact rules readback is unavailable', async () => {
    const staleConversation = exactConversation('conversation_director', {
      studio_director_rules_profile: 'studio-director-rules-v1:old',
    });
    harness.conversations = [staleConversation];
    harness.getConversation.mockRejectedValueOnce(new Error('offline'));

    render(<DirectorRail project={project({ briefConversationId: staleConversation.id })} />);

    expect(
      await screen.findByText(
        'Director setup was interrupted before the conversation could be attached to this project.'
      )
    ).toBeVisible();
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.getConversation).toHaveBeenCalledExactlyOnceWith({ id: staleConversation.id });
    expect(harness.listConversations).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Director composer' })).toBeNull();
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

  it('redacts a conversation-prefixed diagnostic from a persisted-authority rejection', async () => {
    const diagnostic = 'conversation./Users/alice/private-key';
    harness.conversations = [exactConversation()];
    harness.authority.mockRejectedValueOnce(new Error(diagnostic));
    render(<DirectorRail project={project({ briefConversationId: 'conversation_director' })} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Creative Studio could not verify the Director session configuration.');
    expect(alert).not.toHaveTextContent(diagnostic);
    expect(harness.create).not.toHaveBeenCalled();
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
    rendered.rerender(
      <DirectorRail
        project={project()}
        reviewedOutputs={[
          { id: 'proposal-without-model', content: <button type='button'>Review proposal</button>, createdAt: 1 },
        ]}
      />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Configure a text model before starting the Creative Director.'
    );
    const fallback = document.querySelector('[data-studio-director-pending-output-fallback]');
    const proposal = screen.getByRole('button', { name: 'Review proposal' });
    expect(fallback).toContainElement(proposal);
    expect(proposal.closest('[data-message-inline-item]')).toHaveAttribute(
      'data-message-inline-item',
      'studio-reviewed-output-project_1-proposal-without-model'
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
