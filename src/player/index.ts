import { ensureBundledFonts } from '../shared/fonts/ensureBundledFonts'
import { publishedCourseV2Schema } from '../shared/publishedCourseSchema'
import type { PublishedCourseV2Payload } from '../shared/publishedCourseTypes'
import { attachPublishedCoursePresenter, type PublishedCoursePresenter } from './publishedCoursePresenter'
import { assertParsedPublishedCourseV2 } from './surfaces/CoursePlayer'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from './surfaces/publishedDynamicHosts'
import { attachPublishedCourseStageFit } from './surfaces/publishedStageFit'

export const PLAYER_V2_ENTRY_UNSUPPORTED_ERROR =
  '当前播放器只接受 Published Course V2。旧版播放器导出包或旧 Player 课件不受支持，请用最新编辑器重新导出后再打开。'

export const PLAYER_V2_ENTRY_CORRUPT_ERROR =
  '课件数据损坏或格式无效。请重新导出课件后再试。'

const COURSE_ROOT_ID = 'course-root'
const LESSON_ROOT_ID = 'lesson-root'

let activeSession: PublishedCourseSession | null = null
let activePresenter: PublishedCoursePresenter | null = null

export function parsePublishedCourseV2Entry(value: unknown): PublishedCourseV2Payload {
  const candidate = typeof value === 'string' ? parseJsonPayload(value) : value
  try {
    assertParsedPublishedCourseV2(candidate)
  } catch {
    throw new Error(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)
  }
  const parsed = publishedCourseV2Schema.safeParse(candidate)
  if (!parsed.success) {
    throw new Error(PLAYER_V2_ENTRY_CORRUPT_ERROR)
  }
  return parsed.data
}

function parseJsonPayload(encoded: string): unknown {
  const trimmed = encoded.trim()
  if (!trimmed) throw new Error(PLAYER_V2_ENTRY_CORRUPT_ERROR)
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    throw new Error(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error(PLAYER_V2_ENTRY_CORRUPT_ERROR)
  }
}

function postEditorBridgeMessage(message: Record<string, unknown>): void {
  if (window.parent === window) return
  window.parent.postMessage(message, '*')
}

function findBootstrapErrorHost(): { root: HTMLElement; className: string } | null {
  const course = document.getElementById(COURSE_ROOT_ID)
  if (course) return { root: course, className: 'course-player-error' }
  const lesson = document.getElementById(LESSON_ROOT_ID)
  if (lesson) return { root: lesson, className: 'lesson-player-error' }
  return null
}

function reportPlayerBootstrapFailure(error: unknown): void {
  console.error('课程播放器启动失败', error)
  const host = findBootstrapErrorHost()
  const detail = error instanceof Error && error.message.trim()
    ? error.message
    : PLAYER_V2_ENTRY_CORRUPT_ERROR
  if (host) {
    const message = document.createElement('div')
    message.className = host.className
    message.textContent = detail
    host.root.replaceChildren(message)
  }
  postEditorBridgeMessage({
    type: 'courseware-preview-bootstrap:error',
    message: detail,
  })
}

function resolveRoot(root: HTMLElement | string): HTMLElement {
  const rootElement = typeof root === 'string' ? document.getElementById(root) : root
  if (!rootElement) {
    throw new Error('找不到课程播放器容器')
  }
  return rootElement
}

function hasLegacyPlayerEntryGlobals(): boolean {
  if (window.__H5_LESSON_PAYLOAD__ != null) return true
  if (window.__H5_LESSON_PAYLOAD_FALLBACK__ != null) return true
  if (
    typeof window.__H5_LESSON_PAYLOAD_URL__ === 'string'
    && window.__H5_LESSON_PAYLOAD_URL__.trim()
  ) {
    return true
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="courseware-payload"]')
  return Boolean(meta?.content.trim())
}

function bindActiveSession(session: PublishedCourseSession): PublishedCourseSession {
  const originalDestroy = session.destroy.bind(session)
  session.destroy = () => {
    if (activeSession === session) activeSession = null
    if (activePresenter?.session === session) activePresenter = null
    return originalDestroy()
  }
  activeSession = session
  return session
}

async function mountPublishedCourseEntry(
  session: PublishedCourseSession,
  root: HTMLElement,
  payload: PublishedCourseV2Payload,
): Promise<void> {
  await session.mount(root)
  attachPublishedCourseStageFit(root)
  activePresenter = attachPublishedCoursePresenter(root, session, payload)
}

function abandonActiveEntry(): void {
  const presenter = activePresenter
  const session = activeSession
  activePresenter = null
  activeSession = null
  if (presenter) {
    presenter.destroy()
    return
  }
  void session?.destroy()
}

export function startPlayer(
  payloadOrEncoded: unknown,
  root: HTMLElement | string = COURSE_ROOT_ID,
): PublishedCourseSession {
  const payload = parsePublishedCourseV2Entry(payloadOrEncoded)
  const rootElement = resolveRoot(root)
  abandonActiveEntry()
  const session = bindActiveSession(createPublishedCourseSession(payload))
  void mountPublishedCourseEntry(session, rootElement, payload).catch((error) => {
    if (activeSession === session) {
      activeSession = null
      activePresenter = null
      void session.destroy()
    }
    reportPlayerBootstrapFailure(error)
  })
  return session
}

function destroyExposedPlayer(event: PageTransitionEvent): void {
  if (event.persisted) return
  abandonActiveEntry()
}

export function bootstrapPlayer(): PublishedCourseSession | null {
  if (activeSession) return activeSession
  const payload = window.__H5_COURSE_PAYLOAD__
  const root = document.getElementById(COURSE_ROOT_ID)
  if (payload && root) {
    try {
      return startPlayer(payload, root)
    } catch (error) {
      reportPlayerBootstrapFailure(error)
      return null
    }
  }
  if (payload && !root) {
    reportPlayerBootstrapFailure(new Error('找不到课程播放器容器'))
    return null
  }
  if (hasLegacyPlayerEntryGlobals()) {
    reportPlayerBootstrapFailure(new Error(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR))
    return null
  }
  return null
}

/**
 * The Player measures text synchronously and bakes the result into a GPU
 * texture that is never re-measured, so the bundled faces the host document
 * declares have to be loaded before bootstrap. The wait lives here rather than
 * inside `bootstrapPlayer()`: that function is exported API and returns
 * `PublishedCourseSession | null` synchronously, and making it async would
 * change its return type for every caller and every embedded page.
 */
async function bootstrapPlayerAfterFonts(): Promise<void> {
  await ensureBundledFonts()
  bootstrapPlayer()
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
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
export type { PublishedCoursePresenter } from './publishedCoursePresenter'
export type { PublishedCourseSession } from './surfaces/publishedDynamicHosts'
