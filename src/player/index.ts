import type { ExportPayload } from '../shared/componentTypes'
import type { PublishedLessonPayload } from '../shared/publishedLessonTypes'
import { ensureBundledFonts } from '../shared/fonts/ensureBundledFonts'
import { PlayerApp, type PlayerAppOptions } from './PlayerApp'
import {
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
  parsePlayerAuthoringPatchCommand,
  type PlayerAuthoringErrorCode,
  type PlayerAuthoringErrorMessage,
} from '../shared/playerAuthoringProtocol'
import {
  decodeExportPayload,
  loadExportPayloadFromUrl,
  normalizePlayerPayload,
} from './payload'
import { createPublishedCourseSession } from './surfaces/publishedDynamicHosts'
import { attachPublishedCourseStageFit } from './surfaces/publishedStageFit'
import { attachPublishedCoursePresenter } from './publishedCoursePresenter'

let authoringTargetsMessageRevision = 0

export function startPlayer(
  payloadOrEncoded: ExportPayload | PublishedLessonPayload | string,
  root: HTMLElement | string = 'lesson-root',
  options: PlayerAppOptions = {},
): PlayerApp {
  const payload =
    typeof payloadOrEncoded === 'string'
      ? decodeExportPayload(payloadOrEncoded)
      : normalizePlayerPayload(payloadOrEncoded)

  const rootElement =
    typeof root === 'string' ? document.getElementById(root) : root
  if (!rootElement) {
    throw new Error('找不到课件播放器容器')
  }

  return new PlayerApp(payload, rootElement, options)
}

function reportPlayerBootstrapFailure(error: unknown, rootId: string, className: string): void {
  console.error(rootId === 'course-root' ? '课程播放器启动失败' : '课件播放器启动失败', error)
  const root = document.getElementById(rootId)
  if (root) {
    const message = document.createElement('div')
    message.className = className
    message.textContent = '课件加载失败。请重新导出课件后再试。'
    root.replaceChildren(message)
  }
  const detail = error instanceof Error && error.message.trim()
    ? error.message
    : '课件加载失败。'
  postEditorBridgeMessage({
    type: 'courseware-preview-bootstrap:error',
    message: detail,
  })
}

function showBootstrapError(error: unknown): void {
  reportPlayerBootstrapFailure(error, 'lesson-root', 'lesson-player-error')
}

function postEditorBridgeMessage(message: Record<string, unknown>): void {
  if (window.parent === window) return
  const token = window.__H5_LESSON_BRIDGE_TOKEN__
  window.parent.postMessage(
    typeof token === 'string' && token
      ? { ...message, token }
      : message,
    '*',
  )
}

function startAndExposePlayer(
  payload: ExportPayload | PublishedLessonPayload | string,
): PlayerApp | null {
  try {
    authoringTargetsMessageRevision = 0
    const configuredOptions = window.__H5_LESSON_PLAYER_OPTIONS__ ?? {}
    const authoringSessionId = window.__H5_LESSON_BRIDGE_TOKEN__
    const options: PlayerAppOptions = {
      ...configuredOptions,
      ...(configuredOptions.hostMode === 'authoring' &&
        typeof authoringSessionId === 'string' && authoringSessionId
        ? {
            onRuntimeAuthoringTargetsChanged: (update) => {
              postEditorBridgeMessage({
                type: PLAYER_AUTHORING_MESSAGE_TYPES.runtimeTargets,
                protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
                sessionId: authoringSessionId,
                revision: ++authoringTargetsMessageRevision,
                update,
              })
            },
            onComponentAuthoringTargetsChanged: (update) => {
              postEditorBridgeMessage({
                type: PLAYER_AUTHORING_MESSAGE_TYPES.componentTargets,
                protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
                sessionId: authoringSessionId,
                revision: ++authoringTargetsMessageRevision,
                update,
              })
            },
          }
        : {
            onRuntimeAuthoringTargetsChanged: undefined,
            onComponentAuthoringTargetsChanged: undefined,
          }),
    }
    const player = startPlayer(
      payload,
      'lesson-root',
      options,
    )
    window.__H5_LESSON_PLAYER__ = player
    postEditorBridgeMessage({
      type: 'courseware-player:ready',
      hostMode: player.getHostMode(),
    })
    return player
  } catch (error) {
    showBootstrapError(error)
    return null
  }
}

let pendingBridgeScene: {
  sceneId: string
  /** The command arrived before Phaser accepted navigation (usually boot). */
  retryOnMismatch: boolean
} | null = null
let pendingBridgeState: {
  sceneId: string | null
  stateId: string | null
  transition?: Parameters<PlayerApp['setPresentationState']>[1]
} | null = null
let lastForwardedBridgeSceneId: string | null = null
let holdBridgePresentationEvents = false
let heldBridgePresentationDetail: unknown = null
let authoringReadyPosted = false

function authoringErrorMessage(
  value: unknown,
  code: PlayerAuthoringErrorCode,
  message: string,
): PlayerAuthoringErrorMessage {
  const candidate = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}
  return {
    type: PLAYER_AUTHORING_MESSAGE_TYPES.error,
    protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
    ...(typeof candidate.sessionId === 'string'
      ? { sessionId: candidate.sessionId }
      : {}),
    ...(typeof candidate.requestId === 'string'
      ? { requestId: candidate.requestId }
      : {}),
    ...(typeof candidate.revision === 'number'
      ? { revision: candidate.revision }
      : {}),
    code,
    message,
  }
}

function postAuthoringReadyIfNeeded(player: PlayerApp): void {
  if (authoringReadyPosted || player.getHostMode() !== 'authoring') return
  const sessionId = window.__H5_LESSON_BRIDGE_TOKEN__
  if (typeof sessionId !== 'string' || !sessionId) return
  const ready = player.getAuthoringReadyMessage(sessionId)
  if (!ready) return
  authoringReadyPosted = true
  postEditorBridgeMessage({ ...ready })
}

function handleAuthoringBridgeMessage(
  value: unknown,
  player: PlayerApp | undefined,
): boolean {
  const candidate = typeof value === 'object' && value !== null
    ? value as { type?: unknown }
    : null
  if (candidate?.type !== PLAYER_AUTHORING_MESSAGE_TYPES.patch) return false
  const parsed = parsePlayerAuthoringPatchCommand(value)
  if (!parsed.ok) {
    postEditorBridgeMessage({
      ...authoringErrorMessage(value, 'invalid-command', parsed.message),
    })
    return true
  }
  const expectedSessionId = window.__H5_LESSON_BRIDGE_TOKEN__
  if (
    typeof expectedSessionId !== 'string' ||
    !expectedSessionId ||
    parsed.command.sessionId !== expectedSessionId
  ) {
    postEditorBridgeMessage({
      ...authoringErrorMessage(
        parsed.command,
        'invalid-session',
        '编辑命令不属于当前隔离 Player 会话。',
      ),
    })
    return true
  }
  if (!player) {
    postEditorBridgeMessage({
      ...authoringErrorMessage(
        parsed.command,
        'not-ready',
        'Player 尚未完成启动。',
      ),
    })
    return true
  }
  void player.applyAuthoringCommand(parsed.command)
    .then((response) => postEditorBridgeMessage({ ...response }))
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error)
      postEditorBridgeMessage({
        ...authoringErrorMessage(
          parsed.command,
          'update-failed',
          `Player 画面更新失败：${detail}`,
        ),
      })
    })
  return true
}

function applyPendingBridgeState(player: PlayerApp): void {
  const pending = pendingBridgeState
  if (!pending || pendingBridgeScene) return
  if (pending.sceneId && player.getCurrentSceneId() !== pending.sceneId) return
  // State application is synchronous once the target scene exists. Clear the
  // command even when the id is invalid, so it cannot leak into a later scene.
  player.setPresentationState(pending.stateId, pending.transition)
  pendingBridgeState = null
}

function handleEditorBridgeMessage(event: MessageEvent): void {
  if (window.parent === window || event.source !== window.parent) return
  const message = event.data as {
    type?: unknown
    sceneId?: unknown
    stateId?: unknown
    transition?: unknown
  } | null
  const player = window.__H5_LESSON_PLAYER__
  if (handleAuthoringBridgeMessage(event.data, player)) return
  if (!message || !player || typeof message.type !== 'string') return
  if (
    message.type === 'courseware-editor:set-scene' &&
    typeof message.sceneId === 'string'
  ) {
    // A scene command starts a new synchronization transaction. Workspace sends
    // the desired state immediately afterwards when one is selected.
    pendingBridgeState = null
    if (player.getCurrentSceneId() === message.sceneId) {
      // Calling through also cancels a possible in-flight request for another
      // scene. No future scene-change event is guaranteed for this no-op.
      player.goToSceneById(message.sceneId)
      pendingBridgeScene = null
      applyPendingBridgeState(player)
      return
    }
    const accepted = player.goToSceneById(message.sceneId)
    pendingBridgeScene = {
      sceneId: message.sceneId,
      retryOnMismatch: !accepted,
    }
  } else if (
    message.type === 'courseware-editor:set-presentation-state' &&
    (typeof message.stateId === 'string' || message.stateId === null)
  ) {
    const transition = message.stateId !== null &&
      typeof message.transition === 'object' && message.transition !== null
      ? message.transition as Parameters<PlayerApp['setPresentationState']>[1]
      : undefined
    const sceneId = typeof message.sceneId === 'string'
      ? message.sceneId
      : pendingBridgeScene?.sceneId ?? player.getCurrentSceneId()
    pendingBridgeState = { sceneId, stateId: message.stateId, transition }
    applyPendingBridgeState(player)
  }
}

function forwardPlayerEvent(event: Event): void {
  if (window.parent === window) return
  const custom = event as CustomEvent<unknown>
  const player = window.__H5_LESSON_PLAYER__
  if (
    event.type === 'courseware-presentation-change' &&
    holdBridgePresentationEvents
  ) {
    heldBridgePresentationDetail = custom.detail
    return
  }
  if (event.type === 'courseware-scene-change' && pendingBridgeScene && player) {
    const detail = custom.detail as { sceneId?: unknown } | null
    if (detail?.sceneId !== pendingBridgeScene.sceneId) {
      if (pendingBridgeScene.retryOnMismatch) {
        const accepted = player.goToSceneById(pendingBridgeScene.sceneId)
        if (accepted) {
          pendingBridgeScene.retryOnMismatch = false
          // Suppress the boot scene: the requested scene will emit next.
          return
        }
      }
      // A navigation guard may redirect the editor request. Accept the actual
      // scene instead of repeatedly forcing the blocked target.
      pendingBridgeScene = null
      pendingBridgeState = null
    } else {
      pendingBridgeScene = null
    }
  }
  const detail = custom.detail as { sceneId?: unknown } | null
  if (event.type === 'courseware-scene-change' && player) {
    // Apply the editor-requested state before announcing the scene. Otherwise
    // Workspace briefly receives the authored initial state, echoes it back,
    // and can overwrite the requested state after the Player already rendered
    // it. Presentation events raised by this synchronous apply are held until
    // the final scene payload has reached the editor.
    holdBridgePresentationEvents = true
    heldBridgePresentationDetail = null
    try {
      applyPendingBridgeState(player)
    } finally {
      holdBridgePresentationEvents = false
    }
    const sceneId = typeof detail?.sceneId === 'string'
      ? detail.sceneId
      : player.getCurrentSceneId()
    lastForwardedBridgeSceneId = sceneId
    const sceneDetail = {
      ...(typeof custom.detail === 'object' && custom.detail !== null
        ? custom.detail as Record<string, unknown>
        : {}),
      sceneId,
      presentationStateId: player.getCurrentPresentationStateId(),
    }
    postEditorBridgeMessage({
      type: 'courseware-player:scene-change',
      detail: sceneDetail,
    })
    postAuthoringReadyIfNeeded(player)
    if (heldBridgePresentationDetail !== null) {
      postEditorBridgeMessage({
        type: 'courseware-player:presentation-change',
        detail: heldBridgePresentationDetail,
      })
      heldBridgePresentationDetail = null
    }
    return
  }
  if (event.type === 'courseware-presentation-change') {
    // PlayerScene establishes (and runtime may change) the target state before
    // PlayerApp announces the new scene. The scene-change payload already carries
    // that final state, so suppress out-of-context presentation messages here.
    if (
      typeof detail?.sceneId === 'string' &&
      detail.sceneId !== lastForwardedBridgeSceneId
    ) {
      return
    }
  } else if (typeof detail?.sceneId === 'string') {
    lastForwardedBridgeSceneId = detail.sceneId
  }
  const type = event.type === 'courseware-scene-change'
    ? 'courseware-player:scene-change'
    : 'courseware-player:presentation-change'
  postEditorBridgeMessage({ type, detail: custom.detail })
}

function configuredPayloadUrl(): string | null {
  if (
    typeof window.__H5_LESSON_PAYLOAD_URL__ === 'string' &&
    window.__H5_LESSON_PAYLOAD_URL__.trim()
  ) {
    return window.__H5_LESSON_PAYLOAD_URL__
  }

  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="courseware-payload"]',
  )
  return meta?.content.trim() || null
}

function destroyExposedPlayer(event: PageTransitionEvent): void {
  // A persisted page can resume from the back-forward cache with the same
  // live WebGL/Phaser resources. A final unload or removed preview iframe must
  // deterministically release runtimes, component DOM mounts and GPU objects.
  if (event.persisted) return
  window.__H5_LESSON_PLAYER__?.destroy()
  delete window.__H5_LESSON_PLAYER__
  pendingBridgeScene = null
  pendingBridgeState = null
  heldBridgePresentationDetail = null
  authoringReadyPosted = false
  authoringTargetsMessageRevision = 0
}

async function bootstrapPlayerFromUrl(
  payloadUrl: string,
  fallbackPayload?: ExportPayload | PublishedLessonPayload,
): Promise<PlayerApp | null> {
  try {
    const payload = await loadExportPayloadFromUrl(payloadUrl)
    return startAndExposePlayer(payload)
  } catch (error) {
    if (fallbackPayload) {
      console.warn('course.json 无法直接载入，改用离线网页包数据', error)
      return startAndExposePlayer(fallbackPayload)
    }
    showBootstrapError(error)
    return null
  }
}

function bootstrapPublishedCourse(): boolean {
  const payload = window.__H5_COURSE_PAYLOAD__
  const root = document.getElementById('course-root')
  if (!payload || !root) return false
  const session = createPublishedCourseSession(payload)
  void session.mount(root).then(() => {
    attachPublishedCourseStageFit(root)
    attachPublishedCoursePresenter(root, session, payload)
  }).catch((error) => {
    reportPlayerBootstrapFailure(error, 'course-root', 'course-player-error')
  })
  return true
}

export function bootstrapPlayer(): PlayerApp | null {
  if (window.__H5_LESSON_PLAYER__) {
    return window.__H5_LESSON_PLAYER__
  }
  if (bootstrapPublishedCourse()) return null

  const payloadUrl = configuredPayloadUrl()
  const fallbackPayload = window.__H5_LESSON_PAYLOAD_FALLBACK__
  if (payloadUrl) {
    // Browsers generally block fetch(file://.../course.json). The generated
    // package therefore carries the same JSON object in a small local script,
    // while hosted packages still load the canonical course.json file.
    if (window.location.protocol === 'file:' && fallbackPayload) {
      return startAndExposePlayer(fallbackPayload)
    }
    void bootstrapPlayerFromUrl(payloadUrl, fallbackPayload)
    return null
  }

  const inlinePayload = window.__H5_LESSON_PAYLOAD__
  return inlinePayload ? startAndExposePlayer(inlinePayload) : null
}

/**
 * The Player measures text synchronously and bakes the result into a GPU
 * texture that is never re-measured, so the bundled faces the host document
 * declares have to be loaded before bootstrap. The wait lives here rather than
 * inside `bootstrapPlayer()`: that function is exported API and returns
 * `PlayerApp | null` synchronously, and making it async would change its
 * return type for every caller and every embedded page.
 */
async function bootstrapPlayerAfterFonts(): Promise<void> {
  await ensureBundledFonts()
  bootstrapPlayer()
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('message', handleEditorBridgeMessage)
  window.addEventListener('courseware-scene-change', forwardPlayerEvent)
  window.addEventListener('courseware-presentation-change', forwardPlayerEvent)
  window.addEventListener('pagehide', destroyExposedPlayer)
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => void bootstrapPlayerAfterFonts(),
      { once: true },
    )
  } else {
    void bootstrapPlayerAfterFonts()
  }
}

export { ComponentRegistry } from './ComponentRegistry'
export {
  decodeExportPayload,
  loadExportPayloadFromUrl,
  parseExportPayloadJson,
} from './payload'
export { PlayerApp } from './PlayerApp'
export { PlayerScene } from './PlayerScene'
