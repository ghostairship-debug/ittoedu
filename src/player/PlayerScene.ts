import * as Phaser from 'phaser'
import type {
  ComponentHostActions,
  ExportPayload,
} from '../shared/componentTypes'
import type {
  GlobalLayerItem,
  SceneDocument,
} from '../shared/projectTypes'
import type {
  PlayerAuthoringContext,
  PlayerAuthoringErrorCode,
  PlayerAuthoringPatch,
  PlayerAuthoringScope,
  PlayerAuthoringTarget,
} from '../shared/playerAuthoringProtocol'
import type {
  RuntimeNodeHandle,
  RuntimePresentationApi,
  RuntimePresentationTransition,
} from '../shared/runtimeTypes'
import {
  ensureScenePresentation,
  findPresentationState,
  materializeScene,
  resolveSceneEntryStateId,
} from '../shared/presentation'
import type { ComponentRegistry } from './ComponentRegistry'
import type { ComponentAuthoringTargetsChangedHandler } from './ComponentAuthoringTargetRegistry'
import type { CourseRuntimeKernel } from './CourseRuntimeKernel'
import type { AudioManager } from './AudioManager'
import type { CaptureSurfaceSnapshotter } from './PreparedCanvasSnapshots'
import {
  InteractionEngine,
  type InteractionBindableRoot,
} from './InteractionEngine'
import type { VideoInteractionAction } from '../shared/interactionTypes'
import { NodeMotionDirector } from './NodeMotionDirector'
import { ComponentEventMountBuffer } from './ComponentEventMountBuffer'
import { isGlobalLayerItemVisible } from './globalLayerVisibility'
import type {
  RuntimeLayerTargets,
  RuntimeMountEnvironment,
} from './RuntimeHost'
import {
  globalLayerNativeAssetIds,
  nativeRenderInputsOf,
  nativeTextureAssetIds,
  sceneNativeAssetIds,
  type NativeSceneTexturePlan,
} from './sceneAssets'
import {
  renderNode,
  type PlayerRenderNode,
  type RenderedNodeHandle,
  type RenderNodeContext,
  valuesEqual,
} from './renderNode'
import { isNativeRenderInput } from '../shared/contracts/native-v1/types'

export type SceneChangedHandler = (sceneIndex: number) => void

export interface PlayerRuntimeDomLayers {
  global: RuntimeLayerTargets<HTMLElement>
  scene: RuntimeLayerTargets<HTMLElement>
}

interface PendingNavigation {
  index: number
  force: boolean
  targetStateId?: string | null
}

interface PendingPresentation {
  stateId: string
  transition?: RuntimePresentationTransition
}

export interface PlayerSceneInitialEntry {
  sceneIndex: number
  stateId?: string | null
}

export function resolvePlayerSceneEntryStateId(
  scene: Pick<SceneDocument, 'presentation'>,
  requestedStateId: string | null | undefined,
  authoringMode: boolean,
): string | null {
  return authoringMode && requestedStateId === null
    ? null
    : resolveSceneEntryStateId(scene, requestedStateId)
}

/** Slide paint path: Native render input or component mount descriptor only. */
export function asSlidePlayerRenderNode(
  node: { readonly type: string },
): PlayerRenderNode {
  if (isNativeRenderInput(node)) return node
  if (
    node.type === 'external-component'
    && 'id' in node
    && 'component' in node
    && 'props' in node
  ) {
    return node as PlayerRenderNode
  }
  throw new Error(
    `PlayerScene Slide path 只消费 Native render input 或组件 mount descriptor，收到“${node.type}”。`,
  )
}

function nativeSceneTexturePlan(scene: SceneDocument): NativeSceneTexturePlan {
  const presentation = ensureScenePresentation(scene)
  return {
    backgroundAssetId: scene.backgroundAssetId,
    nodes: nativeRenderInputsOf(scene.nodes),
    namedStates: presentation.states.map((state) => {
      const materialized = materializeScene(scene, state.id)
      return {
        backgroundAssetId: materialized.backgroundAssetId,
        nodes: nativeRenderInputsOf(materialized.nodes),
      }
    }),
  }
}

export type PlayerSceneAuthoringPatchResult =
  | { ok: true; target: PlayerAuthoringTarget }
  | { ok: false; code: PlayerAuthoringErrorCode; message: string }

export class PlayerScene extends Phaser.Scene {
  private currentSceneIndex = -1
  private ready = false
  private renderedNodes: RenderedNodeHandle[] = []
  private renderedGlobalItems: Array<{
    item: GlobalLayerItem
    handle: RenderedNodeHandle
  }> = []
  private pendingNavigation: PendingNavigation | null = null
  private waitingForLoader = false
  private renderingScene = false
  private buildingSceneNodes = false
  private applyingPresentation = false
  private pendingPresentation: PendingPresentation | null = null
  private readonly attemptedAssetIds = new Set<string>()
  private globalUnderlayRoot!: Phaser.GameObjects.Container
  private sceneBackgroundRoot!: Phaser.GameObjects.Container
  private sceneUnderlayRoot!: Phaser.GameObjects.Container
  private sceneNodesRoot!: Phaser.GameObjects.Container
  private sceneOverlayRoot!: Phaser.GameObjects.Container
  private globalOverlayRoot!: Phaser.GameObjects.Container
  private currentPresentationStateId: string | null = null
  private currentBackgroundAssetId: string | null = null
  private interactionEngine: InteractionEngine | null = null
  private globalInteractionEngine: InteractionEngine | null = null
  private sceneMotionDirector: NodeMotionDirector | null = null
  private globalMotionDirector: NodeMotionDirector | null = null
  private sceneComponentEvents: ComponentEventMountBuffer | null = null
  private globalComponentEvents: ComponentEventMountBuffer | null = null
  private readonly globalVisibilityByNodeId = new Map<string, boolean>()
  private documentVisible = true
  private runtimesSuspended = false

  constructor(
    private readonly payload: ExportPayload,
    private readonly componentRegistry: ComponentRegistry,
    private readonly onSceneChanged: SceneChangedHandler,
    private readonly transparentBackground: boolean,
    private readonly hostActions: Readonly<ComponentHostActions>,
    private readonly runtimeKernel: CourseRuntimeKernel,
    private readonly audio: AudioManager,
    private readonly interactionsEnabled: boolean,
    private readonly canvasControlsEnabled: boolean,
    private readonly domLayers: PlayerRuntimeDomLayers,
    private readonly onBackgroundChanged: (color: string) => void,
    private readonly initialEntry: PlayerSceneInitialEntry = { sceneIndex: 0 },
    private readonly authoringMode = false,
    private readonly onComponentAuthoringTargetsChanged?:
      ComponentAuthoringTargetsChangedHandler,
    private readonly authoringScope: PlayerAuthoringScope = 'scene',
  ) {
    super({ key: 'courseware-player' })
  }

  preload(): void {
    const initialScene = this.payload.project.scenes[this.initialEntry.sceneIndex] ??
      this.payload.project.scenes[0]
    if (!initialScene) return
    this.queueNativeAssets([
      ...globalLayerNativeAssetIds(nativeRenderInputsOf(
        this.payload.project.globalLayer.map((item) => item.node),
      )),
      ...sceneNativeAssetIds(nativeSceneTexturePlan(initialScene)),
    ])
  }

  create(): void {
    this.ready = true
    if (this.authoringMode) this.input.enabled = false
    // PlayerApp may observe a hidden document before Phaser has created this
    // scene. Prime the kernel now; its own cached state is inherited by the
    // global and scene runtimes mounted below.
    this.runtimeKernel.setVisible(this.documentVisible)
    if (this.runtimesSuspended) this.runtimeKernel.suspend()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this)
    this.events.once(Phaser.Scenes.Events.DESTROY, this.handleShutdown, this)
    this.createLayerRoots()
    this.renderGlobalLayer()
    const initialSceneIndex = this.payload.project.scenes[this.initialEntry.sceneIndex]
      ? this.initialEntry.sceneIndex
      : 0
    this.updateGlobalLayerVisibility(
      this.payload.project.scenes[initialSceneIndex]?.id ?? '',
      false,
    )
    this.runtimeKernel.mountGlobal(this.globalRuntimeEnvironment())
    this.runtimeKernel.emitCourseStart()
    this.showScene(initialSceneIndex, true, this.initialEntry.stateId)

    const canvas = this.game.canvas
    canvas.setAttribute('aria-label', this.payload.project.title)
    canvas.setAttribute('role', 'img')
  }

  /**
   * Accepts a navigation request synchronously. If the target scene owns images
   * that are not resident, rendering completes after Phaser's loader finishes;
   * currentSceneIndex and onSceneChanged only advance once the scene is ready.
   */
  showScene(
    index: number,
    force = false,
    targetStateId?: string | null,
    bypassNavigationGuards = false,
  ): boolean {
    if (
      !this.ready ||
      index < 0 ||
      index >= this.payload.project.scenes.length
    ) {
      return false
    }
    if (!force && index === this.currentSceneIndex && this.pendingNavigation === null) {
      if (targetStateId === null && this.authoringMode) {
        return this.showAuthoringBaseState()
      }
      return typeof targetStateId === 'string'
        ? this.setPresentationState(targetStateId)
        : false
    }
    if (
      !force &&
      this.pendingNavigation?.index === index &&
      !this.pendingNavigation.force &&
      this.pendingNavigation.targetStateId === targetStateId
    ) {
      return false
    }

    let resolvedIndex = index
    if (!force && !bypassNavigationGuards) {
      const requestedSceneId = this.payload.project.scenes[index]?.id
      if (!requestedSceneId) return false
      const resolvedSceneId = this.runtimeKernel.resolveNavigation(requestedSceneId)
      if (!resolvedSceneId) return false
      resolvedIndex = this.payload.project.scenes.findIndex(
        (scene) => scene.id === resolvedSceneId,
      )
      if (resolvedIndex < 0) return false
    }

    // Navigation guards may redirect to a different scene. A state id authored
    // for the original destination must never be applied to that redirected
    // scene merely because the same string happens to exist there.
    this.pendingNavigation = {
      index: resolvedIndex,
      force,
      ...(resolvedIndex === index && targetStateId !== undefined
        ? { targetStateId }
        : {}),
    }
    this.processPendingNavigation()
    return true
  }

  replayScene(): boolean {
    return this.currentSceneIndex >= 0 &&
      this.showScene(this.currentSceneIndex, true)
  }

  showAuthoringBaseState(): boolean {
    if (!this.authoringMode || !this.ready || this.currentSceneIndex < 0) {
      return false
    }
    if (
      this.currentPresentationStateId === null &&
      this.pendingNavigation === null
    ) {
      return false
    }
    const sceneDocument = this.payload.project.scenes[this.currentSceneIndex]
    if (!sceneDocument || this.renderingScene || this.applyingPresentation) {
      return false
    }
    const previous = materializeScene(
      sceneDocument,
      this.currentPresentationStateId,
    )
    const materialized = materializeScene(sceneDocument, null)
    const previousNodesById = new Map(
      previous.nodes.map((node) => [node.id, node]),
    )
    const handlesById = new Map(
      this.renderedNodes.map((handle) => [handle.id, handle]),
    )
    this.applyingPresentation = true
    try {
      materialized.nodes.forEach((node, depth) => {
        const handle = handlesById.get(node.id)
        if (!handle) return
        const renderNodeInput = asSlidePlayerRenderNode(node)
        if (!valuesEqual(previousNodesById.get(node.id), node)) {
          this.sceneMotionDirector?.prepareStableUpdate(node.id)
          try {
            handle.update(renderNodeInput)
          } catch (error) {
            console.error(`基础画面更新节点“${node.name}”失败`, error)
          }
          this.sceneMotionDirector?.update(handle, renderNodeInput, renderNodeInput.visible)
        }
        handle.root.setDepth(depth)
        this.sceneNodesRoot.moveTo(handle.root, depth)
      })
      this.applySceneBackground(materialized)
      this.currentPresentationStateId = null
      this.pendingPresentation = null
      this.sceneMotionDirector?.refreshInputStates()
    } finally {
      this.applyingPresentation = false
    }
    return true
  }

  restartCourse(): boolean {
    if (!this.ready) return false
    this.pendingNavigation = null
    this.runtimeKernel.resetForRestart()
    this.clearRenderedScene()
    this.clearRenderedGlobalLayer()
    this.currentSceneIndex = -1
    this.renderGlobalLayer()
    this.updateGlobalLayerVisibility(this.payload.project.scenes[0]?.id ?? '')
    this.runtimeKernel.mountGlobal(this.globalRuntimeEnvironment())
    this.runtimeKernel.emitCourseRestart()
    return this.showScene(0, true)
  }

  getCurrentSceneIndex(): number {
    return this.currentSceneIndex
  }

  getCurrentPresentationStateId(): string | null {
    return this.currentPresentationStateId
  }

  setPresentationState(
    stateId: string,
    transition?: RuntimePresentationTransition,
  ): boolean {
    const sceneDocument = this.payload.project.scenes[this.currentSceneIndex]
    const state = sceneDocument && findPresentationState(sceneDocument, stateId)
    if (!sceneDocument || !state) {
      return false
    }
    const normalizedTransition = this.normalizeTransition(transition)
    // A component is allowed to request a state from create(). Its handle is not
    // installed in renderedNodes until the complete initial node pass finishes,
    // so applying the state re-entrantly here would only update a partial scene.
    if (this.buildingSceneNodes || this.applyingPresentation) {
      const effectiveStateId = this.pendingPresentation?.stateId ??
        this.currentPresentationStateId
      if (state.id === effectiveStateId) return false
      if (state.id === this.currentPresentationStateId) {
        this.pendingPresentation = null
        return true
      }
      this.pendingPresentation = {
        stateId: state.id,
        transition: normalizedTransition,
      }
      return true
    }
    if (state.id === this.currentPresentationStateId) return false
    const previousStateId = this.currentPresentationStateId
    const previousMaterialized = materializeScene(sceneDocument, previousStateId)
    const previousNodesById = new Map(
      previousMaterialized.nodes.map((node) => [node.id, node]),
    )
    const materialized = materializeScene(sceneDocument, state.id)
    const handlesById = new Map(this.renderedNodes.map((handle) => [handle.id, handle]))
    const motionDirector = this.sceneMotionDirector
    const applyingSceneIndex = this.currentSceneIndex
    this.applyingPresentation = true
    try {
      materialized.nodes.forEach((node, depth) => {
        const handle = handlesById.get(node.id)
        if (!handle) return
        const renderNodeInput = asSlidePlayerRenderNode(node)
        const affected = !valuesEqual(previousNodesById.get(node.id), node)
        if (affected) {
          motionDirector?.prepareStableUpdate(node.id)
          try {
            handle.update(renderNodeInput, normalizedTransition)
          } catch (error) {
            console.error(`状态切换更新节点“${node.name}”失败`, error)
          }
          motionDirector?.update(handle, renderNodeInput, renderNodeInput.visible, {
            preserveRenderedFrame: (normalizedTransition?.duration ?? 0) > 0,
          })
        }
        // Container children render by list order. Moving the existing roots keeps
        // component/runtime references stable while honoring state.nodeOrder.
        handle.root.setDepth(depth)
        this.sceneNodesRoot.moveTo(handle.root, depth)
      })
      this.applySceneBackground(materialized, normalizedTransition)
      this.currentPresentationStateId = state.id
      // A named state is a new stable activation epoch even when a node remains
      // author-visible across states. This is what lets state-conditioned
      // node.activated rules replay an entrance instead of depending on a
      // false -> true visibility edge.
      materialized.nodes.forEach((node) => {
        motionDirector?.beginActivationEpoch(node.id, sceneDocument.id)
      })
      this.sceneMotionDirector?.refreshInputStates()
      this.emitPresentationChange(
        sceneDocument.id,
        previousStateId,
        state.id,
      )
    } finally {
      this.applyingPresentation = false
    }
    if (this.pendingNavigation) {
      this.pendingPresentation = null
      this.processPendingNavigation()
      return true
    }
    if (
      this.currentSceneIndex !== applyingSceneIndex ||
      this.sceneMotionDirector !== motionDirector
    ) {
      return true
    }
    const followup = this.pendingPresentation
    this.pendingPresentation = null
    if (followup && followup.stateId !== this.currentPresentationStateId) {
      this.setPresentationState(followup.stateId, followup.transition)
    } else {
      // Stable-state activation is published only after presentation.enter has
      // had a chance to redirect the state. This prevents rules from observing
      // a node from one state with another state's condition snapshot.
      motionDirector?.flushActivations()
    }
    return true
  }

  /**
   * Applies one complete authoring frame to the live Player. This deliberately
   * updates only rendered handles and host background/order; Project V8 remains
   * untouched until the editor commits its own store transaction.
   */
  async applyAuthoringPatch(
    context: PlayerAuthoringContext,
    patch: PlayerAuthoringPatch,
  ): Promise<PlayerSceneAuthoringPatchResult> {
    const contextFailure = this.validateAuthoringContext(context)
    if (contextFailure) return contextFailure

    if (patch.kind === 'preview-node-motion') {
      if (patch.target.nodeId !== patch.action.nodeId) {
        return this.authoringFailure(
          'target-mismatch',
          '动画预览目标与动作节点不一致。',
        )
      }
      const director = patch.target.scope === 'scene'
        ? this.sceneMotionDirector
        : this.globalMotionDirector
      if (!director?.preview(patch.action, patch.delayMs)) {
        return this.authoringFailure(
          'target-not-found',
          `当前 Player 中无法预览节点“${patch.action.nodeId}”的动画。`,
        )
      }
      return { ok: true, target: patch.target }
    }

    if (patch.kind === 'scene-order') {
      const expectedIds = this.renderedNodes.map((handle) => handle.id)
      const providedIds = patch.nodeIds
      const providedSet = new Set(providedIds)
      if (
        providedIds.length !== expectedIds.length ||
        providedSet.size !== providedIds.length ||
        expectedIds.some((nodeId) => !providedSet.has(nodeId))
      ) {
        return this.authoringFailure(
          'target-mismatch',
          '节点层级必须完整包含当前场景的所有节点，且不能重复。',
        )
      }
      const handlesById = new Map(
        this.renderedNodes.map((handle) => [handle.id, handle]),
      )
      providedIds.forEach((nodeId, depth) => {
        const handle = handlesById.get(nodeId)!
        handle.root.setDepth(depth)
        this.sceneNodesRoot.moveTo(handle.root, depth)
      })
      return { ok: true, target: patch.target }
    }

    if (patch.kind === 'scene-background') {
      const assetFailure = this.validateAuthoringAsset(
        patch.backgroundAssetId,
        'image',
        '场景背景',
      )
      if (assetFailure) return assetFailure
      const textureFailure = await this.ensureAuthoringTextures(
        patch.backgroundAssetId ? [patch.backgroundAssetId] : [],
      )
      if (textureFailure) return textureFailure
      const refreshedContextFailure = this.validateAuthoringContext(context)
      if (refreshedContextFailure) return refreshedContextFailure
      const sceneDocument = this.payload.project.scenes[this.currentSceneIndex]!
      this.applySceneBackground({
        ...sceneDocument,
        backgroundColor: patch.backgroundColor,
        backgroundAssetId: patch.backgroundAssetId,
      })
      return { ok: true, target: patch.target }
    }

    if (patch.kind === 'runtime-content') {
      return this.authoringFailure(
        'unsupported-host-mode',
        'Project V8 Player 不支持 Course Project V9 Runtime 内容更新。',
      )
    }

    if (patch.target.nodeId !== patch.node.id) {
      return this.authoringFailure(
        'target-mismatch',
        '编辑目标 ID 与完整节点 ID 不一致。',
      )
    }

    const located = patch.target.scope === 'scene'
      ? (() => {
          const scene = this.payload.project.scenes[this.currentSceneIndex]!
          const canonical = scene.nodes.find((node) => node.id === patch.node.id)
          const handle = this.renderedNodes.find((item) => item.id === patch.node.id)
          return canonical && handle
            ? { canonical, handle, item: null }
            : null
        })()
      : (() => {
          const entry = this.renderedGlobalItems.find(
            ({ handle }) => handle.id === patch.node.id,
          )
          return entry
            ? { canonical: entry.item.node, handle: entry.handle, item: entry.item }
            : null
        })()
    if (!located) {
      return this.authoringFailure(
        'target-not-found',
        `当前 Player 中不存在节点“${patch.node.id}”。`,
      )
    }
    let canonicalRenderNode: PlayerRenderNode
    let nextRenderNode: PlayerRenderNode
    try {
      canonicalRenderNode = asSlidePlayerRenderNode(located.canonical)
      nextRenderNode = asSlidePlayerRenderNode(patch.node)
    } catch {
      return this.authoringFailure(
        'target-mismatch',
        'PlayerScene Slide path 只接受 Native render input 或组件 mount descriptor。',
      )
    }
    const identityFailure = this.validateAuthoringNodeIdentity(
      canonicalRenderNode,
      nextRenderNode,
    )
    if (identityFailure) return identityFailure
    const assetFailure = this.validateAuthoringNodeAssets(nextRenderNode)
    if (assetFailure) return assetFailure
    const textureFailure = await this.ensureAuthoringTextures(
      this.authoringTextureAssetIds(nextRenderNode),
    )
    if (textureFailure) return textureFailure
    const refreshedContextFailure = this.validateAuthoringContext(context)
    if (refreshedContextFailure) return refreshedContextFailure

    try {
      const nextNode = asSlidePlayerRenderNode(structuredClone(patch.node))
      if (patch.target.scope === 'scene') {
        this.sceneMotionDirector?.prepareStableUpdate(nextNode.id)
        located.handle.update(nextNode)
        this.sceneMotionDirector?.update(
          located.handle,
          nextNode,
          nextNode.visible,
        )
        this.sceneMotionDirector?.refreshInputStates()
      } else {
        located.handle.update(nextNode)
        const currentSceneId = this.payload.project.scenes[this.currentSceneIndex]?.id ?? ''
        const visible = located.item !== null && this.globalItemVisible(
          located.item,
          currentSceneId,
          nextNode,
        )
        located.handle.setHostVisible?.(visible)
        this.globalMotionDirector?.update(
          located.handle,
          nextNode,
          visible,
          { preserveTransient: true, activationSceneId: currentSceneId },
        )
        this.globalMotionDirector?.refreshInputStates()
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return this.authoringFailure(
        'update-failed',
        `节点“${patch.node.name}”的瞬态画面更新失败：${detail}`,
      )
    }
    return { ok: true, target: patch.target }
  }

  clearRenderedScene(): void {
    this.sceneComponentEvents?.dispose()
    this.sceneComponentEvents = null
    this.interactionEngine?.destroy()
    this.interactionEngine = null
    this.sceneMotionDirector?.clear()
    this.sceneMotionDirector = null
    for (const renderedNode of this.renderedNodes.slice().reverse()) {
      try {
        renderedNode.destroy()
      } catch (error) {
        console.error('销毁课件节点失败', error)
      }
    }
    this.renderedNodes = []
    if (this.sceneNodesRoot?.active) this.sceneNodesRoot.removeAll(true)
    if (this.sceneBackgroundRoot?.active) this.sceneBackgroundRoot.removeAll(true)
    this.currentBackgroundAssetId = null
    this.currentPresentationStateId = null
    this.pendingPresentation = null
    this.domLayers.scene.underlay.replaceChildren()
    this.domLayers.scene.overlay.replaceChildren()
  }

  private processPendingNavigation(): void {
    if (
      !this.ready ||
      this.renderingScene ||
      this.applyingPresentation ||
      this.pendingNavigation === null
    ) {
      return
    }
    if (this.load.isLoading()) {
      this.waitForLoader()
      return
    }

    const request = this.pendingNavigation
    const sceneDocument = this.payload.project.scenes[request.index]
    if (!sceneDocument) {
      this.pendingNavigation = null
      return
    }
    const missingAssetIds = sceneNativeAssetIds(nativeSceneTexturePlan(sceneDocument)).filter(
      (assetId) =>
        !this.textures.exists(this.textureKey(assetId)) &&
        !this.attemptedAssetIds.has(assetId),
    )
    if (missingAssetIds.length > 0) {
      this.queueNativeAssets(missingAssetIds)
      this.waitForLoader()
      this.load.start()
      return
    }

    this.pendingNavigation = null
    if (!request.force && request.index === this.currentSceneIndex) {
      // A later request may cancel an in-flight navigation after its textures
      // have loaded. Drop those now-unused textures while keeping this scene.
      if (request.targetStateId === null && this.authoringMode) {
        this.showAuthoringBaseState()
      } else if (typeof request.targetStateId === 'string') {
        this.setPresentationState(request.targetStateId)
      }
      this.releaseUnusedNativeTextures(sceneDocument)
      return
    }
    this.renderScene(request.index, sceneDocument, request.targetStateId)
    this.processPendingNavigation()
  }

  private renderScene(
    index: number,
    sceneDocument: SceneDocument,
    requestedStateId?: string | null,
  ): void {
    this.renderingScene = true
    try {
      this.runtimeKernel.leaveCurrentScene(sceneDocument.id)
      this.clearRenderedScene()
      // presentationApi() resolves against currentSceneIndex. Set it before any
      // component create() hook runs, otherwise components see the previous scene.
      this.currentSceneIndex = index
      const entryState = resolvePlayerSceneEntryStateId(
        sceneDocument,
        requestedStateId,
        this.authoringMode,
      )
      const renderedScene = materializeScene(sceneDocument, entryState)
      const sceneRules = sceneDocument.interactions ?? []
      this.currentPresentationStateId = entryState
      this.applySceneBackground(renderedScene)
      const componentEvents = new ComponentEventMountBuffer((detail) => {
        this.runtimeKernel.events.emit('component:event', detail)
      })
      this.sceneComponentEvents = componentEvents

      const renderContext: RenderNodeContext = {
        payload: this.payload,
        registry: this.componentRegistry,
        actions: this.hostActions,
        scope: 'scene',
        parentRoot: this.sceneNodesRoot,
        events: this.runtimeKernel.events,
        courseState: this.runtimeKernel.courseState,
        presentation: this.presentationApi(),
        audio: this.audio,
        mode: this.authoringMode || this.interactionsEnabled ? 'preview' : 'capture',
        authoring: this.authoringMode,
        ...(this.authoringMode && this.onComponentAuthoringTargetsChanged
          ? {
              onComponentAuthoringTargetsChanged:
                this.onComponentAuthoringTargetsChanged,
            }
          : {}),
        sceneId: sceneDocument.id,
        currentStateId: () => this.currentPresentationStateId,
        emitComponentEvent: componentEvents.emit,
        canvasControlsEnabled: this.canvasControlsEnabled,
        accessibilityRoot: this.domLayers.scene.overlay,
        textureKey: (assetId) => this.textureKey(assetId),
      }
      this.sceneMotionDirector = new NodeMotionDirector({
        scene: this,
        scope: 'scene',
        mode: this.authoringMode ? 'capture' :
          this.interactionsEnabled ? 'preview' : 'capture',
        events: this.runtimeKernel.events,
        sceneId: sceneDocument.id,
      })
      this.buildingSceneNodes = true
      try {
        this.renderedNodes = renderedScene.nodes.map((node, depth) => {
          const handle = renderNode(this, asSlidePlayerRenderNode(node), depth, renderContext)
          this.applyStoredLifecycleState(handle)
          return handle
        })
      } finally {
        this.buildingSceneNodes = false
      }
      renderedScene.nodes.forEach((node, nodeIndex) => {
        const handle = this.renderedNodes[nodeIndex]
        if (handle) {
          this.sceneMotionDirector?.register(
            handle,
            asSlidePlayerRenderNode(node),
            node.visible,
          )
        }
      })

      if (this.interactionsEnabled) {
        this.interactionEngine = new InteractionEngine({
          sceneId: sceneDocument.id,
          rules: sceneRules,
          events: this.runtimeKernel.events,
          presentation: this.presentationApi(),
          hostActions: this.hostActions,
          executeAudioAction: (action) => this.audio.execute(action),
          executeVideoAction: (action) => this.executeVideoAction(action),
          executeNodeMotion: (action, context) =>
            this.sceneMotionDirector?.play(action, context.signal, {
              restartFromBeginning: context.restartFromBeginning,
            }) ?? false,
        })
        this.interactionEngine.bindNodeHandles(
          this.renderedNodes.map((handle) => ({
            id: handle.id,
            root: handle.root as unknown as InteractionBindableRoot,
          })),
        )
      }
      // Component create()/setMode() run before InteractionEngine exists. Replay
      // only after the engine has subscribed and node click bindings are ready.
      // Keeping the build guard active makes any resulting state request join
      // the same initial-entry arbitration as a direct create() request.
      this.buildingSceneNodes = true
      try {
        componentEvents.complete(
          this.interactionsEnabled && sceneRules.length > 0,
        )
      } finally {
        this.buildingSceneNodes = false
      }
      this.sceneMotionDirector.refreshInputStates()
      if (this.pendingNavigation) {
        this.pendingPresentation = null
        return
      }

      // Component create() may request a state while nodes are mounting. Keep
      // that request aside while the authored entry state is announced; an
      // explicit presentation.enter automation is later in the causal order
      // and therefore wins if it requests a different state.
      const componentRequestedState = this.pendingPresentation
      this.pendingPresentation = null
      this.applyingPresentation = true
      try {
        if (entryState !== null) {
          this.emitPresentationChange(sceneDocument.id, null, entryState)
        }
      } finally {
        this.applyingPresentation = false
      }
      if (this.pendingNavigation) {
        this.pendingPresentation = null
        return
      }
      const automationRequestedState = this.pendingPresentation
      this.pendingPresentation = null
      const requestedState = automationRequestedState ?? componentRequestedState
      if (
        requestedState &&
        requestedState.stateId !== this.currentPresentationStateId
      ) {
        this.setPresentationState(
          requestedState.stateId,
          requestedState.transition,
        )
      } else {
        this.sceneMotionDirector.flushActivations()
      }
      if (this.pendingNavigation) {
        this.pendingPresentation = null
        return
      }

      // The initial global activation was deliberately queued before the scene
      // loaded. Flush it only now, with both scene and final presentation state
      // available to scene.in / presentation.in conditions.
      this.updateGlobalLayerVisibility(sceneDocument.id)
      if (this.pendingNavigation) return
      this.runtimeKernel.enterScene(
        sceneDocument,
        this.sceneRuntimeEnvironment(),
      )
      if (this.pendingNavigation) return
      this.releaseUnusedNativeTextures(sceneDocument)
      this.onSceneChanged(index)
    } finally {
      this.renderingScene = false
    }
  }

  private executeVideoAction(action: VideoInteractionAction): boolean {
    const handle = this.renderedNodes.find((item) => item.id === action.nodeId) ??
      this.renderedGlobalItems.find(({ handle: item }) => item.id === action.nodeId)?.handle
    return handle?.videoController?.execute(action) ?? false
  }

  private authoringFailure(
    code: PlayerAuthoringErrorCode,
    message: string,
  ): PlayerSceneAuthoringPatchResult {
    return { ok: false, code, message }
  }

  private validateAuthoringContext(
    context: PlayerAuthoringContext,
  ): PlayerSceneAuthoringPatchResult | null {
    if (!this.authoringMode) {
      return this.authoringFailure(
        'unsupported-host-mode',
        '当前 Player 未以统一画布编辑宿主模式启动。',
      )
    }
    const currentScene = this.payload.project.scenes[this.currentSceneIndex]
    if (!this.ready || !currentScene || this.renderingScene) {
      return this.authoringFailure(
        'not-ready',
        'Player 尚未完成当前场景的稳定画面挂载。',
      )
    }
    if (currentScene.id !== context.sceneId) {
      return this.authoringFailure(
        'scene-mismatch',
        `编辑命令属于场景“${context.sceneId}”，当前 Player 显示“${currentScene.id}”。`,
      )
    }
    if (context.stateId !== this.currentPresentationStateId) {
      return this.authoringFailure(
        'state-mismatch',
        `编辑命令属于“${context.stateId ?? '基础'}”，当前 Player 显示“${this.currentPresentationStateId ?? '基础'}”。`,
      )
    }
    return null
  }

  private validateAuthoringNodeIdentity(
    canonical: PlayerRenderNode,
    node: PlayerRenderNode,
  ): PlayerSceneAuthoringPatchResult | null {
    if (canonical.id !== node.id || canonical.type !== node.type) {
      return this.authoringFailure(
        'target-mismatch',
        '瞬态更新不能改变节点 ID 或节点类型。',
      )
    }
    if (
      canonical.type === 'external-component' &&
      node.type === 'external-component' &&
      (
        canonical.component.packageId !== node.component.packageId ||
        canonical.component.version !== node.component.version
      )
    ) {
      return this.authoringFailure(
        'target-mismatch',
        '瞬态更新不能替换组件包身份。',
      )
    }
    return null
  }

  private validateAuthoringAsset(
    assetId: string | null | undefined,
    expectedKind: 'image' | 'video',
    label: string,
  ): PlayerSceneAuthoringPatchResult | null {
    if (!assetId) return null
    const meta = this.payload.project.assets[assetId] ??
      Object.values(this.payload.project.assets).find((asset) => asset.id === assetId)
    if (
      !meta ||
      meta.kind !== expectedKind ||
      !this.payload.assets[assetId]
    ) {
      return this.authoringFailure(
        'asset-missing',
        `${label}引用的 ${expectedKind === 'image' ? '图片' : '视频'}素材“${assetId}”不存在或类型不匹配。`,
      )
    }
    return null
  }

  private validateAuthoringNodeAssets(
    node: PlayerRenderNode,
  ): PlayerSceneAuthoringPatchResult | null {
    if (!isNativeRenderInput(node)) return null
    if (node.type === 'image') {
      return this.validateAuthoringAsset(node.assetId, 'image', `节点“${node.name}”`)
    }
    if (node.type === 'video') {
      const videoFailure = this.validateAuthoringAsset(
        node.assetId,
        'video',
        `节点“${node.name}”`,
      )
      if (videoFailure) return videoFailure
      if (node.poster.mode === 'image') {
        return this.validateAuthoringAsset(
          node.poster.assetId,
          'image',
          `视频“${node.name}”的海报帧`,
        )
      }
    }
    return null
  }

  private authoringTextureAssetIds(node: PlayerRenderNode): string[] {
    if (!isNativeRenderInput(node)) return []
    return nativeTextureAssetIds([node])
  }

  private async ensureAuthoringTextures(
    assetIds: readonly string[],
  ): Promise<PlayerSceneAuthoringPatchResult | null> {
    const uniqueAssetIds = [...new Set(assetIds)]
    if (uniqueAssetIds.length === 0) return null
    if (this.load.isLoading()) {
      await new Promise<void>((resolve) => {
        this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve(), this)
      })
    }
    const missing = uniqueAssetIds.filter(
      (assetId) => !this.textures.exists(this.textureKey(assetId)),
    )
    if (missing.length === 0) return null
    const alreadyFailed = missing.find((assetId) => this.attemptedAssetIds.has(assetId))
    if (alreadyFailed) {
      return this.authoringFailure(
        'asset-missing',
        `图片素材“${alreadyFailed}”无法解码，不能更新画布。`,
      )
    }
    try {
      this.queueNativeAssets(missing)
      await new Promise<void>((resolve) => {
        this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve(), this)
        this.load.start()
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return this.authoringFailure(
        'asset-missing',
        `画布素材加载失败：${detail}`,
      )
    }
    const unresolved = missing.find(
      (assetId) => !this.textures.exists(this.textureKey(assetId)),
    )
    return unresolved
      ? this.authoringFailure(
          'asset-missing',
          `图片素材“${unresolved}”无法解码，不能更新画布。`,
        )
      : null
  }

  private queueNativeAssets(assetIds: Iterable<string>): void {
    for (const assetId of assetIds) {
      const asset = this.payload.assets[assetId]
      if (
        !asset ||
        this.textures.exists(this.textureKey(assetId)) ||
        this.attemptedAssetIds.has(assetId)
      ) {
        continue
      }
      this.attemptedAssetIds.add(assetId)
      this.load.image(this.textureKey(assetId), asset.dataUrl)
    }
  }

  private waitForLoader(): void {
    if (this.waitingForLoader) return
    this.waitingForLoader = true
    this.load.once(
      Phaser.Loader.Events.COMPLETE,
      this.handleLoaderComplete,
      this,
    )
  }

  private readonly handleLoaderComplete = (): void => {
    this.waitingForLoader = false
    this.processPendingNavigation()
  }

  private releaseUnusedNativeTextures(scene: SceneDocument): void {
    const retained = new Set([
      ...globalLayerNativeAssetIds(nativeRenderInputsOf(
        this.payload.project.globalLayer.map((item) => item.node),
      )),
      ...sceneNativeAssetIds(nativeSceneTexturePlan(scene)),
    ])
    for (const assetId of Object.keys(this.payload.assets)) {
      if (retained.has(assetId)) continue
      const key = this.textureKey(assetId)
      if (this.textures.exists(key)) this.textures.remove(key)
      // Released images may be loaded again when the author navigates back.
      this.attemptedAssetIds.delete(assetId)
    }
  }

  private textureKey(assetId: string): string {
    return `lesson-asset:${assetId}`
  }

  private handleShutdown(): void {
    if (!this.ready) return

    this.ready = false
    this.pendingNavigation = null
    if (this.waitingForLoader) {
      this.load.off(
        Phaser.Loader.Events.COMPLETE,
        this.handleLoaderComplete,
        this,
      )
      this.waitingForLoader = false
    }
    this.runtimeKernel.destroy()
    this.clearRenderedScene()
    this.clearRenderedGlobalLayer()
    this.currentSceneIndex = -1
    this.attemptedAssetIds.clear()
  }

  async waitForCaptureReady(
    snapshotSurfaces?: CaptureSurfaceSnapshotter,
  ): Promise<void> {
    await this.runtimeKernel.waitForCaptureReady(snapshotSurfaces)
    const handles = [
      ...this.renderedGlobalItems.map(({ handle }) => handle),
      ...this.renderedNodes,
    ]
    for (const handle of handles) {
      await handle.prepareCapture?.(snapshotSurfaces)
    }
  }

  setDocumentVisible(visible: boolean): void {
    this.documentVisible = visible
    if (!this.ready) return
    this.runtimeKernel.setVisible(visible)
    for (const handle of this.renderedNodes) handle.setPageVisible?.(visible)
    for (const { handle } of this.renderedGlobalItems) {
      handle.setPageVisible?.(visible)
    }
  }

  suspendRuntimes(): void {
    const alreadySuspended = this.runtimesSuspended
    this.runtimesSuspended = true
    if (!this.ready || alreadySuspended) return
    this.runtimeKernel.suspend()
    for (const handle of this.renderedNodes) handle.suspend?.()
    for (const { handle } of this.renderedGlobalItems) handle.suspend?.()
  }

  resumeRuntimes(): void {
    const wasSuspended = this.runtimesSuspended
    this.runtimesSuspended = false
    if (!this.ready || !wasSuspended) return
    this.runtimeKernel.resume()
    for (const handle of this.renderedNodes) handle.resume?.()
    for (const { handle } of this.renderedGlobalItems) handle.resume?.()
  }

  private createLayerRoots(): void {
    this.sceneBackgroundRoot = this.add
      .container(0, 0)
      .setName('scene-background')
      .setDepth(-50_000)
    this.globalUnderlayRoot = this.add
      .container(0, 0)
      .setName('global-underlay')
      .setDepth(-40_000)
    this.sceneUnderlayRoot = this.add
      .container(0, 0)
      .setName('scene-underlay')
      .setDepth(-30_000)
    this.sceneNodesRoot = this.add
      .container(0, 0)
      .setName('scene-nodes')
      .setDepth(0)
    this.sceneOverlayRoot = this.add
      .container(0, 0)
      .setName('scene-overlay')
      .setDepth(30_000)
    this.globalOverlayRoot = this.add
      .container(0, 0)
      .setName('global-overlay')
      .setDepth(40_000)
  }

  private applySceneBackground(
    sceneDocument: SceneDocument,
    transition?: RuntimePresentationTransition,
  ): void {
    // The solid scene color is hosted by PlayerApp beneath the fixed DOM and
    // Canvas planes. Keeping the camera transparent makes DOM underlays real.
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)')
    this.onBackgroundChanged(sceneDocument.backgroundColor)
    const assetId = sceneDocument.backgroundAssetId ?? null
    if (this.transparentBackground || !assetId) {
      this.sceneBackgroundRoot.removeAll(true)
      this.currentBackgroundAssetId = null
      return
    }
    if (assetId === this.currentBackgroundAssetId && this.sceneBackgroundRoot.length > 0) {
      return
    }
    const key = this.textureKey(assetId)
    if (!this.textures.exists(key)) {
      console.error(`场景背景素材“${assetId}”未加载`)
      this.sceneBackgroundRoot.removeAll(true)
      this.currentBackgroundAssetId = null
      return
    }
    const texture = this.textures.get(key)
    const frame = texture.get()
    const scale = Math.max(
      this.payload.project.canvas.width / Math.max(1, frame.realWidth),
      this.payload.project.canvas.height / Math.max(1, frame.realHeight),
    )
    const image = this.add
      .image(
        this.payload.project.canvas.width / 2,
        this.payload.project.canvas.height / 2,
        key,
      )
      .setDisplaySize(frame.realWidth * scale, frame.realHeight * scale)
    const previous = this.sceneBackgroundRoot.list.slice()
    this.tweens.killTweensOf(previous)
    this.sceneBackgroundRoot.add(image)
    const duration = Math.max(0, transition?.duration ?? 0)
    if (duration > 0 && previous.length > 0) {
      image.setAlpha(0)
      this.tweens.add({
        targets: image,
        alpha: 1,
        duration,
        ease: transition?.ease ?? 'Sine.easeInOut',
      })
      this.tweens.add({
        targets: previous,
        alpha: 0,
        duration,
        ease: transition?.ease ?? 'Sine.easeInOut',
        onComplete: () => previous.forEach((object) => object.destroy()),
      })
    } else {
      previous.forEach((object) => object.destroy())
    }
    this.currentBackgroundAssetId = assetId
  }

  private emitPresentationChange(
    sceneId: string,
    fromStateId: string | null,
    stateId: string,
  ): void {
    const detail = { sceneId, fromStateId, stateId }
    this.runtimeKernel.events.emit('presentation:change', detail)
    window.dispatchEvent(new CustomEvent('courseware-presentation-change', {
      detail,
    }))
  }

  private normalizeTransition(
    transition?: RuntimePresentationTransition,
  ): RuntimePresentationTransition | undefined {
    if (!transition) return undefined
    // Capture surfaces (thumbnails/PDF/PPTX) must always render the resolved
    // state, never an in-between tween frame requested by component/runtime code.
    const duration = !this.interactionsEnabled
      ? 0
      : Number.isFinite(transition.duration)
      ? Phaser.Math.Clamp(transition.duration ?? 0, 0, 10_000)
      : 0
    const ease = typeof transition.ease === 'string' && transition.ease.trim()
      ? transition.ease.trim()
      : undefined
    return { duration, ...(ease ? { ease } : {}) }
  }

  private presentationApi(): RuntimePresentationApi {
    return {
      current: () => (this.buildingSceneNodes || this.applyingPresentation) &&
        this.pendingPresentation
        ? this.pendingPresentation.stateId
        : this.currentPresentationStateId,
      states: () => {
        const scene = this.payload.project.scenes[this.currentSceneIndex]
        if (!scene) return []
        return ensureScenePresentation(scene).states.map((state) => Object.freeze({
          id: state.id,
          name: state.name,
          ...(state.description ? { description: state.description } : {}),
        }))
      },
      setState: (stateId) => this.authoringMode
        ? false
        : this.setPresentationState(stateId),
      transitionTo: (stateId, transition) => this.authoringMode
        ? false
        : this.setPresentationState(stateId, transition),
    }
  }

  private renderGlobalLayer(): void {
    this.clearRenderedGlobalLayer()
    const globalRules = this.payload.project.globalInteractions ?? []
    const componentEvents = new ComponentEventMountBuffer((detail) => {
      this.runtimeKernel.events.emit('component:event', detail)
    })
    this.globalComponentEvents = componentEvents
    this.globalMotionDirector = new NodeMotionDirector({
      scene: this,
      scope: 'global',
      mode: this.authoringMode ? 'capture' :
        this.interactionsEnabled ? 'preview' : 'capture',
      events: this.runtimeKernel.events,
    })
    this.renderedGlobalItems = this.payload.project.globalLayer.map(
      (item, depth) => {
        const parentRoot = item.layer === 'underlay'
          ? this.globalUnderlayRoot
          : this.globalOverlayRoot
        const handle = renderNode(this, asSlidePlayerRenderNode(item.node), depth, {
          payload: this.payload,
          registry: this.componentRegistry,
          actions: this.hostActions,
          scope: 'global',
          parentRoot,
          events: this.runtimeKernel.events,
          courseState: this.runtimeKernel.courseState,
          presentation: this.presentationApi(),
          audio: this.audio,
          mode: this.authoringMode || this.interactionsEnabled ? 'preview' : 'capture',
          authoring: this.authoringMode,
          ...(this.authoringMode && this.onComponentAuthoringTargetsChanged
            ? {
                onComponentAuthoringTargetsChanged:
                  this.onComponentAuthoringTargetsChanged,
              }
            : {}),
          emitComponentEvent: componentEvents.emit,
          currentStateId: () => this.currentPresentationStateId,
          canvasControlsEnabled: this.canvasControlsEnabled,
          accessibilityRoot: this.domLayers.global.overlay,
          textureKey: (assetId) => this.textureKey(assetId),
        })
        this.applyStoredLifecycleState(handle)
        return { item, handle }
      },
    )
    for (const { item, handle } of this.renderedGlobalItems) {
      // The active scene is resolved immediately after the persistent layer is
      // built. Register inactive first so visibility ranges can activate once.
      this.globalMotionDirector.register(handle, asSlidePlayerRenderNode(item.node), false)
    }
    if (this.interactionsEnabled) {
      this.globalInteractionEngine = new InteractionEngine({
        scope: 'global',
        sceneId: '',
        currentSceneId: () => this.payload.project.scenes[this.currentSceneIndex]?.id ?? null,
        rules: globalRules,
        events: this.runtimeKernel.events,
        presentation: this.presentationApi(),
        hostActions: this.hostActions,
        executeAudioAction: (action) => this.audio.execute(action),
        executeVideoAction: (action) => this.executeVideoAction(action),
        executeNodeMotion: (action, context) =>
          this.globalMotionDirector?.play(action, context.signal, {
            restartFromBeginning: context.restartFromBeginning,
          }) ?? false,
      })
      this.globalInteractionEngine.bindNodeHandles(
        this.renderedGlobalItems.map(({ handle }) => ({
          id: handle.id,
          root: handle.root as unknown as InteractionBindableRoot,
          })),
        )
      }
    componentEvents.complete(
      this.interactionsEnabled && globalRules.length > 0,
    )
    this.globalMotionDirector.refreshInputStates()
  }

  private clearRenderedGlobalLayer(): void {
    this.globalComponentEvents?.dispose()
    this.globalComponentEvents = null
    this.globalInteractionEngine?.destroy()
    this.globalInteractionEngine = null
    this.globalMotionDirector?.clear()
    this.globalMotionDirector = null
    for (const { handle } of this.renderedGlobalItems.slice().reverse()) {
      try {
        handle.destroy()
      } catch (error) {
        console.error('销毁全局元素失败', error)
      }
    }
    this.renderedGlobalItems = []
    this.globalVisibilityByNodeId.clear()
  }

  private applyStoredLifecycleState(handle: RenderedNodeHandle): void {
    // Object.create-based unit harnesses predate these fields, so undefined is
    // intentionally treated as the normal visible/running default.
    handle.setPageVisible?.(this.documentVisible !== false)
    if (this.runtimesSuspended === true) handle.suspend?.()
  }

  private updateGlobalLayerVisibility(
    sceneId: string,
    flushActivations = true,
  ): void {
    for (const { item, handle } of this.renderedGlobalItems) {
      const visible = this.globalItemVisible(item, sceneId)
      const previousVisible = this.globalVisibilityByNodeId.get(item.node.id)
      handle.setHostVisible?.(visible)
      this.globalMotionDirector?.update(handle, asSlidePlayerRenderNode(item.node), visible, {
        preserveTransient: previousVisible === true && visible,
        activationSceneId: sceneId,
      })
      this.globalVisibilityByNodeId.set(item.node.id, visible)
    }
    this.globalMotionDirector?.refreshInputStates()
    if (flushActivations) this.globalMotionDirector?.flushActivations()
  }

  private globalItemVisible(
    item: GlobalLayerItem,
    sceneId: string,
    node: Pick<PlayerRenderNode, 'visible'> = asSlidePlayerRenderNode(item.node),
  ): boolean {
    return node.visible && (
      this.authoringMode && this.authoringScope === 'global' ||
      isGlobalLayerItemVisible(item, sceneId)
    )
  }

  private resolveRuntimeNode(nodeId: string): RuntimeNodeHandle | null {
    const sceneNode = this.renderedNodes.find((handle) => handle.id === nodeId)
    if (sceneNode) return sceneNode
    return this.renderedGlobalItems.find(
      ({ handle }) => handle.id === nodeId,
    )?.handle ?? null
  }

  private resolveGlobalRuntimeNode(nodeId: string): RuntimeNodeHandle | null {
    const globalNode = this.renderedGlobalItems.find(
      ({ handle }) => handle.id === nodeId,
    )?.handle
    if (globalNode) return globalNode
    return this.renderedNodes.find((handle) => handle.id === nodeId) ?? null
  }

  private globalRuntimeEnvironment(): RuntimeMountEnvironment {
    return {
      phaser: {
        scene: this,
        underlay: this.globalUnderlayRoot,
        overlay: this.globalOverlayRoot,
      },
      dom: this.domLayers.global,
      resolveNode: (nodeId) => this.resolveGlobalRuntimeNode(nodeId),
      presentation: this.presentationApi(),
    }
  }

  private sceneRuntimeEnvironment(): RuntimeMountEnvironment {
    return {
      phaser: {
        scene: this,
        underlay: this.sceneUnderlayRoot,
        overlay: this.sceneOverlayRoot,
      },
      dom: this.domLayers.scene,
      resolveNode: (nodeId) => this.resolveRuntimeNode(nodeId),
      presentation: this.presentationApi(),
    }
  }
}
