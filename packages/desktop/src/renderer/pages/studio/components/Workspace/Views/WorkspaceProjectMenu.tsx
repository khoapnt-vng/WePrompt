/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Alert,
  Button,
  Dropdown,
  Input,
  InputNumber,
  InputTag,
  Menu,
  Modal,
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
import { majorUnitsToMinorUnits } from '../spendGate';
import { generationBlockMessage, generationCapabilityIsCurrent } from '../Gate/generationBlockers';
import type { WorkspaceDraftValue } from '../useWorkspaceDrafts';
import styles from './WorkspaceControls.module.css';
import type { WorkspaceProjectMenuProps } from './viewTypes';

type ProjectDialog = 'settings' | 'brief' | null;

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
const asNumber = (value: WorkspaceDraftValue | undefined): number => (typeof value === 'number' ? value : 0);

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

  const saveSettings = async (): Promise<void> => {
    const changes: Record<string, unknown> = {
      name: asString(drafts.value('settings.name')).trim(),
      targetDurationSeconds: asNumber(drafts.value('settings.targetDurationSeconds')),
    };
    if (!projection.requestShapeLocked) {
      changes.aspectRatio = asString(drafts.value('settings.aspectRatio')) as typeof project.aspectRatio;
      changes.resolution = asString(drafts.value('settings.resolution')) as typeof project.resolution;
    }
    const changed = Object.fromEntries(
      Object.entries(changes).filter(([key, value]) => project[key as keyof typeof project] !== value)
    );
    const savedKeys = ['settings.name', 'settings.targetDurationSeconds'];
    if (!projection.requestShapeLocked) savedKeys.push('settings.aspectRatio', 'settings.resolution');
    if (Object.keys(changed).length === 0) {
      savedKeys.forEach(drafts.reset);
      return;
    }
    if (await mutations.editProject(changed as Parameters<typeof mutations.editProject>[0])) {
      savedKeys.forEach(drafts.reset);
    }
  };

  const saveBrief = async (): Promise<void> => {
    const brief = asString(drafts.value('brief.text'));
    const imageRouteId = asString(drafts.value('brief.imageRouteId')) || null;
    const videoRouteId = asString(drafts.value('brief.videoRouteId')) || null;
    const operations: Parameters<typeof mutations.applyAuthoring>[0] = [];
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
    const savedKeys = [
      'brief.text',
      'brief.imageRouteId',
      'brief.videoRouteId',
      'brief.spendCurrency',
      'brief.spendMajorUnits',
    ];
    if (operations.length === 0) {
      savedKeys.forEach(drafts.reset);
      setBriefErrorKey(null);
      return;
    }
    if (await mutations.applyAuthoring(operations)) {
      savedKeys.forEach(drafts.reset);
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
  const menu = (
    <Menu>
      <Menu.Item key='settings' onClick={() => openDialog('settings')}>
        {t('conversation.creativeStudio.workspace.controls.settingsTitle')}
      </Menu.Item>
      <Menu.Item key='brief' onClick={() => openDialog('brief')}>
        {t('conversation.creativeStudio.workspace.controls.briefAndRulesTitle')}
      </Menu.Item>
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

      <Modal
        visible={dialog === 'settings'}
        title={t('conversation.creativeStudio.workspace.controls.settingsTitle')}
        footer={null}
        unmountOnExit={false}
        className={styles.projectModal}
        onCancel={() => setDialog(null)}
        afterClose={restoreTriggerFocus}
      >
        <div className={styles.modalBody} data-studio-project-settings>
          {errorMessageKey === null ? null : <Alert type='error' content={t(errorMessageKey)} />}
          {drafts.staleRevision ? (
            <Alert type='error' content={t('conversation.creativeStudio.workspace.controls.draftConflict')} />
          ) : null}
          <div className={styles.formGrid}>
            <label>
              {t('conversation.creativeStudio.workspace.controls.name')}
              <Input
                disabled={pending}
                value={asString(drafts.value('settings.name'))}
                onChange={(value) => drafts.setValue('settings.name', value)}
              />
            </label>
            <label>
              {t('conversation.creativeStudio.workspace.controls.targetDuration')}
              <InputNumber
                disabled={pending}
                min={1}
                precision={0}
                value={asNumber(drafts.value('settings.targetDurationSeconds'))}
                onChange={(value) => drafts.setValue('settings.targetDurationSeconds', value ?? 0)}
              />
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
          </div>
          <p>
            {t(
              projection.requestShapeLocked
                ? 'conversation.creativeStudio.workspace.controls.requestShapeLocked'
                : 'conversation.creativeStudio.workspace.controls.settingsEffect'
            )}
          </p>
          <div className={styles.actions}>
            <Button
              disabled={pending}
              onClick={() =>
                [
                  'settings.name',
                  'settings.targetDurationSeconds',
                  'settings.aspectRatio',
                  'settings.resolution',
                ].forEach(drafts.reset)
              }
            >
              {t('conversation.creativeStudio.workspace.controls.reset')}
            </Button>
            <Button type='primary' disabled={pending || drafts.staleRevision} onClick={() => void saveSettings()}>
              {t('conversation.creativeStudio.workspace.controls.saveSettings')}
            </Button>
          </div>
        </div>
      </Modal>

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
            <div className={styles.actions}>
              <Button disabled={pending} onClick={() => void mutations.refreshRoutes()}>
                {t('conversation.creativeStudio.workspace.controls.refreshRoutes')}
              </Button>
              <Button type='primary' disabled={pending || drafts.staleRevision} onClick={() => void saveBrief()}>
                {t('conversation.creativeStudio.workspace.controls.saveBrief')}
              </Button>
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
