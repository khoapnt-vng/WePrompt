/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudioAsset, StudioEditableScene, StudioScene } from '@/common/types/project/creativeStudioTypes';
import { SceneInspector, type SceneInspectorProps } from '@renderer/pages/studio/components/Storyboard/SceneInspector';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'conversation.creativeStudio.inspector.directionTab': 'Visual',
        'conversation.creativeStudio.inspector.scriptTab': 'Script',
        'conversation.creativeStudio.inspector.purposeLabel': 'Scene goal',
        'conversation.creativeStudio.inspector.purposePlaceholder': 'What should this scene accomplish?',
        'conversation.creativeStudio.inspector.visualPromptPlaceholder':
          'Describe the shot, subject, setting, lighting, and motion.',
        'conversation.creativeStudio.inspector.saved': 'Scene saved',
        'conversation.creativeStudio.inspector.unsavedChanges': 'Your unsaved changes are preserved.',
        'conversation.creativeStudio.inspector.saving': 'Saving scene...',
        'conversation.creativeStudio.inspector.saveFailed': 'The scene could not be saved.',
      })[key] ?? key,
  }),
}));

const selectedScene: StudioScene = {
  id: 'scene-1',
  title: 'Rooftop opening',
  purpose: 'Establish the city',
  visualPrompt: 'A quiet rooftop at blue hour',
  narration: 'Every launch starts with a view.',
  onScreenText: 'A new perspective',
  mediaKind: 'video',
  durationSeconds: 7,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'draft',
};

const sceneDraft: StudioEditableScene = {
  title: selectedScene.title,
  purpose: selectedScene.purpose,
  visualPrompt: selectedScene.visualPrompt,
  narration: selectedScene.narration,
  onScreenText: selectedScene.onScreenText,
  mediaKind: selectedScene.mediaKind,
  durationSeconds: selectedScene.durationSeconds,
  referenceAssetId: selectedScene.referenceAssetId,
};

const createProps = (overrides: Partial<SceneInspectorProps> = {}): SceneInspectorProps => ({
  projectId: 'project-1',
  selectedScene,
  referenceAsset: null,
  sceneDraft,
  mutationPending: false,
  errorMessageKey: null,
  saveState: 'saved',
  conflict: false,
  durationBounds: { minDurationSeconds: 1, maxDurationSeconds: 60, source: 'fallback' },
  onUpdateSceneDraft: vi.fn(),
  onFlushSceneDraft: vi.fn(),
  onRetryConflict: vi.fn(),
  onDiscardConflict: vi.fn(),
  importingReference: false,
  onImportReference: vi.fn(),
  ...overrides,
});

describe('SceneInspector', () => {
  it('hydrates the Visual and Script fields with clear labels and prompts', () => {
    const props = createProps();
    render(<SceneInspector {...props} />);

    expect(
      screen.getByRole('region', {
        name: 'conversation.creativeStudio.inspector.sectionsLabel',
      })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.titleLabel')).toHaveValue('Rooftop opening');
    expect(screen.getByText('Visual')).toBeInTheDocument();
    expect(screen.getByText('Script')).toBeInTheDocument();
    expect(screen.getByLabelText('Scene goal')).toHaveValue('Establish the city');
    expect(screen.getByLabelText('Scene goal')).toHaveAttribute('placeholder', 'What should this scene accomplish?');
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.visualPromptLabel')).toHaveValue(
      'A quiet rooftop at blue hour'
    );
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.visualPromptLabel')).toHaveAttribute(
      'placeholder',
      'Describe the shot, subject, setting, lighting, and motion.'
    );
    expect(
      screen.getByRole('combobox', {
        name: 'conversation.creativeStudio.inspector.mediaKindLabel',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('spinbutton', {
        name: 'conversation.creativeStudio.inspector.durationLabel',
      })
    ).toHaveValue('7');

    fireEvent.click(screen.getByText('Script'));
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.narrationLabel')).toHaveValue(
      'Every launch starts with a view.'
    );
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.onScreenTextLabel')).toHaveValue(
      'A new perspective'
    );
  });

  it('reports controlled field edits and flushes the draft on blur', () => {
    const props = createProps();
    render(<SceneInspector {...props} />);

    const title = screen.getByLabelText('conversation.creativeStudio.inspector.titleLabel');
    fireEvent.change(title, { target: { value: 'New opening' } });
    expect(props.onUpdateSceneDraft).toHaveBeenCalledExactlyOnceWith({
      title: 'New opening',
    });
    fireEvent.blur(title);
    expect(props.onFlushSceneDraft).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Script'));
    const narration = screen.getByLabelText('conversation.creativeStudio.inspector.narrationLabel');
    fireEvent.change(narration, { target: { value: 'A revised line.' } });
    expect(props.onUpdateSceneDraft).toHaveBeenLastCalledWith({
      narration: 'A revised line.',
    });
  });

  it.each(['0', '61', '6.5'])(
    'rejects invalid integer duration %s without replacing the controlled draft',
    (invalidDuration) => {
      const props = createProps();
      render(<SceneInspector {...props} />);

      fireEvent.input(
        screen.getByRole('spinbutton', {
          name: 'conversation.creativeStudio.inspector.durationLabel',
        }),
        { target: { value: invalidDuration } }
      );

      expect(props.onUpdateSceneDraft).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.inspector.invalidDuration');
    }
  );

  it('accepts a valid duration as a number', () => {
    const props = createProps();
    render(<SceneInspector {...props} />);

    const duration = screen.getByRole('spinbutton', {
      name: 'conversation.creativeStudio.inspector.durationLabel',
    });
    fireEvent.change(duration, { target: { value: '12' } });
    expect(props.onUpdateSceneDraft).toHaveBeenCalledExactlyOnceWith({
      durationSeconds: 12,
    });
  });

  it.each(['3', '13'])('shows an error for %s seconds outside the selected route bounds', (durationSeconds) => {
    const props = createProps({
      durationBounds: { minDurationSeconds: 4, maxDurationSeconds: 12, source: 'selected_route' },
    });
    render(<SceneInspector {...props} />);

    fireEvent.input(screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.inspector.durationLabel' }), {
      target: { value: durationSeconds },
    });

    expect(props.onUpdateSceneDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.inspector.invalidDuration');
  });

  it.each([4, 12])('saves the selected route boundary value %i', (durationSeconds) => {
    const props = createProps({
      durationBounds: { minDurationSeconds: 4, maxDurationSeconds: 12, source: 'selected_route' },
    });
    render(<SceneInspector {...props} />);

    const duration = screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.inspector.durationLabel' });
    fireEvent.change(duration, { target: { value: String(durationSeconds) } });
    fireEvent.blur(duration);

    expect(props.onUpdateSceneDraft).toHaveBeenCalledExactlyOnceWith({ durationSeconds });
    expect(props.onFlushSceneDraft).toHaveBeenCalledOnce();
  });

  it('recovers with the button stepper after rejecting an invalid raw duration', () => {
    const props = createProps({
      durationBounds: { minDurationSeconds: 4, maxDurationSeconds: 12, source: 'selected_route' },
    });
    const { container } = render(<SceneInspector {...props} />);
    const duration = screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.inspector.durationLabel' });
    const stepUp = container.querySelectorAll('.arco-input-number-step-button')[1];
    if (stepUp === undefined) throw new Error('Duration increment stepper is missing');

    fireEvent.input(duration, { target: { value: '3' } });
    fireEvent.mouseDown(stepUp);

    expect(props.onUpdateSceneDraft).toHaveBeenCalledExactlyOnceWith({ durationSeconds: 8 });
  });

  it('keeps a persisted out-of-range duration visible with an error', () => {
    render(
      <SceneInspector
        {...createProps({
          sceneDraft: { ...sceneDraft, durationSeconds: 3 },
          durationBounds: { minDurationSeconds: 4, maxDurationSeconds: 12, source: 'selected_route' },
        })}
      />
    );

    expect(screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.inspector.durationLabel' })).toHaveValue(
      '3'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.inspector.invalidDuration');
  });

  it('clears a local duration error after a new canonical draft is adopted', () => {
    const props = createProps();
    const view = render(<SceneInspector {...props} />);
    fireEvent.input(
      screen.getByRole('spinbutton', {
        name: 'conversation.creativeStudio.inspector.durationLabel',
      }),
      { target: { value: '0' } }
    );
    expect(screen.getByText('conversation.creativeStudio.inspector.invalidDuration')).toBeInTheDocument();

    view.rerender(
      <SceneInspector
        {...props}
        sceneDraft={{
          ...sceneDraft,
          durationSeconds: 9,
        }}
      />
    );
    expect(screen.queryByText('conversation.creativeStudio.inspector.invalidDuration')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.inspector.durationLabel' }), {
      target: { value: '10' },
    });
    expect(props.onUpdateSceneDraft).toHaveBeenCalledExactlyOnceWith({ durationSeconds: 10 });
  });

  it('keeps errors and conflict recovery actions visible without dropping the draft', () => {
    const props = createProps({
      conflict: true,
      errorMessageKey: 'conversation.creativeStudio.errors.staleProject',
      saveState: 'failed',
    });
    render(<SceneInspector {...props} />);

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.staleProject');
    expect(screen.getByRole('status')).toHaveTextContent('The scene could not be saved.');
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.titleLabel')).toHaveValue('Rooftop opening');

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.storyboard.discard' }));
    expect(props.onRetryConflict).toHaveBeenCalledTimes(1);
    expect(props.onDiscardConflict).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['saved', 'Scene saved'],
    ['dirty', 'Your unsaved changes are preserved.'],
    ['saving', 'Saving scene...'],
    ['failed', 'The scene could not be saved.'],
  ] as const)('announces the %s save state once in the inspector header', (saveState, message) => {
    const { container } = render(<SceneInspector {...createProps({ saveState })} />);

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveAttribute('aria-live', 'polite');
    expect(statuses[0]).toHaveTextContent(message);
    expect(statuses[0]?.closest('header')).not.toBeNull();
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  it('offers a managed first-frame import without accepting renderer file input', () => {
    const props = createProps();
    render(<SceneInspector {...props} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.preview.importReference',
      })
    );

    expect(props.onImportReference).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox', { name: /file/i })).not.toBeInTheDocument();
  });

  it('shows the canonical managed first-frame image after import', () => {
    const referenceAsset: StudioAsset = {
      id: 'reference-1',
      projectId: 'project-1',
      sceneId: selectedScene.id,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'reference-1.png' },
      byteSize: 128,
      sha256: 'a'.repeat(64),
      createdAt: '2026-07-30T00:00:00.000Z',
    };
    render(
      <SceneInspector
        {...createProps({
          selectedScene: {
            ...selectedScene,
            referenceAssetId: referenceAsset.id,
            assetIds: [referenceAsset.id],
          },
          sceneDraft: {
            ...sceneDraft,
            referenceAssetId: referenceAsset.id,
          },
          referenceAsset,
        })}
      />
    );

    expect(
      screen.getByRole('figure', {
        name: 'conversation.creativeStudio.preview.importReference',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'conversation.creativeStudio.preview.importReference',
      })
    ).toHaveAttribute('src', 'weprompt-studio://asset/project-1/reference-1');
  });

  it('shows a generated reference plate from the references collection', () => {
    const referenceAsset: StudioAsset = {
      id: 'reference-generated-1',
      projectId: 'project-1',
      sceneId: selectedScene.id,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'references', fileName: 'reference-generated-1.png' },
      byteSize: 256,
      sha256: 'b'.repeat(64),
      createdAt: '2026-08-11T00:00:00.000Z',
      sourceVisualPrompt: 'First-frame reference plate',
    };
    render(
      <SceneInspector
        {...createProps({
          selectedScene: {
            ...selectedScene,
            referenceAssetId: referenceAsset.id,
            assetIds: [referenceAsset.id],
          },
          sceneDraft: {
            ...sceneDraft,
            referenceAssetId: referenceAsset.id,
          },
          referenceAsset,
        })}
      />
    );

    expect(
      screen.getByRole('img', {
        name: 'conversation.creativeStudio.preview.importReference',
      })
    ).toHaveAttribute('src', 'weprompt-studio://asset/project-1/reference-generated-1');
  });

  it('announces and disables reference import while the native chooser is active', () => {
    render(<SceneInspector {...createProps({ importingReference: true })} />);

    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.preview.importing',
      })
    ).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Scene saved');
  });

  it('disables reference import while another canonical mutation is pending', () => {
    render(<SceneInspector {...createProps({ mutationPending: true })} />);

    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.preview.importReference',
      })
    ).toBeDisabled();
  });

  it('renders a localized empty state instead of editable controls without a selected scene', () => {
    render(
      <SceneInspector
        {...createProps({
          selectedScene: null,
          sceneDraft: null,
        })}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.storyboard.noScenes')).toBeInTheDocument();
    expect(screen.queryByLabelText('conversation.creativeStudio.inspector.titleLabel')).not.toBeInTheDocument();
  });
});
