# IttoEdu development repo-index

This directory contains the deterministic development-navigation facts for coding agents. It is separate from `artifacts/ai-capabilities`, which describes courseware-generation capabilities.

- `config.json` owns scan roots, exclusions and the four input-domain boundaries.
- `semantic/` contains a deliberately small set of human-maintained current/target boundaries.
- `generated/` is rebuilt from repository inputs; do not hand-edit it.
- `contexts/` is reserved for temporary Context Packs and is not committed.

Live task cards and their derived `TASK_BOARD.md` are intentionally outside the strict `sourceTreeHash`: changing a card from `target-green` to `done` must not make the index produced for that same integration commit self-stale. Task cards remain the sole task-status truth under the development workflow.

Commands:

```text
npm run repo:index
npm run repo:index:check
```

Strict generated files never persist Git HEAD, generation time, absolute paths, usernames or machine identity. Until the golden-task gates pass, manual Bootstrap remains authoritative.
