import * as Phaser from 'phaser'
import type {
  ComponentHostActions,
  ExportPayload,
} from '../shared/componentTypes'
import { ComponentRegistry } from './ComponentRegistry'
import { createPlayerComponentHostActions } from './componentHostActions'
import { CourseRuntimeKernel } from './CourseRuntimeKernel'
import { PreparedCanvasSnapshots } from './PreparedCanvasSnapshots'
import { PlayerPresenterInput } from './PlayerPresenterInput'
import { AudioManager } from './AudioManager'
import { HostEvidenceRecorder } from './HostEvidenceRecorder'
import {
  SCENE_PICKER_OPEN_EVENT,
  ScenePickerOverlay,
  TEACHER_CONTROLLER_COLLAPSE_EVENT,
  type TeacherControllerCollapseEvent,
} from './ScenePickerOverlay'
import {
  PlayerScene,
  type PlayerRuntimeDomLayers,
} from './PlayerScene'
import type { RuntimeExecutionMode } from '../shared/runtimeTypes'
import type { RuntimePresentationTransition } from '../shared/runtimeTypes'
import type { ComponentAuthoringTargetsChangedHandler } from './ComponentAuthoringTargetRegistry'
import type { RuntimeAuthoringTargetsChangedHandler } from './RuntimeAuthoringTargetRegistry'
import {
  PLAYER_AUTHORING_CAPABILITIES,
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
  type PlayerAuthoringAckMessage,
  type PlayerAuthoringErrorCode,
  type PlayerAuthoringErrorMessage,
  type PlayerAuthoringPatchCommand,
  type PlayerAuthoringReadyMessage,
  type PlayerAuthoringScope,
  type PlayerHostMode,
} from '../shared/playerAuthoringProtocol'

export interface PlayerAppOptions {
  transparent?: boolean
  renderWidth?: number
  renderHeight?: number
  controls?: boolean
  mode?: RuntimeExecutionMode
  /** Start directly at this authored scene instead of briefly rendering page 1. */
  initialSceneId?: string
  /** Named state, or explicit base (`null`) in the isolated authoring host. */
  initialStateId?: string | null
  /** Isolated editor host; omitted for every delivery/capture surface. */
  hostMode?: PlayerHostMode
  /** Which authoring layer the unified editor currently exposes. */
  authoringScope?: PlayerAuthoringScope
  /** Internal bridge callback; ordinary callers should leave it undefined. */
  onRuntimeAuthoringTargetsChanged?: RuntimeAuthoringTargetsChangedHandler
  /** Internal bridge callback; ordinary callers should leave it undefined. */
  onComponentAuthoringTargetsChanged?: ComponentAuthoringTargetsChangedHandler
}

const FROZEN_AUTHORING_ACTIONS: Readonly<ComponentHostActions> = Object.freeze({
  goToScene: () => false,
  nextScene: () => false,
  previousScene: () => false,
  replayScene: () => false,
  restartCourse: () => false,
})

function createRuntimeDomLayer(
  className: string,
  logicalWidth: number,
  logicalHeight: number,
  zIndex: number,
): HTMLDivElement {
  const layer = document.createElement('div')
  layer.className = `lesson-runtime-layer ${className}`
  Object.assign(layer.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${logicalWidth}px`,
    height: `${logicalHeight}px`,
    overflow: 'visible',
    pointerEvents: 'none',
    transformOrigin: '0 0',
    zIndex: String(zIndex),
  })
  return layer
}

export class PlayerApp {
  readonly game: Phaser.Game

  readonly #hostEvidenceRecorder = new HostEvidenceRecorder()

  private readonly presenterInput: PlayerPresenterInput | null
  readonly audio: AudioManager
  private readonly disposeAudioToggle: () => void
  private readonly componentRegistry = new ComponentRegistry()
  private readonly preparedCanvasSnapshots = new PreparedCanvasSnapshots()
  private readonly playerScene: PlayerScene
  private readonly runtimeKernel: CourseRuntimeKernel
  private readonly stage: HTMLElement
  private readonly presenterStatus: HTMLDivElement
  private readonly runtimeDomLayers: PlayerRuntimeDomLayers
  private readonly scenePicker: ScenePickerOverlay | null
  private readonly scenePickerEventDisposers: Array<() => void> = []
  private readonly captureMode: boolean
  private readonly hostMode: PlayerHostMode
  private readonly authoringMode: boolean
  private readonly resizeObserver: ResizeObserver | null
  private alignmentFrame: number | null = null
  private capturePreparation: Promise<void> | null = null
  private authoringQueue: Promise<void> = Promise.resolve()
  private lastAuthoringRevision = -1
  private presenterStatusTimer: ReturnType<typeof setTimeout> | null = null
  private lastNavigationBlockedReason: string | null = null
  private destroyed = false

  constructor(
    private readonly payload: ExportPayload,
    private readonly root: HTMLElement,
    options: PlayerAppOptions = {},
  ) {
    if (payload.project.scenes.length === 0) {
      throw new Error('课件至少需要一个场景')
    }
    this.captureMode = options.mode === 'capture'
    this.hostMode = options.hostMode === 'authoring' && !this.captureMode
      ? 'authoring'
      : 'playback'
    this.authoringMode = this.hostMode === 'authoring'
    const requestedInitialSceneIndex = options.initialSceneId
      ? payload.project.scenes.findIndex((scene) => scene.id === options.initialSceneId)
      : 0
    const initialSceneIndex = requestedInitialSceneIndex >= 0
      ? requestedInitialSceneIndex
      : 0
    const initialStateId = !options.initialSceneId || requestedInitialSceneIndex >= 0
      ? options.initialStateId
      : undefined
    const initialScene = payload.project.scenes[initialSceneIndex]!

    this.registerComponentRuntimes()

    const shell = document.createElement('main')
    shell.className = 'lesson-shell'

    const stage = document.createElement('section')
    stage.className = 'lesson-stage'
    stage.setAttribute('aria-label', '课件画布')
    this.stage = stage

    const canvasHost = document.createElement('div')
    canvasHost.className = 'lesson-canvas-host'
    Object.assign(canvasHost.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '2',
      ...(this.authoringMode ? { pointerEvents: 'none' } : {}),
    })
    const logicalWidth = payload.project.canvas.width
    const logicalHeight = payload.project.canvas.height
    this.runtimeDomLayers = {
      global: {
        underlay: createRuntimeDomLayer(
          'lesson-runtime-layer--global-underlay',
          logicalWidth,
          logicalHeight,
          0,
        ),
        overlay: createRuntimeDomLayer(
          'lesson-runtime-layer--global-overlay',
          logicalWidth,
          logicalHeight,
          4,
        ),
      },
      scene: {
        underlay: createRuntimeDomLayer(
          'lesson-runtime-layer--scene-underlay',
          logicalWidth,
          logicalHeight,
          1,
        ),
        overlay: createRuntimeDomLayer(
          'lesson-runtime-layer--scene-overlay',
          logicalWidth,
          logicalHeight,
          3,
        ),
      },
    }
    stage.append(
      canvasHost,
      this.runtimeDomLayers.global.underlay,
      this.runtimeDomLayers.scene.underlay,
      this.runtimeDomLayers.scene.overlay,
      this.runtimeDomLayers.global.overlay,
    )
    const presenterStatus = document.createElement('div')
    presenterStatus.className = 'lesson-presenter-status'
    presenterStatus.setAttribute('role', 'status')
    presenterStatus.setAttribute('aria-live', 'polite')
    presenterStatus.setAttribute('aria-atomic', 'true')
    presenterStatus.hidden = true
    Object.assign(presenterStatus.style, {
      position: 'absolute',
      left: '50%',
      bottom: '24px',
      zIndex: '40',
      maxWidth: 'min(680px, calc(100% - 48px))',
      padding: '10px 16px',
      border: '1px solid rgba(244, 196, 92, 0.7)',
      borderRadius: '999px',
      color: '#fff8dc',
      background: 'rgba(13, 22, 38, 0.94)',
      boxShadow: '0 10px 32px rgba(0, 0, 0, 0.34)',
      fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", sans-serif',
      fontSize: '14px',
      lineHeight: '1.45',
      textAlign: 'center',
      pointerEvents: 'none',
      transform: 'translateX(-50%)',
    })
    stage.append(presenterStatus)
    this.presenterStatus = presenterStatus
    if (this.authoringMode) {
      const inputShield = document.createElement('div')
      inputShield.className = 'lesson-authoring-input-shield'
      inputShield.setAttribute('aria-hidden', 'true')
      Object.assign(inputShield.style, {
        position: 'absolute',
        inset: '0',
        zIndex: '5',
        background: 'transparent',
        pointerEvents: 'auto',
      })
      stage.append(inputShield)
    }
    if (!options.transparent) {
      stage.style.backgroundColor = initialScene.backgroundColor
    }

    const authoredControlsMode = options.controls === false
      ? 'none'
      : payload.project.playback.controls

    shell.append(stage)
    root.replaceChildren(shell)
    const hostActions = this.authoringMode
      ? FROZEN_AUTHORING_ACTIONS
      : createPlayerComponentHostActions(this)
    this.runtimeKernel = new CourseRuntimeKernel(payload, hostActions, {
      // Runtime API 2 has no authoring execution-mode literal. Reuse its
      // deterministic capture branch in the isolated editor host so trusted
      // runtimes do not start preview-only timers, media or autonomous motion.
      mode: this.authoringMode ? 'capture' : options.mode,
      freezeCourseState: this.authoringMode,
      onAssessmentEvaluated: (evidence) => {
        this.#hostEvidenceRecorder.recordAssessment(evidence)
      },
      onActionRecorded: (evidence) => {
        this.#hostEvidenceRecorder.recordAction(evidence)
      },
      ...(this.authoringMode && options.onRuntimeAuthoringTargetsChanged
        ? {
            authoring: {
              onTargetsChanged: options.onRuntimeAuthoringTargetsChanged,
            },
          }
        : {}),
    })
    this.audio = new AudioManager(
      payload.project,
      (assetId) => {
        const asset = payload.assets[assetId]
        if (!asset) throw new Error(`工程声音素材“${assetId}”不存在`)
        return asset.dataUrl
      },
      this.runtimeKernel.events,
      {
        mode: this.authoringMode ? 'capture' : options.mode,
        unlockTarget: typeof window === 'undefined' ? undefined : window,
      },
    )
    this.disposeAudioToggle = this.runtimeKernel.events.on('audio:toggle-mute', () => {
      this.audio.toggleMuted()
    })
    this.scenePickerEventDisposers.push(
      this.runtimeKernel.events.on<{ reason?: string }>(
        'navigation:blocked',
        (event) => {
          this.lastNavigationBlockedReason = event?.reason ?? '导航被课程规则阻止'
          this.showPresenterFeedback(this.lastNavigationBlockedReason)
        },
      ),
    )
    const presenterSettings = payload.project.playback.presenter
    this.presenterInput = !this.captureMode && !this.authoringMode &&
      (payload.project.playback.keyboardNavigation || presenterSettings.enabled)
      ? new PlayerPresenterInput({
          totalPages: payload.project.scenes.length,
          keyboardNavigation: payload.project.playback.keyboardNavigation,
          presenter: presenterSettings,
          onNavigate: (targetIndex) => {
            this.lastNavigationBlockedReason = null
            const accepted = this.goToScene(targetIndex)
            return accepted
              ? { accepted: true }
              : {
                  accepted: false,
                  message: this.lastNavigationBlockedReason ?? '场景导航未执行',
                }
          },
          onAuthoredCommand: (command) => {
            const accepted = this.hasActivePresenterRule(command)
            this.runtimeKernel.events.emit('presenter:command', {
              command,
              sceneId: this.getCurrentSceneId(),
            })
            return accepted
          },
          onFeedback: ({ message }) => this.showPresenterFeedback(message),
          isModalOpen: () => this.scenePicker?.isOpen ?? false,
        })
      : null
    this.playerScene = new PlayerScene(
      payload,
      this.componentRegistry,
      (index) => {
        this.scenePicker?.close()
        this.presenterInput?.setIndex(index)
        window.dispatchEvent(new CustomEvent('courseware-scene-change', {
          detail: {
            sceneId: this.payload.project.scenes[index]?.id,
            sceneIndex: index,
            presentationStateId: this.playerScene.getCurrentPresentationStateId(),
          },
        }))
      },
      options.transparent ?? false,
      hostActions,
      this.runtimeKernel,
      this.audio,
      !this.captureMode && !this.authoringMode,
      this.captureMode || this.authoringMode || authoredControlsMode === 'canvas',
      this.runtimeDomLayers,
      (color) => {
        if (!options.transparent) this.stage.style.backgroundColor = color
      },
      {
        sceneIndex: initialSceneIndex,
        ...(initialStateId !== undefined ? { stateId: initialStateId } : {}),
      },
      this.authoringMode,
      this.authoringMode
        ? options.onComponentAuthoringTargetsChanged
        : undefined,
      this.authoringMode ? options.authoringScope ?? 'scene' : 'scene',
    )

    this.scenePicker = this.captureMode || this.authoringMode
      ? null
      : new ScenePickerOverlay({
          stage,
          scenes: payload.project.scenes,
          onSelect: (sceneId, bypassNavigationGuards) => {
            this.goToSceneById(sceneId, undefined, bypassNavigationGuards)
          },
        })
    if (this.scenePicker) {
      this.scenePickerEventDisposers.push(
        this.runtimeKernel.events.on(SCENE_PICKER_OPEN_EVENT, () => {
          this.scenePicker?.open(this.getCurrentSceneId())
        }),
        this.runtimeKernel.events.on<TeacherControllerCollapseEvent>(
          TEACHER_CONTROLLER_COLLAPSE_EVENT,
          (event) => {
            if (event?.collapsed) this.scenePicker?.close()
          },
        ),
      )
    }
    const renderWidth = Math.max(
      1,
      Math.ceil(options.renderWidth ?? payload.project.canvas.width),
    )
    const renderHeight = Math.max(
      1,
      Math.ceil(options.renderHeight ?? payload.project.canvas.height),
    )

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: canvasHost,
      width: renderWidth,
      height: renderHeight,
      backgroundColor: 'rgba(0,0,0,0)',
      scene: this.playerScene,
      banner: false,
      dom: {
        createContainer: true,
        // The container itself passes through input. API 4 component hosts can
        // opt individual descendants back into pointer interaction.
        pointerEvents: 'none',
      },
      audio: {
        noAudio: true,
      },
      render: {
        antialias: true,
        // Scene color lives on the stage so a declared DOM underlay is really
        // behind the Canvas instead of being covered by an opaque clear pass.
        transparent: true,
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: renderWidth,
        height: renderHeight,
        expandParent: true,
      },
    })

    this.resizeObserver = this.captureMode || typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.scheduleRuntimeLayerAlignment())
    this.resizeObserver?.observe(stage)
    this.resizeObserver?.observe(this.game.canvas)
    if (this.captureMode) {
      this.alignRuntimeDomLayers()
    } else {
      window.addEventListener('resize', this.scheduleRuntimeLayerAlignment)
      document.addEventListener('visibilitychange', this.handleVisibilityChange)
      // visibilitychange is not replayed for a document that was already
      // hidden before PlayerApp construction. PlayerScene caches this state
      // until Phaser finishes mounting its first runtimes/components.
      this.handleVisibilityChange()
      this.scheduleRuntimeLayerAlignment()
    }
  }

  goToScene(
    index: number,
    targetStateId?: string | null,
    bypassNavigationGuards = false,
  ): boolean {
    if (this.destroyed) {
      return false
    }
    this.scenePicker?.close()
    return this.playerScene.showScene(
      index,
      false,
      targetStateId,
      this.authoringMode || bypassNavigationGuards,
    )
  }

  goToSceneById(
    sceneId: string,
    targetStateId?: string | null,
    bypassNavigationGuards = false,
  ): boolean {
    if (this.destroyed) return false
    const index = this.payload.project.scenes.findIndex(
      (scene) => scene.id === sceneId,
    )
    return index >= 0 && this.goToScene(
      index,
      targetStateId,
      bypassNavigationGuards,
    )
  }

  previous(): boolean {
    return this.previousScene()
  }

  next(): boolean {
    return this.nextScene()
  }

  previousScene(): boolean {
    const index = this.playerScene.getCurrentSceneIndex()
    if (index <= 0) {
      this.showPresenterFeedback('已经是第一个场景')
      return false
    }
    return this.goToScene(index - 1)
  }

  nextScene(): boolean {
    const index = this.playerScene.getCurrentSceneIndex()
    if (index >= this.payload.project.scenes.length - 1) {
      this.showPresenterFeedback('已经是最后一个场景')
      return false
    }
    return this.goToScene(index + 1)
  }

  replayScene(): boolean {
    if (this.destroyed) return false
    this.scenePicker?.close()
    return this.playerScene.replayScene()
  }

  restartCourse(): boolean {
    if (this.destroyed) return false
    this.scenePicker?.close()
    return this.playerScene.restartCourse()
  }

  getCurrentSceneIndex(): number {
    return this.playerScene.getCurrentSceneIndex()
  }

  getCurrentSceneId(): string | null {
    const index = this.playerScene.getCurrentSceneIndex()
    return this.payload.project.scenes[index]?.id ?? null
  }

  getCurrentPresentationStateId(): string | null {
    return this.playerScene.getCurrentPresentationStateId()
  }

  setPresentationState(
    stateId: string | null,
    transition?: RuntimePresentationTransition,
  ): boolean {
    if (stateId === null) {
      return this.authoringMode && this.playerScene.showAuthoringBaseState()
    }
    return this.playerScene.setPresentationState(stateId, transition)
  }

  getHostMode(): PlayerHostMode {
    return this.hostMode
  }

  getAuthoringReadyMessage(
    sessionId: string,
  ): PlayerAuthoringReadyMessage | null {
    const sceneId = this.getCurrentSceneId()
    if (!this.authoringMode || this.destroyed || !sceneId) return null
    return {
      type: PLAYER_AUTHORING_MESSAGE_TYPES.ready,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId,
      context: {
        sceneId,
        stateId: this.getCurrentPresentationStateId(),
      },
      capabilities: PLAYER_AUTHORING_CAPABILITIES,
    }
  }

  /** Serializes transient frames so a slower asset load cannot overtake a drag. */
  applyAuthoringCommand(
    command: PlayerAuthoringPatchCommand,
  ): Promise<PlayerAuthoringAckMessage | PlayerAuthoringErrorMessage> {
    return new Promise((resolve) => {
      const apply = async (): Promise<void> => {
        if (!this.authoringMode) {
          resolve(this.authoringError(
            command,
            'unsupported-host-mode',
            '当前 Player 不是统一画布编辑宿主。',
          ))
          return
        }
        if (this.destroyed) {
          resolve(this.authoringError(
            command,
            'not-ready',
            'Player 已销毁，不能继续应用画面更新。',
          ))
          return
        }
        if (command.revision <= this.lastAuthoringRevision) {
          resolve(this.authoringError(
            command,
            'stale-revision',
            `编辑修订 ${command.revision} 已过期，当前已应用 ${this.lastAuthoringRevision}。`,
          ))
          return
        }
        const result = await this.playerScene.applyAuthoringPatch(
          command.context,
          command.patch,
        )
        if (!result.ok) {
          resolve(this.authoringError(command, result.code, result.message))
          return
        }
        this.lastAuthoringRevision = command.revision
        resolve({
          type: PLAYER_AUTHORING_MESSAGE_TYPES.ack,
          protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
          sessionId: command.sessionId,
          requestId: command.requestId,
          revision: command.revision,
          context: command.context,
          target: result.target,
        })
      }
      const queued = this.authoringQueue.then(apply, apply)
      this.authoringQueue = queued.catch(() => undefined)
    })
  }

  async waitForCaptureReady(): Promise<void> {
    if (this.capturePreparation) return this.capturePreparation
    const preparation = (async (): Promise<void> => {
      // Freeze runtime/component updates before authors render their explicit
      // deterministic capture frame. The suspended state is cached by
      // PlayerScene, so a capture-time navigation cannot mount a running child.
      if (this.captureMode) this.playerScene.suspendRuntimes()
      this.preparedCanvasSnapshots.reset()
      await this.playerScene.waitForCaptureReady((roots) => {
        this.preparedCanvasSnapshots.captureRoots(roots)
      })
    })()
    this.capturePreparation = preparation
    try {
      await preparation
    } finally {
      if (this.capturePreparation === preparation) {
        this.capturePreparation = null
      }
    }
  }

  getPreparedCanvasSnapshot(
    source: HTMLCanvasElement,
  ): HTMLCanvasElement | undefined {
    return this.preparedCanvasSnapshots.get(source)
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.resizeObserver?.disconnect()
    if (!this.captureMode) {
      window.removeEventListener('resize', this.scheduleRuntimeLayerAlignment)
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    }
    if (this.alignmentFrame !== null) cancelAnimationFrame(this.alignmentFrame)
    this.alignmentFrame = null
    this.presenterInput?.destroy()
    if (this.presenterStatusTimer !== null) clearTimeout(this.presenterStatusTimer)
    this.presenterStatusTimer = null
    this.scenePickerEventDisposers.splice(0).forEach((dispose) => dispose())
    this.scenePicker?.destroy()
    this.disposeAudioToggle()
    this.audio.destroy()
    this.game.destroy(true)
    this.runtimeKernel.destroy()
    this.componentRegistry.dispose()
    this.capturePreparation = null
    this.preparedCanvasSnapshots.clear()
    this.root.replaceChildren()
  }

  private registerComponentRuntimes(): void {
    this.componentRegistry.install()
    for (const component of Object.values(this.payload.components)) {
      try {
        this.componentRegistry.executeRuntime(
          component.manifest,
          component.runtimeSource,
        )
      } catch (error) {
        console.error(`组件“${component.manifest.name}”注册失败`, error)
      }
    }
  }

  private hasActivePresenterRule(command: 'next' | 'previous'): boolean {
    const sceneId = this.getCurrentSceneId()
    const stateId = this.getCurrentPresentationStateId()
    const scene = this.payload.project.scenes.find((item) => item.id === sceneId)
    const rules = [
      ...this.payload.project.globalInteractions,
      ...(scene?.interactions ?? []),
    ]
    return rules.some((rule) => {
      if (
        !rule.enabled ||
        rule.trigger.type !== 'presenter.command' ||
        rule.trigger.command !== command
      ) {
        return false
      }
      return rule.conditions.every((condition) => {
        if (condition.type === 'scene.in') {
          return sceneId !== null && condition.sceneIds.includes(sceneId)
        }
        if (condition.type === 'presentation.in') {
          return stateId !== null && condition.stateIds.includes(stateId)
        }
        return false
      })
    })
  }

  private showPresenterFeedback(message: string): void {
    if (this.destroyed || !message) return
    if (this.presenterStatusTimer !== null) clearTimeout(this.presenterStatusTimer)
    this.presenterStatus.textContent = message
    this.presenterStatus.hidden = false
    this.runtimeKernel.events.emit('presenter:feedback', { message })
    this.presenterStatusTimer = setTimeout(() => {
      this.presenterStatus.hidden = true
      this.presenterStatus.textContent = ''
      this.presenterStatusTimer = null
    }, 2400)
  }

  private authoringError(
    command: PlayerAuthoringPatchCommand,
    code: PlayerAuthoringErrorCode,
    message: string,
  ): PlayerAuthoringErrorMessage {
    return {
      type: PLAYER_AUTHORING_MESSAGE_TYPES.error,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: command.sessionId,
      requestId: command.requestId,
      revision: command.revision,
      code,
      message,
    }
  }

  private readonly scheduleRuntimeLayerAlignment = (): void => {
    if (this.destroyed || this.alignmentFrame !== null) return
    this.alignmentFrame = requestAnimationFrame(() => {
      this.alignmentFrame = null
      this.alignRuntimeDomLayers()
    })
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.destroyed || this.captureMode) return
    const visible = document.visibilityState !== 'hidden'
    if (visible) {
      this.playerScene.resumeRuntimes()
      this.playerScene.setDocumentVisible(true)
    } else {
      this.playerScene.setDocumentVisible(false)
      this.playerScene.suspendRuntimes()
    }
  }

  private alignRuntimeDomLayers(): void {
    if (this.captureMode) {
      const logicalWidth = this.payload.project.canvas.width
      const logicalHeight = this.payload.project.canvas.height
      for (const layer of [
        this.runtimeDomLayers.global.underlay,
        this.runtimeDomLayers.scene.underlay,
        this.runtimeDomLayers.scene.overlay,
        this.runtimeDomLayers.global.overlay,
      ]) {
        Object.assign(layer.style, {
          left: '0',
          top: '0',
          width: `${logicalWidth}px`,
          height: `${logicalHeight}px`,
          transform: 'none',
          transformOrigin: '0 0',
        })
      }
      return
    }
    const canvas = this.game.canvas
    const canvasRect = canvas.getBoundingClientRect()
    const stageRect = this.stage.getBoundingClientRect()
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return
    const scaleX = canvasRect.width / this.payload.project.canvas.width
    const scaleY = canvasRect.height / this.payload.project.canvas.height
    const translateX = canvasRect.left - stageRect.left
    const translateY = canvasRect.top - stageRect.top
    const transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`
    for (const layer of [
      this.runtimeDomLayers.global.underlay,
      this.runtimeDomLayers.scene.underlay,
      this.runtimeDomLayers.scene.overlay,
      this.runtimeDomLayers.global.overlay,
    ]) {
      layer.style.transform = transform
    }
  }
}
