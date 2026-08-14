/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAspectRatio,
  StudioMediaKind,
  StudioOutputRole,
  StudioResolution,
  StudioSceneGenerationChoice,
  StudioSceneReferencePrompt,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioRuleBreach } from '@/common/types/project/creativeStudioRules';
import type { GenerationReviewRouteSnapshot } from './generationRequests';
import { Alert, Button, Modal, Tag } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import studioType from '../../StudioTypography.module.css';

type ActionResult = void | Promise<unknown>;

export type GenerationReviewRoute =
  | {
      status: 'valid' | 'invalid';
      snapshot: GenerationReviewRouteSnapshot;
      providerName: string | null;
      silentOutput: boolean | null;
    }
  | {
      status: 'missing';
      snapshot: null;
      providerName: null;
    };

export type GenerationReviewScene = {
  id: string;
  title: string;
  mediaKind: StudioMediaKind;
  outputRole: StudioOutputRole;
  durationSeconds: number;
  /**
   * The authored string main evaluates before sending the prompt: the reference plate subject for
   * outputRole 'reference', the scene's visual prompt otherwise. It mirrors jobManager's
   * `output.role === 'reference' ? stripFirstFramePromptPrefix(baseRequest.prompt, aspectRatio) :
   * baseRequest.prompt`, because a rule verdict computed against a different string than main checks
   * is worse than no verdict.
   */
  promptText: string;
  route: GenerationReviewRoute;
  /** The picture this scene's reference plate should paint. Present only for outputRole 'reference'. */
  referencePrompt?: string;
};

export type GenerationReviewConfirmation = {
  sceneIds: string[];
  routes: StudioSceneGenerationChoice[];
};

/**
 * The submission the modal's confirm button would produce, or `null` when it would be disabled.
 *
 * Exported so the Director's auto-submitted image requests go through the *same* validity rule as
 * a human pressing Confirm. Both paths spend money, so a second implementation that drifted from
 * this one would submit routes the modal refuses. Returns `null` unless every scene resolves to a
 * valid, matching route — a partial batch is never submitted silently.
 */
export const collectSubmittableRoutes = (
  scenes: readonly GenerationReviewScene[]
): GenerationReviewConfirmation | null => {
  if (scenes.length === 0) return null;
  const validRoutes = scenes
    .filter((scene) => scene.route.status === 'valid' && routeMatchesScene(scene))
    .map((scene) => scene.route.snapshot)
    .filter((route): route is GenerationReviewRouteSnapshot => route !== null);
  if (validRoutes.length !== scenes.length) return null;
  return {
    sceneIds: scenes.map((scene) => scene.id),
    routes: validRoutes.map(({ sceneId, choiceId, kind }) => ({ sceneId, choiceId, kind })),
  };
};

export type ExactGenerationReviewSubmitResult = 'rejected' | 'not_submitted' | 'submitted';

/** Keeps the reviewed IDs/routes as the final authority immediately in front of paid submission. */
export const submitExactGenerationReview = async (
  scenes: readonly GenerationReviewScene[],
  confirmation: GenerationReviewConfirmation,
  submitScenes: (confirmation: GenerationReviewConfirmation) => Promise<boolean>
): Promise<ExactGenerationReviewSubmitResult> => {
  const reviewed = collectSubmittableRoutes(scenes);
  const matches =
    reviewed !== null &&
    reviewed.sceneIds.length === confirmation.sceneIds.length &&
    reviewed.sceneIds.every((sceneId, index) => sceneId === confirmation.sceneIds[index]) &&
    reviewed.routes.length === confirmation.routes.length &&
    reviewed.routes.every((route, index) => {
      const candidate = confirmation.routes[index];
      return (
        candidate !== undefined &&
        candidate.sceneId === route.sceneId &&
        candidate.choiceId === route.choiceId &&
        candidate.kind === route.kind
      );
    });
  if (!matches) return 'rejected';
  return (await submitScenes(reviewed)) ? 'submitted' : 'not_submitted';
};

/**
 * The per-scene reference prompts a submission must carry, or `null` when any submitted scene has
 * none.
 *
 * Main refuses a reference submission whose scenes are not all described, so a caller that cannot
 * build this list must not spend: returning `null` sends it back to the review surface instead.
 */
export const collectReferencePrompts = (
  scenes: readonly GenerationReviewScene[],
  sceneIds: readonly string[]
): StudioSceneReferencePrompt[] | null => {
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const prompts: StudioSceneReferencePrompt[] = [];
  for (const sceneId of sceneIds) {
    const prompt = sceneById.get(sceneId)?.referencePrompt;
    if (prompt === undefined || prompt.trim().length === 0) return null;
    prompts.push({ sceneId, prompt });
  }
  return prompts;
};

export type GenerationReviewExcludedScene = {
  id: string;
  title: string;
  reasonValues?: Record<string, string | number>;
  reasonMessageKey:
    | 'conversation.creativeStudio.scene.status.needs_title'
    | 'conversation.creativeStudio.scene.status.needs_prompt'
    | 'conversation.creativeStudio.scene.status.generating'
    | 'conversation.creativeStudio.scene.status.needs_selection'
    | 'conversation.creativeStudio.scene.status.generated'
    | 'conversation.creativeStudio.scene.status.needs_attention'
    | 'conversation.creativeStudio.reference.excludedUnavailable'
    | 'conversation.creativeStudio.reference.excludedPromptUnusable'
    | 'conversation.creativeStudio.review.excludedFirstFrame'
    | 'conversation.creativeStudio.models.blocked.catalogUnloaded'
    | 'conversation.creativeStudio.models.blocked.noEngine'
    | 'conversation.creativeStudio.models.blocked.needsSetup'
    | 'conversation.creativeStudio.models.blocked.notAnswering'
    | 'conversation.creativeStudio.models.blocked.retired'
    | 'conversation.creativeStudio.models.engine.frameMismatch'
    | 'conversation.creativeStudio.models.blocked.frame'
    | 'conversation.creativeStudio.models.blocked.resolution'
    | 'conversation.creativeStudio.models.blocked.duration'
    | 'conversation.creativeStudio.models.blocked.firstFrame';
};

export type GenerationReviewModalProps = {
  visible: boolean;
  mode: 'single' | 'batch';
  scenes: GenerationReviewScene[];
  excludedScenes?: GenerationReviewExcludedScene[];
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  targetDurationSeconds: number;
  selectedDurationSeconds: number;
  projectDurationSeconds: number;
  submitting: boolean;
  /** Blocks another paid submit until the parent supplies a newly reviewed intent. */
  submissionBlocked?: boolean;
  errorMessageKey?: string | null;
  /** Breaches computed by the page with the same shared evaluator main uses. */
  ruleBreachesBySceneId?: Record<string, StudioRuleBreach[]>;
  /** Hands the breach to the Director. Absent hides the affordance. */
  onAskDirector?: () => void;
  /** Closes route-blocked review and focuses the matching project engine slot. */
  onSetEngines?: (role: StudioMediaKind) => void;
  onCancel: () => void;
  onConfirm: (confirmation: GenerationReviewConfirmation) => ActionResult;
};

const routeMatchesScene = (scene: GenerationReviewScene): boolean =>
  scene.route.snapshot !== null &&
  scene.route.snapshot.sceneId === scene.id &&
  scene.route.snapshot.kind === scene.mediaKind;

/**
 * Hoisted, not inlined as `= {}`. A fresh object literal in the destructuring default is a new
 * identity on every render, and this value goes into the review `useMemo`'s dependency array — an
 * inline default would defeat that memo for every project with no rules, which is all of them until
 * the user pins one.
 */
const NO_RULE_BREACHES: Record<string, StudioRuleBreach[]> = {};

/**
 * Final paid-generation authorization surface.
 *
 * The component receives only already-sanitized route snapshots. It never
 * resolves providers or submits on open; the explicit confirm action is its
 * sole mutation callback.
 */
export const GenerationReviewModal: React.FC<GenerationReviewModalProps> = ({
  visible,
  mode,
  scenes,
  excludedScenes = [],
  aspectRatio,
  resolution,
  targetDurationSeconds,
  selectedDurationSeconds,
  projectDurationSeconds,
  submitting,
  submissionBlocked = false,
  errorMessageKey = null,
  ruleBreachesBySceneId = NO_RULE_BREACHES,
  onAskDirector,
  onSetEngines,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const review = useMemo(() => {
    const videoSeconds = scenes.reduce(
      (total, scene) => total + (scene.mediaKind === 'video' ? scene.durationSeconds : 0),
      0
    );
    const missingRoute = scenes.some((scene) => scene.route.status === 'missing');
    const invalidRoute = scenes.some(
      (scene) => scene.route.status === 'invalid' || (scene.route.snapshot !== null && !routeMatchesScene(scene))
    );
    const durationMismatch = mode === 'batch' && projectDurationSeconds !== targetDurationSeconds;
    const validRoutes = scenes
      .filter((scene) => scene.route.status === 'valid' && routeMatchesScene(scene))
      .map((scene) => scene.route.snapshot)
      .filter((route): route is GenerationReviewRouteSnapshot => route !== null);
    const knownAudioPolicies = scenes.flatMap((scene) =>
      scene.route.status !== 'missing' && scene.route.silentOutput !== null ? [scene.route.silentOutput] : []
    );
    const audioMessageKey = knownAudioPolicies.includes(false)
      ? 'conversation.creativeStudio.review.audioOn'
      : knownAudioPolicies.length > 0
        ? 'conversation.creativeStudio.review.audioOff'
        : null;
    const ruleBreached = scenes.some((scene) => (ruleBreachesBySceneId[scene.id] ?? []).length > 0);

    return {
      videoSeconds,
      missingRoute,
      invalidRoute,
      durationMismatch,
      validRoutes,
      audioMessageKey,
      ruleBreached,
      canConfirm:
        scenes.length > 0 && !missingRoute && !invalidRoute && !ruleBreached && validRoutes.length === scenes.length,
    };
  }, [mode, projectDurationSeconds, ruleBreachesBySceneId, scenes, targetDurationSeconds]);

  const handleConfirm = (): void => {
    if (!review.canConfirm || submissionBlocked || submitting) return;
    void onConfirm({
      sceneIds: scenes.map((scene) => scene.id),
      routes: review.validRoutes.map(({ sceneId, choiceId, kind }) => ({ sceneId, choiceId, kind })),
    });
  };

  const disabledReason = review.ruleBreached
    ? 'conversation.creativeStudio.rules.breachBlockedConfirm'
    : review.missingRoute || review.invalidRoute
      ? 'conversation.creativeStudio.review.disabledMissingRoutes'
      : null;
  const routeBlockRole = scenes.find((scene) => scene.route.status !== 'valid' || !routeMatchesScene(scene))?.mediaKind;
  const firstFrameExclusions = excludedScenes.filter(
    (scene) => scene.reasonMessageKey === 'conversation.creativeStudio.review.excludedFirstFrame'
  );
  const otherExclusions = excludedScenes.filter(
    (scene) => scene.reasonMessageKey !== 'conversation.creativeStudio.review.excludedFirstFrame'
  );

  const footer = (
    <div className='flex flex-wrap justify-end gap-8px'>
      <Button disabled={submitting} onClick={onCancel}>
        {t('conversation.creativeStudio.review.cancel')}
      </Button>
      {routeBlockRole !== undefined && onSetEngines !== undefined && (
        <Button disabled={submitting} onClick={() => onSetEngines(routeBlockRole)}>
          {t('conversation.creativeStudio.review.setEngines')}
        </Button>
      )}
      <Button
        type='primary'
        loading={submitting}
        disabled={!review.canConfirm || submissionBlocked || submitting}
        onClick={handleConfirm}
      >
        {t('conversation.creativeStudio.review.confirm')}
      </Button>
    </div>
  );

  return (
    <Modal
      visible={visible}
      wrapClassName={studioType.surface}
      title={t('conversation.creativeStudio.review.title')}
      footer={footer}
      closable={!submitting}
      maskClosable={!submitting}
      escToExit={!submitting}
      unmountOnExit
      onCancel={onCancel}
    >
      <div className='flex flex-col gap-14px'>
        <div className='flex flex-wrap gap-8px' aria-live='polite'>
          <Tag>{t('conversation.creativeStudio.review.sceneCount', { count: scenes.length })}</Tag>
          <Tag>{t('conversation.creativeStudio.review.videoSeconds', { seconds: review.videoSeconds })}</Tag>
          <Tag>
            {t('conversation.creativeStudio.review.selectedDurationFull', {
              count: selectedDurationSeconds,
              seconds: selectedDurationSeconds,
            })}
          </Tag>
          <Tag>
            {t('conversation.creativeStudio.review.targetDurationFull', {
              count: targetDurationSeconds,
              seconds: targetDurationSeconds,
            })}
          </Tag>
        </div>

        <dl className='m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12px gap-y-8px rounded-8px bg-fill-1 p-12px'>
          <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.review.aspectRatio')}</dt>
          <dd className='m-0 text-13px text-t-primary'>{aspectRatio}</dd>
          <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.review.resolution')}</dt>
          <dd className='m-0 text-13px text-t-primary'>{resolution}</dd>
        </dl>

        <div className='flex flex-col gap-10px'>
          {scenes.map((scene) => (
            <article
              key={scene.id}
              aria-label={scene.title}
              className='rounded-8px border border-border-2 bg-bg-2 p-12px'
            >
              <div className='mb-10px flex flex-wrap items-center gap-8px'>
                <h3 className='m-0 min-w-0 flex-1 truncate text-14px font-600 text-t-primary'>{scene.title}</h3>
                <Tag>
                  {t(
                    scene.mediaKind === 'image'
                      ? 'conversation.creativeStudio.scene.image'
                      : 'conversation.creativeStudio.scene.video'
                  )}
                </Tag>
                {scene.outputRole === 'reference' && <Tag>{t('conversation.creativeStudio.reference.reviewTag')}</Tag>}
                <Tag>
                  {t('conversation.creativeStudio.scene.durationSeconds', {
                    count: scene.durationSeconds,
                    seconds: scene.durationSeconds,
                  })}
                </Tag>
              </div>
              {scene.route.snapshot === null ? (
                <Alert type='warning' content={t('conversation.creativeStudio.review.missingRoute')} />
              ) : (
                <>
                  <dl className='m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12px gap-y-6px'>
                    <dt className='text-12px text-t-tertiary'>
                      {t('conversation.creativeStudio.review.providerLabel')}
                    </dt>
                    <dd className='m-0 break-all text-12px text-t-primary'>
                      {scene.route.providerName ?? t('conversation.creativeStudio.models.unavailable')}
                    </dd>
                    <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.review.modelLabel')}</dt>
                    <dd className='m-0 break-all text-12px text-t-primary'>{scene.route.snapshot.model}</dd>
                  </dl>
                  {(scene.route.status === 'invalid' || !routeMatchesScene(scene)) && (
                    <Alert
                      className='mt-10px'
                      type='error'
                      content={t('conversation.creativeStudio.review.invalidRoute')}
                    />
                  )}
                </>
              )}
              {(ruleBreachesBySceneId[scene.id] ?? []).map((breach) => (
                <Alert
                  key={breach.ruleId}
                  className='mt-10px'
                  type='error'
                  content={t('conversation.creativeStudio.rules.breachScene', {
                    rule: breach.ruleText,
                    term: breach.matchedTerm,
                  })}
                />
              ))}
            </article>
          ))}
        </div>

        {otherExclusions.length > 0 && (
          <Alert
            type='warning'
            content={
              <div>
                <p className='m-0'>{t('conversation.creativeStudio.reference.excludedSummary')}</p>
                <ul className='mb-0 mt-6px pl-18px'>
                  {otherExclusions.map((scene) => (
                    <li key={scene.id}>
                      <span>{scene.title}</span>
                      <span> — {t(scene.reasonMessageKey, scene.reasonValues)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            }
          />
        )}

        {firstFrameExclusions.length > 0 && (
          <Alert
            type='warning'
            content={
              <div>
                <p className='m-0'>
                  {t('conversation.creativeStudio.review.excludedFirstFrame', {
                    count: firstFrameExclusions.length,
                  })}
                </p>
                <ul className='mb-0 mt-6px pl-18px'>
                  {firstFrameExclusions.map((scene) => (
                    <li key={scene.id}>{scene.title}</li>
                  ))}
                </ul>
              </div>
            }
          />
        )}

        {review.durationMismatch && (
          <Alert type='warning' content={t('conversation.creativeStudio.review.durationMismatch')} />
        )}

        <div className='flex flex-col gap-8px'>
          <Alert type='info' content={t('conversation.creativeStudio.review.watermarkOff')} />
          {review.audioMessageKey && <Alert type='info' content={t(review.audioMessageKey)} />}
          <Alert type='warning' content={t('conversation.creativeStudio.review.chargeNotice')} />
        </div>

        {disabledReason && (
          <p role='status' className='m-0 rounded-8px bg-fill-1 p-10px text-12px text-t-secondary'>
            {t(disabledReason)}
          </p>
        )}
        {review.ruleBreached && onAskDirector !== undefined && (
          <div>
            <Button onClick={onAskDirector}>{t('conversation.creativeStudio.rules.breachAskDirector')}</Button>
          </div>
        )}
        {errorMessageKey && (
          <div role='alert' className='rounded-8px border border-danger-3 bg-danger-light-1 p-10px text-danger'>
            {t(errorMessageKey)}
          </div>
        )}
      </div>
    </Modal>
  );
};
