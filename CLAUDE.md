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
changed source with `index_repository --repo-path /Users/sanan/Downloads/gc --name gridcast --persistence false`.
Use `--project gridcast` for queries. Keep the graph local; do not commit generated graph databases.

The graph supplements source inspection and `AI-LOG.md`; it does not replace either. Check source and
tests before edits. Partial parser coverage was reported for JSX in `components/ui/app-shell.tsx`, so
a missing graph result is not proof that a symbol or relationship is absent.
