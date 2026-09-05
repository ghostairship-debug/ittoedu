import * as Phaser from 'phaser'
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MIN_NODE_SIZE,
  MIN_VISIBLE_NODE_EDGE,
} from '../../shared/constants'
import type { ComponentPackageData } from '../../shared/componentTypes'
import type { NodeMotionAction } from '../../shared/interactionTypes'
import type {
  EditorCanvasDocument,
  EditorCanvasNode,
} from './editorCanvasNode'
import type { EditorPhaserBridge } from './EditorPhaserBridge'
import { resizeWorldFrameFromHandle } from '../authoring/stageViewportTransform'
import { lineHandleWorldPoints } from '../authoring/slideLineAuthoring'
import { SelectionOverlay, type ResizeDirection } from './SelectionOverlay'
import { ProxyNodeAdapter } from './adapters/ProxyNodeAdapter'
import type { AdapterBounds, NodeAdapter } from './adapters/NodeAdapter'

const SNAP_DISTANCE = 7

interface Point {
  x: number
  y: number
}

interface AxisBounds {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

interface TransformSnapshot {
  nodeId: string
  bounds: AdapterBounds
}

function modifierPressed(pointer: Phaser.Input.Pointer): boolean {
  const event = pointer.event as MouseEvent
  return Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey)
}

function axisBounds(bounds: AdapterBounds): AxisBounds {
  const radians = Phaser.Math.DegToRad(bounds.rotation)
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const halfWidth = bounds.width / 2
  const halfHeight = bounds.height / 2
  const points = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((point) => ({
    x: centerX + point.x * cosine - point.y * sine,
    y: centerY + point.x * sine + point.y * cosine,
  }))
  const left = Math.min(...points.map((point) => point.x))
  const right = Math.max(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const bottom = Math.max(...points.map((point) => point.y))
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function unionBounds(bounds: AxisBounds[]): AxisBounds {
  const left = Math.min(...bounds.map((item) => item.left))
  const right = Math.max(...bounds.map((item) => item.right))
  const top = Math.min(...bounds.map((item) => item.top))
  const bottom = Math.max(...bounds.map((item) => item.bottom))
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function intersects(a: AxisBounds, b: AxisBounds): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

export class EditorScene extends Phaser.Scene {
  private readonly adapters = new Map<string, NodeAdapter>()
  private selectionOverlay!: SelectionOverlay
  private marqueeGraphics!: Phaser.GameObjects.Graphics
  private guideGraphics!: Phaser.GameObjects.Graphics
  private selectedNodeIds: string[] = []
  private editingTextNodeId: string | null = null
  private document: EditorCanvasDocument | null = null
  private components: Record<string, ComponentPackageData> = {}
  private lastClick = { nodeId: '', time: 0 }
  private marqueeStart: (Point & { additive: boolean }) | null = null
  private dragStart: {
    anchorNodeId: string
    anchorCenter: Point
    group: AxisBounds
    nodes: TransformSnapshot[]
  } | null = null
  private resizeStart: {
    direction: ResizeDirection
    group: AxisBounds
    nodes: TransformSnapshot[]
    singleRotation: number
  } | null = null
  private rotationStart: {
    center: Point
    pointerAngle: number
    nodes: TransformSnapshot[]
  } | null = null

  constructor(private readonly bridge: EditorPhaserBridge) {
    super({ key: 'EditorScene' })
  }

  create(): void {
    this.marqueeGraphics = this.add.graphics().setDepth(999_998)
    this.guideGraphics = this.add.graphics().setDepth(999_999)
    this.selectionOverlay = new SelectionOverlay(this)
    this.configureResize()
    this.configureMarquee()
    this.bridge.attach(this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup())
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup())
  }

  loadDocument(
    document: EditorCanvasDocument,
    components: Record<string, ComponentPackageData>,
  ): void {
    this.clearAdapters()
    this.document = structuredClone(document)
    this.components = components
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)')
    document.nodes.forEach((node) => this.mountAdapter(node))
    this.reorderNodes(document.nodes.map((node) => node.id))
    this.selectNodes([])
  }

  addNode(node: EditorCanvasNode): void {
    if (this.adapters.has(node.id)) return
    this.mountAdapter(node)
    if (this.document) this.document.nodes.push(structuredClone(node))
    const ids = this.document?.nodes.map((item) => item.id) ?? [node.id]
    this.reorderNodes([...ids.filter((id) => id !== node.id), node.id])
  }

  applyNode(node: EditorCanvasNode): void {
    if (this.document) {
      const index = this.document.nodes.findIndex((item) => item.id === node.id)
      if (index >= 0) this.document.nodes[index] = structuredClone(node)
    }
    const adapter = this.adapters.get(node.id)
    if (!adapter || adapter.getNode().type !== node.type) {
      this.removeNode(node.id)
      this.mountAdapter(node)
      if (this.document) this.document.nodes.push(structuredClone(node))
      this.showCurrentSelection()
      return
    }
    adapter.update(node)
    this.input.setDraggable(adapter.interactionTarget, node.visible && !node.locked)
    this.showCurrentSelection()
  }

  removeNode(nodeId: string): void {
    this.adapters.get(nodeId)?.destroy()
    this.adapters.delete(nodeId)
    if (this.document) this.document.nodes = this.document.nodes.filter((node) => node.id !== nodeId)
    this.selectedNodeIds = this.selectedNodeIds.filter((id) => id !== nodeId)
    this.showCurrentSelection()
  }

  reorderNodes(nodeIds: string[]): void {
    nodeIds.forEach((id, index) => this.adapters.get(id)?.setDepth(index))
    if (this.document) {
      const byId = new Map(this.document.nodes.map((node) => [node.id, node]))
      if (nodeIds.every((id) => byId.has(id))) {
        this.document.nodes = nodeIds.map((id) => byId.get(id)!)
      }
    }
    this.showCurrentSelection()
  }

  selectNode(nodeId: string | null): void {
    this.selectNodes(nodeId ? [nodeId] : [])
  }

  selectNodes(nodeIds: string[]): void {
    const next = [...new Set(nodeIds)].filter((id) => this.adapters.has(id))
    const nextSet = new Set(next)
    this.selectedNodeIds.forEach((id) => {
      if (!nextSet.has(id)) this.adapters.get(id)?.setSelected(false)
    })
    next.forEach((id) => this.adapters.get(id)?.setSelected(true))
    this.selectedNodeIds = next
    this.showCurrentSelection()
  }

  setTextEditing(nodeId: string | null): void {
    if (this.editingTextNodeId) {
      const previous = this.adapters.get(this.editingTextNodeId)
      previous?.setEditMode(false)
      if (previous) {
        const node = previous.getNode()
        this.input.setDraggable(previous.interactionTarget, node.visible && !node.locked)
      }
    }
    this.editingTextNodeId = nodeId
    if (nodeId) {
      const adapter = this.adapters.get(nodeId)
      adapter?.setEditMode(true)
      if (adapter) this.input.setDraggable(adapter.interactionTarget, false)
    }
  }

  previewNodeMotion(action: NodeMotionAction, delayMs = 0): boolean {
    return this.adapters.get(action.nodeId)?.previewMotion(action, delayMs) ?? false
  }

  private configureMarquee(): void {
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (!pointer.leftButtonDown() || over.length > 0) return
        this.marqueeStart = {
          x: pointer.worldX,
          y: pointer.worldY,
          additive: modifierPressed(pointer),
        }
        this.marqueeGraphics.clear()
      },
    )
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.marqueeStart || !pointer.isDown) return
      const rect = this.pointerRect(this.marqueeStart, pointer)
      this.marqueeGraphics
        .clear()
        .fillStyle(0x5b9cff, 0.12)
        .fillRect(rect.left, rect.top, rect.width, rect.height)
        .lineStyle(1, 0x5b9cff, 0.95)
        .strokeRect(rect.left, rect.top, rect.width, rect.height)
    })
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      if (!this.marqueeStart) return
      const start = this.marqueeStart
      this.marqueeStart = null
      this.marqueeGraphics.clear()
      const rect = this.pointerRect(start, pointer)
      const moved = rect.width > 3 || rect.height > 3
      const hits = moved
        ? [...this.adapters.values()]
            .filter((adapter) => adapter.getNode().visible && intersects(axisBounds(adapter.getBounds()), rect))
            .map((adapter) => adapter.nodeId)
        : []
      const next = start.additive
        ? [...new Set([...this.selectedNodeIds, ...hits])]
        : hits
      this.selectNodes(next)
      this.bridge.emitSelection(next)
    })
  }

  private pointerRect(start: Point, pointer: Phaser.Input.Pointer): AxisBounds {
    const left = Math.min(start.x, pointer.worldX)
    const right = Math.max(start.x, pointer.worldX)
    const top = Math.min(start.y, pointer.worldY)
    const bottom = Math.max(start.y, pointer.worldY)
    return { left, right, top, bottom, width: right - left, height: bottom - top }
  }

  private mountAdapter(node: EditorCanvasNode): void {
    const adapter = new ProxyNodeAdapter(this, node)
    this.adapters.set(node.id, adapter)
    this.configureAdapterInput(adapter)
  }

  private configureAdapterInput(adapter: NodeAdapter): void {
    const target = adapter.interactionTarget
    target.setData('nodeId', adapter.nodeId)
    this.input.setDraggable(target, adapter.getNode().visible && !adapter.getNode().locked)
    target.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (pointer: Phaser.Input.Pointer) => {
        const additive = modifierPressed(pointer)
        let next: string[]
        if (additive) {
          next = this.selectedNodeIds.includes(adapter.nodeId)
            ? this.selectedNodeIds.filter((id) => id !== adapter.nodeId)
            : [...this.selectedNodeIds, adapter.nodeId]
        } else if (this.selectedNodeIds.length > 1 && this.selectedNodeIds.includes(adapter.nodeId)) {
          next = this.selectedNodeIds
        } else {
          next = [adapter.nodeId]
        }
        this.selectNodes(next)
        this.bridge.emitSelection(next)
      },
    )
    target.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_UP,
      () => {
        const now = performance.now()
        if (
          this.lastClick.nodeId === adapter.nodeId &&
          now - this.lastClick.time < 380
        ) {
          if (adapter.getNode().type === 'text') {
            // Enter DOM editing only after the second pointer sequence has
            // finished. Mounting/focusing the overlay during pointerdown lets
            // the browser's default canvas focus immediately blur it again.
            this.bridge.emitTextDoubleClick(adapter.nodeId)
          } else if (adapter.getNode().type === 'formula') {
            this.bridge.emitFormulaDoubleClick(adapter.nodeId)
          }
        }
        this.lastClick = { nodeId: adapter.nodeId, time: now }
      },
    )
    target.on(Phaser.Input.Events.DRAG_START, () => {
      const node = adapter.getNode()
      if (node.locked || !node.visible || this.editingTextNodeId === adapter.nodeId) return
      const selected = this.selectedNodeIds.includes(adapter.nodeId)
        ? this.selectedAdapters(false)
        : [adapter]
      const nodes = selected
        .filter((item) => !item.getNode().locked)
        .map((item) => ({ nodeId: item.nodeId, bounds: item.getBounds() }))
      if (nodes.length === 0) return
      const group = unionBounds(nodes.map((item) => axisBounds(item.bounds)))
      const anchorBounds = adapter.getBounds()
      this.dragStart = {
        anchorNodeId: adapter.nodeId,
        anchorCenter: {
          x: anchorBounds.x + anchorBounds.width / 2,
          y: anchorBounds.y + anchorBounds.height / 2,
        },
        group,
        nodes,
      }
    })
    target.on(
      Phaser.Input.Events.DRAG,
      (pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        if (!this.dragStart || this.dragStart.anchorNodeId !== adapter.nodeId) return
        let dx = dragX - this.dragStart.anchorCenter.x
        let dy = dragY - this.dragStart.anchorCenter.y
        dx = Phaser.Math.Clamp(
          dx,
          -this.dragStart.group.right + MIN_VISIBLE_NODE_EDGE,
          CANVAS_WIDTH - MIN_VISIBLE_NODE_EDGE - this.dragStart.group.left,
        )
        dy = Phaser.Math.Clamp(
          dy,
          -this.dragStart.group.bottom + MIN_VISIBLE_NODE_EDGE,
          CANVAS_HEIGHT - MIN_VISIBLE_NODE_EDGE - this.dragStart.group.top,
        )
        const event = pointer.event as MouseEvent
        const snapped = event?.altKey
          ? { dx, dy, guideX: undefined, guideY: undefined }
          : this.snapMove(this.dragStart.group, dx, dy, new Set(this.dragStart.nodes.map((item) => item.nodeId)))
        for (const item of this.dragStart.nodes) {
          this.adapters.get(item.nodeId)?.setPosition(item.bounds.x + snapped.dx, item.bounds.y + snapped.dy)
        }
        this.drawGuides(snapped.guideX, snapped.guideY)
        this.showCurrentSelection()
        this.bridge.emitTransformsPreview({
          nodes: this.currentTransforms(this.dragStart.nodes),
        })
      },
    )
    target.on(Phaser.Input.Events.DRAG_END, () => {
      if (!this.dragStart || this.dragStart.anchorNodeId !== adapter.nodeId) return
      const moved = this.dragStart.nodes
        .map((item) => {
          const bounds = this.adapters.get(item.nodeId)?.getBounds()
          return bounds ? { nodeId: item.nodeId, x: bounds.x, y: bounds.y } : null
        })
        .filter((item): item is { nodeId: string; x: number; y: number } => Boolean(item))
      if (moved.length === 1) this.bridge.emitMoveEnd(moved[0])
      else if (moved.length > 1) this.bridge.emitMovesEnd({ nodes: moved })
      this.dragStart = null
      this.guideGraphics.clear()
    })
  }

  private snapMove(
    group: AxisBounds,
    dx: number,
    dy: number,
    excluded: Set<string>,
  ): { dx: number; dy: number; guideX?: number; guideY?: number } {
    const xTargets = [0, CANVAS_WIDTH / 2, CANVAS_WIDTH]
    const yTargets = [0, CANVAS_HEIGHT / 2, CANVAS_HEIGHT]
    for (const adapter of this.adapters.values()) {
      if (excluded.has(adapter.nodeId) || !adapter.getNode().visible) continue
      const bounds = axisBounds(adapter.getBounds())
      xTargets.push(bounds.left, (bounds.left + bounds.right) / 2, bounds.right)
      yTargets.push(bounds.top, (bounds.top + bounds.bottom) / 2, bounds.bottom)
    }
    const movingX = [group.left + dx, (group.left + group.right) / 2 + dx, group.right + dx]
    const movingY = [group.top + dy, (group.top + group.bottom) / 2 + dy, group.bottom + dy]
    let xMatch: { distance: number; delta: number; guide: number } | null = null
    let yMatch: { distance: number; delta: number; guide: number } | null = null
    for (const moving of movingX) {
      for (const target of xTargets) {
        const distance = Math.abs(target - moving)
        if (distance <= SNAP_DISTANCE && (!xMatch || distance < xMatch.distance)) {
          xMatch = { distance, delta: target - moving, guide: target }
        }
      }
    }
    for (const moving of movingY) {
      for (const target of yTargets) {
        const distance = Math.abs(target - moving)
        if (distance <= SNAP_DISTANCE && (!yMatch || distance < yMatch.distance)) {
          yMatch = { distance, delta: target - moving, guide: target }
        }
      }
    }
    return {
      dx: dx + (xMatch?.delta ?? 0),
      dy: dy + (yMatch?.delta ?? 0),
      guideX: xMatch?.guide,
      guideY: yMatch?.guide,
    }
  }

  private drawGuides(x?: number, y?: number): void {
    this.guideGraphics.clear().lineStyle(1, 0xff4d9d, 0.95)
    if (x !== undefined) this.guideGraphics.lineBetween(x, 0, x, CANVAS_HEIGHT)
    if (y !== undefined) this.guideGraphics.lineBetween(0, y, CANVAS_WIDTH, y)
  }

  private configureResize(): void {
    for (const [direction, handle] of Object.entries(this.selectionOverlay.handles) as Array<[
      ResizeDirection,
      Phaser.GameObjects.Rectangle,
    ]>) {
      handle.on(Phaser.Input.Events.DRAG_START, () => {
        const nodes = this.selectedAdapters(false)
          .filter((adapter) => !adapter.getNode().locked)
          .map((adapter) => ({ nodeId: adapter.nodeId, bounds: adapter.getBounds() }))
        if (nodes.length === 0) return
        this.resizeStart = {
          direction,
          group: unionBounds(nodes.map((item) => axisBounds(item.bounds))),
          nodes,
          singleRotation: nodes.length === 1 ? nodes[0].bounds.rotation : 0,
        }
      })
      handle.on(
        Phaser.Input.Events.DRAG,
        (pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
          if (!this.resizeStart) return
          if (this.resizeStart.nodes.length === 1) {
            this.previewSingleResize(this.resizeStart, pointer, dragX, dragY)
          } else {
            this.previewGroupResize(this.resizeStart, pointer, dragX, dragY)
          }
          this.showCurrentSelection()
          this.bridge.emitTransformsPreview({
            nodes: this.currentTransforms(this.resizeStart.nodes),
          })
        },
      )
      handle.on(Phaser.Input.Events.DRAG_END, () => {
        if (!this.resizeStart) return
        const transformed = this.currentTransforms(this.resizeStart.nodes)
        if (transformed.length === 1) {
          const item = transformed[0]
          this.bridge.emitResizeEnd(item)
        } else if (transformed.length > 1) {
          this.bridge.emitTransformsEnd({ nodes: transformed })
        }
        this.resizeStart = null
      })
    }

    const rotationHandle = this.selectionOverlay.rotationHandle
    rotationHandle.on(Phaser.Input.Events.DRAG_START, (pointer: Phaser.Input.Pointer) => {
      const nodes = this.selectedAdapters(false)
        .filter((adapter) => !adapter.getNode().locked)
        .map((adapter) => ({ nodeId: adapter.nodeId, bounds: adapter.getBounds() }))
      if (nodes.length === 0) return
      const group = unionBounds(nodes.map((item) => axisBounds(item.bounds)))
      const center = { x: (group.left + group.right) / 2, y: (group.top + group.bottom) / 2 }
      this.rotationStart = {
        center,
        pointerAngle: Math.atan2(pointer.worldY - center.y, pointer.worldX - center.x),
        nodes,
      }
    })
    rotationHandle.on(Phaser.Input.Events.DRAG, (pointer: Phaser.Input.Pointer) => {
      if (!this.rotationStart) return
      const currentAngle = Math.atan2(
        pointer.worldY - this.rotationStart.center.y,
        pointer.worldX - this.rotationStart.center.x,
      )
      let delta = Phaser.Math.RadToDeg(currentAngle - this.rotationStart.pointerAngle)
      if ((pointer.event as MouseEvent)?.shiftKey) delta = Math.round(delta / 15) * 15
      for (const item of this.rotationStart.nodes) {
        const adapter = this.adapters.get(item.nodeId)
        if (!adapter) continue
        const centerX = item.bounds.x + item.bounds.width / 2
        const centerY = item.bounds.y + item.bounds.height / 2
        const radians = Phaser.Math.DegToRad(delta)
        const offsetX = centerX - this.rotationStart.center.x
        const offsetY = centerY - this.rotationStart.center.y
        const nextCenterX = this.rotationStart.center.x + offsetX * Math.cos(radians) - offsetY * Math.sin(radians)
        const nextCenterY = this.rotationStart.center.y + offsetX * Math.sin(radians) + offsetY * Math.cos(radians)
        adapter.setPosition(nextCenterX - item.bounds.width / 2, nextCenterY - item.bounds.height / 2)
        adapter.previewRotation(item.bounds.rotation + delta)
      }
      this.showCurrentSelection()
      this.bridge.emitTransformsPreview({
        nodes: this.currentTransforms(this.rotationStart.nodes),
      })
    })
    rotationHandle.on(Phaser.Input.Events.DRAG_END, () => {
      if (!this.rotationStart) return
      const transformed = this.currentTransforms(this.rotationStart.nodes)
      if (transformed.length === 1) {
        this.bridge.emitRotateEnd({ nodeId: transformed[0].nodeId, rotation: transformed[0].rotation })
      } else if (transformed.length > 1) {
        this.bridge.emitTransformsEnd({ nodes: transformed })
      }
      this.rotationStart = null
    })
  }

  private previewSingleResize(
    startState: NonNullable<EditorScene['resizeStart']>,
    pointer: Phaser.Input.Pointer,
    dragX: number,
    dragY: number,
  ): void {
    const item = startState.nodes[0]
    const adapter = this.adapters.get(item.nodeId)
    if (!adapter) return
    const start = item.bounds
    const node = adapter.getNode()
    const component = node.type === 'external-component' && node.component
      ? this.components[node.component.packageId]
      : undefined
    const minimumWidth = component?.manifest.minSize.width ?? MIN_NODE_SIZE
    const minimumHeight = component?.manifest.minSize.height ?? MIN_NODE_SIZE
    const centerX = start.x + start.width / 2
    const centerY = start.y + start.height / 2
    const radians = Phaser.Math.DegToRad(-start.rotation)
    const dx = dragX - centerX
    const dy = dragY - centerY
    const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
    const localY = dx * Math.sin(radians) + dy * Math.cos(radians)
    let left = -start.width / 2
    let right = start.width / 2
    let top = -start.height / 2
    let bottom = start.height / 2
    if (startState.direction.includes('w')) left = Math.min(localX, right - minimumWidth)
    if (startState.direction.includes('e')) right = Math.max(localX, left + minimumWidth)
    if (startState.direction.includes('n')) top = Math.min(localY, bottom - minimumHeight)
    if (startState.direction.includes('s')) bottom = Math.max(localY, top + minimumHeight)
    let width = right - left
    let height = bottom - top
    const preserve =
      (node.type === 'image' && node.preserveAspectRatio) ||
      node.type === 'video' ||
      (node.type === 'external-component' && (component?.manifest.preserveAspectRatio ?? true)) ||
      Boolean((pointer.event as MouseEvent)?.shiftKey)
    if (preserve) {
      const horizontal = startState.direction.includes('w') || startState.direction.includes('e')
      const vertical = startState.direction.includes('n') || startState.direction.includes('s')
      const minimumScale = Math.max(
        minimumWidth / start.width,
        minimumHeight / start.height,
      )
      const scale = horizontal && vertical
        ? Math.max(width / start.width, height / start.height, minimumScale)
        : horizontal
          ? Math.max(width / start.width, minimumScale)
          : Math.max(height / start.height, minimumScale)
      width = start.width * scale
      height = start.height * scale

      if (horizontal) {
        if (startState.direction.includes('w')) left = right - width
        else right = left + width
      } else {
        left = -width / 2
        right = width / 2
      }
      if (vertical) {
        if (startState.direction.includes('n')) top = bottom - height
        else bottom = top + height
      } else {
        top = -height / 2
        bottom = height / 2
      }
    }
    const localCenterX = (left + right) / 2
    const localCenterY = (top + bottom) / 2
    const forward = Phaser.Math.DegToRad(start.rotation)
    const nextCenterX = centerX + localCenterX * Math.cos(forward) - localCenterY * Math.sin(forward)
    const nextCenterY = centerY + localCenterX * Math.sin(forward) + localCenterY * Math.cos(forward)
    adapter.setPosition(nextCenterX - width / 2, nextCenterY - height / 2)
    adapter.previewResize(width, height)
  }

  private previewGroupResize(
    startState: NonNullable<EditorScene['resizeStart']>,
    pointer: Phaser.Input.Pointer,
    dragX: number,
    dragY: number,
  ): void {
    const start = startState.group
    const resized = resizeWorldFrameFromHandle(
      { x: start.left, y: start.top, width: start.width, height: start.height },
      startState.direction,
      { x: dragX, y: dragY },
      MIN_NODE_SIZE,
    )
    let left = resized.x
    let right = resized.x + resized.width
    let top = resized.y
    let bottom = resized.y + resized.height
    if ((pointer.event as MouseEvent)?.shiftKey && startState.direction.length === 2) {
      const ratio = start.width / start.height
      let width = right - left
      let height = bottom - top
      if (width / height > ratio) height = width / ratio
      else width = height * ratio
      if (startState.direction.includes('w')) left = right - width
      else right = left + width
      if (startState.direction.includes('n')) top = bottom - height
      else bottom = top + height
    }
    const scaleX = (right - left) / start.width
    const scaleY = (bottom - top) / start.height
    for (const item of startState.nodes) {
      const adapter = this.adapters.get(item.nodeId)
      if (!adapter) continue
      const relativeX = item.bounds.x - start.left
      const relativeY = item.bounds.y - start.top
      const width = Math.max(MIN_NODE_SIZE, item.bounds.width * scaleX)
      const height = Math.max(MIN_NODE_SIZE, item.bounds.height * scaleY)
      adapter.setPosition(left + relativeX * scaleX, top + relativeY * scaleY)
      adapter.previewResize(width, height)
    }
  }

  private currentTransforms(nodes: TransformSnapshot[]) {
    return nodes
      .map((item) => {
        const bounds = this.adapters.get(item.nodeId)?.getBounds()
        return bounds
          ? {
              nodeId: item.nodeId,
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              rotation: bounds.rotation,
            }
          : null
      })
      .filter((item): item is {
        nodeId: string
        x: number
        y: number
        width: number
        height: number
        rotation: number
      } => Boolean(item))
  }

  private selectedAdapters(includeHidden = true): NodeAdapter[] {
    return this.selectedNodeIds
      .map((id) => this.adapters.get(id))
      .filter((adapter): adapter is NodeAdapter => Boolean(adapter))
      .filter((adapter) => includeHidden || adapter.getNode().visible)
  }

  private showCurrentSelection(): void {
    if (!this.selectionOverlay) return
    const selected = this.selectedAdapters(false)
    if (selected.length === 0) {
      this.selectionOverlay.hide()
      return
    }
    if (selected.length === 1) {
      const adapter = selected[0]
      const node = adapter.getNode()
      const lineHandles =
        node.type === 'shape' &&
        (node.shapeType === 'line' || node.shapeType === 'elbow-arrow') &&
        !node.locked
          ? lineHandleWorldPoints(
              { x: node.x, y: node.y, width: node.width, height: node.height },
              node.rotation,
              node.lineGeometry,
              node.shapeType,
            )
          : null
      this.selectionOverlay.show(adapter.getBounds(), node.locked, lineHandles)
      return
    }
    const bounds = unionBounds(selected.map((adapter) => axisBounds(adapter.getBounds())))
    this.selectionOverlay.show(
      {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
        rotation: 0,
      },
      selected.every((adapter) => adapter.getNode().locked),
    )
  }

  private clearAdapters(): void {
    this.adapters.forEach((adapter) => adapter.destroy())
    this.adapters.clear()
    this.selectedNodeIds = []
    this.editingTextNodeId = null
    this.dragStart = null
    this.resizeStart = null
    this.rotationStart = null
    this.selectionOverlay?.hide()
    this.marqueeGraphics?.clear()
    this.guideGraphics?.clear()
  }

  private cleanup(): void {
    this.clearAdapters()
    this.selectionOverlay?.destroy()
    this.marqueeGraphics?.destroy()
    this.guideGraphics?.destroy()
    this.bridge.detach(this)
  }
}
