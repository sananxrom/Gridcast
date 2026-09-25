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
The helper publishes `.codebase-memory/graph.db.zst` under a shared-folder lock; generated files remain
outside Git. Both agents must use it for indexing this shared repository. Version 0.11.0 can rewrite an
existing snapshot even with `persistence=false`, so that flag does not make a reader read-only. Do not
run raw indexing or background watchers on this repository. If a crash leaves `.refresh-lock`, check its
`owner` file and the other agent before removing it.
Use `--project gridcast` for queries. Keep the graph local; do not commit generated graph databases.

The graph supplements source inspection and `AI-LOG.md`; it does not replace either. Check source and
tests before edits. Partial parser coverage was reported for JSX in `components/ui/app-shell.tsx`, so
a missing graph result is not proof that a symbol or relationship is absent.

### From Cowork (cloud sessions)

A Cowork session's shell runs in a Linux VM that mounts only the connected folder, so
`/Users/sanan/.local/bin/codebase-memory-mcp` is not reachable and Codex's registration does not apply.
A portable snapshot now lives at `.codebase-memory/graph.db.zst` in the connected `gc` folder.
On first index in a fresh local cache, codebase-memory imports this snapshot and then reconciles the
current source. Each host keeps its own writable SQLite cache. The helper serializes shared artifact
refreshes across hosts; no writable SQLite cache is shared.
This shares graph data, not the Mac executable or Codex MCP registration. The Linux executable remains
necessary. This setup does not alter or bypass the separate Cowork restriction on SymDex.

Install per session (the VM's home does not survive between sessions), verifying the checksum:

```sh
cd "$HOME" && mkdir -p cbm && cd cbm
V=v0.11.0; A=codebase-memory-mcp-linux-arm64-portable.tar.gz      # match `uname -m`
B=https://github.com/DeusData/codebase-memory-mcp/releases/download/$V
curl -sSL -o checksums.txt $B/checksums.txt && curl -sSL -o pkg.tar.gz $B/$A
[ "$(grep " $A\$" checksums.txt | awk '{print $1}')" = "$(sha256sum pkg.tar.gz | awk '{print $1}')" ] \
  && tar -xzf pkg.tar.gz && echo OK || echo "CHECKSUM MISMATCH - stop"
CBM_BIN="$HOME/cbm/codebase-memory-mcp" bash "$HOME/mnt/gc/tools/publish-code-index.sh"
```

Never install the binary inside the connected folder. Do not skip the checksum comparison.

The JSON argument form below works across both hosts, and the local index survives between `cli` invocations within a session:

```sh
./codebase-memory-mcp cli --quiet search_graph    '{"project":"gridcast","query":"accrueSettlement"}'
./codebase-memory-mcp cli --quiet get_file_outline '{"project":"gridcast","file_path":"lib/budgets.ts"}'
./codebase-memory-mcp cli --quiet get_architecture '{"project":"gridcast","aspects":["all"]}'
```

`search_graph` is BM25 over symbols and is the usual entry point. `query_graph` expects a formal query,
not a natural-language question. Re-run the shared refresh helper after source changes, not only after pushes.
An existing cache updates incrementally from the mounted source; the shared snapshot bootstraps a new
cache. Verify source and coverage before relying on graph results. `AI-LOG.md` remains the shared history.
The snapshot is intentionally Git-ignored: it travels through the connected folder, not a Git clone alone.

Before numbering a new `gridcast-research/` document, `ls` that folder. Both agents write there
concurrently, and doc 19 was allocated twice on 25 Sep.
