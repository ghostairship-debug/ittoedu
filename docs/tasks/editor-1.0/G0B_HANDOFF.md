# Lane G0B Handoff: Flow Surface Paper Scroll & Media Layout

## Overview
Implemented paper scroll handling (wheel event, blank-area drag-to-scroll, boundary clamping) and media three-width layout support in `FlowSurfaceHost`.

## Changes
1. `src/player/surfaces/flow/FlowSurfaceHost.ts`:
   - Configured `renderFlowArticle` to set `pointerEvents = 'auto'`, `overflow = 'auto'`, `overscrollBehavior = 'contain'`, and `data-flow-paper-scroll = 'true'`.
   - Added passive: false wheel event listener on `article` clamping `scrollTop` within `[0, max(0, scrollHeight - clientHeight)]` and preventing default when scrolling.
   - Added primary-button blank-area pointer drag-to-scroll on `article`, ignoring interactive targets (`video, audio, button, a, input, textarea, [data-flow-interactive]`).
   - Updated media block rendering in `renderBlockDom` to set `data-flow-media-layout = block.layout` and enforce three-width rules (`content-width` -> `readingWidth`, `wide` -> `wideContentWidth`, `full-width` -> `100%`) with `maxWidth: 100%` on inner media elements.
   - Maintained overlay `pointerEvents = 'none'` and teacher controller frame `pointerEvents = 'auto'`.

2. `tests/unit/flowSurfaceHost.test.ts`:
   - Added test for wheel scroll on long flow paper documents with mocked dimensions.
   - Added test verifying teacher controller retains `pointerEvents = 'auto'` and processes `scene.next` actions over flow paper.
   - Added test verifying media layout with wide setting against `wideContentWidth`.

## Test Results
- `npx vitest run tests/unit/flowSurfaceHost.test.ts`: 16 passed (16 total).
- `git diff --check`: clean (0 errors).
