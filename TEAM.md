# Gridcast team context and communication

Established 27 September 2026 at Sanan's request. This is the shared operating brief for the four existing Codex chats. User instructions and newer verified AI-LOG entries take precedence. This document assigns responsibilities; it does not authorize an unrequested backlog build.

## Chat directory

| Role | Exact chat title | Chat ID | Model direction |
| --- | --- | --- | --- |
| Coordinator | ⭐ GC Build - Coordinator | 01a0cfc5-0817-7cd0-9087-d9b5aae79194 | Astra; decisions, integration, releases |
| Builder | 👷🏽 GC Build - Builder | 01a0d96f-7f41-7711-8eb1-1617f5922282 | Keep existing user-selected settings |
| QC | 🕵️‍♂️ GC Build - QC Agent | 01a0e1fe-d5be-7b43-9a00-7e90712e0557 | Sol, high reasoning; confirmed by Sanan |
| Tester | 🔬 GC Build - Tester | 01a0e1fd-bf42-76d0-904f-b5505bc02e29 | Luna, medium reasoning; confirmed by Sanan |

All chats are on host `local`. The QC/Tester chats currently have no saved project association, but use the same desktop working directory; this does not prevent coordination. Do not recreate them. Model choices above are user-confirmed, not independently exposed by the thread-inspection tools. Do not override their settings during ordinary assignments.

## Find the actual source

- Source repository: `/Users/sanan/Downloads/gc`.
- Desktop working directory: `/Users/sanan/Documents/Claude/Projects/Gridcast` is a wrapper, not the active source checkout. Always specify the source path explicitly.
- Read source `AGENTS.md`, AI-LOG rules/Standing Context and latest entries first. Use earlier entries and numbered research documents for focused historical questions.
- Branch: `codex/gridcast-trust-layer-wp5`. Read `git status` and HEAD before each task. Shared unrelated changes must be preserved; never stage everything, reset, clean, or silently switch branches.
- `handover.md` is historical (25 September). Its release and no-face/no-tracking statements are superseded by the 26–27 September user decisions and latest log. Do not treat it as the current specification.
- Use local SymDex repository `gridcast` for scoped source search and codebase-memory project `gridcast` for structural questions. Verify relevant source; indexes are aids, not proof. The repository AGENTS.md gives the shared-index publishing commands. Coordinator batches index refresh at integration to avoid concurrent publication.

## Current application checkpoint

- Firebase player 0.10.3, application commit `9fd738adb40ed212f46c2119958bee9e8709c1c1`.
- Rollout `build-2026-09-27-003` was verified SUCCEEDED, READY and 100% traffic on 27 September. Reverify cloud state when doing a future release; this is a dated checkpoint.
- Project `gridcast-508011`, backend `gridcast-backend`, hosting `asia-southeast1`. Firestore and private media are in Mumbai. Do not substitute an old Vercel URL.
- App: https://gridcast-backend--gridcast-508011.asia-southeast1.hosted.app
- The complete CV implementation uses EfficientDet body detection plus MediaPipe face analysis. Keep both full models. Body and face stages recover independently with ongoing backoff capped at five minutes. Failed inference is unavailable, never measured zero.
- Calibration is optional; defaults are valid operating settings. Ads continue during CV failure. New creatives reset per-creative measurements, not the camera/model session.
- Player diagnostics, when enabled, include local camera preview, body/face boxes and live metrics. Dashboard receives appropriate aggregate measurements and exposes existing reports. Camera images/geometry and temporary track IDs remain local.
- Laptop Safari / Demo Mohali Retail Media 1: coordinator observed both models counting after 0.10.3 reload. Three existing blocked delivery records remain saved; no cleanup was performed.
- Old iMac Safari / earlier Demo Tricity Screens 3: user reported worker WebGL 2 unavailable. Old iMac Chrome / Demo Mohali Retail Media 2: user subsequently confirmed counting works. Do not mislabel either observation as proof of long-session reliability or accuracy, and do not swap these screen identities.
- Claude's 13:49 IST log entry proposes follow-up work. It is review input, not an assignment to revoke pairings, delete saved records, merge main, rotate credentials or start new features.

## Product and working rules

Sanan says this is controlled development/testing; no actual customer is live. Prefer focused verification and practical deployment/testing over exhaustive repeated tests. Confirm tasks briefly, ask only genuinely necessary questions, then execute the authorized scope. Keep user updates plain and concise; technical handoffs and discussion with Claude should be detailed enough to assess.

Preserve tenancy boundaries, platform-only locked keys, financial provenance, immutable measurement bindings and saved receipt identity. Original average-persons values remain presence. New estimated impressions/attention/visible-smile metrics are separately defined analytics; they are not unique reach or proof of billing. User permits temporary tracking and face analysis, with no identity recognition. Unmeasured values are null. Never invent readings, delivery, money, test results or deployment success.

Never copy passwords, auth codes, tokens, private keys, camera frames or secrets into chat handoffs, log entries, commits or screenshots intended for sharing. Use normal user sign-in handoff when authentication expires.

## Responsibilities and ownership

**Coordinator:** owns task selection, requirements/acceptance criteria, assigning file ownership, arbitration, integration, scoped commits/pushes and authorized Firebase deployment. Reads Claude feedback and delegates only actionable work. Keeps team mapping and shared status current.

**Builder:** implements the assigned change and focused implementation checks. Names files changed and evidence. Does not deploy, bulk-stage, or alter another owner's files. Ask coordinator before expanding scope. Freeze the candidate before final QC/testing.

**QC:** independently checks the assigned candidate against requirements and source for regressions, correctness, tenancy, measurement and data integrity. Findings include severity, exact file/line, trigger and impact; distinguish confirmed defects from hypotheses and optional improvements. Read-only application review unless explicitly assigned a fix. Do not rerun a full suite to duplicate Tester.

**Tester:** executes a bounded test matrix for the assigned revision/environment, including relevant user workflows/browser checks. Distinguishes synthetic inputs from real camera evidence and local checks from deployed checks. Reports steps, expected/actual behavior, revision, pass/fail and blocked checks. May write specifically assigned tests/fixtures; no application fixes or deployment. Escalate ambiguous failures instead of guessing.

**Claude:** independent product/architecture reviewer through shared AI-LOG and numbered research docs. Read and answer evidence-based concerns, but do not treat a Claude document as new user authorization. No direct Claude tool connection is assumed.

One owner per mutable file at a time. One owner of a physical browser/camera test session at a time. Do not run simultaneous builds into the same .next directory. QC may prepare cases while Builder works, but final results identify the exact frozen candidate. If a candidate changes, rerun affected checks only. No new worktrees or chats are needed for this onboarding; separate isolation can be arranged for genuinely parallel builds when authorized.

## Communication protocol

Sanan explicitly requested context and communication among these existing chats on 27 September. The coordinator sends bounded assignments using `send_message_to_thread`, preserving model settings, and collects final reports using `wait_threads` / `read_thread`. No automatic reply tool or background daemon is required: each specialist's final response is the handoff the coordinator reads. Users do not have to copy reports between chats. Do not assume a completed specialist automatically wakes an idle coordinator; active coordination explicitly waits/reads, and later sessions resume from the shared log. No recurring automation or indefinite polling is established by this setup.

All coordination is through this hub by default; avoid specialist-to-specialist message loops. If a tool rejects a cross-chat message, leave the report in the source log and final response and describe the actual block; do not repeatedly retry or bypass approval.

Each assignment provides:
1. Objective and user-approved behavior.
2. Exact source path and revision/candidate identity.
3. Relevant files, owned files, and exclusions.
4. Acceptance criteria and focused checks.
5. Expected output and stop condition.

Each specialist returns:
- Task / revision / environment.
- Result: done, findings, or blocked.
- Changes or findings with file references and reproduction evidence.
- Checks actually run and results; unverified limits.
- Required next action, if any.

Use short status updates only when meaningful; ask the coordinator for missing scope in the task's response. End the turn when the assigned work is finished. Wait for the next assignment rather than taking unrelated work from the backlog.

AI-LOG is append-only, IST timestamped, honest model/surface, files and SHAs, failures included, no secrets. Append only scoped work; never replace the full shared log with an older snapshot. Coordinator commits shared records after collecting reports, preserving others' appended entries. Pure read-only acknowledgements do not need separate log entries under the log's own rules; coordinator records this onboarding as one team operation.
