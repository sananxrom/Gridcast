# AI-LOG — Gridcast

Shared working memory for every AI agent on this project (Claude, Cursor, Codex, Copilot, whatever comes next)
and for the humans reading over their shoulder.

**If you are an AI agent: read this whole file before your first tool call in a session, and append an entry
before you finish. That is the deal. Nothing else in the repo tells you what happened last week.**

---

## How to use this file

### Rules

1. **Append only, at the end of the Log.** Never edit, reorder, reword or delete someone else's entry — including
   your own from an earlier session. If an earlier entry turned out to be wrong, write a new entry that says so.
   This is the one property that makes the file safe for several agents at once.
2. **One entry per user prompt that changed something** — code, config, data, a decision, a deployment.
   Pure questions ("what does this file do?") do not need an entry. When in doubt, log it; the file is cheap.
3. **Write the entry before you hand the turn back**, not in a batch at the end of a session. A session that
   crashes mid-way should still have left a trace.
4. **Timestamp in IST**, format `YYYY-MM-DD HH:MM IST`. Get it from the machine (`date "+%Y-%m-%d %H:%M IST"`),
   do not guess from context.
5. **Name yourself honestly** — model and surface, e.g. `claude-opus-5 (Cowork)`, `gpt-5-codex (CLI)`,
   `cursor-composer`. If a human did the work themselves, `sanan (manual)`.
6. **Cite files with paths, and commits with short SHAs.** "Fixed the config bug" is useless in three weeks;
   "`lib/config.ts:88` — `common` flag was being merged into option defaults" is not.
7. **Say what did NOT work.** A failed approach saved is an hour saved for the next agent. The `Outcome` field
   is for the truth, including "abandoned, see why".
8. **Never put secrets in here** — no API keys, tokens, passwords, `.env` values, customer data. This file is
   committed to git. If a secret is involved, write "rotated the auth secret (value not recorded)".
9. **Keep Standing Context current.** It is the only section that may be edited in place. When you change it,
   log that you changed it.
10. **Commit the file with your work**, same commit or one right after: `git add AI-LOG.md`.

### Entry template

Copy this block, fill it, append it under `## Log`:

```markdown
### YYYY-MM-DD HH:MM IST · <model> (<surface>)

**Asked:** what the user actually asked for, in their framing, one or two lines.
**Did:** what you actually did. Files touched, routes added, commands run, decisions taken.
**Outcome:** shipped / partially done / abandoned — and how you verified it (build passed, test, screenshot,
curl output). Include what broke and what you left unfinished.
**Files:** `path/one.ts`, `path/two.tsx`
**Commit:** `abc1234` (or "not committed")
**Open:** anything the next agent must know — a known bug, a half-finished refactor, a decision waiting on Sanan.
```

Fields may be omitted when genuinely empty. Do not pad them.

### What belongs where

| Kind of knowledge | Goes in |
|---|---|
| What happened, when, by whom | **Log** (append) |
| Facts that stay true across sessions — stack, conventions, invariants | **Standing Context** (edit in place, then log the edit) |
| Full reasoning behind a design | `gridcast-research/*.md`, referenced from the log |
| Task lists, TODOs | Not here. This file is history + context, not a tracker |

---

## Standing Context

*Editable in place. Change it only when a fact actually changes, and log that you did.*

### The product
Gridcast is a DOOH (digital out-of-home) advertising network in Chandigarh: Android boxes with USB cameras on
screens in shops, cafés and gyms, counting real people on-device and selling verified presence to advertisers.
Multi-tenant — screen owners are resellers; Gridcast is `org_id` tenant zero, not a special case.

### Hard rules — do not violate without asking Sanan

- **The metric is presence, never impressions.** A frame is sampled every ~2 s during a play; the play's number
  is the mean of those samples (`avg_persons`). No tracking, no re-identification, no de-duplication. It is
  described to users as "average people in front of the screen while your ad played" and is never called
  impressions, reach, unique viewers or audience.
- **Unmeasured is null, never zero.** No camera or a failed agent produces `measured: false` with a null count.
  Measured and unmeasured plays are never summed into one figure.
- **Every number carries its provenance.** `presence.measured`, `screen_rate.exposure_source`,
  `screen_rate_seed.revenue_source` — measured vs self-reported vs derived, never blended.
- **Transparent vertically, isolated horizontally.** Every party sees the full economics of any transaction they
  are part of, decomposed and unnetted. No party sees anything belonging to another org.
- **No bank account numbers are stored.** Payout method label and UPI ID only.
- **Locked config keys** (measurement and privacy: `sample_interval_s`, `model`, `confidence_min`,
  `presence_metric`, `camera_fail_mode`, `upload_frames`, `retain_frames`, `face_recognition`, `reidentify`,
  `demographics`, and the transport keys) may be set **only** from the platform layer, enforced server-side
  with a 403 — never in the UI alone.

### Stack and repo
- Next.js 14.2.15 App Router · React 18.3.1 · TypeScript · Tailwind 3.4 · shadcn conventions · lucide-react
- Repo `github.com/sananxrom/Gridcast`; working copy `~/Downloads/gc`; dev server on port 4000
- Storage: single JSON blob behind `lib/store.ts` (`redis` via Upstash REST | `file` | `memory`), key `gridcast:db`
- Auth: PBKDF2-SHA256 (60k) + HMAC-signed session tokens, `Authorization: Bearer`, 7-day expiry (`lib/auth.ts`)
- Device config: 116 settings as data in `lib/config.ts`; four layers platform → org → group → screen
- Roles: owner / manager / sales / installer, plus `platform_admin` and `advertiser_viewer` (`lib/roles.ts`)
- Player: `app/player/page.tsx`, web kiosk, YouTube IFrame playback, TF.js + COCO-SSD `lite_mobilenet_v2` from CDN
- Brand accent: ochre `#A16207`, single accent hue site-wide
- Deployment: Firebase App Hosting (`apphosting.yaml`); a Vercel deployment also exists — one of the two should go

### Working conventions
- Never run `git commit` or `git push` on Sanan's behalf; give him the exact commands to paste.
- No `Co-Authored-By` or generated-by trailers in commit messages.
- Verify before claiming done: `npx tsc --noEmit`, then `npm run build`, then exercise the actual path.
- Docs live in `gridcast-research/` and are numbered; `10-next-steps.md` is the current plan of record.

### Known open risks
See `gridcast-research/10-next-steps.md` §0 for the full list. The short version: device routes are
unauthenticated, ~12 routes have no org check, `POST /api/reset` is open, and seeded accounts share a password.
Nothing measured by the current build is trustworthy until WP0–WP2 in that doc are done.

---

## Log

*Append new entries at the bottom. Newest last.*

### 2026-09-23 20:05 IST · claude-opus-5 (Cowork)

**Asked:** What is the next step on this build, and write it up properly as a technical doc. Then create a shared
memory-log file in the repo that every AI working on this project reads and appends to.
**Did:** Audited the current tree (routes in `lib/api.ts`, the seed/storage model, the player's measurement path,
Phase 1 feature coverage, env handling) and wrote the result up as a prioritised engineering plan —
WP0 deployment integrity → WP1 authorization → WP2 device identity and proof-of-play → WP3 measurement
provenance → WP4 storage decision → WP5 inventory correctness → WP6 money, with the venue LOIs and the
ground-truth count running in parallel. Created this file.
**Outcome:** Doc delivered and saved as `gridcast-research/10-next-steps.md`. Audit findings worth carrying
forward: `POST /api/reset` is unauthenticated (`lib/api.ts:39,503`); device routes accept a bare `screen_id`
with no token (`:49-51`) so plays and presence counts are forgeable and `accrued_spend` moves on that input;
~12 entity routes have no org check; `GC_AUTH_SECRET` falls back to a constant that is in the public repo
(`lib/auth.ts:11-13`); all seeded users share the password `gridcast` (`lib/seed.ts:56-57`); `config_version`
does not exist anywhere; the player loads COCO-SSD while the config declares `yolox-tiny` as a locked key;
`preview_frames` ships JPEGs every 5 s despite the "no video is transmitted" copy; the JSON blob is ~470 bytes
per play with no locking and re-uploads whole on every write. No code was changed this session.
**Files:** `gridcast-research/10-next-steps.md`, `AI-LOG.md` (new)
**Commit:** not committed
**Open:** WP0 is half a day and closes an unauthenticated production wipe plus a forgeable admin token — do it
first. Also unresolved from earlier: whether the live Firebase deployment now reports `"store":"redis"`
(the `env:` block is in `apphosting.yaml` but the endpoint did not respond when checked), and whether the
Vercel deployment should be retired.
