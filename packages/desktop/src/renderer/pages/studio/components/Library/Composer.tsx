/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CreateStudioProjectInput, StudioAspectRatio } from '@/common/types/project/creativeStudioTypes';
import { Button, Input, Select } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './StudioLibrary.module.css';

const ASPECT_RATIOS: StudioAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const DURATION_GUESSES = [12, 18, 24, 30, 60] as const;

export type ComposerProps = {
  creating: boolean;
  disabled: boolean;
  errorMessageKey: string | null;
  onSubmit: (input: CreateStudioProjectInput) => Promise<void>;
};

export const Composer: React.FC<ComposerProps> = ({ creating, disabled, errorMessageKey, onSubmit }) => {
  const { t } = useTranslation();
  const [sentence, setSentence] = useState('');
  const [aspectRatio, setAspectRatio] = useState<StudioAspectRatio>('16:9');
  const [targetDurationSeconds, setTargetDurationSeconds] = useState(18);
  const [empty, setEmpty] = useState(false);

  const submit = useCallback(async (): Promise<void> => {
    const brief = sentence.trim();
    if (brief.length === 0) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    await onSubmit({
      name: brief.slice(0, 256),
      brief,
      aspectRatio,
      targetDurationSeconds,
      resolution: '720p',
    });
  }, [aspectRatio, onSubmit, sentence, targetDurationSeconds]);

  return (
    <div className={styles.composer}>
      <label id='studio-composer-title' htmlFor='studio-composer-sentence' className={styles.composerLabel}>
        {t('conversation.creativeStudio.library.composer.label')}
      </label>
      <Input.TextArea
        id='studio-composer-sentence'
        aria-describedby={empty ? 'studio-composer-error' : undefined}
        value={sentence}
        maxLength={16 * 1024}
        rows={1}
        autoSize={{ minRows: 1, maxRows: 6 }}
        className={styles.composerInput}
        placeholder={t('conversation.creativeStudio.library.composer.placeholder')}
        disabled={disabled}
        onChange={(value) => {
          setSentence(value);
          if (value.trim().length > 0) setEmpty(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className={styles.composerActions}>
        <div className={styles.guesses}>
          <Select
            aria-label={t('conversation.creativeStudio.library.composer.aspectRatioLabel')}
            className={styles.guessSelect}
            size='small'
            value={aspectRatio}
            disabled={disabled}
            onChange={(value) => setAspectRatio(value as StudioAspectRatio)}
          >
            {ASPECT_RATIOS.map((value) => (
              <Select.Option key={value} value={value}>
                {value}
              </Select.Option>
            ))}
          </Select>
          <Select
            aria-label={t('conversation.creativeStudio.library.composer.durationLabel')}
            className={styles.guessSelect}
            size='small'
            value={targetDurationSeconds}
            disabled={disabled}
            renderFormat={(option) =>
              t('conversation.creativeStudio.library.composer.durationGuess', { seconds: option?.value ?? 18 })
            }
            onChange={(value) => setTargetDurationSeconds(Number(value))}
          >
            {DURATION_GUESSES.map((seconds) => (
              <Select.Option key={seconds} value={seconds}>
                {t('conversation.creativeStudio.library.composer.durationGuess', { seconds })}
              </Select.Option>
            ))}
          </Select>
        </div>
        <Button
          type='primary'
          size='small'
          className={styles.composerSubmit}
          loading={creating}
          disabled={disabled}
          onClick={() => void submit()}
        >
          {t('conversation.creativeStudio.library.composer.submit')}
        </Button>
      </div>
      {(empty || errorMessageKey !== null) && (
        <p id='studio-composer-error' role='alert' className={styles.alert}>
          {t(empty ? 'conversation.creativeStudio.library.composer.empty' : errorMessageKey!)}
        </p>
      )}
    </div>
  );
};
