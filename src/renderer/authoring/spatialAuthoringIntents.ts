import type { FormulaAstNode, TextRun, TextRunStyle } from '../../shared/contracts/native-v1/types'
import type {
  SpatialPathStyle,
  SpatialRelationKind,
  SpatialSemanticZoomRule,
} from '../../shared/courseProjectTypes'
import type {
  SpatialAuthoringSession,
  SpatialEditorWorldTransform,
  SpatialSurfaceBackgroundPatch,
} from '../course/spatialEditorCommands'
import type { EditorCanvasNodePatch } from '../phaser/editorCanvasNode'
import type { CourseAuthoringTarget } from './courseAuthoringSession'
import type { SpatialWorldContentEditSession } from './spatialWorldAuthoring'

export type SpatialGraphSelection =
  | { readonly kind: 'path'; readonly id: string }
  | { readonly kind: 'relation'; readonly id: string }

export type SpatialAuthoringIntent = (
  | {
      readonly kind: 'select-layers'
      readonly layerItemIds: readonly string[]
      readonly additive?: boolean
      readonly scope?: 'global' | 'surface' | 'world'
    }
  | { readonly kind: 'set-scope'; readonly scope: 'global' | 'surface' | 'world' }
  | {
      readonly kind: 'transform-layers'
      readonly coordinateSpace: 'world' | 'viewport'
      readonly layers: readonly SpatialEditorWorldTransform[]
      readonly expectedSelectionIds: readonly string[]
      readonly expectedCamera: SpatialAuthoringSession['sessionCamera']
      readonly targets: readonly CourseAuthoringTarget[]
    }
  | {
      readonly kind: 'patch-layers'
      readonly updates: readonly {
        readonly target: CourseAuthoringTarget
        readonly patch: EditorCanvasNodePatch
      }[]
      readonly expectedSelectionIds: readonly string[]
    }
  | {
      readonly kind: 'pan-session-camera'
      readonly delta: { readonly x: number; readonly y: number }
      readonly expectedCamera: SpatialAuthoringSession['sessionCamera']
    }
  | {
      readonly kind: 'zoom-session-camera'
      readonly zoom: number
      readonly expectedCamera: SpatialAuthoringSession['sessionCamera']
    }
  | {
      readonly kind: 'fit-home-camera'
      readonly expectedCamera: SpatialAuthoringSession['sessionCamera']
    }
  | {
      readonly kind: 'begin-content-edit'
      readonly source: 'canvas' | 'properties'
      readonly expectedEdit: SpatialWorldContentEditSession | null
    }
  | {
      readonly kind: 'update-text-content-edit'
      readonly expectedEdit: SpatialWorldContentEditSession
      readonly text: string
      readonly runs: readonly TextRun[]
      readonly width?: number
      readonly height?: number
    }
  | {
      readonly kind: 'set-content-edit-composing'
      readonly expectedEdit: SpatialWorldContentEditSession
      readonly composing: boolean
    }
  | {
      readonly kind: 'commit-text-content-edit'
      readonly expectedEdit: SpatialWorldContentEditSession
      readonly text: string
      readonly runs: readonly TextRun[]
      readonly width?: number
      readonly height?: number
    }
  | {
      readonly kind: 'commit-formula-content-edit'
      readonly expectedEdit: SpatialWorldContentEditSession
      readonly ast: FormulaAstNode
      readonly accessibleText: string
    }
  | { readonly kind: 'cancel-content-edit'; readonly expectedEdit: SpatialWorldContentEditSession }
  | {
      readonly kind: 'commit-text-run-style'
      readonly expectedEdit: SpatialWorldContentEditSession
      readonly selectionStart: number
      readonly selectionEnd: number
      readonly patch: TextRunStyle
    }
  | { readonly kind: 'set-surface-background'; readonly backgroundColor: string }
  | { readonly kind: 'set-surface-background-patch'; readonly patch: SpatialSurfaceBackgroundPatch }
  | {
      readonly kind: 'set-show-camera-frames'
      readonly show: boolean
      readonly expectedShow: boolean
    }
  | {
      readonly kind: 'add-camera-frame'
      readonly name?: string
      readonly expectedCamera: SpatialAuthoringSession['sessionCamera']
    }
  | { readonly kind: 'rename-camera-frame'; readonly name: string }
  | {
      readonly kind: 'reorder-camera-frame'
      readonly toIndex: number
      readonly expectedFrameIds: readonly string[]
    }
  | { readonly kind: 'delete-camera-frame' }
  | {
      readonly kind: 'set-camera-home-from-session'
      readonly expectedCamera: SpatialAuthoringSession['sessionCamera']
    }
  | {
      readonly kind: 'update-camera-frame-from-session'
      readonly expectedCamera: SpatialAuthoringSession['sessionCamera']
    }
  | { readonly kind: 'activate-camera-frame' }
  | {
      readonly kind: 'fit-world-content'
      readonly viewportWidth: number
      readonly viewportHeight: number
      readonly expectedCamera: SpatialAuthoringSession['sessionCamera']
    }
  | {
      readonly kind: 'set-playback-path'
      readonly pathId: string | null
      readonly expectedPathId: string | null
      readonly pathTarget?: CourseAuthoringTarget
    }
  | {
      readonly kind: 'add-semantic-rule'
      readonly rule: {
        readonly layerItemIds: readonly string[]
        readonly minZoom: number
        readonly maxZoom: number
        readonly visible: boolean
      }
    }
  | {
      readonly kind: 'update-semantic-rule'
      readonly patch: Partial<Omit<SpatialSemanticZoomRule, 'id'>>
    }
  | { readonly kind: 'delete-semantic-rule' }
  | {
      readonly kind: 'add-path'
      readonly input: {
        readonly name: string
        readonly layerItemIds: readonly string[]
        readonly style?: SpatialPathStyle
      }
    }
  | { readonly kind: 'rename-path'; readonly name: string }
  | { readonly kind: 'update-path-style'; readonly style: SpatialPathStyle }
  | { readonly kind: 'reorder-path-waypoints'; readonly layerItemIds: readonly string[] }
  | { readonly kind: 'delete-path' }
  | {
      readonly kind: 'add-relation'
      readonly input: {
        readonly sourceLayerItemId: string
        readonly targetLayerItemId: string
        readonly kind: SpatialRelationKind
        readonly label?: string
      }
    }
  | { readonly kind: 'update-relation-label'; readonly label: string }
  | { readonly kind: 'update-relation-kind'; readonly relationKind: SpatialRelationKind }
  | { readonly kind: 'delete-relation' }
  | {
      readonly kind: 'set-graph-selection'
      readonly selection: SpatialGraphSelection | null
      readonly expectedSelection: SpatialGraphSelection | null
    }
) & {
  /** Exact open draft visible when this callback or gesture was captured. */
  readonly expectedContentEdit: SpatialWorldContentEditSession | null
}

type WithoutExpectedContentEdit<Intent> = Intent extends unknown
  ? Omit<Intent, 'expectedContentEdit'>
  : never

/** Input accepted only by adapters that synchronously attach an exact edit identity. */
export type SpatialAuthoringIntentInput = WithoutExpectedContentEdit<SpatialAuthoringIntent>

export interface SpatialAuthoringReceipt {
  readonly ok: boolean
  readonly reason?: string
  readonly historyEntry: boolean
  readonly edit?: SpatialWorldContentEditSession | null
}

export interface SpatialAuthoringCommandPort {
  run(target: CourseAuthoringTarget, intent: SpatialAuthoringIntent): SpatialAuthoringReceipt
}
