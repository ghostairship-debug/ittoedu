# G1B Handoff

## Summary of Changes

Implemented Lane G1B (Block and Overlay Chrome):
1. **Flow Block Format Command (`convert-quote`)**:
   - Added `{ kind: 'convert-quote' }` to `FlowBlockFormatSpec` in `src/renderer/course/flowEditorCommands.ts`.
   - Handled paragraph/heading to quote conversions while preserving block `id`, `text`, and `runs`.
   - Guaranteed converting the last navigable heading to quote fails with `FLOW_LAST_HEADING_REASON`.
2. **Block Type Dropdown & Properties**:
   - In `src/renderer/ui/PropertiesTab.tsx`, quote option is always visible in the block type dropdown. Selecting quote triggers `formatFlowBlock({ kind: 'convert-quote' })`.
   - Added move up (`flow-block-move-up`), move down (`flow-block-move-down`), and convert to overlay (`flow-block-to-overlay`) chrome buttons for flow media and component blocks.
   - Preserved `flowRichTextColor` from text runs.
3. **Flow Overlay Properties & Formula**:
   - Added `FlowOverlayProperties` in `src/renderer/ui/PropertiesTab.tsx` when `flowSession.selection.focus === 'overlay'`.
   - Supported converting overlay media and components back to document via `flow-overlay-to-document`.
   - Added `commitFlowOverlayFormulaAst` in `src/renderer/course/flowSharedAuthoringAdapters.ts` and wired `FormulaAuthoringEditor` for overlay formulas.
4. **Unit Tests**:
   - Added tests in `tests/unit/flowEditorCommands.test.ts` for paragraph to quote and last heading check.
   - Added integration tests in `tests/unit/flowProductIntegration.test.tsx` for dropdown quote conversion and media block to overlay conversion.
   - Added overlay formula authoring test in `tests/unit/flowFormulaProperties.test.tsx`.
