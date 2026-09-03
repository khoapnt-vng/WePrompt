import type { BadgeProps } from '@arco-design/web-react';
import { Badge, Button, Message, Tooltip } from '@arco-design/web-react';
import { IconDown, IconRight } from '@arco-design/web-react/icon';
import { Attention, CheckOne, Download, LoadingOne, Right } from '@icon-park/react';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { getAcpImageFileName } from '@/common/chat/acpToolCallOutput';
import { coalesceToolCalls } from '@/common/chat/toolActivity/coalesceToolCalls';
import type { CoalescedStep } from '@/common/chat/toolActivity/types';
import type { NormalizedToolCall, NormalizedToolStatus, ToolMessage } from '@/common/chat/normalizeToolCall';
import { isDiagnosticTelemetryText, normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import LocalImageView from '@/renderer/components/media/LocalImageView';
import type { WorkJournalSourceMessage } from '@/renderer/pages/conversation/Messages/types';
import { iconColors } from '@/renderer/styles/colors';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import { buildTurnClose } from './toolActivity/buildTurnClose';
import { buildTurnWorkRecap } from './toolActivity/buildTurnWorkRecap';
import { useToolActionText } from './toolActivity/useToolActionText';
import ToolOutputCitations, { toolUsesKnowledgeSearch } from './ToolOutputCitations';
import './MessageToolGroupSummary.css';

const statusToBadge = (status: NormalizedToolStatus): BadgeProps['status'] => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    case 'running':
      return 'processing';
    case 'canceled':
      return 'default';
    case 'pending':
    default:
      return 'default';
  }
};

type JournalRow =
  | {
      key: string;
      kind: 'narration';
      label: string;
      status: NormalizedToolStatus;
      includeInRecap: boolean;
      isFallback?: boolean;
      collapseDuplicateFallback?: boolean;
      fallbackDoneLabel?: string;
    }
  | { key: string; kind: 'tool'; step: CoalescedStep; status: NormalizedToolStatus };

const planStatus: Record<'pending' | 'in_progress' | 'completed', NormalizedToolStatus> = {
  pending: 'pending',
  in_progress: 'running',
  completed: 'completed',
};

const PROVIDER_NARRATION_MAX_LENGTH = 180;
const SHELL_COMMAND =
  '(?:aws|az|bash|bunx?|cat|cargo|cmake|cmd|cp|curl|deno|docker|dotnet|echo|env|fd|find|fish|gcloud|gh|git|go|gradle|grep|helm|java|jq|just|kubectl|ls|make|mkdir|mv|mvn|node|npm|npx|perl|pip3?|pnpm|podman|powershell|pwd|pwsh|pytest|python(?:3(?:\\.\\d+)?)?|rg|rm|ruby|sed|sh|sudo|swift|terraform|test|vitest|wget|xcodebuild|yarn|yq|zsh)';
const SHELL_COMMAND_WORD = new RegExp(`^${SHELL_COMMAND}$`, 'i');
const NATURAL_COMMAND_VERBS = new Set(['echo', 'find', 'test']);
const NATURAL_COMMAND_DETERMINERS = new Set(['a', 'an', 'our', 'the', 'these', 'this', 'those', 'your']);
const LABELED_SHELL_COMMAND = new RegExp(
  `^(?:(?:first|next|then|now|finally)\\s*[:,]?\\s+)?(?:(?:i(?:'m| am)?|we(?:'re| are)?)\\s+)?(?:check(?:ed|ing)?|command|complet(?:ed|ing)?|execute|executed|executing|finish(?:ed|ing)?|run|running|test(?:ed|ing)?)(?:\\s+(?:(?:the\\s+)?command|execute|executing|run|running|test|testing))?\\s*:?\\s+(?:(?:sudo|env)\\s+)?${SHELL_COMMAND}(?:\\s|$)`,
  'i'
);
const COMMAND_LABEL_SHELL_COMMAND = new RegExp(
  `\\bcommand\\b[^:\\r\\n]{0,30}:\\s*(?:(?:sudo|env)\\s+)?${SHELL_COMMAND}(?:\\s|$)`,
  'i'
);
const DIAGNOSTIC_NARRATION = /\b(?:local_estimate|token\s+watermark|microcompact)\b/i;
const TELEMETRY_IDENTIFIER =
  /\b(?:call|conversation|message|provider|request|session|token|tool|trace)(?:[\s_-]*(?:id|identifier))?\s*[:=]\s*\S+/i;
const FILE_PATH_TOKEN =
  /\b[\w@.-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|toml|md|css|scss|less|html?|py|rs|go|java|kt|swift|sh|bash|zsh|fish|sql|lock)\b/i;
const ROOTED_PATH =
  /(?:^|\s)(?:(?:\.{1,2}|~)?[\\/]|[a-z]:[\\/]|\\\\|(?:src|packages|tests?|docs?|app|lib|components|server|client)[\\/])\S+/i;
const NESTED_PATH = /(?:^|\s)(?:[\w@.-]+[\\/]){2,}[\w@.-]+|(?:^|\s)[\w@.-]+[\\/][\w@.-]+\.[a-z0-9]{1,10}\b/i;
const NATURAL_SLASH_PHRASE = /\b(?:and\/or|input\/output|read\/write|ui\/ux)\b/gi;
const NATURAL_NARRATION_START =
  /^(?:i(?:'m| am| will|'ll)|we(?:'re| are| will|'ll)|first|next|then|now|finally|active|queued|finished|completed|pending|add(?:ing)?|analyz(?:e|ing)|apply(?:ing)?|build(?:ing)?|check(?:ing)?|choos(?:e|ing)|compar(?:e|ing)|complet(?:e|ing)|creat(?:e|ing)|decid(?:e|ing)|echo(?:ing)?|explor(?:e|ing)|find(?:ing)?|finish(?:ing)?|fix(?:ing)?|generat(?:e|ing)|identif(?:y|ying)|implement(?:ing)?|inspect(?:ing)?|investigat(?:e|ing)|keep(?:ing)?|load(?:ing)?|locat(?:e|ing)|open(?:ing)?|plan(?:ning)?|prepar(?:e|ing)|read(?:ing)?|review(?:ing)?|run(?:ning)?|search(?:ing)?|settle|settling|summariz(?:e|ing)|test(?:ing)?|trac(?:e|ing)|understand(?:ing)?|updat(?:e|ing)|validat(?:e|ing)|verif(?:y|ying)|writ(?:e|ing))\b/i;
const AMBIGUOUS_COMMAND_NARRATION_START = /^(?:build|echo|find|run|test)\b/i;
const NATURAL_SENTENCE_CONNECTOR = /\b(?:a|an|and|after|before|for|the|to|while|with|without)\b/i;
const UNSAFE_PROVIDER_NARRATION = [
  LABELED_SHELL_COMMAND,
  COMMAND_LABEL_SHELL_COMMAND,
  /[\r\n`]|~~~|&&|\|\||[|;<>]|(?:^|\s)&(?:\s|$)|\$\(|\$\{/,
  /\b(?:https?|file|ftp):|(?:^|\s)www\./i,
  /\b[a-z_][\w.-]*\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/i,
  /(?:[{}]|\[|\])|=>/,
  /(?:^|\s)--?[a-z][\w-]*(?:\s|=|$)/i,
  /^\s*[$#>%]\s*\S+/,
  TELEMETRY_IDENTIFIER,
  FILE_PATH_TOKEN,
  ROOTED_PATH,
  NESTED_PATH,
];

const containsShellCommandPhrase = (narration: string): boolean => {
  const words: string[] = narration.match(/[a-z][a-z0-9.+-]*/gi) ?? [];
  return words.some((word, index) => {
    const command = word.toLowerCase();
    if (!SHELL_COMMAND_WORD.test(command)) return false;
    const nextWord = words[index + 1]?.toLowerCase();
    return !(NATURAL_COMMAND_VERBS.has(command) && nextWord && NATURAL_COMMAND_DETERMINERS.has(nextWord));
  });
};

const isSentenceLikeNarration = (narration: string): boolean => {
  const firstLetter = narration.match(/\p{L}/u)?.[0];
  if (!firstLetter) return false;

  const hasLetterCase = firstLetter.toLocaleLowerCase() !== firstLetter.toLocaleUpperCase();
  if (!hasLetterCase) return narration.length >= 4;
  if (firstLetter !== firstLetter.toLocaleUpperCase()) return false;

  const words = narration.match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? [];
  if (words.length < 2) return false;
  const hasNaturalStart = NATURAL_NARRATION_START.test(narration);
  const hasSentenceStructure = words.length >= 5 && NATURAL_SENTENCE_CONNECTOR.test(narration);
  if (AMBIGUOUS_COMMAND_NARRATION_START.test(narration)) return hasNaturalStart && hasSentenceStructure;
  return hasNaturalStart || hasSentenceStructure;
};

const getSafeProviderNarration = (value: string | undefined): string | undefined => {
  const narration = value?.trim();
  const narrationWithoutNaturalSlashPhrases = narration?.replace(NATURAL_SLASH_PHRASE, '');
  if (
    !narration ||
    isDiagnosticTelemetryText(narration) ||
    DIAGNOSTIC_NARRATION.test(narration) ||
    containsShellCommandPhrase(narration) ||
    UNSAFE_PROVIDER_NARRATION.some((pattern) => pattern.test(narration)) ||
    /[\\/]/.test(narrationWithoutNaturalSlashPhrases ?? '') ||
    !isSentenceLikeNarration(narration)
  ) {
    return undefined;
  }
  if (narration.length <= PROVIDER_NARRATION_MAX_LENGTH) return narration;
  return `${narration.slice(0, PROVIDER_NARRATION_MAX_LENGTH - 1)}…`;
};

const isToolMessage = (message: WorkJournalSourceMessage): message is ToolMessage =>
  message.type === 'tool_group' || message.type === 'acp_tool_call' || message.type === 'tool_call';

const buildJournalRows = (
  messages: WorkJournalSourceMessage[],
  fallback: {
    plan: {
      running: string;
      done: string;
    };
    thinking: {
      running: string;
      done: string;
    };
  }
): JournalRow[] => {
  const rows: JournalRow[] = [];
  const normalizedCallsWithSource = messages.flatMap((message, messageIndex) =>
    isToolMessage(message) ? normalizeToolMessages([message]).map((call) => ({ call, messageIndex })) : []
  );
  const sourceIndexByCall = new Map(normalizedCallsWithSource.map(({ call, messageIndex }) => [call, messageIndex]));
  const toolStepsByMessageIndex = new Map<number, CoalescedStep[]>();

  for (const step of coalesceToolCalls(normalizedCallsWithSource.map(({ call }) => call))) {
    const messageIndex = sourceIndexByCall.get(step.calls[0]);
    if (messageIndex === undefined) continue;
    const steps = toolStepsByMessageIndex.get(messageIndex) ?? [];
    steps.push(step);
    toolStepsByMessageIndex.set(messageIndex, steps);
  }

  const pushNarration = (row: Extract<JournalRow, { kind: 'narration' }>) => {
    const previous = rows[rows.length - 1];
    if (
      row.collapseDuplicateFallback &&
      previous?.kind === 'narration' &&
      previous.collapseDuplicateFallback &&
      previous.label === row.label &&
      previous.status === row.status
    ) {
      return;
    }
    rows.push(row);
  };

  for (const [messageIndex, message] of messages.entries()) {
    if (isToolMessage(message)) {
      toolStepsByMessageIndex.get(messageIndex)?.forEach((step, stepIndex) => {
        rows.push({
          key: `tool-${messageIndex}-${step.key || stepIndex}`,
          kind: 'tool',
          step,
          status: step.status,
        });
      });
      continue;
    }

    if (message.type === 'plan') {
      message.content.entries.forEach((entry, index) => {
        const status = planStatus[entry.status];
        const narration = getSafeProviderNarration(entry.content);
        pushNarration({
          key: `plan-${message.id}-${index}`,
          kind: 'narration',
          label: narration ?? (status === 'completed' ? fallback.plan.done : fallback.plan.running),
          status,
          includeInRecap: true,
          isFallback: narration === undefined,
          collapseDuplicateFallback: narration === undefined,
          fallbackDoneLabel: narration === undefined ? fallback.plan.done : undefined,
        });
      });
      continue;
    }

    const status = message.content.status === 'done' ? 'completed' : 'running';
    const subject = getSafeProviderNarration(message.content.subject);
    pushNarration({
      key: `thinking-${message.id}`,
      kind: 'narration',
      label: subject ?? (status === 'completed' ? fallback.thinking.done : fallback.thinking.running),
      status,
      includeInRecap: false,
      isFallback: subject === undefined,
      fallbackDoneLabel: subject === undefined ? fallback.thinking.done : undefined,
    });
  }

  return rows;
};

const settleJournalRows = (rows: JournalRow[], isActive: boolean): JournalRow[] => {
  let activeRowIndex = -1;
  if (isActive) {
    for (let index = rows.length - 1; index >= 0; index--) {
      if (rows[index].status !== 'pending') {
        activeRowIndex = index;
        break;
      }
    }
  }

  return rows.map((row, index) => {
    if (!isActive && (row.status === 'pending' || row.status === 'running')) {
      return row.kind === 'tool'
        ? { ...row, status: 'canceled', step: { ...row.step, status: 'canceled' } }
        : { ...row, status: 'canceled' };
    }
    if (row.status !== 'running' || index === activeRowIndex) return row;
    if (row.kind === 'tool') {
      if (row.step.hadError) {
        return { ...row, status: 'canceled', step: { ...row.step, status: 'canceled' } };
      }
      return { ...row, status: 'completed', step: { ...row.step, status: 'completed', hadError: false } };
    }
    return { ...row, label: row.fallbackDoneLabel ?? row.label, status: 'completed' };
  });
};

type LoadedToolItem = {
  sourceVersion: string;
  item: NormalizedToolCall;
};

const getToolItemVersion = (item: NormalizedToolCall): string =>
  JSON.stringify([
    item.status,
    item.name,
    item.description,
    item.input,
    item.output,
    item.truncated,
    item.imagePath,
    item.messageId,
    item.conversationId,
  ]);

const ToolItemDetail: React.FC<{ item: NormalizedToolCall }> = ({ item }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [fullItem, setFullItem] = useState<LoadedToolItem | null>(null);
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null);
  const [loadErrorVersion, setLoadErrorVersion] = useState<string | null>(null);
  const detailPanelId = useId();
  const { conversationId, key, messageId, truncated } = item;
  const itemVersion = getToolItemVersion(item);
  const latestItemVersionRef = useRef(itemVersion);
  const activeRequestVersionRef = useRef<string | undefined>(undefined);
  latestItemVersionRef.current = itemVersion;
  const displayItem = fullItem?.sourceVersion === itemVersion ? fullItem.item : item;
  const imagePath = displayItem.imagePath;
  const loadingFull = loadingVersion === itemVersion;
  const loadError = loadErrorVersion === itemVersion;
  const hasDetail = displayItem.input || displayItem.output || item.truncated || imagePath;
  const accessibleName =
    displayItem.description && displayItem.description !== displayItem.name
      ? `${displayItem.name} ${displayItem.description}`
      : displayItem.name;
  const [messageApi, messageContext] = Message.useMessage();
  const handleDownloadImage = useCallback(
    async (path: string) => {
      try {
        await downloadFileFromPath(path, getAcpImageFileName(path));
        messageApi.success(t('acp.image.download_success'));
      } catch (error) {
        console.error('[MessageToolGroupSummary] Failed to download image:', error);
        messageApi.error(t('acp.image.download_error'));
      }
    },
    [messageApi, t]
  );

  const loadFullItem = useCallback(async () => {
    if (
      !truncated ||
      fullItem?.sourceVersion === itemVersion ||
      activeRequestVersionRef.current === itemVersion ||
      !conversationId ||
      !messageId
    ) {
      return;
    }

    const requestVersion = itemVersion;
    activeRequestVersionRef.current = requestVersion;
    setLoadingVersion(requestVersion);
    setLoadErrorVersion(null);
    try {
      const message = await ipcBridge.database.getConversationMessage.invoke({
        conversation_id: conversationId,
        message_id: messageId,
      });
      const next = normalizeToolMessages([message as ToolMessage]).find((candidate) => candidate.key === key);
      if (next && latestItemVersionRef.current === requestVersion) {
        setFullItem({ sourceVersion: requestVersion, item: next });
      }
    } catch {
      if (latestItemVersionRef.current === requestVersion) {
        setLoadErrorVersion(requestVersion);
      }
    } finally {
      if (activeRequestVersionRef.current === requestVersion) {
        activeRequestVersionRef.current = undefined;
        setLoadingVersion((current) => (current === requestVersion ? null : current));
      }
    }
  }, [conversationId, fullItem?.sourceVersion, itemVersion, key, messageId, truncated]);

  useEffect(() => {
    if (expanded) void loadFullItem();
  }, [expanded, loadFullItem]);

  const toggleExpanded = () => {
    setExpanded((value) => !value);
  };

  const toolLabel = (
    <span className={'flex-1 min-w-0' + (expanded ? ' break-all' : ' truncate')}>
      <span className='font-medium text-13px'>{displayItem.name}</span>
      {displayItem.description && displayItem.description !== displayItem.name && (
        <span className='m-l-4px opacity-80 text-13px'>{displayItem.description}</span>
      )}
    </span>
  );

  return (
    <div className='flex flex-col'>
      {messageContext}
      <div className='flex flex-row text-t-secondary gap-12px items-center'>
        <Badge status={statusToBadge(item.status)} className={item.status === 'running' ? 'badge-breathing' : ''} />
        {hasDetail ? (
          <Button
            type='text'
            size='mini'
            className='!flex flex-1 items-center justify-between gap-12px !min-w-0 !w-auto !h-auto !p-0 !text-left !text-t-secondary !whitespace-normal hover:!text-t-primary'
            aria-label={accessibleName}
            aria-expanded={expanded}
            aria-controls={detailPanelId}
            onClick={toggleExpanded}
          >
            {toolLabel}
            <span className='inline-flex items-center shrink-0'>
              {expanded ? <IconDown style={{ fontSize: 12 }} /> : <IconRight style={{ fontSize: 12 }} />}
            </span>
          </Button>
        ) : (
          toolLabel
        )}
      </div>
      {expanded && hasDetail && (
        <div id={detailPanelId} className='tool-detail-panel m-l-20px m-t-4px'>
          {loadingFull && <div className='tool-detail-label'>{t('common.loading')}</div>}
          {loadError && <div className='tool-detail-label'>{t('common.failed')}</div>}
          {displayItem.input && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>{t('tools.labels.arguments')}</div>
              <pre className='tool-detail-content'>{displayItem.input}</pre>
            </div>
          )}
          {displayItem.output && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>{t('tools.labels.result')}</div>
              <pre className='tool-detail-content'>
                {toolUsesKnowledgeSearch(displayItem.name) ? (
                  <ToolOutputCitations output={displayItem.output} />
                ) : (
                  displayItem.output
                )}
              </pre>
            </div>
          )}
        </div>
      )}
      {imagePath && (
        <div className='group relative m-l-20px m-t-8px overflow-hidden rounded border bg-1 p-2 max-w-280px'>
          <LocalImageView
            src={imagePath}
            alt={getAcpImageFileName(imagePath)}
            className='max-w-full max-h-320px object-contain rounded'
          />
          <Tooltip content={t('acp.image.download')}>
            <Button
              aria-label={t('acp.image.download_aria')}
              className='!absolute right-10px top-10px !h-28px !w-28px !p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-90 focus:opacity-100'
              type='secondary'
              size='mini'
              shape='circle'
              icon={<Download theme='outline' size='14' />}
              onClick={() => void handleDownloadImage(imagePath)}
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
};

const StepRow: React.FC<{ label: string; status: Exclude<NormalizedToolStatus, 'error'> }> = ({ label, status }) => {
  const icon = (() => {
    switch (status) {
      case 'running':
        return (
          <span data-status-icon='running'>
            <LoadingOne theme='outline' size='14' fill={iconColors.primary} className='loading' />
          </span>
        );
      case 'completed':
        return <CheckOne theme='filled' size='14' fill={iconColors.success} data-status-icon='completed' />;
      case 'canceled':
        return (
          <Attention
            theme='filled'
            size='14'
            strokeLinejoin='bevel'
            fill={iconColors.warning}
            data-status-icon='canceled'
          />
        );
      case 'pending':
        return <Badge status='default' data-status-icon='pending' />;
    }
  })();

  return (
    <div className='flex flex-row items-center gap-8px text-t-secondary' data-status={status}>
      <span className='flex-shrink-0 flex items-center'>{icon}</span>
      <span className='text-13px'>{label}</span>
    </div>
  );
};

const MessageToolGroupSummary: React.FC<{ messages: WorkJournalSourceMessage[]; isActive?: boolean }> = ({
  messages,
  isActive = false,
}) => {
  const { t } = useTranslation();
  const action = useToolActionText();
  const toolMessages = useMemo(() => messages.filter(isToolMessage), [messages]);
  const tools = useMemo(() => normalizeToolMessages(toolMessages), [toolMessages]);
  const sourceRows = useMemo(
    () =>
      buildJournalRows(messages, {
        plan: {
          running: t('messages.toolActivity.generic.running'),
          done: t('messages.toolActivity.generic.done'),
        },
        thinking: {
          running: t('conversation.thinking.label'),
          done: t('conversation.thinking.complete'),
        },
      }),
    [messages, t]
  );
  const rows = useMemo(() => settleJournalRows(sourceRows, isActive), [isActive, sourceRows]);
  const recap = useMemo(
    () =>
      buildTurnWorkRecap(
        rows
          .filter((row) => row.kind === 'tool' || row.includeInRecap)
          .map((row) =>
            row.kind === 'tool'
              ? {
                  category: row.step.action.category,
                  status: row.status,
                  attempts: row.step.attempts,
                  hadError: row.step.hadError,
                }
              : {
                  category: 'generic',
                  status: row.status,
                  safeSubject: row.isFallback ? undefined : row.label,
                }
          ),
        isActive
      ),
    [isActive, rows]
  );
  const turnClose = useMemo(() => (isActive ? null : buildTurnClose(recap, recap.safeSubject)), [isActive, recap]);
  const allSteps = useMemo(() => {
    const labeled: Array<{ key: string; label: string; status: Exclude<NormalizedToolStatus, 'error'> }> = [];
    for (const row of rows) {
      if (row.status === 'error') continue;
      labeled.push({
        key: row.key,
        label: row.kind === 'tool' ? action.label(row.step) : row.label,
        status: row.status,
      });
    }
    return labeled;
  }, [action, rows]);
  const visibleSteps = useMemo(() => {
    if (!isActive) return [];
    const findLastStep = (status: NormalizedToolStatus) => {
      for (let index = allSteps.length - 1; index >= 0; index -= 1) {
        if (allSteps[index].status === status) return allSteps[index];
      }
      return undefined;
    };
    const currentStep = findLastStep('running') ?? findLastStep('pending');
    return currentStep ? [currentStep] : [];
  }, [allSteps, isActive]);
  const [showDetails, setShowDetails] = useState(false);

  if (rows.length === 0 && tools.length === 0) return null;

  return (
    <div className='tool-group-summary flex flex-col gap-6px'>
      <div
        className='flex flex-col gap-4px'
        role={isActive ? 'log' : undefined}
        aria-live={isActive ? 'polite' : undefined}
        aria-atomic={isActive ? false : undefined}
      >
        {visibleSteps.map((step) => (
          <StepRow key={step.key} label={step.label} status={step.status} />
        ))}
        {turnClose && (
          <div
            className={'text-13px m-t-4px ' + (turnClose.tone === 'attention' ? 'text-warning' : 'text-t-primary')}
            role='status'
          >
            {t(turnClose.key)}
          </div>
        )}
      </div>
      {(allSteps.length > 0 || tools.length > 0) && (
        <Button
          type='text'
          size='mini'
          className='tool-group-summary__header'
          aria-expanded={showDetails}
          onClick={() => setShowDetails((value) => !value)}
        >
          <span className='tool-group-summary__label'>{t('common.technical_details')}</span>
          <Right
            theme='outline'
            size='12'
            className={`tool-group-summary__arrow${showDetails ? ' tool-group-summary__arrow--open' : ''}`}
          />
        </Button>
      )}
      {showDetails && (
        <div className='tool-group-summary__body'>
          {allSteps.map((step) => (
            <StepRow key={step.key} label={step.label} status={step.status} />
          ))}
          {tools.map((item) => (
            <ToolItemDetail key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageToolGroupSummary);
