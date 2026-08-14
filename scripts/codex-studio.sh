#!/usr/bin/env bash
#
# Launch Codex on a Creative Studio task, with the reference docs pointed at rather than pasted.
#
#   ./scripts/codex-studio.sh <task-brief.md> [worktree]
#
# Paths, not contents: a pasted doc is stale the moment someone commits; a path never is.
# Verify by branch tip, never by exit code — Codex exits 0 both when the binary is missing and
# when it spins for an hour doing nothing.
set -uo pipefail

CODEX=/Users/lap16603/.codex/plugins/.plugin-appserver/codex
REPO=/Users/lap16603/Projects/WePrompt
BRIEF=${1:?usage: codex-studio.sh <task-brief.md> [worktree]}
WORKTREE=${2:-$REPO/.worktrees/cs2}

[ -x "$CODEX" ] || { echo "FATAL: codex not at $CODEX"; exit 1; }
[ -f "$BRIEF" ]  || { echo "FATAL: no brief at $BRIEF"; exit 1; }
[ -d "$WORKTREE" ] || { echo "FATAL: no worktree at $WORKTREE"; exit 1; }

PREAMBLE="You are working on Creative Studio 2 in the WePrompt repo.

Read these first, from disk, in this order. They are in the repo you are working in:

  1. AGENTS.md — project conventions. Binding.
  2. docs/contributing/creative-studio-2-agent-onboarding.md — the traps that have actually cost
     time here, and the house rules. Read this before touching anything.
  3. docs/design/creative-studio-2-handoff-state.md — what is shipped, what is open, what needs a
     human rather than a commit.
  4. docs/design/creative-studio-2-design-handoff.md — the design and its reasoning, including the
     options that were argued down. Read it before proposing an alternative; it may already be
     there with a reason.

You have no skill system. AGENTS.md points at .claude/skills/*/SKILL.md — read those files
directly as ordinary Markdown when they apply.

Three rules that override anything a task brief says: never run 'git push' or 'just push'; never
add AI signatures (no Co-Authored-By, no 'Generated with'); never weaken the spend fence. If a
claim in your task brief turns out to be wrong, say so plainly in your report rather than working
around it.

Your task follows.

---

"

BEFORE=$(git -C "$WORKTREE" rev-parse HEAD)
echo "worktree : $WORKTREE"
echo "branch   : $(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD)"
echo "base     : $BEFORE"
echo "codex    : $("$CODEX" --version 2>&1 | head -1)"
echo "brief    : $BRIEF"
echo "--- running ---"

"$CODEX" exec \
  -C "$WORKTREE" \
  -s workspace-write \
  --add-dir "$REPO/.git" \
  --color never \
  -o "${BRIEF%.md}-report.md" \
  -c model_reasoning_effort='"high"' \
  "$PREAMBLE$(cat "$BRIEF")"

AFTER=$(git -C "$WORKTREE" rev-parse HEAD)
echo "--- done ---"
echo "tip before : $BEFORE"
echo "tip after  : $AFTER"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "RESULT: NO COMMIT — read ${BRIEF%.md}-report.md and 'git -C $WORKTREE status'"
else
  echo "RESULT: committed"
  git -C "$WORKTREE" log --oneline "$BEFORE..$AFTER"
fi
