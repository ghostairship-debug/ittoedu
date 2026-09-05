import type {
  CourseAuthoringSessionToken,
  CourseAuthoringTarget,
} from '../../authoring/courseAuthoringSession'
import type { CourseBackgroundFields } from '../../../shared/effectiveBackground'
import { COURSE_AUTHORING_STALE_SESSION_REASON } from '../../authoring/courseAuthoringSession'
import {
  markFlowTextComposing,
  updateFlowTextDraft,
  type FlowFormulaDraft,
  type FlowTextEditSession,
} from '../../authoring/flowTextEdit'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import {
  captureFlowEditorAuthoringTarget,
  type FlowEditorView,
} from '../../course/flowEditorView'
import type { FlowAuthoringIntent } from '../../store/slices/flowAuthoringSlice'
import type {
  FlowPropertiesCommands,
  FlowPropertiesContext,
  FlowPropertiesKind,
} from './FlowPropertiesPanel'

type FlowPropertiesIntent = Extract<FlowAuthoringIntent, {
  readonly kind:
    | 'rename-page'
    | 'set-paper-background'
    | 'set-surface-background'
    | 'import-surface-background-asset'
    | 'patch-block'
    | 'replace-media-asset'
    | 'import-replacement-media'
    | 'move-block'
    | 'convert-block-to-overlay'
    | 'convert-overlay-to-document'
    | 'delete-blocks'
    | 'format-block'
    | 'format-text-style'
    | 'patch-overlay-paper-space'
    | 'commit-overlay-formula'
    | 'commit-block-formula'
    | 'patch-overlay-properties'
}>

export type FlowPropertiesOwnerResult =
  | { readonly status: 'inactive' }
  | {
      readonly status: 'stale'
      readonly reason: string
      readonly locationId: string
      readonly editingGlobal: boolean
    }
  | {
      readonly status: 'active'
      readonly locationId: string
      readonly editingGlobal: boolean
      readonly context: FlowPropertiesContext | null
    }

function draftBindingKey(target: CourseAuthoringTarget | null): string {
  if (!target) return 'flow-property-target-unavailable'
  return [
    target.projectId,
    target.documentRevision,
    target.sessionGeneration,
    target.locationId,
    target.surfaceId,
    target.owner,
    target.ownerKey,
    target.itemId,
    target.authoringAddress,
  ].join(':')
}

function captureTarget(
  kind: FlowPropertiesKind,
  view: FlowEditorView,
  selection: FlowEditorSelection,
  sessionToken: CourseAuthoringSessionToken,
): CourseAuthoringTarget | null {
  try {
    if (kind === 'flow-page') {
      return captureFlowEditorAuthoringTarget({ view, sessionToken, target: { kind: 'surface' } })
    }
    if (kind === 'flow-overlay') {
      const layerItemId = selection.selectedOverlayIds.at(-1)
      return layerItemId
        ? captureFlowEditorAuthoringTarget({
            view,
            sessionToken,
            target: { kind: 'overlay', layerItemId },
          })
        : null
    }
    const blockId = selection.selectedBlockId
    return blockId
      ? captureFlowEditorAuthoringTarget({
          view,
          sessionToken,
          target: { kind: 'block', blockId },
        })
      : null
  } catch {
    return null
  }
}

function createCommands(input: {
  readonly target: CourseAuthoringTarget | null
  readonly selection: FlowEditorSelection
  readonly textEdit: FlowTextEditSession | null
  readonly runIntent: (
    target: CourseAuthoringTarget,
    intent: FlowAuthoringIntent,
  ) => { readonly ok: boolean; readonly reason?: string }
  readonly reportError: (message: string) => void
}): FlowPropertiesCommands {
  const selectedBlockIds = [...input.selection.selectedBlockIds]
  const dispatch = (intent: FlowAuthoringIntent) => {
    if (!input.target) {
      input.reportError(COURSE_AUTHORING_STALE_SESSION_REASON)
      return
    }
    const receipt = input.runIntent(input.target, intent)
    if (!receipt.ok && receipt.reason) input.reportError(receipt.reason)
  }
  const run = (intent: FlowPropertiesIntent) => dispatch({
    ...intent,
    expectedEdit: input.textEdit,
  })
  return {
    renamePage: (_surfaceId, title) => run({ kind: 'rename-page', title }),
    setPaperBackground: (_surfaceId, backgroundColor) => run({
      kind: 'set-paper-background',
      backgroundColor,
    }),
    updateSurfaceBackground: (patch) => run({ kind: 'set-surface-background', patch }),
    importSurfaceBackgroundAsset: (imported) => run({
      kind: 'import-surface-background-asset',
      name: imported.name,
      mimeType: imported.mimeType,
      bytes: imported.bytes,
    }),
    patchSelectedBlock: (patch) => run({ kind: 'patch-block', patch }),
    replaceMediaAsset: (assetId) => run({ kind: 'replace-media-asset', assetId }),
    importReplacementMedia: (imported) => run({
      kind: 'import-replacement-media',
      name: imported.name,
      mimeType: imported.mimeType,
      bytes: imported.bytes,
    }),
    moveSelectedBlock: (direction) => run({ kind: 'move-block', direction }),
    convertSelectedToOverlay: () => run({ kind: 'convert-block-to-overlay' }),
    convertOverlayToDocument: () => run({ kind: 'convert-overlay-to-document' }),
    deleteSelectedBlocks: () => run({ kind: 'delete-blocks', blockIds: selectedBlockIds }),
    formatBlock: (spec) => run({ kind: 'format-block', spec }),
    formatTextStyle: (style) => run({
      kind: 'format-text-style',
      style,
      expectedEdit: input.textEdit,
    }),
    patchOverlayPaperSpace: (paperSpace) => run({
      kind: 'patch-overlay-paper-space',
      paperSpace,
    }),
    commitOverlayFormula: (ast, accessibleText) => run({
      kind: 'commit-overlay-formula',
      ast,
      accessibleText,
    }),
    patchOverlayProperties: (patch) => run({
      kind: 'patch-overlay-properties',
      patch,
    }),
    beginBlockFormulaEdit: () => {
      if (!input.textEdit) dispatch({ kind: 'begin-formula-edit' })
    },
    updateBlockFormulaDraft: (draft) => {
      if (!input.textEdit || input.textEdit.kind !== 'formula') return
      const previous = input.textEdit.draft as FlowFormulaDraft
      dispatch({
        kind: 'update-text-edit',
        expectedEdit: input.textEdit,
        edit: updateFlowTextDraft(input.textEdit, {
          ast: draft.ast ?? previous.ast,
          accessibleText: draft.ast ? draft.accessibleText : previous.accessibleText,
          source: draft.source,
          valid: draft.committable,
          hasSlots: draft.hasSlots,
        }),
      })
    },
    setBlockFormulaComposing: (composing) => {
      if (
        !input.textEdit
        || input.textEdit.kind !== 'formula'
        || input.textEdit.composing === composing
      ) return
      dispatch({
        kind: 'update-text-edit',
        expectedEdit: input.textEdit,
        edit: markFlowTextComposing(input.textEdit, composing),
      })
    },
    cancelBlockFormulaEdit: () => {
      if (input.textEdit?.kind === 'formula') {
        dispatch({ kind: 'cancel-text-edit', edit: input.textEdit })
      }
    },
    commitBlockFormula: (ast, accessibleText) => {
      if (input.textEdit?.kind === 'formula') {
        dispatch({ kind: 'commit-text-edit', edit: input.textEdit })
        return
      }
      run({
        kind: 'commit-block-formula',
        ast,
        accessibleText,
        expectedEdit: input.textEdit,
      })
    },
    reportError: input.reportError,
  }
}

export function buildFlowPropertiesOwner(input: {
  readonly view: FlowEditorView | null
  readonly selection: FlowEditorSelection | null
  readonly assets: FlowPropertiesContext['assets']
  readonly textEdit: FlowTextEditSession | null
  readonly authoringToken: CourseAuthoringSessionToken | null
  readonly course: CourseBackgroundFields
  readonly runIntent: (
    target: CourseAuthoringTarget,
    intent: FlowAuthoringIntent,
  ) => { readonly ok: boolean; readonly reason?: string }
  readonly reportError: (message: string) => void
}): FlowPropertiesOwnerResult {
    const { selection, view } = input
    if (!selection || !view) return { status: 'inactive' }
    const editingGlobal = selection.authoringScope === 'global'
    const token = input.authoringToken
    if (
      !token
      || token.surfaceType !== 'flow'
      || token.locationId !== selection.locationId
      || token.revision !== view.revision
    ) {
      return {
        status: 'stale',
        reason: COURSE_AUTHORING_STALE_SESSION_REASON,
        locationId: selection.locationId,
        editingGlobal,
      }
    }
    if (editingGlobal) {
      return {
        status: 'active',
        locationId: selection.locationId,
        editingGlobal,
        context: null,
      }
    }
    const kind: FlowPropertiesKind = selection.focus === 'overlay'
      && selection.selectedOverlayIds.length > 0
      ? 'flow-overlay'
      : selection.selectedBlockId
        ? 'flow-block'
        : 'flow-page'
    const target = captureTarget(kind, view, selection, token)
    return {
      status: 'active',
      locationId: selection.locationId,
      editingGlobal,
      context: {
        kind,
        view,
        assets: input.assets,
        selection,
        textEdit: input.textEdit,
        draftBindingKey: draftBindingKey(target),
        course: input.course,
        commands: createCommands({
          target,
          selection,
          textEdit: input.textEdit,
          runIntent: input.runIntent,
          reportError: input.reportError,
        }),
      },
    }
}
