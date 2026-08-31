# Working around the AionCore consent gap: copy and visibility

**Date:** 2026-08-31 · **Status:** proposal, for Codex review before implementation
**About:** [BUG-190](./creative-studio-3-bug-list.md) and **BUG-191** · unblocking phase 5 without an
upstream release

## The reframe

BUG-190's accepted conclusion is that there is no safe WePrompt-only fix, because Aionrs collapses
every MCP proxy call into one `mcp` category and `proceed_always` is remembered by category. That
conclusion is correct **about authority**. It is the wrong frame for the product problem.

**MCP consent is not the security boundary here.** Checked against the code:

- **No Director tool can spend.** None of the eleven — `read_storyboard`, `propose_storyboard`,
  `studio_apply_edits`, `studio_apply_free_fix`, `studio_get_command_status`,
  `studio_get_conditioning_frame`, `studio_get_project_status`, `studio_get_proposal`,
  `studio_list_routes`, `studio_propose_paid_recovery`, `studio_request_reference_images` — submits,
  confirms or dispatches a paid job. `studio_propose_paid_recovery` _proposes_; a human confirms on
  the card, and a paid recovery cannot be accepted from chat at all.
- **No tool can change the budget.** `set_spend_policy` is `operation_not_permitted`.
- **No tool can accept a proposal.** The Director has no tool for it, and its own rules say so.
- **Seventeen operations are refused server-side** at `studioServer.ts:843`, `:850` and `:1350`,
  regardless of what consent was granted.

So granting "always" gives the Director exactly what the disposition table already permits. The
authority model is doing its job. What is broken is that **the product asks an unanswerable question
and then hides the fact that it is waiting.**

Both halves are fixable inside WePrompt. Neither needs AionCore.

**What this does not fix, stated plainly:** the grant is category-wide, so a third-party MCP server
later attached to the same Director manager would inherit it. Only the Studio server is attached
today. That is the thing an AionCore fix genuinely buys, and it should stay on the list as a
constraint rather than a blocker.

---

## Fix 1 — the prompt names what it is asking about

### The mechanism is narrower than "it does not handle MCP"

`summarizePermission` (`permissionIntent.ts:49`) **already has an MCP branch**:

```ts
} else if (action === 'mcp') {
  intentKey = 'messages.permission.intent.tool';
} else if (action === 'exec' || command.length > 0) {
  intentKey = 'messages.permission.intent.run';
}
```

It never fires. `action` carries the **tool name** — `studio_get_conditioning_frame` — not the string
`'mcp'`. The `mcp` marker is in `command_type`, which is declared on the message content
(`chatLib.ts:438`) and which `summarizePermission` is never given. So the tool name matches none of
the branches, `command` is non-empty because the MCP description is populated, and it falls through
to `intent.run` — _"I'd like to run a command"_.

That single misattribution is why BUG-190's entry quotes exec copy for an MCP call, and it cost real
diagnostic time: the entry's own author, and later I, both reasoned about the wrong renderer path
because of it.

### The change

**`MessagePermission.tsx:33`** — destructure `command_type` alongside what it already takes, and pass
it through:

```ts
const { options = [], description, title, action, call_id, command_type } = message.content || {};
const summary = summarizePermission({ action, command: description, commandType: command_type });
```

**`permissionIntent.ts:49`** — accept it and check it before the command fall-through:

```ts
export const summarizePermission = (input: {
  action?: string;
  command?: string;
  commandType?: string;
}): PermissionSummary => {
  const command = extractCommand(input.command);
  const destructive = isDestructiveCommand(command);
  const action = (input.action ?? '').toLowerCase();
  const commandType = (input.commandType ?? '').toLowerCase();
  ...
  } else if (commandType === 'mcp' || action === 'mcp') {
    intentKey = 'messages.permission.intent.tool';
  } else if (action === 'exec' || command.length > 0) {
```

No new locale key is needed for this half: `permission.intent.tool` — _"I'd like to use a tool"_ —
already ships in all twelve locales.

### Two decisions for Codex, not assumptions

**Does `destructive` still outrank an MCP tool?** The destructive check runs first, so an MCP
description containing something like `git reset --hard` in prose would render _"I'd like to delete or
remove files"_ for a read-only tool call. The file's own doc says destructive detection deliberately
errs toward flagging, so this may be intended. My inclination is to keep destructive first — a false
caution is cheaper than a missed one — but it should be a decision rather than a side effect.

**Should the prompt name the tool?** It can. `action` already holds the tool name, and the component
already renders `summary.command` in mono beneath the intent line. Naming it would mean a new
interpolated key — _"I'd like to use the {{tool}} tool"_ — and therefore twelve locales. Worth it in
my view, since "a tool" is only marginally better than "a command" for someone deciding whether to
grant. But it is scope, and it is Codex's call whether it belongs in this change.

**What we cannot say:** that the tool is read-only. `readOnlyHint` is exactly what AionCore does not
carry. The prompt must not imply a guarantee the product cannot make.

### Blast radius — the part that needs the most care

`permissionIntent.ts` and `MessagePermission.tsx` are **shared conversation surface**, not Creative
Studio. Every conversation type renders through them. This is the same class of change as the
`buildTurnClose` work in phase 2, which the review flagged for exactly this reason.

The change is additive — a new optional input, a new branch ahead of an existing fall-through — so no
existing path changes unless `command_type === 'mcp'`. That should be asserted rather than assumed:
a test that a non-MCP exec permission still renders `intent.run` is the one that matters.

---

## Fix 2 — a blocked Director is visible from outside the rail (BUG-191)

### What the entry establishes

With the Director rail collapsed, a turn called a tool and stopped on a permission prompt for **almost
four minutes** with no sign of it in the workspace. The rail's composer was still in the DOM and still
accepted a message, but the rail contributed **zero layout** — so the prompt existed in a pane nobody
could see.

It compounds with BUG-190 precisely because the consent dialog **only exists inside the rail**. Anyone
who collapses the rail to look at their work cannot see, or answer, the thing blocking their turn.

### The change

The entry's own fix direction is right: **the rail toggle carries state.** Concretely, three states
rather than one:

| State              | Toggle reads as              | Why                               |
| ------------------ | ---------------------------- | --------------------------------- |
| Idle               | as today                     | no change                         |
| Director working   | a quiet activity indicator   | tells you where the time is going |
| **Blocked on you** | a distinct, non-quiet marker | this is a question, not progress  |

The third is the one that matters, and it must survive the quiet-density instinct: a Director waiting
on a person is not satisfied work, and per the block grammar's own invariant, _density may quieten
satisfied work; it may never quieten a decision._

`WorkspaceShell` already receives Director-derived state as props — `notice`, `proposalInbox`,
`reviewedOutputs`, `projectStatusPending` — so there is precedent for the shell knowing this without
the rail being mounted. A pending-permission signal is one more of the same shape.

**Two things I would hold the fix to:**

**Do not require the rail to be open to answer.** If the marker is only an invitation to expand, the
person still has to leave what they were looking at. Whether the prompt can be answered from the
toggle, or whether expanding is acceptable, is a design question — but "you must reopen the rail" is
the behaviour the bug is about.

**The collapsed rail contributing zero layout is the underlying defect.** A toggle that carries state
fixes the symptom well, and it is worth being explicit that the pane can still hold content nobody
can reach.

### Sequencing

BUG-191 is triaged **absorb · phase 5**, and it sits in `WorkspaceShell` and the rail — both
explicitly kept by the CS4 commission. So this is not work on a deleted surface. Fix 1 is independent
of phase 5 entirely and could land on the shared base at any time.

---

## Why this is worth doing rather than waiting

With both fixes, the flow becomes: a person is told which tool wants to run, sees that their Director
is waiting on them even with the rail collapsed, and grants once — after which the Director works
without interruption, bounded by a disposition table that refuses seventeen operations and a spend
gate that no tool can reach.

That is a defensible product experience built entirely from what we control. The remaining AionCore
ask — authenticated server identity plus narrow read-only authority — stops being a phase gate and
becomes what it should be: a hardening improvement for the day a third-party MCP server is attached.

## Tests this needs

- A non-MCP exec permission still renders `intent.run`. This is the regression that matters, because
  the surface is shared.
- An MCP permission renders `intent.tool` rather than `intent.run`, driven by `command_type` with
  `action` set to a tool name — the exact shape that produced the bug.
- A destructive-looking MCP description renders whatever Codex decides above, asserted either way so
  the precedence is deliberate.
- The rail toggle shows the blocked state while a permission is pending and the rail is collapsed, and
  clears it once answered.
- Twelve locales, in the same change, if the interpolated tool-name key is adopted.
