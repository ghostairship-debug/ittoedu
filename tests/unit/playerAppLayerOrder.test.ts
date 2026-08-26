import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExportPayload } from '../../src/shared/componentTypes'

const appMocks = vi.hoisted(() => ({
  gameDestroy: vi.fn(),
  componentDispose: vi.fn(),
  runtimeDestroy: vi.fn(),
  audioDestroy: vi.fn(),
  sceneLifecycleOrder: [] as string[],
  sceneSetDocumentVisible: vi.fn(),
  sceneIndex: 0,
  showSceneCalls: [] as unknown[][],
  showSceneResults: [] as boolean[],
  showSceneBlockedReasons: [] as string[],
  runtimeEventHandlers: new Map<string, (event: unknown) => void>(),
  presenterInputOptions: [] as unknown[],
  playerSceneConstructorArgs: [] as unknown[][],
  runtimeKernelOptions: [] as Array<Record<string, unknown> | undefined>,
  hostConstructionOrder: [] as string[],
}))

vi.mock('phaser', () => ({
  AUTO: 'auto',
  Scale: { FIT: 'fit', CENTER_BOTH: 'center-both' },
  Game: class FakeGame {
    readonly canvas = document.createElement('canvas')

    constructor(config: { parent: HTMLElement }) {
      config.parent.append(this.canvas)
    }

    destroy(): void {
      appMocks.gameDestroy()
      this.canvas.remove()
    }
  },
}))

vi.mock('../../src/player/ComponentRegistry', () => ({
  ComponentRegistry: class FakeComponentRegistry {
    install(): void {}
    executeRuntime(): void {}
    dispose(): void { appMocks.componentDispose() }
  },
}))

vi.mock('../../src/player/componentHostActions', () => ({
  createPlayerComponentHostActions: () => ({}),
}))

vi.mock('../../src/player/CourseRuntimeKernel', () => ({
  CourseRuntimeKernel: class FakeRuntimeKernel {
    readonly events = {
      on: (eventName: string, handler: (event: unknown) => void) => {
        appMocks.runtimeEventHandlers.set(eventName, handler)
        return () => appMocks.runtimeEventHandlers.delete(eventName)
      },
      emit: () => {},
    }
    constructor(
      _payload: unknown,
      _actions: unknown,
      options?: Record<string, unknown>,
    ) {
      appMocks.hostConstructionOrder.push('runtime-kernel')
      appMocks.runtimeKernelOptions.push(options)
    }
    destroy(): void { appMocks.runtimeDestroy() }
  },
}))

vi.mock('../../src/player/HostEvidenceRecorder', () => ({
  HostEvidenceRecorder: class FakeHostEvidenceRecorder {
    constructor() {
      appMocks.hostConstructionOrder.push('host-evidence-session')
    }
    recordAssessment(): void {}
    recordAction(): void {}
  },
}))

vi.mock('../../src/player/AudioManager', () => ({
  AudioManager: class FakeAudioManager {
    toggleMuted(): void {}
    destroy(): void { appMocks.audioDestroy() }
  },
}))

vi.mock('../../src/player/PlayerScene', () => ({
  PlayerScene: class FakePlayerScene {
    constructor(...args: unknown[]) {
      appMocks.playerSceneConstructorArgs.push(args)
    }
    setDocumentVisible(visible: boolean): void {
      appMocks.sceneSetDocumentVisible(visible)
      appMocks.sceneLifecycleOrder.push(`visible:${visible}`)
    }
    suspendRuntimes(): void {
      appMocks.sceneLifecycleOrder.push('suspend')
    }
    resumeRuntimes(): void {
      appMocks.sceneLifecycleOrder.push('resume')
    }
    async waitForCaptureReady(): Promise<void> {
      appMocks.sceneLifecycleOrder.push('prepare')
    }
    getCurrentSceneIndex(): number { return appMocks.sceneIndex }
    getCurrentPresentationStateId(): null { return null }
    showScene(...args: unknown[]): boolean {
      appMocks.showSceneCalls.push(args)
      const accepted = appMocks.showSceneResults.shift() ?? true
      if (accepted) appMocks.sceneIndex = args[0] as number
      else {
        const reason = appMocks.showSceneBlockedReasons.shift()
        if (reason) {
          appMocks.runtimeEventHandlers.get('navigation:blocked')?.({ reason })
        }
      }
      return accepted
    }
    replayScene(): boolean { return true }
  },
}))

vi.mock('../../src/player/PlayerPresenterInput', () => ({
  PlayerPresenterInput: class FakePresenterInput {
    constructor(options: unknown) { appMocks.presenterInputOptions.push(options) }
    setIndex(): void {}
    destroy(): void {}
  },
}))

vi.mock('../../src/player/ScenePickerOverlay', () => ({
  SCENE_PICKER_OPEN_EVENT: 'scene-picker:open',
  TEACHER_CONTROLLER_COLLAPSE_EVENT: 'teacher-controller:collapse',
  ScenePickerOverlay: class FakeScenePickerOverlay {
    close(): void {}
    destroy(): void {}
  },
}))

import { PlayerApp } from '../../src/player/PlayerApp'
import { createProject } from '../../src/renderer/project/createProject'

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  appMocks.sceneLifecycleOrder.length = 0
  appMocks.playerSceneConstructorArgs.length = 0
  appMocks.runtimeKernelOptions.length = 0
  appMocks.hostConstructionOrder.length = 0
  appMocks.sceneIndex = 0
  appMocks.showSceneCalls.length = 0
  appMocks.showSceneResults.length = 0
  appMocks.showSceneBlockedReasons.length = 0
  appMocks.runtimeEventHandlers.clear()
  appMocks.presenterInputOptions.length = 0
  document.body.replaceChildren()
})

describe('PlayerApp fixed renderer planes', () => {
  it('使全局/场景 underlay 位于 Phaser 下方，overlay 位于上方', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const payload: ExportPayload = {
      project: createProject({ includeDefaultController: false, controls: 'none' }),
      assets: {},
      components: {},
    }
    const ignoredComponentTargets = vi.fn()
    const player = new PlayerApp(payload, root, {
      controls: false,
      mode: 'capture',
      onComponentAuthoringTargetsChanged: ignoredComponentTargets,
    })

    const zIndex = (selector: string): string | undefined =>
      root.querySelector<HTMLElement>(selector)?.style.zIndex
    expect(zIndex('.lesson-runtime-layer--global-underlay')).toBe('0')
    expect(zIndex('.lesson-runtime-layer--scene-underlay')).toBe('1')
    expect(zIndex('.lesson-canvas-host')).toBe('2')
    expect(zIndex('.lesson-runtime-layer--scene-overlay')).toBe('3')
    expect(zIndex('.lesson-runtime-layer--global-overlay')).toBe('4')
    expect(appMocks.playerSceneConstructorArgs.at(-1)?.[13]).toBeUndefined()
    expect(appMocks.hostConstructionOrder.slice(0, 2)).toEqual([
      'host-evidence-session',
      'runtime-kernel',
    ])
    expect(appMocks.runtimeKernelOptions.at(-1)?.onAssessmentEvaluated).toEqual(
      expect.any(Function),
    )
    expect(appMocks.runtimeKernelOptions.at(-1)?.onActionRecorded).toEqual(
      expect.any(Function),
    )
    expect(appMocks.runtimeKernelOptions.at(-1)).not.toHaveProperty(
      'onTeacherEscapeRecorded',
    )
    expect(appMocks.runtimeKernelOptions.at(-1)).not.toHaveProperty(
      'hostEvidenceRecorder',
    )

    player.destroy()
    expect(root).toBeEmptyDOMElement()
    expect(appMocks.gameDestroy).toHaveBeenCalledOnce()
  })

  it('构造时文档已隐藏也会把初始状态传给 PlayerScene', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const root = document.createElement('div')
    document.body.append(root)
    const payload: ExportPayload = {
      project: createProject({ includeDefaultController: false, controls: 'none' }),
      assets: {},
      components: {},
    }

    const player = new PlayerApp(payload, root, { controls: false })

    expect(appMocks.sceneLifecycleOrder).toEqual(['visible:false', 'suspend'])
    player.destroy()
  })

  it('捕获模式在 prepareCapture 前先暂停运行时与组件', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const payload: ExportPayload = {
      project: createProject({ includeDefaultController: false, controls: 'none' }),
      assets: {},
      components: {},
    }
    const player = new PlayerApp(payload, root, {
      controls: false,
      mode: 'capture',
    })
    appMocks.sceneLifecycleOrder.length = 0

    await player.waitForCaptureReady()

    expect(appMocks.sceneLifecycleOrder).toEqual(['suspend', 'prepare'])
    player.destroy()
  })

  it('编辑宿主保留显式 null 基础态并屏蔽 Player 输入', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const project = createProject({ includeDefaultController: false, controls: 'none' })
    const payload: ExportPayload = { project, assets: {}, components: {} }
    const onComponentAuthoringTargetsChanged = vi.fn()

    const player = new PlayerApp(payload, root, {
      controls: false,
      hostMode: 'authoring',
      initialSceneId: project.scenes[0]!.id,
      initialStateId: null,
      onComponentAuthoringTargetsChanged,
    })

    const args = appMocks.playerSceneConstructorArgs.at(-1)!
    expect(args[11]).toEqual({ sceneIndex: 0, stateId: null })
    expect(args[12]).toBe(true)
    expect(args[13]).toBe(onComponentAuthoringTargetsChanged)
    expect(appMocks.runtimeKernelOptions.at(-1)).toMatchObject({
      mode: 'capture',
      freezeCourseState: true,
    })
    expect(root.querySelector('.lesson-authoring-input-shield')).not.toBeNull()
    expect(root.querySelector('.lesson-canvas-host')).toHaveStyle({
      pointerEvents: 'none',
    })
    expect(root.querySelector('.lesson-footer')).toBeNull()
    player.destroy()
  })

  it('Project V8 不创建外层底栏，并按工程控制画布内控制器', () => {
    const noneRoot = document.createElement('div')
    const noneProject = createProject({ includeDefaultController: false, controls: 'none' })
    const nonePlayer = new PlayerApp({
      project: noneProject,
      assets: {},
      components: {},
    }, noneRoot)

    expect(noneRoot.querySelector('.lesson-footer')).toBeNull()
    expect(appMocks.playerSceneConstructorArgs.at(-1)?.[8]).toBe(false)
    nonePlayer.destroy()

    const canvasRoot = document.createElement('div')
    const canvasProject = createProject({ includeDefaultController: true })
    const canvasPlayer = new PlayerApp({
      project: canvasProject,
      assets: {},
      components: {},
    }, canvasRoot)

    expect(canvasRoot.querySelector('.lesson-footer')).toBeNull()
    expect(appMocks.playerSceneConstructorArgs.at(-1)?.[8]).toBe(true)
    canvasPlayer.destroy()
  })

  it('交付、捕获和 authoring 根都不创建重复教师快捷控件', () => {
    const enabledRoot = document.createElement('div')
    const enabledProject = createProject()
    const enabledPlayer = new PlayerApp({
      project: enabledProject,
      assets: {},
      components: {},
    }, enabledRoot)
    expect(enabledRoot.querySelector('[data-testid="teacher-escape-controls"]')).toBeNull()
    enabledPlayer.destroy()

    const disabledRoot = document.createElement('div')
    const disabledProject = createProject()
    disabledProject.playback.presenter.enabled = false
    const disabledPlayer = new PlayerApp({
      project: disabledProject,
      assets: {},
      components: {},
    }, disabledRoot)
    expect(disabledRoot.querySelector('[data-testid="teacher-escape-controls"]')).toBeNull()
    disabledPlayer.destroy()

    const noAuthoredControlsRoot = document.createElement('div')
    const inputCount = appMocks.presenterInputOptions.length
    const noAuthoredControlsPlayer = new PlayerApp({
      project: createProject(),
      assets: {},
      components: {},
    }, noAuthoredControlsRoot, { controls: false })
    expect(noAuthoredControlsRoot.querySelector(
      '[data-testid="teacher-escape-controls"]',
    )).toBeNull()
    expect(appMocks.presenterInputOptions).toHaveLength(inputCount + 1)
    expect(appMocks.playerSceneConstructorArgs.at(-1)?.[8]).toBe(false)
    noAuthoredControlsPlayer.destroy()

    const noneRoot = document.createElement('div')
    const nonePlayer = new PlayerApp({
      project: createProject({ controls: 'none' }),
      assets: {},
      components: {},
    }, noneRoot)
    expect(noneRoot.querySelector('[data-testid="teacher-escape-controls"]')).toBeNull()
    nonePlayer.destroy()

    const captureRoot = document.createElement('div')
    const captureInputCount = appMocks.presenterInputOptions.length
    const capturePlayer = new PlayerApp({
      project: createProject(),
      assets: {},
      components: {},
    }, captureRoot, { controls: false, mode: 'capture' })
    expect(captureRoot.querySelector('[data-testid="teacher-escape-controls"]')).toBeNull()
    expect(appMocks.presenterInputOptions).toHaveLength(captureInputCount)
    capturePlayer.destroy()

    const authoringRoot = document.createElement('div')
    const authoringInputCount = appMocks.presenterInputOptions.length
    const authoringPlayer = new PlayerApp({
      project: createProject(),
      assets: {},
      components: {},
    }, authoringRoot, { controls: false, hostMode: 'authoring' })
    expect(authoringRoot.querySelector('[data-testid="teacher-escape-controls"]')).toBeNull()
    expect(appMocks.presenterInputOptions).toHaveLength(authoringInputCount)
    authoringPlayer.destroy()
  })
})
