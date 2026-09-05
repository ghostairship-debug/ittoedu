import type { InteractionRule } from '../../shared/interactionTypes'
import type { RuntimeDocument } from '../../shared/runtimeTypes'
import type {
  FormulaAstNode,
  NativeLineGeometry,
  TeacherControllerButton,
  TextRun,
} from '../../shared/contracts/native-v1/types'

export interface EditorCanvasNode {
  id: string
  name: string
  type: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  playbackInitialVisibility: 'inherit' | 'hidden'
  component?: {
    packageId: string
    version: string
  }
  props?: Record<string, unknown>
  preserveAspectRatio?: boolean
  style?: Record<string, unknown>
  text?: string
  runs?: TextRun[]
  ast?: FormulaAstNode
  formulaId?: string
  accessibleText?: string
  buttons?: TeacherControllerButton[]
  shapeType?: string
  lineGeometry?: NativeLineGeometry
  safeAreas?: import('../../shared/contracts/native-v1/types').ImageSafeArea[]
}

export interface EditorCanvasNodePatch {
  name?: string
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  opacity?: number
  visible?: boolean
  locked?: boolean
  playbackInitialVisibility?: 'inherit' | 'hidden'
  type?: string
  text?: unknown
  style?: unknown
  component?: {
    packageId?: string
    version?: string
  }
  props?: unknown
  [key: string]: unknown
}

export interface EditorCanvasDocument {
  id: string
  name: string
  backgroundColor: string
  backgroundAssetId?: string | null
  nodes: EditorCanvasNode[]
}

export interface EditorCanvasPresentationState {
  id: string
  name: string
  description?: string
  backgroundColor?: string
  backgroundAssetId?: string | null
  nodeOverrides: Record<string, Record<string, unknown>>
  nodeOrder?: string[]
}

export interface EditorCanvasPresentation {
  initialStateId: string
  thumbnailStateId?: string
  states: EditorCanvasPresentationState[]
}

export interface EditorCanvasSceneView extends EditorCanvasDocument {
  interactions: InteractionRule[]
  presentation?: EditorCanvasPresentation
  runtime?: RuntimeDocument
}
