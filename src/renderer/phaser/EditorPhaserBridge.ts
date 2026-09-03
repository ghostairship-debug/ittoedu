import type { ComponentPackageData } from '../../shared/componentTypes'
import type {
  EditorCanvasDocument,
  EditorCanvasNode,
} from './editorCanvasNode'
import type { StagePoint } from '../authoring/stageViewportTransform'
import type { EditorScene } from './EditorScene'
import {
  adaptV9SlideLayerItemHit,
  editorPhaserPointerToWorld,
  hitTestV9SlideLayerItems,
  marqueeHitV9SlideLayerItems,
  v9SlideLayerItemBounds,
  v9SlideLayerItemIsHittable,
  type V9SlideHitTarget,
} from './v9SlideHitAdapter'

export interface NodeMoveEndEvent {
  nodeId: string
  x: number
  y: number
}

export interface NodesMoveEndEvent {
  nodes: NodeMoveEndEvent[]
}

export interface NodeSelectionEvent {
  nodeIds: string[]
  additive: boolean
}

export interface NodeResizeEndEvent {
  nodeId: string
  x: number
  y: number
  width: number
  height: number
}

export interface NodeRotateEndEvent {
  nodeId: string
  rotation: number
}

export interface NodeTransformEndEvent extends NodeResizeEndEvent {
  rotation: number
}

export interface NodesTransformEndEvent {
  nodes: NodeTransformEndEvent[]
}

export type NodesTransformPreviewEvent = NodesTransformEndEvent

type Handler<T> = (event: T) => void

export class EditorPhaserBridge {
  private scene: EditorScene | null = null
  private selectedNodeIds: string[] = []
  private editingTextNodeId: string | null = null
  private pending:
    | {
        document: EditorCanvasDocument
        components: Record<string, ComponentPackageData>
      }
    | undefined

  private readonly selectedHandlers = new Set<Handler<NodeSelectionEvent>>()
  private readonly moveHandlers = new Set<Handler<NodeMoveEndEvent>>()
  private readonly movesHandlers = new Set<Handler<NodesMoveEndEvent>>()
  private readonly resizeHandlers = new Set<Handler<NodeResizeEndEvent>>()
  private readonly rotateHandlers = new Set<Handler<NodeRotateEndEvent>>()
  private readonly transformsHandlers = new Set<Handler<NodesTransformEndEvent>>()
  private readonly transformPreviewHandlers =
    new Set<Handler<NodesTransformPreviewEvent>>()
  private readonly doubleClickHandlers = new Set<Handler<string>>()
  private readonly formulaDoubleClickHandlers = new Set<Handler<string>>()
  attach(scene: EditorScene): void {
    this.scene = scene
    if (this.pending) {
      const { document, components } = this.pending
      this.loadDocument(scene, document, components)
      this.pending = undefined
    }
  }

  private loadDocument(
    scene: EditorScene,
    document: EditorCanvasDocument,
    components: Record<string, ComponentPackageData>,
  ): void {
    scene.loadDocument(document, components)
    if (this.scene !== scene) return

    // Loading a document recreates every proxy and intentionally clears the
    // Phaser-side selection. Restore the latest UI state immediately.
    scene.selectNodes(this.selectedNodeIds)
    scene.setTextEditing(this.editingTextNodeId)
  }

  loadScene(
    document: EditorCanvasDocument,
    components: Record<string, ComponentPackageData>,
  ): void {
    if (!this.scene) {
      this.pending = { document, components }
      return
    }
    this.loadDocument(this.scene, document, components)
  }

  applyNode(node: EditorCanvasNode): void {
    this.scene?.applyNode(node)
  }
  addNode(node: EditorCanvasNode): void {
    this.scene?.addNode(node)
  }
  removeNode(nodeId: string): void {
    this.scene?.removeNode(nodeId)
  }
  reorderNodes(nodeIds: string[]): void {
    this.scene?.reorderNodes(nodeIds)
  }
  selectNode(nodeId: string | null): void {
    this.selectNodes(nodeId ? [nodeId] : [])
  }
  selectNodes(nodeIds: string[]): void {
    this.selectedNodeIds = [...nodeIds]
    this.scene?.selectNodes(this.selectedNodeIds)
  }
  setTextEditing(nodeId: string | null): void {
    this.editingTextNodeId = nodeId
    this.scene?.setTextEditing(nodeId)
  }
  previewNodeMotion(
    action: import('../../shared/interactionTypes').NodeMotionAction,
    delayMs = 0,
  ): boolean {
    return this.scene?.previewNodeMotion(action, delayMs) ?? false
  }

  dispose(): void {
    this.scene = null
    this.pending = undefined
  }

  onNodeSelected(handler: Handler<NodeSelectionEvent>): () => void {
    this.selectedHandlers.add(handler)
    return () => this.selectedHandlers.delete(handler)
  }
  onNodeMoveEnd(handler: Handler<NodeMoveEndEvent>): () => void {
    this.moveHandlers.add(handler)
    return () => this.moveHandlers.delete(handler)
  }
  onNodesMoveEnd(handler: Handler<NodesMoveEndEvent>): () => void {
    this.movesHandlers.add(handler)
    return () => this.movesHandlers.delete(handler)
  }
  onNodeResizeEnd(handler: Handler<NodeResizeEndEvent>): () => void {
    this.resizeHandlers.add(handler)
    return () => this.resizeHandlers.delete(handler)
  }
  onNodeRotateEnd(handler: Handler<NodeRotateEndEvent>): () => void {
    this.rotateHandlers.add(handler)
    return () => this.rotateHandlers.delete(handler)
  }
  onNodesTransformEnd(handler: Handler<NodesTransformEndEvent>): () => void {
    this.transformsHandlers.add(handler)
    return () => this.transformsHandlers.delete(handler)
  }
  onNodesTransformPreview(
    handler: Handler<NodesTransformPreviewEvent>,
  ): () => void {
    this.transformPreviewHandlers.add(handler)
    return () => this.transformPreviewHandlers.delete(handler)
  }
  onTextDoubleClick(handler: Handler<string>): () => void {
    this.doubleClickHandlers.add(handler)
    return () => this.doubleClickHandlers.delete(handler)
  }
  onFormulaDoubleClick(handler: Handler<string>): () => void {
    this.formulaDoubleClickHandlers.add(handler)
    return () => this.formulaDoubleClickHandlers.delete(handler)
  }

  emitSelected(nodeId: string | null, additive = false): void {
    this.selectedHandlers.forEach((handler) => handler({ nodeIds: nodeId ? [nodeId] : [], additive }))
  }
  emitSelection(nodeIds: string[], additive = false): void {
    this.selectedHandlers.forEach((handler) => handler({ nodeIds, additive }))
  }
  emitMoveEnd(event: NodeMoveEndEvent): void {
    this.moveHandlers.forEach((handler) => handler(event))
  }
  emitMovesEnd(event: NodesMoveEndEvent): void {
    this.movesHandlers.forEach((handler) => handler(event))
  }
  emitResizeEnd(event: NodeResizeEndEvent): void {
    this.resizeHandlers.forEach((handler) => handler(event))
  }
  emitRotateEnd(event: NodeRotateEndEvent): void {
    this.rotateHandlers.forEach((handler) => handler(event))
  }
  emitTransformsEnd(event: NodesTransformEndEvent): void {
    this.transformsHandlers.forEach((handler) => handler(event))
  }
  emitTransformsPreview(event: NodesTransformPreviewEvent): void {
    this.transformPreviewHandlers.forEach((handler) => handler(event))
  }
  emitTextDoubleClick(nodeId: string): void {
    this.doubleClickHandlers.forEach((handler) => handler(nodeId))
  }
  emitFormulaDoubleClick(nodeId: string): void {
    this.formulaDoubleClickHandlers.forEach((handler) => handler(nodeId))
  }

  detach(scene: EditorScene): void {
    if (this.scene === scene) this.scene = null
  }

  /**
   * Phaser logical 1280×720 is Project world. CSS zoom/pan is applied by
   * Workspace; do not scale pointer.worldX/Y again here.
   */
  pointerToSlideWorld(pointer: { worldX: number; worldY: number }): StagePoint {
    return editorPhaserPointerToWorld(pointer)
  }
}

export {
  adaptV9SlideLayerItemHit,
  editorPhaserPointerToWorld,
  hitTestV9SlideLayerItems,
  marqueeHitV9SlideLayerItems,
  v9SlideLayerItemBounds,
  v9SlideLayerItemIsHittable,
}
export type { V9SlideHitTarget }
