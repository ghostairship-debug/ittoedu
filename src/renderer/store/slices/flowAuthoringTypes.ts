import type { DocumentSelection, DocumentDiagnostic } from '../../../shared/document/ports'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { ComponentLayerItem, FlowBlock, LayerFrame, NativeLayerItem } from '../../../shared/courseProjectTypes'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { FormulaAstNode, TextRunStyle } from '../../../shared/contracts/native-v1'
import type { FlowParagraphAnchor } from '../../../shared/flowParagraphAnchors'
import type { FlowMenuDocumentKind } from '../../../core/tools/flowMenuDocumentInsertion'
import type { FlowMenuPaperItem, FlowMenuParagraphAnchor } from '../../../core/tools/flowMenuPaperInsertion'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import type { FlowEditorCommandRequest, FlowSurfaceBackgroundPatch } from '../../authoring/flowTextInput'
import type { FlowAuthoringSession } from '../../project/createFlowCourseProject'
import type { FlowTextEditSession, FlowBlockFormatSpec } from '../../authoring/flowTextInput'
import type { ChartTextField } from '../../authoring/chartTextDraft'
import type { FlowDocumentDraft as FlowSourceDraft } from '../../authoring/flowDocumentDraft'
import type { FlowPreparedDocumentResources } from '../../document/flowDocumentResources'
/** Transient clipboard input survives view unmount; recovery serializes only the source fields. */
export interface FlowDocumentDraft extends FlowSourceDraft {
  readonly preparedResources?: readonly FlowPreparedDocumentResources[]
}

export type FlowOwnedState = {
  flowEditingInstance?: { documentId: string; instanceId: string } | null
  flowDocumentDrafts?: Record<string, FlowDocumentDraft>
  flowContextSelection?: DocumentSelection | null
  flowDocumentDraft?: FlowDocumentDraft | null
  flowSession: FlowAuthoringSession | null
  flowTextEdit: FlowTextEditSession | null
  flowClipboard: {
    readonly projectId: string
    readonly blocks: readonly FlowBlock[]
  } | null
}

export type FlowMenuMediaSource =
  | { readonly kind: 'existing'; readonly assetId: string }
  | { readonly kind: 'new'; readonly meta: AssetMeta; readonly bytes: Uint8Array }
  | { readonly kind: 'new'; readonly name: string; readonly mimeType: string; readonly bytes: Uint8Array; readonly duration?: number; readonly width?: number; readonly height?: number }

export type FlowAuthoringIntent = (
  | {
      readonly kind: 'select-blocks'
      readonly blockIds: readonly string[]
      readonly focus?: 'block' | 'text'
      readonly textRange?: FlowEditorSelection['textRange']
      readonly documentSelectionIssue?: string
      readonly documentSelection?: FlowEditorSelection['documentSelection']
    }
  | { readonly kind: 'select-overlay'; readonly layerItemIds: readonly string[] }
  | {
      readonly kind: 'begin-text-edit'
      readonly gesture: 'double-click' | 'enter' | 'click-text'
      readonly offset?: number
      readonly end?: number
      readonly listItemId?: string
      readonly tableRowId?: string
      readonly tableColumnId?: string
    }
  | { readonly kind: 'begin-formula-edit' }
  | { readonly kind: 'menu-insert-document'; readonly documentKind: FlowMenuDocumentKind }
  | { readonly kind: 'menu-insert-paper'; readonly item: FlowMenuPaperItem; readonly frame: LayerFrame; readonly paragraphAnchor: FlowMenuParagraphAnchor }
  | { readonly kind: 'menu-insert-paper-component'; readonly item: ComponentLayerItem; readonly frame: LayerFrame; readonly paragraphAnchor: FlowMenuParagraphAnchor; readonly packageData: ComponentPackageData }
  | { readonly kind: 'menu-insert-media'; readonly placement: 'document'; readonly mediaKind: 'image' | 'video' | 'audio'; readonly source: FlowMenuMediaSource }
  | { readonly kind: 'menu-insert-media'; readonly placement: 'paper'; readonly mediaKind: 'image'; readonly source: FlowMenuMediaSource; readonly item: FlowMenuPaperItem; readonly frame: LayerFrame; readonly paragraphAnchor: FlowMenuParagraphAnchor }
  | { readonly kind: 'replace-document-content'; readonly blocks: FlowBlock[]; readonly historyGroup: string; readonly preparedResources?: unknown }
  | { readonly kind: 'document-history'; readonly direction: 'undo' | 'redo' }
  | { readonly kind: 'update-document-draft'; readonly source: string; readonly diagnostics: DocumentDiagnostic[]; readonly composing: boolean }
  | { readonly kind: 'clear-document-draft' }
  | { readonly kind: 'begin-table-field-edit'; readonly field: 'table-caption' | 'table-header'; readonly columnId?: string; readonly text?: string; readonly composing?: boolean }
  | { readonly kind: 'begin-chart-text-edit'; readonly field: ChartTextField }
  | {
      readonly kind: 'update-text-edit'
      readonly expectedEdit: FlowTextEditSession
      readonly edit: FlowTextEditSession | null
    }
  | {
      readonly kind: 'commit-text-edit'
      readonly edit: FlowTextEditSession
      readonly keepSelected?: boolean
      readonly nextBlockId?: string
    }
  | { readonly kind: 'cancel-text-edit'; readonly edit: FlowTextEditSession }
  | {
      readonly kind: 'format-text-style'
      readonly style: TextRunStyle
      readonly expectedEdit: FlowTextEditSession | null
    }
  | { readonly kind: 'format-block'; readonly spec: FlowBlockFormatSpec }
  | {
      readonly kind: 'execute-editor-command'
      readonly blockIds: readonly string[]
      readonly command: FlowEditorCommandRequest
    }
  | {
      readonly kind: 'delete-blocks'
      readonly blockIds: readonly string[]
      readonly direction?: 'backward' | 'forward'
    }
  | {
      readonly kind: 'transform-overlay-frame'
      readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
      readonly paragraphAnchor?: FlowParagraphAnchor | null
    }
  | {
      readonly kind: 'commit-block-formula'
      readonly ast: FormulaAstNode
      readonly accessibleText: string
      readonly expectedEdit: FlowTextEditSession | null
    }
  | { readonly kind: 'clear-selection' }
  | { readonly kind: 'set-width-mode'; readonly widthMode: 'fluid' | 'reading' }
  | { readonly kind: 'rename-page'; readonly title: string }
  | { readonly kind: 'set-paper-background'; readonly backgroundColor: string }
  | { readonly kind: 'set-surface-background'; readonly patch: FlowSurfaceBackgroundPatch }
  | {
      readonly kind: 'import-surface-background-asset'
      readonly name: string
      readonly mimeType: string
      readonly bytes: Uint8Array
    }
  | { readonly kind: 'patch-block'; readonly patch: Record<string, unknown> }
  | { readonly kind: 'replace-media-asset'; readonly assetId: string }
  | {
      readonly kind: 'import-replacement-media'
      readonly name: string
      readonly mimeType: string
      readonly bytes: Uint8Array
    }
  | { readonly kind: 'move-block'; readonly direction: 'up' | 'down' }
  | { readonly kind: 'convert-block-to-overlay'; readonly frame?: NativeLayerItem['frame']; readonly paragraphAnchor?: FlowParagraphAnchor }
  | { readonly kind: 'convert-overlay-to-document' }
  | { readonly kind: 'patch-overlay-paper-space'; readonly paperSpace: 'viewport' | 'paper' }
  | { readonly kind: 'patch-overlay-body-plane'; readonly bodyPlane: 'overlay' | 'underlay' }
  | { readonly kind: 'commit-overlay-formula'; readonly ast: FormulaAstNode; readonly accessibleText: string }
  | { readonly kind: 'patch-overlay-properties'; readonly patch: Record<string, unknown> }
) & {
  /** Exact edit visible when a document mutation callback was created. */
  readonly expectedEdit?: FlowTextEditSession | null
}

export interface FlowAuthoringReceipt {
  readonly ok: boolean
  readonly reason?: string
  readonly historyEntry: boolean
  readonly edit?: FlowTextEditSession | null
}

