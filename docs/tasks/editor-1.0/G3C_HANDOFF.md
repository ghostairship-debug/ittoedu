# G3C Handoff: Wrap Actually Float

- **Branch**: `cursor/g3c-wrap-float-0ab9`
- **Base Commit**: `2df0e18461e83cfb4db5c6eb4c535f624d044f89`
- **Target Remote**: `https://github.com/ghostairship-debug/ittoedu.git`

## Allowlist Changes
- `src/player/surfaces/flow/FlowSurfaceHost.ts`: Apply wrap left/right (48% width + float/margin) on figure in try-run; clear both at end of reading container.
- `src/renderer/ui/FlowWorkspace.tsx`: Remove extra wrapper `<div>` on root and section children, float outer block frame (`flow-block-*`) with 48% width and margins for wrap left/right; add clear both at end of article.
- `src/renderer/ui/PropertiesTab.tsx`: Add component wrap SelectField dropdown (`data-testid="flow-component-wrap"`).
- `tests/unit/flowSurfaceHost.test.ts`: Added tests verifying float left/right, width: 48%, omitted wrap full row, and sibling relationship with subsequent paragraphs.
- `tests/unit/flowWorkspace.test.tsx`: Verified edit paper outer block frame has float left/right and 48% width for media and component blocks; fixed assetId to `asset-image`.
- `docs/tasks/editor-1.0/G3C_HANDOFF.md`: This handoff document.

Allowlist extras: None.

## Vitest Results
`npx vitest run tests/unit/flowSurfaceHost.test.ts tests/unit/flowWorkspace.test.tsx`
- Test Files: 2 passed (2)
- Tests: 31 passed (31)
