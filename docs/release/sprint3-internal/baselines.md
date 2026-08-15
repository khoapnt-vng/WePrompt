# Sprint 3 Internal Release Baselines

**Captured (UTC):** 2026-08-15T12:07:27Z

**Captured (Asia/Ho_Chi_Minh):** 2026-08-15T19:07:27+07:00

**Purpose:** Freeze the approved release inputs before source implementation. Remote movement observed after these commits is context only and does not silently change the release baseline.

## WePrompt

- Repository: `khoapnt-vng/WePrompt`
- Approved ref: `ghk/sprint3`
- Approved commit: `634f49c21567d9bd987b04887eaa0c6126b86353`
- Parent: `e0dda1747ee75da845cf91b2885edb4f17225a07`
- Commit time: `2026-08-12T11:04:30+07:00`
- Subject: `fix: forward-port three sprint2 commits that never reached sprint3`
- Remote `sprint3` head at capture: `634f49c21567d9bd987b04887eaa0c6126b86353`
- Remote `main` head at capture: `7a4c3cc79eb8ead27141d5af82a623231785786f`
- `v2.1.39` tag at capture: absent
- RC branch: `release/internal-sprint3`
- RC worktree: `/Users/lap16603/Projects/.worktrees/weprompt-internal-sprint3`
- RC worktree state before this record: clean

The pre-existing `/Users/lap16603/Projects/WePrompt` checkout was not used for release edits. At capture it was on `7faf1a54b04c77b0ad491a9fff248d5443774961` with 113,360 porcelain entries, mostly pre-existing untracked application/dependency content. The exact `git status --porcelain=v1 -uall` output hash was `50f468a44a55964495a784fff4eff61e4a50922dea597338f6999d64db3ae91e` (SHA-256). Those files remain outside release scope.

## AionCore

- Repository: `khoapnt-vng/aioncore`
- Approved starting line: current `v0.1.54` line
- Approved commit: `9bd693b3b43cdb1003061de0e4f62259ab6f42ae`
- Parent: `5feac2780b2656aaa92a344dfc27d918af670d28`
- Commit time: `2026-08-11T10:41:19+07:00`
- Subject: `chore(release): bump workspace version to 0.1.54`
- Remote `main` head at capture: `9bd693b3b43cdb1003061de0e4f62259ab6f42ae`
- Remote `security/pilot-hardening-d01-d06` head at capture: `9bd693b3b43cdb1003061de0e4f62259ab6f42ae`
- Remote `fix/mcp-oauth-discovery` head at capture: `fbe0ac6bcccf0eb3bd7db095568fb4de2096ce42`
- Annotated `v0.1.54` tag object: `9bf46ba71eb1e71f7e41a3615d8eae19e0a6d497`
- Peeled `v0.1.54` commit: `9bd693b3b43cdb1003061de0e4f62259ab6f42ae`
- `v0.1.55` tag and GitHub release at capture: absent
- RC branch: `release/internal-v0.1.55`
- RC worktree: `/Users/lap16603/Projects/.worktrees/aioncore-internal-v0.1.55`
- RC worktree state at capture: clean

The pre-existing `/Users/lap16603/Projects/AionCore` checkout was clean at `928f91c8981bb2475040ff05792f01940eaebc97`. Its empty porcelain-output hash was `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (SHA-256). It remains outside release scope.

## Ancestry and Release Boundary

- The WePrompt approved commit exactly equalled remote `ghk/sprint3` at capture.
- The AionCore approved commit exactly equalled the fork's remote `main` and protected pilot-hardening heads at capture.
- Both RC worktrees were created directly from their immutable approved commits.
- Branch names are not release evidence. All subsequent reviews, pins, manifests, artifacts, and acceptance records must use full commit and artifact hashes.
- No tag, release asset, package, or distribution was created during baseline capture.
