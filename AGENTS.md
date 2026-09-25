# Instructions for AI agents working on Gridcast

Before your first tool call in a session: read `AI-LOG.md`.
Before you finish: append an entry to `AI-LOG.md` following the template at the top of that file.

It carries the project's standing context (the hard rules on the presence metric, provenance, tenancy and
locked config keys), the working conventions, and an append-only history of what every agent has done.
Append only — never edit or delete another entry.

Current plan of record: `gridcast-research/10-next-steps.md`.


## Local codebase memory

Sanan requested `codebase-memory-mcp` for future Gridcast work. Use its local `gridcast` index for
structural searches, architecture questions and dependency/call-path analysis. The source repository is
`/Users/sanan/Downloads/gc`; do not index the empty desktop project wrapper instead.

The MCP server is registered in Codex as `codebase-memory-mcp`. If it is unavailable in an already-open
session, use `/Users/sanan/.local/bin/codebase-memory-mcp cli`. Refresh the index before relying on
changed source and publish the shared snapshot with `bash tools/publish-code-index.sh` from this repository.
The snapshot lives at `.codebase-memory/graph.db.zst`; it stays in the shared folder and outside Git.
Each host imports into its own private cache. Both agents must use the helper for indexing this shared
repository: a shared-folder lock prevents simultaneous snapshot publication. Refresh after finishing
source/log edits. Do not run raw indexing or background watchers on this shared repository; version
0.11.0 also rewrites existing snapshots with `persistence=false`. A lock left by a crashed process must
be checked against its `owner` file and the other agent before removal.
Use `--project gridcast` for queries. Keep the graph local; do not commit generated graph databases.

The graph supplements source inspection and `AI-LOG.md`; it does not replace either. Check source and
tests before edits. Partial parser coverage was reported for JSX in `components/ui/app-shell.tsx`, so
a missing graph result is not proof that a symbol or relationship is absent.


## SymDex code search

Sanan also requested SymDex and its global `symdex-code-search` skill. For Gridcast, use repository id
`gridcast`, rooted at `/Users/sanan/Downloads/gc`. Prefer SymDex symbol/text searches, outlines and
context packs before broad file reads; codebase-memory remains available for graph exploration.
Check index freshness, and verify relevant source and tests before changing code. Neither index replaces
`AI-LOG.md` or proves that a missing symbol is absent.

Local CLI: `/Users/sanan/.local/bin/symdex`. Refresh structural data with
`symdex index /Users/sanan/Downloads/gc --repo gridcast --no-embed`. Use `--repo gridcast` for scoped
queries. The Codex MCP entry is `symdex` and runs `symdex serve`. Keep generated indexes out of Git.
The requested core installation does not include semantic embeddings; use symbol/text search unless
a separate embedding setup is explicitly chosen.
