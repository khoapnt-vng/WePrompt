/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { StudioRulesDrawer } from '@/renderer/pages/studio/components/Rules';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const project = (rules: unknown[] = [], ruleListUndo: unknown = null) =>
  ({ id: 'project_1', revision: 4, rules, ruleListUndo }) as never;
const noOpUndoRules = async (): Promise<boolean> => true;

describe('StudioRulesDrawer', () => {
  it('hides undo when no rule-list write is available', () => {
    render(
      <StudioRulesDrawer
        visible
        project={project()}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={vi.fn()}
        onUndoRules={noOpUndoRules}
      />
    );

    expect(screen.queryByRole('button', { name: 'conversation.creativeStudio.rules.undo' })).not.toBeInTheDocument();
  });

  it('names the removed rule that undo will restore and invokes one undo', async () => {
    const onUndoRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer
        visible
        project={project([], {
          capturedRevision: 3,
          previousRules: [
            {
              id: 'rule_1',
              scope: 'project',
              text: 'Keep the kits generic.',
              predicate: null,
              createdAt: '2026-08-13T00:00:00.000Z',
            },
          ],
        })}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={vi.fn()}
        onUndoRules={onUndoRules}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.rules.undoRemoved')).toBeInTheDocument();
    expect(screen.getByText('Keep the kits generic.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.undo' }));

    await waitFor(() => expect(onUndoRules).toHaveBeenCalledTimes(1));
  });

  it('lists the locked organisation layer as unremovable and the project rules as removable', () => {
    render(
      <StudioRulesDrawer
        visible
        project={project([
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Keep the kits generic.',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ])}
        organisationRules={[
          {
            id: 'org_1',
            scope: 'organisation',
            text: 'No competitor brands.',
            predicate: { kind: 'forbidden_terms', terms: ['acme'] },
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ]}
        onClose={vi.fn()}
        onSetRules={vi.fn()}
        onUndoRules={noOpUndoRules}
      />
    );

    expect(screen.getByText('No competitor brands.')).toBeInTheDocument();
    expect(screen.getByText('Keep the kits generic.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'conversation.creativeStudio.rules.removeAccessible' })).toHaveLength(
      1
    );
  });

  it('sends the whole list with the new rule appended, carrying the project revision', async () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer
        visible
        project={project([
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Keep the kits generic.',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ])}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
        onUndoRules={noOpUndoRules}
      />
    );

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.textLabel'), {
      target: { value: 'No competitor logos.' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.termsLabel'), {
      target: { value: 'acme, globex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    await waitFor(() => expect(onSetRules).toHaveBeenCalledTimes(1));
    expect(onSetRules.mock.calls[0][0]).toEqual([
      { id: 'rule_1', text: 'Keep the kits generic.', predicate: null },
      {
        id: expect.any(String),
        text: 'No competitor logos.',
        predicate: { kind: 'forbidden_terms', terms: ['acme', 'globex'] },
      },
    ]);
  });

  it('explains what each badge means, so the two enforcement states are not a guess', () => {
    render(
      <StudioRulesDrawer
        visible
        project={project()}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={vi.fn()}
        onUndoRules={noOpUndoRules}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.rules.enforcedHelp')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.rules.contextOnlyHelp')).toBeInTheDocument();
  });

  it('refuses an empty rule and never calls the command', () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer
        visible
        project={project()}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
        onUndoRules={noOpUndoRules}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.invalidText');
    expect(onSetRules).not.toHaveBeenCalled();
  });

  it('identifies rule text beyond the shared limit and never calls the command', () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer
        visible
        project={project()}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
        onUndoRules={noOpUndoRules}
      />
    );

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.textLabel'), {
      target: { value: 'x'.repeat(241) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.textTooLong');
    expect(onSetRules).not.toHaveBeenCalled();
  });

  it('identifies more than eight forbidden terms and never calls the command', () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer
        visible
        project={project()}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
        onUndoRules={noOpUndoRules}
      />
    );

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.textLabel'), {
      target: { value: 'Avoid competitor brands.' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.termsLabel'), {
      target: { value: 'one,two,three,four,five,six,seven,eight,nine' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.tooManyTerms');
    expect(onSetRules).not.toHaveBeenCalled();
  });

  it('identifies a forbidden term beyond the shared limit and never calls the command', () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer
        visible
        project={project()}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
        onUndoRules={noOpUndoRules}
      />
    );

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.textLabel'), {
      target: { value: 'Avoid competitor brands.' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.termsLabel'), {
      target: { value: 'x'.repeat(65) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.termTooLong');
    expect(onSetRules).not.toHaveBeenCalled();
  });

  it('identifies a forbidden term with no matchable token and never calls the command', () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer
        visible
        project={project()}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
        onUndoRules={noOpUndoRules}
      />
    );

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.textLabel'), {
      target: { value: 'Avoid competitor brands.' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.termsLabel'), {
      target: { value: '+++' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.termUnusable');
    expect(onSetRules).not.toHaveBeenCalled();
  });

  it('identifies matcher-equivalent forbidden terms and never calls the command', () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer
        visible
        project={project()}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
        onUndoRules={noOpUndoRules}
      />
    );

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.textLabel'), {
      target: { value: 'Avoid competitor brands.' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.termsLabel'), {
      target: { value: 'Nike, Nike!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.duplicateTerm');
    expect(onSetRules).not.toHaveBeenCalled();
  });

  it('reads the adopted project on the next write, so add-then-remove never resends the pre-add list', async () => {
    const onSetRules = vi.fn(async () => true);
    // Stands in for StudioPage: the command succeeds, the page awaits refetch, and the drawer
    // re-renders against the adopted project. Without that adoption the second write would carry
    // the pre-add list AND a stale expectedRevision, which surfaces as `stale_project` in the
    // drawer's error slot with no way forward but closing the project.
    //
    // This harness advances only `rules` and holds `revision: 4` fixed, deliberately rather than by
    // omission: `onSetRules(drafts)` carries no revision, so the drawer has no way to observe one
    // moving — the CAS lives in StudioPage, which reads `project.revision` at call time (Step 8.3).
    // What this test proves is the half the drawer owns: the second write is built from the ADOPTED
    // list rather than the pre-add one. The revision half is proved elsewhere, by Step 8.3's
    // `await refetch()` and by Task 13's end-to-end test asserting `persisted.revision` equals the
    // revision the write returned.
    const Harness: React.FC = () => {
      const [rules, setRules] = React.useState<unknown[]>([]);
      return (
        <StudioRulesDrawer
          visible
          project={project(rules)}
          organisationRules={[]}
          onClose={vi.fn()}
          onSetRules={async (drafts) => {
            setRules(drafts.map((draft) => ({ ...draft, scope: 'project', createdAt: '2026-08-13T00:00:00.000Z' })));
            return onSetRules(drafts);
          }}
          onUndoRules={noOpUndoRules}
        />
      );
    };
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.textLabel'), {
      target: { value: 'No competitor logos.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));
    await waitFor(() => expect(screen.getByText('No competitor logos.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.removeAccessible' }));

    await waitFor(() => expect(onSetRules).toHaveBeenCalledTimes(2));
    expect(onSetRules.mock.calls[1][0]).toEqual([]);
  });

  it('refuses to add past the cap, so the store never rejects a write the UI allowed', () => {
    const onSetRules = vi.fn(async () => true);
    const rules = Array.from({ length: 24 }, (_, index) => ({
      id: `rule_${index}`,
      scope: 'project',
      text: `Rule ${index}.`,
      predicate: null,
      createdAt: '2026-08-13T00:00:00.000Z',
    }));
    render(
      <StudioRulesDrawer
        visible
        project={project(rules)}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
        onUndoRules={noOpUndoRules}
      />
    );

    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' })).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.rules.limitReached')).toBeInTheDocument();
    expect(onSetRules).not.toHaveBeenCalled();
  });
});
