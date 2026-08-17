# Creative Studio 2 — Phase 2A gate record

Phase 2A happy path complete; Level 1 not hardened; 2B next; 2C remains recovery gate.

This is the audited no-spend, direct-free-edit happy path over the existing flat storyboard. It is
not evidence of a general recovery or undo model, nor authority to create media or incur spend.

## Candidate and reviewed boundaries

- Reviewed source candidate: `ae43daae56d2b56b5264e41c55aa0c0a248b07dd` on
  `feat/creative-studio-2`, clean and unsigned before this closeout.
- Its sole parent is `95c58da18bfcb4ed78b1d7547d2499f34610c499`; the ten-task series is linear.
- Approved spec SHA-256: `aa390cdd29f99840070db5eca206e62ac9a3d684e042a021bc273ee4818568fe`.
- Approved plan SHA-256: `93e9cf5d382c84381eaf959148c9210ef43d09e6e57bd9802b2f47c45860e2e2`.
- The independent exact-candidate review passed with no Critical or Important finding for the command
  state machine, store point, filesystem confinement, or spend boundary.

## Automated evidence before closeout

- Task 9 focus: 10 files, 1,013 tests.
- Studio-MCP focus: `bunx vitest run tests/unit/process/creative-studio/service/index.test.ts`,
  238/238 passed on the reviewed candidate.
- The admissible candidate full suite was 652 passed and 1 skipped files; 9,237 passed and 19 skipped
  tests. The final closeout reruns are recorded below rather than inferred from that candidate result.
- Pre-closeout coverage was 67.27% statements, 63.82% branches, 63.89% functions, and 68.78% lines;
  the final closeout coverage replaces or qualifies that measurement below.

### Bounded mailbox timing

| Control                    | Value                          |
| -------------------------- | ------------------------------ |
| Sweep interval             | 500 ms                         |
| ACK grace                  | 2,000 ms                       |
| Slot lease                 | 2,000 ms                       |
| Wait bound                 | 15,000 ms                      |
| Acceptance threshold       | 750 ms                         |
| Isolated run 1 p50/p95/max | 527.076 / 550.452 / 558.256 ms |
| Isolated run 2 p50/p95/max | 534.989 / 548.370 / 548.994 ms |

Each timing run used 30 samples after five warmups.

## Owner-passed human checkpoint

The owner explicitly passed the repaired-descriptor checkpoint. The checked project was
`8efbdb17_9910_41af_9d76_6a0b729ecf37`; it advanced exactly once from revision 8 to 9 through
command `49bcefd3-9953-43bf-a447-0b69936e0e5f`. The Director made one authoritative
`read_storyboard`, one first-try valid `studio_apply_edits`, and one matching
`studio_get_command_status` call.

The command bounded the work to the brief, an existing scene title, and the existing scene order. It
returned one applied receipt with expected revision 8, applied revision 9, and no created scene IDs.
The status read returned that same durable receipt. The live Table adopted the canonical order and
title without reload; no generation review opened.

The durable mailbox contained exactly one terminal applied receipt and no pending command, slot, or
lease. There were no proposals, reference requests, jobs, or assets. Application/store logs after the
checkpoint showed no media/job/generation submission or image/video-provider event; the permitted
Director text turn was the only observed remote activity. This is application/store evidence, not a
provider billing-ledger or packet-capture audit.

The checkpoint application was restarted from this exact worktree with
`AIONUI_ENABLE_CREATIVE_STUDIO=1` and the compatible bundled AionCore on `PATH`; its owning terminal
was then stopped. No 5173 or 9230 listener remained. No provider/project data is needed for this
closeout record.

## Final closeout gates

On the final source tree, all of the following commands exited 0:

| Gate               | Command                                                                          | Fresh result                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Types              | `bunx tsc --noEmit`                                                              | 0 errors                                                                                                                                |
| Gate documentation | `bunx vitest run tests/unit/process/creative-studio/types/documentation.test.ts` | 1 file, 19/19 passed                                                                                                                    |
| i18n               | `bun run i18n:types && node scripts/check-i18n.js`                               | passed; the existing 25-key warnings for zh-CN, ja-JP, zh-TW, and ko-KR remain warnings                                                 |
| Full suite         | `bun run test`                                                                   | 652 passed/1 skipped files; 9,244 passed/19 skipped tests; 213.98 s                                                                     |
| Coverage           | `bun run test:coverage`                                                          | 652 passed/1 skipped files; 9,244 passed/19 skipped tests; 67.27% statements, 63.82% branches, 63.88% functions, 68.78% lines; 289.49 s |

Two earlier full-suite attempts on the same source tree were diagnostic failures under sustained host
load, each with only the loaded-latency maximum over 750 ms: 786.753 ms, then 807.1605 ms. The later
exact-tree full-suite result above passed. Two subsequently isolated measured runs both passed the
unchanged 750 ms threshold: p50/p95/max 537.261/551.059/557.093 ms and
528.683/546.592/550.399 ms. These diagnostics do not loosen the committed timing contract.

## Limits and next gate

Phase 2A is the Level 1 happy path, not hardened Level 1. Phase 2B next expands the model to
Section -> Clip -> Take and Table/Board review. Phase 2C remains the recovery gate for versioned
recovery/checkpointing and exactly-once attribution. Direct edits are not generally undoable:
`StudioRuleListUndo` remains rule-list-only, `set_brief` is the sharpest recovery gap, and paid
authority remains Phase 3b.
