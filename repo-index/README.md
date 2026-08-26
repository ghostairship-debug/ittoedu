# IttoEdu development repo-index

This directory contains the deterministic development-navigation facts for coding agents. It is separate from `artifacts/ai-capabilities`, which describes courseware-generation capabilities.

- `config.json` owns scan roots, exclusions and the four input-domain boundaries.
- `semantic/` contains a deliberately small set of human-maintained current/target boundaries.
- `generated/` is an optional local cache rebuilt from repository inputs; it is ignored by Git, is never committed, and must not be hand-edited. Run `npm run repo:index` yourself whenever you want it; a missing cache is a normal state.
- `contexts/` is reserved for temporary Context Packs and is not committed.

Live task cards and their derived `TASK_BOARD.md` are intentionally outside the strict `sourceTreeHash`: changing a card from `target-green` to `done` must not make the index produced for that same integration commit self-stale. Task cards remain the sole task-status truth under the development workflow.

Commands (all explicit and optional; none of them is a phase gate):

```text
npm run repo:index
npm run repo:index:check
npm run repo:context -- --path <repo-relative-path> --size small
```

`repo:index:check` is a tool-development command for comparing a freshly built index against the local cache. Neither package scripts nor CI run it, so no freshness, golden or quality gate can block work on a stale or missing cache.

Strict generated files never persist Git HEAD, generation time, absolute paths, usernames or machine identity. Reading the source, contracts and targeted tests directly stays authoritative; this index only narrows where to look.
