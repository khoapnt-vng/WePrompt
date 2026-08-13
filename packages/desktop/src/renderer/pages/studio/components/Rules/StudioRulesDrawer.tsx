/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Drawer, Input, Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  hasRuleToken,
  ORGANISATION_STUDIO_RULES,
  ruleTermMatchKey,
  STUDIO_RULE_LIMITS,
  type StudioBriefRule,
  type StudioBriefRuleDraft,
} from '@/common/types/project/creativeStudioRules';
import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import styles from './StudioRulesDrawer.module.css';

export type StudioRulesDrawerProps = {
  visible: boolean;
  project: Pick<StudioRendererProject, 'id' | 'revision' | 'rules'>;
  /** Injected so tests can exercise the locked layer while it ships empty. */
  organisationRules?: readonly StudioBriefRule[];
  pending?: boolean;
  errorMessageKey?: string | null;
  onClose: () => void;
  onSetRules: (rules: StudioBriefRuleDraft[]) => Promise<boolean>;
};

const toDraft = (rule: StudioBriefRule): StudioBriefRuleDraft => ({
  id: rule.id,
  text: rule.text,
  predicate: rule.predicate === null ? null : { kind: 'forbidden_terms', terms: [...rule.predicate.terms] },
});

const parseTerms = (value: string): string[] => {
  return value
    .split(/[,，、،؛\n]/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
};

type RuleValidation = {
  field: 'text' | 'terms';
  messageKey: string;
  term?: string;
};

/**
 * The document's rule list.
 *
 * It lives in the app frame rather than in a phase for two reasons written down elsewhere: CS2's
 * shell is Table / Board / Cut and Brief is not one of the three (engine-strip.md:54), and Brief is
 * a draft surface whose every mutation forces a project-draft flush (StudioPage beforeMutation).
 * Rules govern the whole document, so the frame owns them and they survive the phase-4 swap.
 *
 * Writes go through the dedicated set-brief-rules command, never through the project draft: the
 * draft resends every field on every flush and dirty-tracks per field, so a rules array there is
 * clobbered wholesale whenever a Director pin races a brief keystroke.
 */
export const StudioRulesDrawer: React.FC<StudioRulesDrawerProps> = ({
  visible,
  project,
  organisationRules = ORGANISATION_STUDIO_RULES,
  pending = false,
  errorMessageKey = null,
  onClose,
  onSetRules,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [terms, setTerms] = useState('');
  const [validation, setValidation] = useState<RuleValidation | null>(null);
  const parsedTerms = parseTerms(terms);
  const atLimit = organisationRules.length + project.rules.length >= STUDIO_RULE_LIMITS.maxRules;

  const add = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setValidation({ field: 'text', messageKey: 'conversation.creativeStudio.rules.invalidText' });
      return;
    }
    if (trimmed.length > STUDIO_RULE_LIMITS.text) {
      setValidation({ field: 'text', messageKey: 'conversation.creativeStudio.rules.textTooLong' });
      return;
    }
    if (atLimit) return;
    if (parsedTerms.length > STUDIO_RULE_LIMITS.maxTerms) {
      setValidation({ field: 'terms', messageKey: 'conversation.creativeStudio.rules.tooManyTerms' });
      return;
    }
    const termTooLong = parsedTerms.find((term) => term.length > STUDIO_RULE_LIMITS.term);
    if (termTooLong !== undefined) {
      setValidation({
        field: 'terms',
        messageKey: 'conversation.creativeStudio.rules.termTooLong',
        term: termTooLong,
      });
      return;
    }
    const unusableTerm = parsedTerms.find((term) => !hasRuleToken(term));
    if (unusableTerm !== undefined) {
      setValidation({
        field: 'terms',
        messageKey: 'conversation.creativeStudio.rules.termUnusable',
        term: unusableTerm,
      });
      return;
    }
    const seenTerms = new Set<string>();
    const duplicateTerm = parsedTerms.find((term) => {
      const key = ruleTermMatchKey(term);
      if (seenTerms.has(key)) return true;
      seenTerms.add(key);
      return false;
    });
    if (duplicateTerm !== undefined) {
      setValidation({
        field: 'terms',
        messageKey: 'conversation.creativeStudio.rules.duplicateTerm',
        term: duplicateTerm,
      });
      return;
    }
    setValidation(null);
    const draft: StudioBriefRuleDraft = {
      id: window.crypto.randomUUID().replaceAll('-', '_'),
      text: trimmed,
      predicate: parsedTerms.length === 0 ? null : { kind: 'forbidden_terms', terms: parsedTerms },
    };
    if (await onSetRules([...project.rules.map(toDraft), draft])) {
      setText('');
      setTerms('');
    }
  };

  const remove = async (ruleId: string): Promise<void> => {
    await onSetRules(project.rules.filter((rule) => rule.id !== ruleId).map(toDraft));
  };

  return (
    <Drawer
      visible={visible}
      title={t('conversation.creativeStudio.rules.title')}
      width={480}
      footer={null}
      onCancel={onClose}
    >
      <div className={styles.body}>
        <p className={styles.description}>{t('conversation.creativeStudio.rules.description')}</p>
        <p className={styles.description}>{t('conversation.creativeStudio.rules.precedence')}</p>

        {organisationRules.length === 0 && project.rules.length === 0 ? (
          <p className={styles.description}>{t('conversation.creativeStudio.rules.empty')}</p>
        ) : (
          <ul className={styles.list}>
            {[...organisationRules, ...project.rules].map((rule) => (
              <li key={rule.id} className={styles.rule}>
                <div className={styles.ruleCopy}>
                  <p className={styles.ruleText}>{rule.text}</p>
                  <div className={styles.ruleMeta}>
                    <Tag>
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
                    {rule.scope === 'organisation' && (
                      <Tag>{t('conversation.creativeStudio.rules.scope.organisationLocked')}</Tag>
                    )}
                    {rule.predicate !== null && <span>{rule.predicate.terms.join(', ')}</span>}
                  </div>
                </div>
                {rule.scope === 'project' && (
                  <Button
                    type='text'
                    status='danger'
                    disabled={pending}
                    aria-label={t('conversation.creativeStudio.rules.removeAccessible', { rule: rule.text })}
                    onClick={() => void remove(rule.id)}
                  >
                    {t('conversation.creativeStudio.rules.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/*
          The two enforcement states are the whole point of the list, and a bare chip does not say
          which one costs money. Rendered once as a legend rather than per rule, so the sentence is
          not repeated N times, and statically rather than as a hover tooltip: Arco renders tooltip
          content into a portal only while hovered, which makes it invisible to
          StudioAccessibleCopy's raw-key sweep and unassertable in jsdom.
        */}
        <ul className={styles.legend}>
          <li className={styles.legendRow}>
            <Tag>{t('conversation.creativeStudio.rules.enforcedBadge')}</Tag>
            <span>{t('conversation.creativeStudio.rules.enforcedHelp')}</span>
          </li>
          <li className={styles.legendRow}>
            <Tag>{t('conversation.creativeStudio.rules.contextOnlyBadge')}</Tag>
            <span>{t('conversation.creativeStudio.rules.contextOnlyHelp')}</span>
          </li>
        </ul>

        <div className={styles.form}>
          <label htmlFor='studio-rule-text' className={styles.label}>
            {t('conversation.creativeStudio.rules.textLabel')}
          </label>
          <Input
            id='studio-rule-text'
            value={text}
            error={validation?.field === 'text'}
            placeholder={t('conversation.creativeStudio.rules.textPlaceholder')}
            aria-label={t('conversation.creativeStudio.rules.textLabel')}
            onChange={setText}
          />
          {validation?.field === 'text' && (
            <span role='alert' className={styles.error}>
              {validation.term === undefined
                ? t(validation.messageKey)
                : t(validation.messageKey, { term: validation.term })}
            </span>
          )}

          <label htmlFor='studio-rule-terms' className={styles.label}>
            {t('conversation.creativeStudio.rules.termsLabel')}
          </label>
          <Input
            id='studio-rule-terms'
            value={terms}
            error={validation?.field === 'terms'}
            placeholder={t('conversation.creativeStudio.rules.termsPlaceholder')}
            aria-label={t('conversation.creativeStudio.rules.termsLabel')}
            onChange={setTerms}
          />
          <p className={styles.help}>{t('conversation.creativeStudio.rules.termsHelp')}</p>
          {validation?.field === 'terms' && (
            <span role='alert' className={styles.error}>
              {validation.term === undefined
                ? t(validation.messageKey)
                : t(validation.messageKey, { term: validation.term })}
            </span>
          )}

          {atLimit && <p className={styles.limit}>{t('conversation.creativeStudio.rules.limitReached')}</p>}
          {errorMessageKey !== null && (
            <span role='alert' className={styles.error}>
              {t(errorMessageKey)}
            </span>
          )}
          <Button type='primary' loading={pending} disabled={atLimit || pending} onClick={() => void add()}>
            {t('conversation.creativeStudio.rules.add')}
          </Button>
        </div>
      </div>
    </Drawer>
  );
};
