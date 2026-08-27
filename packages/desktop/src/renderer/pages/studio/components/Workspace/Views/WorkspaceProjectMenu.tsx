/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Dropdown,
  Input,
  InputTag,
  Menu,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Tag,
} from '@arco-design/web-react';
import { MoreOne } from '@icon-park/react';
import type { SelectHandle, SelectProps } from '@arco-design/web-react/es/Select/interface';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  hasRuleToken,
  ORGANISATION_STUDIO_RULES,
  ruleTermMatchKey,
  STUDIO_RULE_LIMITS,
  type StudioBriefRule,
  type StudioBriefRuleDraft,
} from '@/common/types/project/creativeStudioRules';
import { deriveStudioEditorFolderPreviewV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import { majorUnitsToMinorUnits } from '../spendGate';
import { generationBlockMessage, generationCapabilityIsCurrent } from '../Gate/generationBlockers';
import type { WorkspaceDraftValue } from '../useWorkspaceDrafts';
import styles from './WorkspaceControls.module.css';
import type { WorkspaceProjectMenuProps } from './viewTypes';

type ProjectDialog = 'brief' | null;

type EditorFolderExportStatus =
  | { kind: 'idle' }
  | { kind: 'exporting' }
  | {
      kind: 'success';
      artifactId: string;
      folderName: string;
      byteSize: number;
      fileCount: number;
      slateShotOrdinals: number[];
      movedAsideCount: number;
    }
  | { kind: 'failure'; messageKey: string };

type FilmExportStatus =
  | { kind: 'idle' }
  | {
      kind: 'busy_elsewhere';
      projectId: string;
      renderId: string;
      phase: 'preparing' | 'analyzing' | 'rendering' | 'publishing';
      progress: number | null;
    }
  | {
      kind: 'exporting';
      renderId: string;
      phase: 'preparing' | 'analyzing' | 'rendering' | 'publishing';
      progress: number | null;
    }
  | {
      kind: 'success';
      renderId: string;
      artifactId: string;
      folderName: string;
      nominalDurationSeconds: number;
      renderedDurationSeconds: number;
      trimmedShotCount: number;
      movedAsideCount: number;
    }
  | { kind: 'failure'; renderId: string; messageKey: string };

type RuleValidation = {
  field: 'text' | 'terms';
  messageKey: string;
  term?: string;
};

type StoredRuleEditDraft = {
  baseRule: StudioBriefRule;
  text: string;
  terms: string[];
  termInputValue: string;
};

type StoredRuleDrafts = {
  add: {
    text: string;
    termsValue: string;
    attempt: StudioBriefRuleDraft | null;
  };
  edits: StoredRuleEditDraft[];
};

const RULE_DRAFT_STORAGE_PREFIX = 'aionui:creative-studio:v2:rule-drafts:';
// The worst-case JSON escaping expansion for every accepted field remains below
// this ceiling, including all 24 simultaneous edit drafts.
const RULE_DRAFT_STORAGE_MAX_BYTES = 2 * 1024 * 1024;
const RULE_DRAFT_ADD_INPUT_MAX = 32 * 1024;
const RULE_DRAFT_EDIT_TEXT_MAX = 1024;
const RULE_DRAFT_EDIT_TERM_MAX = 256;
const RULE_DRAFT_EDIT_TERMS_MAX = 16;
const SAFE_RULE_ID = /^[A-Za-z0-9_-]{1,256}$/;

type VolatileStoredRuleDrafts = {
  drafts: StoredRuleDrafts | null;
  storageBacked: boolean;
};

const volatileStoredRuleDrafts = new Map<string, VolatileStoredRuleDrafts>();

const emptyStoredRuleDrafts = (): StoredRuleDrafts => ({
  add: { text: '', termsValue: '', attempt: null },
  edits: [],
});

const cloneStoredRuleDrafts = (drafts: StoredRuleDrafts): StoredRuleDrafts => ({
  add: {
    text: drafts.add.text,
    termsValue: drafts.add.termsValue,
    attempt:
      drafts.add.attempt === null
        ? null
        : {
            ...drafts.add.attempt,
            predicate:
              drafts.add.attempt.predicate === null
                ? null
                : { kind: 'forbidden_terms', terms: [...drafts.add.attempt.predicate.terms] },
          },
  },
  edits: drafts.edits.map((edit) => ({
    baseRule: {
      ...edit.baseRule,
      predicate:
        edit.baseRule.predicate === null
          ? null
          : { kind: 'forbidden_terms', terms: [...edit.baseRule.predicate.terms] },
    },
    text: edit.text,
    terms: [...edit.terms],
    termInputValue: edit.termInputValue,
  })),
});

const isEmptyStoredRuleDrafts = (drafts: StoredRuleDrafts): boolean =>
  drafts.add.text.length === 0 &&
  drafts.add.termsValue.length === 0 &&
  drafts.add.attempt === null &&
  drafts.edits.length === 0;

const ruleDraftStorageKey = (projectId: string): string =>
  `${RULE_DRAFT_STORAGE_PREFIX}${encodeURIComponent(projectId)}`;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isBoundedText = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum;

const parseStoredPredicate = (value: unknown): StudioBriefRuleDraft['predicate'] | undefined => {
  if (value === null) return null;
  if (!isPlainRecord(value) || !hasExactKeys(value, ['kind', 'terms']) || value.kind !== 'forbidden_terms') {
    return undefined;
  }
  if (
    !Array.isArray(value.terms) ||
    value.terms.length > STUDIO_RULE_LIMITS.maxTerms ||
    value.terms.some((term) => typeof term !== 'string' || term.length === 0 || term.length > STUDIO_RULE_LIMITS.term)
  ) {
    return undefined;
  }
  return { kind: 'forbidden_terms', terms: [...value.terms] as string[] };
};

const parseStoredCanonicalRuleDraft = (value: unknown): StudioBriefRuleDraft | null => {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['id', 'predicate', 'text'])) return null;
  const predicate = parseStoredPredicate(value.predicate);
  const terms = predicate === null || predicate === undefined ? [] : predicate.terms;
  if (
    typeof value.id !== 'string' ||
    !SAFE_RULE_ID.test(value.id) ||
    typeof value.text !== 'string' ||
    value.text.trim().length === 0 ||
    value.text.length > STUDIO_RULE_LIMITS.text ||
    predicate === undefined ||
    (predicate !== null && terms.length === 0) ||
    terms.some((term) => !hasRuleToken(term)) ||
    new Set(terms).size !== terms.length
  ) {
    return null;
  }
  return { id: value.id, text: value.text, predicate };
};

const parseStoredRuleDraft = (value: unknown): StudioBriefRuleDraft | null => {
  const draft = parseStoredCanonicalRuleDraft(value);
  if (draft === null || draft.text !== draft.text.trim()) return null;
  const terms = draft.predicate?.terms ?? [];
  const matchKeys = terms.map(ruleTermMatchKey);
  return new Set(matchKeys).size === matchKeys.length ? draft : null;
};

const parseStoredBaseRule = (value: unknown): StudioBriefRule | null => {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['createdAt', 'id', 'predicate', 'scope', 'text'])) return null;
  const draft = parseStoredCanonicalRuleDraft({ id: value.id, text: value.text, predicate: value.predicate });
  if (
    draft === null ||
    value.scope !== 'project' ||
    typeof value.createdAt !== 'string' ||
    value.createdAt.length !== 24 ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(Date.parse(value.createdAt)).toISOString() !== value.createdAt
  ) {
    return null;
  }
  return { ...draft, scope: 'project', createdAt: value.createdAt };
};

const loadStoredRuleDrafts = (projectId: string): StoredRuleDrafts => {
  const key = ruleDraftStorageKey(projectId);
  const volatile = volatileStoredRuleDrafts.get(projectId);
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(key);
  } catch {
    return volatile?.drafts === null || volatile?.drafts === undefined
      ? emptyStoredRuleDrafts()
      : cloneStoredRuleDrafts(volatile.drafts);
  }
  if (volatile?.storageBacked === false) {
    return volatile.drafts === null ? emptyStoredRuleDrafts() : cloneStoredRuleDrafts(volatile.drafts);
  }
  if (raw === null) {
    volatileStoredRuleDrafts.delete(projectId);
    return emptyStoredRuleDrafts();
  }
  try {
    if (raw.length > RULE_DRAFT_STORAGE_MAX_BYTES) throw new Error('oversized rule draft');
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed) || !hasExactKeys(parsed, ['add', 'edits', 'version']) || parsed.version !== 1) {
      throw new Error('invalid rule draft envelope');
    }
    if (!isPlainRecord(parsed.add) || !hasExactKeys(parsed.add, ['attempt', 'termsValue', 'text'])) {
      throw new Error('invalid add draft');
    }
    if (
      !isBoundedText(parsed.add.text, RULE_DRAFT_ADD_INPUT_MAX) ||
      !isBoundedText(parsed.add.termsValue, RULE_DRAFT_ADD_INPUT_MAX)
    ) {
      throw new Error('invalid add draft fields');
    }
    const attempt = parsed.add.attempt === null ? null : parseStoredRuleDraft(parsed.add.attempt);
    if (parsed.add.attempt !== null && attempt === null) throw new Error('invalid add attempt');
    if (attempt !== null && parsed.add.text.length === 0 && parsed.add.termsValue.length === 0) {
      throw new Error('hidden add attempt');
    }
    if (!Array.isArray(parsed.edits) || parsed.edits.length > STUDIO_RULE_LIMITS.maxRules) {
      throw new Error('invalid edit drafts');
    }
    const edits: StoredRuleEditDraft[] = [];
    const ids = new Set<string>();
    for (const edit of parsed.edits) {
      if (!isPlainRecord(edit) || !hasExactKeys(edit, ['baseRule', 'termInputValue', 'terms', 'text'])) {
        throw new Error('invalid edit draft');
      }
      const baseRule = parseStoredBaseRule(edit.baseRule);
      if (
        baseRule === null ||
        ids.has(baseRule.id) ||
        !isBoundedText(edit.text, RULE_DRAFT_EDIT_TEXT_MAX) ||
        !isBoundedText(edit.termInputValue, RULE_DRAFT_EDIT_TERM_MAX) ||
        !Array.isArray(edit.terms) ||
        edit.terms.length > RULE_DRAFT_EDIT_TERMS_MAX ||
        edit.terms.some((term) => !isBoundedText(term, RULE_DRAFT_EDIT_TERM_MAX))
      ) {
        throw new Error('invalid edit draft fields');
      }
      ids.add(baseRule.id);
      edits.push({
        baseRule,
        text: edit.text,
        terms: [...edit.terms] as string[],
        termInputValue: edit.termInputValue,
      });
    }
    const drafts: StoredRuleDrafts = {
      add: { text: parsed.add.text, termsValue: parsed.add.termsValue, attempt },
      edits,
    };
    volatileStoredRuleDrafts.set(projectId, { drafts: cloneStoredRuleDrafts(drafts), storageBacked: true });
    return drafts;
  } catch {
    let removed = false;
    try {
      window.sessionStorage.removeItem(key);
      removed = true;
    } catch {
      // The volatile value or tombstone remains authoritative while storage is unavailable.
    }
    if (volatile?.drafts !== null && volatile?.drafts !== undefined) {
      volatileStoredRuleDrafts.set(projectId, {
        drafts: cloneStoredRuleDrafts(volatile.drafts),
        storageBacked: false,
      });
      return cloneStoredRuleDrafts(volatile.drafts);
    }
    if (removed) volatileStoredRuleDrafts.delete(projectId);
    else volatileStoredRuleDrafts.set(projectId, { drafts: null, storageBacked: false });
    return emptyStoredRuleDrafts();
  }
};

const persistStoredRuleDrafts = (projectId: string, drafts: StoredRuleDrafts): void => {
  const key = ruleDraftStorageKey(projectId);
  if (isEmptyStoredRuleDrafts(drafts)) {
    try {
      window.sessionStorage.removeItem(key);
      volatileStoredRuleDrafts.delete(projectId);
    } catch {
      volatileStoredRuleDrafts.set(projectId, { drafts: null, storageBacked: false });
    }
    return;
  }
  const snapshot = cloneStoredRuleDrafts(drafts);
  const raw = JSON.stringify({ version: 1, ...snapshot });
  let storageBacked = false;
  try {
    if (raw.length <= RULE_DRAFT_STORAGE_MAX_BYTES) {
      window.sessionStorage.setItem(key, raw);
      storageBacked = true;
    }
  } catch {
    // The bounded volatile fallback preserves navigation and close protection.
  }
  volatileStoredRuleDrafts.set(projectId, { drafts: snapshot, storageBacked });
};

const storedRuleDraftCount = (drafts: StoredRuleDrafts): number =>
  drafts.edits.length +
  (drafts.add.text.length > 0 || drafts.add.termsValue.length > 0 || drafts.add.attempt !== null ? 1 : 0);

const countStoredRuleDraftsExcept = (excludedProjectId: string | null): number => {
  const projectIds = new Set(volatileStoredRuleDrafts.keys());
  try {
    const excludedKey = excludedProjectId === null ? null : ruleDraftStorageKey(excludedProjectId);
    const keys = Array.from({ length: window.sessionStorage.length }, (_value, index) =>
      window.sessionStorage.key(index)
    );
    let count = 0;
    for (const key of keys) {
      if (key === null || key === excludedKey || !key.startsWith(RULE_DRAFT_STORAGE_PREFIX)) continue;
      const encodedProjectId = key.slice(RULE_DRAFT_STORAGE_PREFIX.length);
      let projectId: string;
      try {
        projectId = decodeURIComponent(encodedProjectId);
      } catch {
        window.sessionStorage.removeItem(key);
        continue;
      }
      if (ruleDraftStorageKey(projectId) !== key) continue;
      projectIds.add(projectId);
    }
    for (const projectId of projectIds) {
      if (projectId === excludedProjectId) continue;
      count += storedRuleDraftCount(loadStoredRuleDrafts(projectId));
    }
    return count;
  } catch {
    let count = 0;
    for (const [projectId, volatile] of volatileStoredRuleDrafts) {
      if (projectId !== excludedProjectId && volatile.drafts !== null) {
        count += storedRuleDraftCount(volatile.drafts);
      }
    }
    return count;
  }
};

export const countStoredStudioRuleDrafts = (): number => countStoredRuleDraftsExcept(null);

export const purgeStoredStudioRuleDrafts = (projectId: string): void => {
  volatileStoredRuleDrafts.set(projectId, { drafts: null, storageBacked: false });
  try {
    window.sessionStorage.removeItem(ruleDraftStorageKey(projectId));
    volatileStoredRuleDrafts.delete(projectId);
  } catch {
    // The volatile tombstone prevents a stale envelope from resurfacing in this renderer session.
  }
};

const asString = (value: WorkspaceDraftValue | undefined): string => (typeof value === 'string' ? value : '');

const toRuleDraft = ({ id, text, predicate }: StudioBriefRule): StudioBriefRuleDraft => ({
  id,
  text,
  predicate: predicate === null ? null : { kind: 'forbidden_terms', terms: [...predicate.terms] },
});

const sameRuleDraft = (left: StudioBriefRuleDraft, right: StudioBriefRuleDraft): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const parseTerms = (value: string): string[] =>
  value
    .split(/[,，、،؛\n]/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);

const validateRule = (text: string, terms: readonly string[]): RuleValidation | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { field: 'text', messageKey: 'conversation.creativeStudio.rules.invalidText' };
  }
  if (trimmed.length > STUDIO_RULE_LIMITS.text) {
    return { field: 'text', messageKey: 'conversation.creativeStudio.rules.textTooLong' };
  }
  if (terms.length > STUDIO_RULE_LIMITS.maxTerms) {
    return { field: 'terms', messageKey: 'conversation.creativeStudio.rules.tooManyTerms' };
  }
  const tooLong = terms.find((term) => term.length > STUDIO_RULE_LIMITS.term);
  if (tooLong !== undefined) {
    return { field: 'terms', messageKey: 'conversation.creativeStudio.rules.termTooLong', term: tooLong };
  }
  const unusable = terms.find((term) => !hasRuleToken(term));
  if (unusable !== undefined) {
    return { field: 'terms', messageKey: 'conversation.creativeStudio.rules.termUnusable', term: unusable };
  }
  const seen = new Set<string>();
  const duplicate = terms.find((term) => {
    const key = ruleTermMatchKey(term);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  return duplicate === undefined
    ? null
    : { field: 'terms', messageKey: 'conversation.creativeStudio.rules.duplicateTerm', term: duplicate };
};

const mintRuleId = (usedIds: ReadonlySet<string>): string | null => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = window.crypto.randomUUID().replaceAll('-', '_');
    if (!usedIds.has(candidate)) return candidate;
  }
  return null;
};

const RuleValidationMessage: React.FC<{ validation: RuleValidation }> = ({ validation }) => {
  const { t } = useTranslation();
  return (
    <span role='alert' className={styles.ruleError}>
      {validation.term === undefined ? t(validation.messageKey) : t(validation.messageKey, { term: validation.term })}
    </span>
  );
};

const AccessibleSelect: React.FC<
  SelectProps & { accessibleName: string; controlRef?: React.MutableRefObject<SelectHandle | null> }
> = ({ accessibleName, controlRef, ...props }) => {
  const localRef = useRef<SelectHandle | null>(null);
  const selectRef = controlRef ?? localRef;
  useLayoutEffect(() => {
    selectRef.current?.dom?.setAttribute('aria-label', accessibleName);
  }, [accessibleName]);
  return <Select ref={selectRef} {...props} />;
};

const RuleTags: React.FC<{ rule: StudioBriefRule; locked?: boolean }> = ({ rule, locked = false }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.ruleMeta}>
      <Tag className={styles.ruleScope}>
        {t(
          rule.scope === 'organisation'
            ? 'conversation.creativeStudio.rules.scope.organisation'
            : 'conversation.creativeStudio.rules.scope.project'
        )}
      </Tag>
      <Tag>
        {t(
          rule.predicate === null
            ? 'conversation.creativeStudio.rules.contextOnlyBadge'
            : 'conversation.creativeStudio.rules.enforcedBadge'
        )}
      </Tag>
      {locked ? <Tag>{t('conversation.creativeStudio.rules.scope.organisationLocked')}</Tag> : null}
    </div>
  );
};

type ProjectRuleCardProps = {
  rule: StudioBriefRule;
  initialDraft?: StoredRuleEditDraft;
  pending: boolean;
  onSave: (base: StudioBriefRuleDraft, next: StudioBriefRuleDraft, adoptionKey: string) => Promise<boolean>;
  onRemove: (base: StudioBriefRuleDraft) => Promise<boolean>;
  onAdopted: (adoptionKey: string) => void;
  onEditStarted: (rule: StudioBriefRule) => void;
  onEditFinished: (ruleId: string) => void;
  onDraftChange: (ruleId: string, draft: StoredRuleEditDraft | null) => void;
  registerEditButton: (ruleId: string, node: HTMLButtonElement | null) => void;
};

const ProjectRuleCard: React.FC<ProjectRuleCardProps> = ({
  rule,
  initialDraft,
  pending,
  onSave,
  onRemove,
  onAdopted,
  onEditStarted,
  onEditFinished,
  onDraftChange,
  registerEditButton,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(initialDraft !== undefined);
  const [text, setText] = useState(initialDraft?.text ?? rule.text);
  const [terms, setTerms] = useState<string[]>(initialDraft?.terms ?? rule.predicate?.terms ?? []);
  const [termInputValue, setTermInputValue] = useState(initialDraft?.termInputValue ?? '');
  const [validation, setValidation] = useState<RuleValidation | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const baseRef = useRef(toRuleDraft(initialDraft?.baseRule ?? rule));
  const baseRuleRef = useRef(initialDraft?.baseRule ?? rule);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const textRef = useRef(text);
  const termsRef = useRef(terms);
  const termInputValueRef = useRef(termInputValue);
  const restoreEditFocusRef = useRef(false);
  const editAttemptSequenceRef = useRef(0);
  const editAttemptRef = useRef<{
    next: StudioBriefRuleDraft;
    text: string;
    terms: readonly string[];
    termInputValue: string;
    adoptionKey: string;
  } | null>(null);
  textRef.current = text;
  termsRef.current = terms;
  termInputValueRef.current = termInputValue;

  useLayoutEffect(() => {
    const baseTerms = baseRef.current.predicate?.terms ?? [];
    const dirty =
      editing &&
      (text !== baseRef.current.text ||
        termInputValue.length > 0 ||
        terms.length !== baseTerms.length ||
        terms.some((term, index) => term !== baseTerms[index]));
    onDraftChange(
      rule.id,
      dirty
        ? {
            baseRule: {
              ...baseRuleRef.current,
              text: baseRef.current.text,
              predicate:
                baseRef.current.predicate === null
                  ? null
                  : { kind: 'forbidden_terms', terms: [...baseRef.current.predicate.terms] },
            },
            text,
            terms: [...terms],
            termInputValue,
          }
        : null
    );
  }, [baseVersion, editing, onDraftChange, rule.id, termInputValue, terms, text]);

  useLayoutEffect(() => {
    if (!editing && !pending && restoreEditFocusRef.current) {
      restoreEditFocusRef.current = false;
      editButtonRef.current?.focus({ preventScroll: true });
    }
  }, [editing, pending]);

  useEffect(() => {
    const attempt = editAttemptRef.current;
    if (pending || attempt === null || !sameRuleDraft(toRuleDraft(rule), attempt.next)) return;
    editAttemptRef.current = null;
    baseRef.current = attempt.next;
    baseRuleRef.current = { ...rule, text: attempt.next.text, predicate: attempt.next.predicate };
    setBaseVersion((version) => version + 1);
    onAdopted(attempt.adoptionKey);
    if (
      textRef.current === attempt.text &&
      termsRef.current === attempt.terms &&
      termInputValueRef.current === attempt.termInputValue
    ) {
      restoreEditFocusRef.current = true;
      onEditFinished(rule.id);
      setEditing(false);
    }
  }, [onAdopted, onEditFinished, pending, rule]);

  const beginEdit = (): void => {
    baseRef.current = toRuleDraft(rule);
    baseRuleRef.current = rule;
    setBaseVersion((version) => version + 1);
    setText(rule.text);
    setTerms(rule.predicate?.terms ?? []);
    setTermInputValue('');
    setValidation(null);
    editAttemptRef.current = null;
    onEditStarted(rule);
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    const submittedText = text;
    const submittedTerms = terms;
    const submittedTermInputValue = termInputValue;
    const effectiveTerms =
      submittedTermInputValue.length === 0 ? submittedTerms : [...submittedTerms, submittedTermInputValue];
    const unchanged: StudioBriefRuleDraft = {
      id: rule.id,
      text: submittedText,
      predicate: effectiveTerms.length === 0 ? null : { kind: 'forbidden_terms', terms: effectiveTerms },
    };
    if (sameRuleDraft(baseRef.current, unchanged)) {
      restoreEditFocusRef.current = true;
      onEditFinished(rule.id);
      setEditing(false);
      return;
    }
    const normalizedTerms = effectiveTerms.map((term) => term.trim()).filter((term) => term.length > 0);
    const invalid = validateRule(submittedText, normalizedTerms);
    if (invalid !== null) {
      setValidation(invalid);
      return;
    }
    setValidation(null);
    const next: StudioBriefRuleDraft = {
      id: rule.id,
      text: submittedText.trim(),
      predicate: normalizedTerms.length === 0 ? null : { kind: 'forbidden_terms', terms: normalizedTerms },
    };
    if (sameRuleDraft(baseRef.current, next)) {
      restoreEditFocusRef.current = true;
      onEditFinished(rule.id);
      setEditing(false);
      return;
    }
    const priorAttempt = editAttemptRef.current;
    const adoptionKey =
      priorAttempt !== null && sameRuleDraft(priorAttempt.next, next)
        ? priorAttempt.adoptionKey
        : `edit:${rule.id}:${(editAttemptSequenceRef.current += 1)}`;
    editAttemptRef.current = {
      next,
      text: submittedText,
      terms: submittedTerms,
      termInputValue: submittedTermInputValue,
      adoptionKey,
    };
    const saved = await onSave(baseRef.current, next, adoptionKey);
    if (saved) {
      editAttemptRef.current = null;
      baseRef.current = next;
      baseRuleRef.current = { ...baseRuleRef.current, text: next.text, predicate: next.predicate };
      setBaseVersion((version) => version + 1);
      if (
        textRef.current === submittedText &&
        termsRef.current === submittedTerms &&
        termInputValueRef.current === submittedTermInputValue
      ) {
        restoreEditFocusRef.current = true;
        onEditFinished(rule.id);
        setEditing(false);
      }
    }
  };

  const remove = async (): Promise<void> => {
    await onRemove(toRuleDraft(rule));
  };

  const cancel = (): void => {
    editAttemptRef.current = null;
    restoreEditFocusRef.current = true;
    onEditFinished(rule.id);
    setEditing(false);
  };

  return (
    <li className={styles.ruleCard} data-studio-project-rule={rule.id}>
      <RuleTags rule={rule} />
      {editing ? (
        <div className={styles.ruleEditor}>
          <label>
            {t('conversation.creativeStudio.rules.textLabel')}
            <Input.TextArea
              autoFocus
              disabled={pending}
              maxLength={RULE_DRAFT_EDIT_TEXT_MAX}
              autoSize={{ minRows: 2, maxRows: 5 }}
              value={text}
              error={validation?.field === 'text'}
              aria-invalid={validation?.field === 'text'}
              onChange={setText}
            />
          </label>
          <label>
            {t('conversation.creativeStudio.rules.termsLabel')}
            <InputTag
              disabled={pending}
              value={terms}
              inputValue={termInputValue}
              status={validation?.field === 'terms' ? 'error' : undefined}
              aria-invalid={validation?.field === 'terms'}
              onChange={(nextTerms, reason) => {
                if (nextTerms.length <= RULE_DRAFT_EDIT_TERMS_MAX) setTerms(nextTerms);
                if (reason === 'clear') setTermInputValue('');
              }}
              onInputChange={(value) => {
                if (value.length <= RULE_DRAFT_EDIT_TERM_MAX) setTermInputValue(value);
              }}
              onPressEnter={() => {
                if (
                  termInputValue.length > 0 &&
                  terms.length < RULE_DRAFT_EDIT_TERMS_MAX &&
                  !terms.includes(termInputValue)
                ) {
                  setTerms([...terms, termInputValue]);
                  setTermInputValue('');
                }
              }}
            />
          </label>
          {validation === null ? null : <RuleValidationMessage validation={validation} />}
          <div className={styles.actions}>
            <Button disabled={pending} onClick={cancel}>
              {t('common.cancel')}
            </Button>
            <Button type='primary' loading={pending} disabled={pending} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.ruleText} dir='auto'>
            {rule.text}
          </p>
          {rule.predicate === null ? null : (
            <p className={styles.ruleTerms} dir='auto'>
              {rule.predicate.terms.join(', ')}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              ref={(node) => {
                const button = node instanceof HTMLButtonElement ? node : null;
                editButtonRef.current = button;
                registerEditButton(rule.id, button);
              }}
              disabled={pending}
              data-rule-edit
              aria-label={`${t('common.edit')}: ${rule.text}`}
              onClick={beginEdit}
            >
              {t('common.edit')}
            </Button>
            <Button
              status='danger'
              disabled={pending}
              aria-label={t('conversation.creativeStudio.rules.removeAccessible', { rule: rule.text })}
              onClick={() => void remove()}
            >
              {t('conversation.creativeStudio.rules.remove')}
            </Button>
          </div>
        </>
      )}
    </li>
  );
};

const ProjectScopedWorkspaceProjectMenu: React.FC<WorkspaceProjectMenuProps> = ({
  project,
  projection,
  routeCatalog,
  generationCapability,
  exportCatalog,
  filmExportCapability,
  createEditorFolder,
  revealEditorFolder,
  createFilm,
  getFilmExportStatus,
  refreshExports,
  cancelFilmExport,
  acknowledgeFilmExport,
  revealFilm,
  detachBedAudio,
  drafts,
  pending,
  errorMessageKey,
  mutations,
  briefDialogRequest = 0,
  briefRouteFocusRole = null,
  onRuleDraftDirtyCountChange,
  onActiveRuleDraftDirtyCountChange,
  organisationRules = ORGANISATION_STUDIO_RULES,
}) => {
  const { t } = useTranslation();
  const [initialStoredRuleDrafts] = useState(() => loadStoredRuleDrafts(project.id));
  const [audioOpen, setAudioOpen] = useState(false);
  const [detachingAssetId, setDetachingAssetId] = useState<string | null>(null);
  const [audioAnnouncement, setAudioAnnouncement] = useState('');
  const acknowledgeRuleAdoption = mutations.acknowledgeRuleAdoption;
  const currentGenerationCapability = generationCapabilityIsCurrent(project, generationCapability)
    ? generationCapability
    : null;
  const generationBlocksForRole = (role: 'image' | 'video') => {
    const blocks =
      currentGenerationCapability === null
        ? routeCatalog === null
          ? [{ code: 'catalog_unloaded' as const, role }]
          : []
        : currentGenerationCapability.blocks.map((group) => group.block).filter((block) => block.role === role);
    return [...new Map(blocks.map((block) => [JSON.stringify(block), block] as const)).values()];
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<ProjectDialog>(null);
  const [editorFolderExportStatus, setEditorFolderExportStatus] = useState<EditorFolderExportStatus>({ kind: 'idle' });
  const [filmExportStatus, setFilmExportStatus] = useState<FilmExportStatus>({ kind: 'idle' });
  const [filmRendererBusyElsewhere, setFilmRendererBusyElsewhere] = useState(false);
  const handledFilmTerminalIdsRef = useRef(new Set<string>());
  const [filmDialogOpen, setFilmDialogOpen] = useState(false);
  const [filmTransition, setFilmTransition] = useState<'cut' | 'dissolve'>('cut');
  const [filmTrimTails, setFilmTrimTails] = useState(false);
  const [revealingFilm, setRevealingFilm] = useState(false);
  const [revealingEditorFolder, setRevealingEditorFolder] = useState(false);
  const [briefErrorKey, setBriefErrorKey] = useState<string | null>(null);
  const [ruleText, setRuleText] = useState(initialStoredRuleDrafts.add.text);
  const [ruleTerms, setRuleTerms] = useState(initialStoredRuleDrafts.add.termsValue);
  const [ruleValidation, setRuleValidation] = useState<RuleValidation | null>(null);
  const [retainedRuleEdits, setRetainedRuleEdits] = useState<Array<{ rule: StudioBriefRule; originalIndex: number }>>(
    initialStoredRuleDrafts.edits.map(({ baseRule }, index) => ({
      rule: baseRule,
      originalIndex: Math.max(
        0,
        project.rules.findIndex((candidate) => candidate.id === baseRule.id) === -1
          ? index
          : project.rules.findIndex((candidate) => candidate.id === baseRule.id)
      ),
    }))
  );
  const [storedRuleEdits, setStoredRuleEdits] = useState<StoredRuleEditDraft[]>(initialStoredRuleDrafts.edits);
  const [removalFocusRequest, setRemovalFocusRequest] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const imageRouteSelectRef = useRef<SelectHandle | null>(null);
  const videoRouteSelectRef = useRef<SelectHandle | null>(null);
  const addRuleButtonRef = useRef<HTMLButtonElement | null>(null);
  const projectRuleEditButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const removalFocusTargetRef = useRef<string | null | undefined>(undefined);
  const removalAttemptRef = useRef<{
    projectId: string;
    ruleId: string;
    targetId: string | null;
    adoptionKey: string;
  } | null>(null);

  useEffect(() => {
    if (briefDialogRequest <= 0) return;
    setMenuOpen(false);
    setDialog('brief');
  }, [briefDialogRequest]);
  const focusRequestedBriefRoute = useCallback((): void => {
    if (briefRouteFocusRole === 'image') imageRouteSelectRef.current?.focus();
    if (briefRouteFocusRole === 'video') videoRouteSelectRef.current?.focus();
  }, [briefRouteFocusRole]);
  type AddAttempt = {
    projectId: string;
    draft: StudioBriefRuleDraft;
    adoptionKey: string;
  };
  const initialAddAttempt = initialStoredRuleDrafts.add.attempt;
  const [addAttempt, setAddAttempt] = useState<AddAttempt | null>(() =>
    initialAddAttempt === null
      ? null
      : {
          projectId: project.id,
          draft: initialAddAttempt,
          adoptionKey: `add:${project.id}:${initialAddAttempt.id}`,
        }
  );
  const addAttemptRef = useRef<AddAttempt | null>(addAttempt);
  const currentProjectId = useRef(project.id);
  const ruleTextRef = useRef(ruleText);
  const ruleTermsRef = useRef(ruleTerms);
  currentProjectId.current = project.id;
  ruleTextRef.current = ruleText;
  ruleTermsRef.current = ruleTerms;
  addAttemptRef.current = addAttempt;

  const replaceAddAttempt = useCallback((attempt: AddAttempt | null): void => {
    addAttemptRef.current = attempt;
    setAddAttempt(attempt);
  }, []);

  const updateStoredRuleEdit = useCallback((ruleId: string, draft: StoredRuleEditDraft | null): void => {
    setStoredRuleEdits((current) => {
      const index = current.findIndex((candidate) => candidate.baseRule.id === ruleId);
      if (draft === null) return index < 0 ? current : current.filter((_candidate, position) => position !== index);
      if (index < 0) return [...current, draft];
      const next = [...current];
      next[index] = draft;
      return next;
    });
  }, []);

  const ruleDraftDirtyCount =
    storedRuleEdits.length + (ruleText.length > 0 || ruleTerms.length > 0 || addAttempt !== null ? 1 : 0);

  useLayoutEffect(() => {
    persistStoredRuleDrafts(project.id, {
      add: { text: ruleText, termsValue: ruleTerms, attempt: addAttempt?.draft ?? null },
      edits: storedRuleEdits,
    });
  }, [addAttempt, project.id, ruleTerms, ruleText, storedRuleEdits]);

  useLayoutEffect(() => {
    onRuleDraftDirtyCountChange?.(ruleDraftDirtyCount + countStoredRuleDraftsExcept(project.id));
  }, [onRuleDraftDirtyCountChange, project.id, ruleDraftDirtyCount]);

  useLayoutEffect(() => {
    onActiveRuleDraftDirtyCountChange?.(ruleDraftDirtyCount);
    return () => onActiveRuleDraftDirtyCountChange?.(0);
  }, [onActiveRuleDraftDirtyCountChange, ruleDraftDirtyCount]);

  const dirtyCountCallbackRef = useRef(onRuleDraftDirtyCountChange);
  dirtyCountCallbackRef.current = onRuleDraftDirtyCountChange;
  useEffect(
    () => () => {
      dirtyCountCallbackRef.current?.(countStoredRuleDraftsExcept(null));
    },
    []
  );

  useLayoutEffect(() => {
    const targetId = removalFocusTargetRef.current;
    if (targetId === undefined || pending) return;
    removalFocusTargetRef.current = undefined;
    (targetId === null ? null : (projectRuleEditButtonsRef.current.get(targetId) ?? null))?.focus({
      preventScroll: true,
    });
    if (targetId === null || !projectRuleEditButtonsRef.current.has(targetId)) {
      addRuleButtonRef.current?.focus({ preventScroll: true });
    }
  }, [pending, project.rules, removalFocusRequest]);

  useEffect(() => {
    const attempt = removalAttemptRef.current;
    if (
      pending ||
      attempt === null ||
      attempt.projectId !== project.id ||
      project.rules.some((rule) => rule.id === attempt.ruleId)
    ) {
      return;
    }
    removalAttemptRef.current = null;
    acknowledgeRuleAdoption(attempt.adoptionKey);
    removalFocusTargetRef.current = attempt.targetId;
    setRemovalFocusRequest((request) => request + 1);
  }, [acknowledgeRuleAdoption, pending, project.id, project.rules]);

  useEffect(() => {
    const attempt = addAttemptRef.current;
    if (pending || attempt === null || attempt.projectId !== project.id) return;
    const adopted = project.rules.find((rule) => rule.id === attempt.draft.id);
    if (adopted === undefined || !sameRuleDraft(toRuleDraft(adopted), attempt.draft)) return;
    replaceAddAttempt(null);
    acknowledgeRuleAdoption(attempt.adoptionKey);
    const currentTerms = parseTerms(ruleTermsRef.current);
    const currentDraft: StudioBriefRuleDraft = {
      id: attempt.draft.id,
      text: ruleTextRef.current.trim(),
      predicate: currentTerms.length === 0 ? null : { kind: 'forbidden_terms', terms: currentTerms },
    };
    if (sameRuleDraft(currentDraft, attempt.draft)) {
      setRuleText('');
      setRuleTerms('');
    }
  }, [acknowledgeRuleAdoption, pending, project.id, project.rules, replaceAddAttempt]);

  const registerProjectRuleEditButton = (ruleId: string, node: HTMLButtonElement | null): void => {
    if (node === null) projectRuleEditButtonsRef.current.delete(ruleId);
    else projectRuleEditButtonsRef.current.set(ruleId, node);
  };

  const retainRuleEdit = (rule: StudioBriefRule): void => {
    setRetainedRuleEdits((current) =>
      current.some((entry) => entry.rule.id === rule.id)
        ? current
        : [...current, { rule, originalIndex: project.rules.findIndex((candidate) => candidate.id === rule.id) }]
    );
  };

  const finishRuleEdit = (ruleId: string): void => {
    const retained = retainedRuleEdits.find((entry) => entry.rule.id === ruleId);
    setRetainedRuleEdits((current) => current.filter((entry) => entry.rule.id !== ruleId));
    updateStoredRuleEdit(ruleId, null);
    if (project.rules.some((rule) => rule.id === ruleId)) return;
    const originalIndex = retained?.originalIndex ?? project.rules.length;
    removalFocusTargetRef.current = project.rules[originalIndex]?.id ?? project.rules[originalIndex - 1]?.id ?? null;
    setRemovalFocusRequest((request) => request + 1);
  };

  const visibleProjectRules = useMemo(() => {
    const visible = [...project.rules];
    for (const retained of retainedRuleEdits.toSorted((left, right) => left.originalIndex - right.originalIndex)) {
      if (visible.some((rule) => rule.id === retained.rule.id)) continue;
      visible.splice(Math.max(0, Math.min(retained.originalIndex, visible.length)), 0, retained.rule);
    }
    return visible;
  }, [project.rules, retainedRuleEdits]);

  const focusAfterRuleRemoval = (ruleId: string): void => {
    const index = project.rules.findIndex((rule) => rule.id === ruleId);
    removalFocusTargetRef.current = project.rules[index + 1]?.id ?? project.rules[index - 1]?.id ?? null;
    setRemovalFocusRequest((request) => request + 1);
  };

  const restoreTriggerFocus = (): void => triggerRef.current?.focus({ preventScroll: true });
  const openDialog = (next: Exclude<ProjectDialog, null>): void => {
    setMenuOpen(false);
    setDialog(next);
  };

  const filmSetupDraftKeys = [
    'settings.aspectRatio',
    'settings.resolution',
    'brief.text',
    'brief.imageRouteId',
    'brief.videoRouteId',
    'brief.spendCurrency',
    'brief.spendMajorUnits',
  ] as const;

  const resetFilmSetup = (): void => {
    filmSetupDraftKeys.forEach(drafts.reset);
    setBriefErrorKey(null);
  };

  const saveFilmSetup = async (): Promise<void> => {
    const brief = asString(drafts.value('brief.text'));
    const imageRouteId = asString(drafts.value('brief.imageRouteId')) || null;
    const videoRouteId = asString(drafts.value('brief.videoRouteId')) || null;
    const operations: Parameters<typeof mutations.saveFilmSetup>[0]['authoringOperations'] = [];
    if (brief !== project.brief) operations.push({ kind: 'set_brief', brief });
    if (imageRouteId !== project.imageRouteId || videoRouteId !== project.videoRouteId) {
      operations.push({ kind: 'set_routes', imageRouteId, videoRouteId });
    }
    const currency = asString(drafts.value('brief.spendCurrency')).trim().toUpperCase();
    const major = asString(drafts.value('brief.spendMajorUnits')).trim();
    const minor = major.length === 0 ? null : majorUnitsToMinorUnits(major);
    const nextPolicy =
      major.length === 0 ? null : minor === null ? undefined : { currency, maxPerBatchMinorUnits: minor };
    if (nextPolicy === undefined || (nextPolicy !== null && !/^[A-Z]{3}$/.test(currency))) {
      setBriefErrorKey('conversation.creativeStudio.workspace.controls.invalidSpendPolicy');
      return;
    }
    if (JSON.stringify(nextPolicy) !== JSON.stringify(project.spendPolicy)) {
      operations.push({ kind: 'set_spend_policy', policy: nextPolicy });
    }
    const authoringKeys = [
      'brief.text',
      'brief.imageRouteId',
      'brief.videoRouteId',
      'brief.spendCurrency',
      'brief.spendMajorUnits',
    ];
    const shapeKeys = ['settings.aspectRatio', 'settings.resolution'];
    let changedShape: Parameters<typeof mutations.saveFilmSetup>[0]['projectChanges'] = null;
    if (!projection.requestShapeLocked) {
      const shapeChanges = {
        aspectRatio: asString(drafts.value('settings.aspectRatio')) as typeof project.aspectRatio,
        resolution: asString(drafts.value('settings.resolution')) as typeof project.resolution,
      };
      const aspectRatioChanged = shapeChanges.aspectRatio !== project.aspectRatio;
      const resolutionChanged = shapeChanges.resolution !== project.resolution;
      changedShape =
        aspectRatioChanged && resolutionChanged
          ? shapeChanges
          : aspectRatioChanged
            ? { aspectRatio: shapeChanges.aspectRatio }
            : resolutionChanged
              ? { resolution: shapeChanges.resolution }
              : null;
    }
    if (changedShape === null && operations.length === 0) {
      if (!projection.requestShapeLocked) shapeKeys.forEach(drafts.reset);
      authoringKeys.forEach(drafts.reset);
      setBriefErrorKey(null);
      return;
    }
    const result = await mutations.saveFilmSetup({
      projectId: project.id,
      expectedRevision: project.revision,
      projectChanges: changedShape,
      authoringOperations: operations,
    });
    if (!projection.requestShapeLocked && result.projectSettingsSaved) shapeKeys.forEach(drafts.reset);
    if (result.authoringSaved) {
      authoringKeys.forEach(drafts.reset);
      setBriefErrorKey(null);
    }
  };

  const updateRule = async (
    base: StudioBriefRuleDraft,
    next: StudioBriefRuleDraft,
    adoptionKey: string
  ): Promise<boolean> =>
    mutations.setRules((latestRules) => {
      const index = latestRules.findIndex((rule) => rule.id === base.id);
      if (index >= 0 && sameRuleDraft(toRuleDraft(latestRules[index]!), next)) return latestRules.map(toRuleDraft);
      if (index < 0 || !sameRuleDraft(toRuleDraft(latestRules[index]!), base)) return null;
      return latestRules.map((rule, position) => (position === index ? next : toRuleDraft(rule)));
    }, adoptionKey);

  const removeRule = async (base: StudioBriefRuleDraft): Promise<boolean> => {
    const projectIndex = project.rules.findIndex((rule) => rule.id === base.id);
    const attempt = {
      projectId: project.id,
      ruleId: base.id,
      targetId: project.rules[projectIndex + 1]?.id ?? project.rules[projectIndex - 1]?.id ?? null,
      adoptionKey: `remove:${project.id}:${base.id}`,
    };
    removalAttemptRef.current = attempt;
    const removed = await mutations.setRules((latestRules) => {
      const index = latestRules.findIndex((rule) => rule.id === base.id);
      if (index < 0) return latestRules.map(toRuleDraft);
      if (!sameRuleDraft(toRuleDraft(latestRules[index]!), base)) return null;
      return latestRules.filter((_rule, position) => position !== index).map(toRuleDraft);
    }, attempt.adoptionKey);
    if (removed && removalAttemptRef.current === attempt) {
      removalAttemptRef.current = null;
      focusAfterRuleRemoval(base.id);
    }
    return removed;
  };

  const addRule = async (): Promise<void> => {
    const submittedText = ruleText;
    const submittedTermsValue = ruleTerms;
    const terms = parseTerms(submittedTermsValue);
    const invalid = validateRule(submittedText, terms);
    if (invalid !== null) {
      setRuleValidation(invalid);
      return;
    }
    if (organisationRules.length + project.rules.length >= STUDIO_RULE_LIMITS.maxRules) return;
    const normalizedDraft = {
      id: '',
      text: submittedText.trim(),
      predicate: terms.length === 0 ? null : { kind: 'forbidden_terms' as const, terms },
    };
    const priorAttempt = addAttemptRef.current;
    const id =
      priorAttempt !== null &&
      priorAttempt.projectId === project.id &&
      sameRuleDraft({ ...priorAttempt.draft, id: '' }, normalizedDraft)
        ? priorAttempt.draft.id
        : mintRuleId(new Set([...organisationRules, ...project.rules].map((rule) => rule.id)));
    if (id === null) {
      setRuleValidation({ field: 'text', messageKey: 'conversation.creativeStudio.rules.invalidText' });
      return;
    }
    const expectedProjectId = project.id;
    const draft: StudioBriefRuleDraft = {
      id,
      text: normalizedDraft.text,
      predicate: normalizedDraft.predicate,
    };
    const adoptionKey = `add:${expectedProjectId}:${id}`;
    replaceAddAttempt({ projectId: expectedProjectId, draft, adoptionKey });
    setRuleValidation(null);
    const saved = await mutations.setRules((latestRules) => {
      const existing = latestRules.find((rule) => rule.id === id);
      if (existing !== undefined) {
        return sameRuleDraft(toRuleDraft(existing), draft) ? latestRules.map(toRuleDraft) : null;
      }
      if (organisationRules.length + latestRules.length >= STUDIO_RULE_LIMITS.maxRules) {
        return null;
      }
      return [...latestRules.map(toRuleDraft), draft];
    }, adoptionKey);
    if (saved && addAttemptRef.current?.draft.id === id) replaceAddAttempt(null);
    if (
      saved &&
      currentProjectId.current === expectedProjectId &&
      ruleTextRef.current === submittedText &&
      ruleTermsRef.current === submittedTermsValue
    ) {
      setRuleText('');
      setRuleTerms('');
    }
  };

  const changeRuleText = (value: string): void => {
    setRuleText(value);
    if (value.length === 0 && ruleTermsRef.current.length === 0) replaceAddAttempt(null);
  };

  const changeRuleTerms = (value: string): void => {
    setRuleTerms(value);
    if (value.length === 0 && ruleTextRef.current.length === 0) replaceAddAttempt(null);
  };

  const atRuleLimit = organisationRules.length + project.rules.length >= STUDIO_RULE_LIMITS.maxRules;
  const editorFolderPreview = useMemo(() => deriveStudioEditorFolderPreviewV2(project), [project]);
  const editorFolderDisabledKey =
    editorFolderExportStatus.kind === 'exporting'
      ? 'conversation.creativeStudio.workspace.editorFolderExport.disabled.exportRunning'
      : pending
        ? 'conversation.creativeStudio.workspace.editorFolderExport.disabled.mutationActive'
        : exportCatalog === null
          ? 'conversation.creativeStudio.workspace.editorFolderExport.disabled.catalogUnavailable'
          : editorFolderPreview.status === 'blocked'
            ? `conversation.creativeStudio.workspace.editorFolderExport.disabled.${editorFolderPreview.reason}`
            : null;
  const filmExportDisabledKey =
    filmRendererBusyElsewhere || filmExportStatus.kind === 'exporting' || filmExportStatus.kind === 'busy_elsewhere'
      ? 'conversation.creativeStudio.workspace.filmExport.disabled.exportRunning'
      : pending
        ? 'conversation.creativeStudio.workspace.filmExport.disabled.mutationActive'
        : exportCatalog === null
          ? 'conversation.creativeStudio.workspace.filmExport.disabled.catalogUnavailable'
          : editorFolderPreview.status === 'blocked'
            ? `conversation.creativeStudio.workspace.filmExport.disabled.${editorFolderPreview.reason}`
            : null;
  const exportEditorFolder = async (): Promise<void> => {
    if (editorFolderDisabledKey !== null || exportCatalog === null || editorFolderPreview.status !== 'ready') return;
    const beforeIds = new Set(exportCatalog.artifacts.map(({ id }) => id));
    const beforeCount = exportCatalog.artifacts.filter(({ shape }) => shape === 'editor_folder').length;
    const submittedRevision = project.revision;
    const submittedPreview = editorFolderPreview;
    setMenuOpen(false);
    setEditorFolderExportStatus({ kind: 'exporting' });
    const result = await createEditorFolder();
    if (result.ok === false) {
      setEditorFolderExportStatus({ kind: 'failure', messageKey: result.messageKey });
      return;
    }
    const created = result.catalog.artifacts.filter(
      (artifact) =>
        artifact.shape === 'editor_folder' &&
        artifact.sourceRevision === submittedRevision &&
        !beforeIds.has(artifact.id)
    );
    if (created.length !== 1) {
      setEditorFolderExportStatus({
        kind: 'failure',
        messageKey: 'conversation.creativeStudio.workspace.editorFolderExport.errors.resultConflict',
      });
      return;
    }
    const artifact = created[0]!;
    const afterCount = result.catalog.artifacts.filter(({ shape }) => shape === 'editor_folder').length;
    setEditorFolderExportStatus({
      kind: 'success',
      artifactId: artifact.id,
      folderName: artifact.folderName,
      byteSize: artifact.byteSize,
      fileCount: artifact.fileCount,
      slateShotOrdinals: submittedPreview.slateShotOrdinals,
      movedAsideCount: Math.max(0, beforeCount + 1 - afterCount),
    });
  };
  const revealCompletedEditorFolder = async (artifactId: string): Promise<void> => {
    if (revealingEditorFolder || pending) return;
    setRevealingEditorFolder(true);
    const result = await revealEditorFolder(artifactId);
    setRevealingEditorFolder(false);
    if (result.ok === false) setEditorFolderExportStatus({ kind: 'failure', messageKey: result.messageKey });
  };
  const exportFilm = async (): Promise<void> => {
    if (filmExportDisabledKey !== null || exportCatalog === null || editorFolderPreview.status !== 'ready') return;
    const renderId = `film_${crypto.randomUUID().replaceAll('-', '')}`;
    const beforeIds = new Set(exportCatalog.artifacts.map(({ id }) => id));
    const beforeCount = exportCatalog.artifacts.filter(({ shape }) => shape === 'film').length;
    const submittedRevision = project.revision;
    setFilmDialogOpen(false);
    setFilmExportStatus({ kind: 'exporting', renderId, phase: 'preparing', progress: 0 });
    const result = await createFilm({
      renderId,
      transition: filmTransition === 'dissolve' ? { kind: 'dissolve', seconds: 0.35 } : { kind: 'cut' },
      trimTails: filmTrimTails,
    });
    if (result.ok === false) {
      setFilmExportStatus({ kind: 'failure', renderId, messageKey: result.messageKey });
      return;
    }
    const created = result.catalog.artifacts.filter(
      (artifact) =>
        artifact.shape === 'film' && artifact.sourceRevision === submittedRevision && !beforeIds.has(artifact.id)
    );
    if (created.length !== 1 || created[0]!.shape !== 'film') {
      setFilmExportStatus({
        kind: 'failure',
        renderId,
        messageKey: 'conversation.creativeStudio.workspace.filmExport.errors.resultConflict',
      });
      return;
    }
    const artifact = created[0]!;
    const afterCount = result.catalog.artifacts.filter(({ shape }) => shape === 'film').length;
    setFilmExportStatus({
      kind: 'success',
      renderId,
      artifactId: artifact.id,
      folderName: artifact.folderName,
      nominalDurationSeconds: artifact.film.nominalDurationSeconds,
      renderedDurationSeconds: artifact.film.renderedDurationSeconds,
      trimmedShotCount: artifact.film.trimmedShotCount,
      movedAsideCount: Math.max(0, beforeCount + 1 - afterCount),
    });
  };
  const cancelCurrentFilmExport = async (renderId: string): Promise<void> => {
    if (await cancelFilmExport(renderId)) {
      setFilmExportStatus({
        kind: 'failure',
        renderId,
        messageKey: 'conversation.creativeStudio.workspace.filmExport.errors.cancelled',
      });
    }
  };
  const revealCompletedFilm = async (artifactId: string, renderId: string): Promise<void> => {
    if (revealingFilm) return;
    setRevealingFilm(true);
    const result = await revealFilm(artifactId);
    setRevealingFilm(false);
    if (result.ok === false) setFilmExportStatus({ kind: 'failure', renderId, messageKey: result.messageKey });
  };

  const dismissFilmExportResult = async (renderId: string): Promise<void> => {
    const result = await acknowledgeFilmExport(renderId);
    if (result === null) return;
    handledFilmTerminalIdsRef.current.add(renderId);
    setFilmExportStatus({ kind: 'idle' });
  };

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let attachedRenderId: string | null = null;
    const poll = async (): Promise<void> => {
      const result = await getFilmExportStatus();
      if (cancelled) return;
      if (result === null) {
        timer = window.setTimeout((): void => void poll(), 500);
        return;
      }
      if (result.status === 'active') {
        if (result.progress.projectId === project.id) {
          setFilmRendererBusyElsewhere(false);
          attachedRenderId = result.progress.renderId;
          setFilmExportStatus({
            kind: 'exporting',
            renderId: result.progress.renderId,
            phase: result.progress.phase,
            progress: result.progress.progress,
          });
        } else {
          setFilmRendererBusyElsewhere(true);
          attachedRenderId = null;
          setFilmExportStatus((current) =>
            current.kind === 'failure' || current.kind === 'success'
              ? current
              : {
                  kind: 'busy_elsewhere',
                  projectId: result.progress.projectId,
                  renderId: result.progress.renderId,
                  phase: result.progress.phase,
                  progress: result.progress.progress,
                }
          );
        }
      } else if (result.status === 'terminal') {
        setFilmRendererBusyElsewhere(false);
        attachedRenderId = null;
        const terminal = result.result;
        if (!handledFilmTerminalIdsRef.current.has(terminal.renderId)) {
          if (terminal.outcome === 'succeeded') {
            if (!(await refreshExports()) || cancelled) {
              timer = window.setTimeout((): void => void poll(), 500);
              return;
            }
            handledFilmTerminalIdsRef.current.add(terminal.renderId);
            setFilmExportStatus({
              kind: 'success',
              renderId: terminal.renderId,
              artifactId: terminal.artifact.id,
              folderName: terminal.artifact.folderName,
              nominalDurationSeconds: terminal.artifact.film.nominalDurationSeconds,
              renderedDurationSeconds: terminal.artifact.film.renderedDurationSeconds,
              trimmedShotCount: terminal.artifact.film.trimmedShotCount,
              movedAsideCount: terminal.movedAsideCount,
            });
          } else {
            handledFilmTerminalIdsRef.current.add(terminal.renderId);
            const messageKey =
              terminal.outcome === 'cancelled'
                ? 'conversation.creativeStudio.workspace.filmExport.errors.cancelled'
                : terminal.reason === 'stale_authority'
                  ? 'conversation.creativeStudio.workspace.filmExport.errors.staleAuthority'
                  : terminal.reason === 'invalid_media'
                    ? 'conversation.creativeStudio.workspace.filmExport.errors.invalidMedia'
                    : terminal.reason === 'unavailable'
                      ? 'conversation.creativeStudio.workspace.filmExport.errors.unavailable'
                      : 'conversation.creativeStudio.workspace.filmExport.errors.renderFailed';
            setFilmExportStatus({ kind: 'failure', renderId: terminal.renderId, messageKey });
          }
        } else {
          setFilmExportStatus((current) => (current.kind === 'busy_elsewhere' ? { kind: 'idle' } : current));
        }
      } else if (attachedRenderId !== null) {
        setFilmRendererBusyElsewhere(false);
        const settledRenderId = attachedRenderId;
        attachedRenderId = null;
        setFilmExportStatus((current) =>
          current.kind === 'exporting' && current.renderId === settledRenderId ? { kind: 'idle' } : current
        );
      } else {
        setFilmRendererBusyElsewhere(false);
        setFilmExportStatus((current) => (current.kind === 'busy_elsewhere' ? { kind: 'idle' } : current));
      }
      timer = window.setTimeout((): void => void poll(), 500);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [getFilmExportStatus, project.id, refreshExports]);
  const audioImports = projection.cut.audioImports;
  const bedAssetId = projection.cut.bed.assetId;
  const detachAudio = async (assetId: string): Promise<void> => {
    if (assetId === bedAssetId || detachingAssetId !== null) return;
    setDetachingAssetId(assetId);
    try {
      const detached = await detachBedAudio(assetId);
      setAudioAnnouncement(t(`conversation.creativeStudio.workspace.assets.${detached ? 'detached' : 'detachFailed'}`));
    } finally {
      setDetachingAssetId(null);
    }
  };
  const menu = (
    <Menu>
      <Menu.Item key='brief' onClick={() => openDialog('brief')}>
        {t('conversation.creativeStudio.workspace.controls.briefAndRulesTitle')}
      </Menu.Item>
      <Menu.Item key='audio' data-studio-audio-imports onClick={() => setAudioOpen(true)}>
        {t('conversation.creativeStudio.workspace.assets.show')}
      </Menu.Item>
      <Menu.Item
        key='editor-folder-export'
        disabled={editorFolderDisabledKey !== null}
        data-studio-editor-folder-export
        onClick={() => void exportEditorFolder()}
      >
        {editorFolderDisabledKey !== null
          ? t(editorFolderDisabledKey)
          : editorFolderPreview.status === 'ready' && editorFolderPreview.slateCount > 0
            ? t('conversation.creativeStudio.workspace.editorFolderExport.actionWithSlates', {
                count: editorFolderPreview.slateCount,
              })
            : t('conversation.creativeStudio.workspace.editorFolderExport.action')}
      </Menu.Item>
      {filmExportCapability?.status === 'ready' ? (
        <Menu.Item
          key='film-export'
          disabled={filmExportDisabledKey !== null}
          data-studio-film-export
          onClick={() => {
            setMenuOpen(false);
            setFilmDialogOpen(true);
          }}
        >
          {filmExportDisabledKey !== null
            ? t(filmExportDisabledKey)
            : editorFolderPreview.status === 'ready' && editorFolderPreview.slateCount > 0
              ? t('conversation.creativeStudio.workspace.filmExport.actionWithSlates', {
                  count: editorFolderPreview.slateCount,
                })
              : t('conversation.creativeStudio.workspace.filmExport.action')}
        </Menu.Item>
      ) : null}
    </Menu>
  );

  return (
    <>
      <Dropdown
        trigger='click'
        position='br'
        popupVisible={menuOpen}
        droplist={menu}
        getPopupContainer={() => document.body}
        onVisibleChange={setMenuOpen}
      >
        <Button
          ref={(node) => {
            triggerRef.current = node instanceof HTMLButtonElement ? node : null;
          }}
          type='text'
          shape='circle'
          icon={<MoreOne aria-hidden='true' />}
          className={styles.projectMenuTrigger}
          aria-label={t('common.more')}
          aria-haspopup='menu'
          aria-expanded={menuOpen}
          data-studio-project-menu-trigger
        />
      </Dropdown>

      {editorFolderExportStatus.kind === 'idle' ? null : (
        <div className={styles.editorFolderExportStatus} data-studio-editor-folder-export-status>
          {editorFolderExportStatus.kind === 'exporting' ? (
            <Alert
              showIcon
              type='info'
              content={t('conversation.creativeStudio.workspace.editorFolderExport.exporting')}
            />
          ) : editorFolderExportStatus.kind === 'failure' ? (
            <Alert
              showIcon
              type='error'
              content={
                <div className={styles.editorFolderExportStatusContent} role='alert'>
                  <span>{t(editorFolderExportStatus.messageKey)}</span>
                  <Button size='small' onClick={() => setEditorFolderExportStatus({ kind: 'idle' })}>
                    {t('conversation.creativeStudio.workspace.editorFolderExport.dismiss')}
                  </Button>
                </div>
              }
            />
          ) : (
            <Alert
              showIcon
              type='success'
              content={
                <div className={styles.editorFolderExportStatusContent} role='status'>
                  <strong dir='auto'>{editorFolderExportStatus.folderName}</strong>
                  <span>
                    {t('conversation.creativeStudio.workspace.editorFolderExport.successFacts', {
                      bytes: editorFolderExportStatus.byteSize,
                      count: editorFolderExportStatus.fileCount,
                    })}
                  </span>
                  <span>
                    {t('conversation.creativeStudio.workspace.editorFolderExport.successSlates', {
                      shots:
                        editorFolderExportStatus.slateShotOrdinals.length === 0
                          ? t('conversation.creativeStudio.workspace.editorFolderExport.none')
                          : editorFolderExportStatus.slateShotOrdinals.join(', '),
                    })}
                  </span>
                  <span>
                    {t('conversation.creativeStudio.workspace.editorFolderExport.successQuarantine', {
                      count: editorFolderExportStatus.movedAsideCount,
                    })}
                  </span>
                  <div className={styles.editorFolderExportStatusActions}>
                    <Button
                      size='small'
                      loading={revealingEditorFolder}
                      disabled={pending}
                      onClick={() => void revealCompletedEditorFolder(editorFolderExportStatus.artifactId)}
                    >
                      {t('conversation.creativeStudio.workspace.editorFolderExport.reveal')}
                    </Button>
                    <Button size='small' onClick={() => setEditorFolderExportStatus({ kind: 'idle' })}>
                      {t('conversation.creativeStudio.workspace.editorFolderExport.dismiss')}
                    </Button>
                  </div>
                </div>
              }
            />
          )}
        </div>
      )}

      {filmExportStatus.kind === 'idle' ? null : (
        <div className={styles.editorFolderExportStatus} data-studio-film-export-status>
          {filmExportStatus.kind === 'exporting' || filmExportStatus.kind === 'busy_elsewhere' ? (
            <Alert
              showIcon
              type='info'
              content={
                <div className={styles.editorFolderExportStatusContent} role='status'>
                  <span>
                    {filmExportStatus.kind === 'busy_elsewhere'
                      ? t('conversation.creativeStudio.workspace.filmExport.disabled.exportRunning')
                      : t(`conversation.creativeStudio.workspace.filmExport.phase.${filmExportStatus.phase}`)}
                  </span>
                  {filmExportStatus.progress === null ? null : (
                    <Progress percent={Math.round(filmExportStatus.progress * 100)} size='small' />
                  )}
                  {filmExportStatus.kind === 'busy_elsewhere' ? null : (
                    <Button
                      size='small'
                      disabled={filmExportStatus.phase === 'publishing'}
                      onClick={() => void cancelCurrentFilmExport(filmExportStatus.renderId)}
                    >
                      {t('conversation.creativeStudio.workspace.filmExport.cancel')}
                    </Button>
                  )}
                </div>
              }
            />
          ) : filmExportStatus.kind === 'failure' ? (
            <Alert
              showIcon
              type='error'
              content={
                <div className={styles.editorFolderExportStatusContent} role='alert'>
                  <span>{t(filmExportStatus.messageKey)}</span>
                  <Button size='small' onClick={() => void dismissFilmExportResult(filmExportStatus.renderId)}>
                    {t('conversation.creativeStudio.workspace.filmExport.dismiss')}
                  </Button>
                </div>
              }
            />
          ) : (
            <Alert
              showIcon
              type='success'
              content={
                <div className={styles.editorFolderExportStatusContent} role='status'>
                  <strong dir='auto'>{filmExportStatus.folderName}</strong>
                  <span>
                    {t('conversation.creativeStudio.workspace.filmExport.successFacts', {
                      nominal: filmExportStatus.nominalDurationSeconds.toFixed(2),
                      rendered: filmExportStatus.renderedDurationSeconds.toFixed(2),
                      count: filmExportStatus.trimmedShotCount,
                    })}
                  </span>
                  <span>
                    {t('conversation.creativeStudio.workspace.filmExport.successQuarantine', {
                      count: filmExportStatus.movedAsideCount,
                    })}
                  </span>
                  <div className={styles.editorFolderExportStatusActions}>
                    <Button
                      size='small'
                      loading={revealingFilm}
                      onClick={() => void revealCompletedFilm(filmExportStatus.artifactId, filmExportStatus.renderId)}
                    >
                      {t('conversation.creativeStudio.workspace.filmExport.reveal')}
                    </Button>
                    <Button size='small' onClick={() => void dismissFilmExportResult(filmExportStatus.renderId)}>
                      {t('conversation.creativeStudio.workspace.filmExport.dismiss')}
                    </Button>
                  </div>
                </div>
              }
            />
          )}
        </div>
      )}

      <Modal
        title={t('conversation.creativeStudio.workspace.filmExport.title')}
        visible={filmDialogOpen}
        okText={t('conversation.creativeStudio.workspace.filmExport.export')}
        cancelText={t('common.cancel')}
        unmountOnExit
        onCancel={() => setFilmDialogOpen(false)}
        onOk={() => void exportFilm()}
      >
        <div className={styles.modalBody} data-studio-film-export-dialog>
          <p>{t('conversation.creativeStudio.workspace.filmExport.description')}</p>
          <label>
            <span>{t('conversation.creativeStudio.workspace.filmExport.transition')}</span>
            <Select value={filmTransition} onChange={(value) => setFilmTransition(value as 'cut' | 'dissolve')}>
              <Select.Option value='cut'>{t('conversation.creativeStudio.workspace.filmExport.cut')}</Select.Option>
              <Select.Option value='dissolve'>
                {t('conversation.creativeStudio.workspace.filmExport.dissolve')}
              </Select.Option>
            </Select>
          </label>
          <div>
            <Checkbox checked={filmTrimTails} onChange={setFilmTrimTails}>
              {t('conversation.creativeStudio.workspace.filmExport.trimTails')}
            </Checkbox>
            <p className={styles.fieldHint}>{t('conversation.creativeStudio.workspace.filmExport.trimTailsHelp')}</p>
          </div>
          <p>{t('conversation.creativeStudio.workspace.filmExport.noSpend')}</p>
        </div>
      </Modal>

      <Drawer
        footer={
          <Button onClick={() => setAudioOpen(false)}>{t('conversation.creativeStudio.workspace.assets.close')}</Button>
        }
        onCancel={() => setAudioOpen(false)}
        title={t('conversation.creativeStudio.workspace.assets.title')}
        visible={audioOpen}
        width={560}
      >
        <div className={styles.modalBody} data-studio-audio-drawer>
          <p>{t('conversation.creativeStudio.workspace.assets.description')}</p>
          <p aria-atomic='true' aria-live='polite' role='status'>
            {audioAnnouncement}
          </p>
          {audioImports.length === 0 ? (
            <p>{t('conversation.creativeStudio.workspace.assets.audioEmpty')}</p>
          ) : (
            <ul>
              {audioImports.map((asset) => {
                const selected = asset.assetId === bedAssetId;
                return (
                  <li key={asset.assetId} data-audio-position={asset.position}>
                    <div>
                      <strong>
                        <bdi>
                          {t('conversation.creativeStudio.workspace.assets.audioItem', { position: asset.position })}
                        </bdi>
                      </strong>
                      <p>
                        <bdi>
                          {t('conversation.creativeStudio.workspace.assets.audioFacts', {
                            seconds: asset.durationSeconds,
                            bytes: asset.byteSize,
                          })}
                        </bdi>
                      </p>
                      {selected ? <span>{t('conversation.creativeStudio.workspace.assets.selectedBed')}</span> : null}
                    </div>
                    <Popconfirm
                      cancelText={t('conversation.creativeStudio.workspace.assets.cancel')}
                      content={t('conversation.creativeStudio.workspace.assets.detachContent')}
                      disabled={selected}
                      okText={t('conversation.creativeStudio.workspace.assets.detach')}
                      onOk={() => void detachAudio(asset.assetId)}
                      title={t('conversation.creativeStudio.workspace.assets.detachTitle')}
                    >
                      <Button disabled={selected} loading={detachingAssetId === asset.assetId} status='danger'>
                        {t('conversation.creativeStudio.workspace.assets.detach')}
                      </Button>
                    </Popconfirm>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Drawer>

      <Modal
        visible={dialog === 'brief'}
        title={t('conversation.creativeStudio.workspace.controls.briefAndRulesTitle')}
        footer={null}
        unmountOnExit={false}
        className={styles.projectModal}
        onCancel={() => setDialog(null)}
        afterOpen={focusRequestedBriefRoute}
        afterClose={restoreTriggerFocus}
      >
        <div className={styles.modalBody} data-studio-brief-rules>
          {errorMessageKey === null ? null : <Alert type='error' content={t(errorMessageKey)} />}
          {briefErrorKey === null ? null : <Alert type='warning' content={t(briefErrorKey)} />}
          {drafts.staleRevision ? (
            <Alert type='error' content={t('conversation.creativeStudio.workspace.controls.draftConflict')} />
          ) : null}

          <section className={styles.modalSection}>
            <h3>{t('conversation.creativeStudio.workspace.controls.briefTitle')}</h3>
            <label>
              {t('conversation.creativeStudio.workspace.controls.brief')}
              <Input.TextArea
                disabled={pending}
                autoSize={{ minRows: 3, maxRows: 8 }}
                value={asString(drafts.value('brief.text'))}
                onChange={(value) => drafts.setValue('brief.text', value)}
              />
            </label>
            <div className={styles.formGrid}>
              <label>
                {t('conversation.creativeStudio.workspace.controls.imageRoute')}
                <AccessibleSelect
                  accessibleName={t('conversation.creativeStudio.workspace.controls.imageRoute')}
                  allowClear
                  controlRef={imageRouteSelectRef}
                  disabled={pending}
                  value={asString(drafts.value('brief.imageRouteId')) || undefined}
                  onChange={(value) => drafts.setValue('brief.imageRouteId', value ?? '')}
                >
                  {routeCatalog?.image.options.map((route) => (
                    <Select.Option key={route.choiceId} value={route.choiceId}>
                      {route.providerName} · {route.model}
                    </Select.Option>
                  ))}
                </AccessibleSelect>
                <small>
                  {t(
                    `conversation.creativeStudio.workspace.controls.routeStatus.${routeCatalog?.image.status ?? 'unavailable'}`
                  )}
                </small>
                {generationBlocksForRole('image').map((block) => {
                  const message = generationBlockMessage(block);
                  return (
                    <small data-generation-block-role='image' key={JSON.stringify(block)} role='status'>
                      {t(message.key, message.values)}
                    </small>
                  );
                })}
              </label>
              <label>
                {t('conversation.creativeStudio.workspace.controls.videoRoute')}
                <AccessibleSelect
                  accessibleName={t('conversation.creativeStudio.workspace.controls.videoRoute')}
                  allowClear
                  controlRef={videoRouteSelectRef}
                  disabled={pending}
                  value={asString(drafts.value('brief.videoRouteId')) || undefined}
                  onChange={(value) => drafts.setValue('brief.videoRouteId', value ?? '')}
                >
                  {routeCatalog?.video.options.map((route) => (
                    <Select.Option key={route.choiceId} value={route.choiceId}>
                      {route.providerName} · {route.model}
                    </Select.Option>
                  ))}
                </AccessibleSelect>
                <small>
                  {t(
                    `conversation.creativeStudio.workspace.controls.routeStatus.${routeCatalog?.video.status ?? 'unavailable'}`
                  )}
                </small>
                {generationBlocksForRole('video').map((block) => {
                  const message = generationBlockMessage(block);
                  return (
                    <small data-generation-block-role='video' key={JSON.stringify(block)} role='status'>
                      {t(message.key, message.values)}
                    </small>
                  );
                })}
              </label>
              <label>
                {t('conversation.creativeStudio.workspace.controls.aspectRatio')}
                <AccessibleSelect
                  accessibleName={t('conversation.creativeStudio.workspace.controls.aspectRatio')}
                  disabled={pending || projection.requestShapeLocked}
                  value={asString(drafts.value('settings.aspectRatio'))}
                  onChange={(value) => drafts.setValue('settings.aspectRatio', value)}
                >
                  {['16:9', '9:16', '1:1', '4:3', '3:4'].map((value) => (
                    <Select.Option key={value} value={value}>
                      {value}
                    </Select.Option>
                  ))}
                </AccessibleSelect>
              </label>
              <label>
                {t('conversation.creativeStudio.workspace.controls.resolution')}
                <AccessibleSelect
                  accessibleName={t('conversation.creativeStudio.workspace.controls.resolution')}
                  disabled={pending || projection.requestShapeLocked}
                  value={asString(drafts.value('settings.resolution'))}
                  onChange={(value) => drafts.setValue('settings.resolution', value)}
                >
                  <Select.Option value='720p'>720p</Select.Option>
                  <Select.Option value='1080p'>1080p</Select.Option>
                </AccessibleSelect>
              </label>
              <label>
                {t('conversation.creativeStudio.workspace.controls.spendCurrency')}
                <Input
                  disabled={pending}
                  maxLength={3}
                  value={asString(drafts.value('brief.spendCurrency'))}
                  onChange={(value) => drafts.setValue('brief.spendCurrency', value.toUpperCase())}
                />
              </label>
              <label>
                {t('conversation.creativeStudio.workspace.controls.spendCap')}
                <Input
                  disabled={pending}
                  value={asString(drafts.value('brief.spendMajorUnits'))}
                  onChange={(value) => drafts.setValue('brief.spendMajorUnits', value)}
                />
              </label>
            </div>
            <p className={styles.ruleDescription}>
              {t(
                projection.requestShapeLocked
                  ? 'conversation.creativeStudio.workspace.controls.requestShapeLocked'
                  : 'conversation.creativeStudio.workspace.controls.settingsEffect'
              )}
            </p>
            <div className={styles.actions}>
              <Button disabled={pending} onClick={() => void mutations.refreshRoutes()}>
                {t('conversation.creativeStudio.workspace.controls.refreshRoutes')}
              </Button>
              <span className={styles.actionGroup}>
                <Button disabled={pending} onClick={resetFilmSetup}>
                  {t('conversation.creativeStudio.workspace.controls.reset')}
                </Button>
                <Button type='primary' disabled={pending || drafts.staleRevision} onClick={() => void saveFilmSetup()}>
                  {t('conversation.creativeStudio.workspace.controls.saveBrief')}
                </Button>
              </span>
            </div>
          </section>

          <section className={styles.modalSection}>
            <h3>{t('conversation.creativeStudio.rules.title')}</h3>
            <p className={styles.ruleDescription}>{t('conversation.creativeStudio.rules.description')}</p>
            <p className={styles.ruleDescription}>{t('conversation.creativeStudio.rules.precedence')}</p>

            {organisationRules.length === 0 && visibleProjectRules.length === 0 ? (
              <p className={styles.ruleDescription}>{t('conversation.creativeStudio.rules.empty')}</p>
            ) : (
              <ul className={styles.ruleList}>
                {organisationRules.map((rule) => (
                  <li key={rule.id} className={styles.ruleCard} data-studio-organisation-rule={rule.id}>
                    <RuleTags rule={rule} locked />
                    <p className={styles.ruleText} dir='auto'>
                      {rule.text}
                    </p>
                    {rule.predicate === null ? null : (
                      <p className={styles.ruleTerms} dir='auto'>
                        {rule.predicate.terms.join(', ')}
                      </p>
                    )}
                  </li>
                ))}
                {visibleProjectRules.map((rule) => (
                  <ProjectRuleCard
                    key={`${project.id}:${rule.id}`}
                    rule={rule}
                    initialDraft={storedRuleEdits.find((draft) => draft.baseRule.id === rule.id)}
                    pending={pending}
                    onSave={updateRule}
                    onRemove={removeRule}
                    onAdopted={acknowledgeRuleAdoption}
                    onEditStarted={retainRuleEdit}
                    onEditFinished={finishRuleEdit}
                    onDraftChange={updateStoredRuleEdit}
                    registerEditButton={registerProjectRuleEditButton}
                  />
                ))}
              </ul>
            )}

            <ul className={styles.ruleLegend}>
              <li>
                <Tag>{t('conversation.creativeStudio.rules.enforcedBadge')}</Tag>
                <span>{t('conversation.creativeStudio.rules.enforcedHelp')}</span>
              </li>
              <li>
                <Tag>{t('conversation.creativeStudio.rules.contextOnlyBadge')}</Tag>
                <span>{t('conversation.creativeStudio.rules.contextOnlyHelp')}</span>
              </li>
            </ul>

            <div className={styles.ruleAddForm}>
              <label>
                {t('conversation.creativeStudio.rules.textLabel')}
                <Input.TextArea
                  disabled={pending}
                  maxLength={RULE_DRAFT_ADD_INPUT_MAX}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  value={ruleText}
                  error={ruleValidation?.field === 'text'}
                  aria-invalid={ruleValidation?.field === 'text'}
                  placeholder={t('conversation.creativeStudio.rules.textPlaceholder')}
                  onChange={changeRuleText}
                />
              </label>
              <label>
                {t('conversation.creativeStudio.rules.termsLabel')}
                <Input
                  disabled={pending}
                  maxLength={RULE_DRAFT_ADD_INPUT_MAX}
                  value={ruleTerms}
                  error={ruleValidation?.field === 'terms'}
                  aria-invalid={ruleValidation?.field === 'terms'}
                  placeholder={t('conversation.creativeStudio.rules.termsPlaceholder')}
                  onChange={changeRuleTerms}
                />
              </label>
              <p className={styles.ruleDescription}>{t('conversation.creativeStudio.rules.termsHelp')}</p>
              {ruleValidation === null ? null : <RuleValidationMessage validation={ruleValidation} />}
              {atRuleLimit ? (
                <p className={styles.ruleDescription}>{t('conversation.creativeStudio.rules.limitReached')}</p>
              ) : null}
              <Button
                ref={(node) => {
                  addRuleButtonRef.current = node instanceof HTMLButtonElement ? node : null;
                }}
                type='primary'
                loading={pending}
                disabled={pending || atRuleLimit}
                onClick={() => void addRule()}
              >
                {t('conversation.creativeStudio.rules.add')}
              </Button>
            </div>
          </section>
        </div>
      </Modal>
    </>
  );
};

export const WorkspaceProjectMenu: React.FC<WorkspaceProjectMenuProps> = (props) => (
  <ProjectScopedWorkspaceProjectMenu key={props.project.id} {...props} />
);
