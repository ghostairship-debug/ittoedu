import { useCallback, useEffect, useRef, useState } from 'react'

export interface WorkbenchLayoutPrefs {
  navWidth: number
  chatWidth: number
  navCollapsed: boolean
  contentClosed: boolean
  chatClosed: boolean
  explorerOpen: boolean
  conversationsOpen: boolean
  sessionsHeight: number
}
export const STORAGE_KEY = 'guoling-workbench-layout-v2'
export const DEFAULT_PREFS: WorkbenchLayoutPrefs = {
  navWidth: 240, chatWidth: 360, navCollapsed: false, contentClosed: false,
  chatClosed: false, explorerOpen: true, conversationsOpen: true, sessionsHeight: 260,
}
export const LAYOUT_LIMITS = { nav: { min: 180, max: 440 }, chat: { min: 280, max: 640 }, sessions: { min: 160, max: 500 }, content: 320 } as const
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)))
export function parseLayoutPrefs(raw: string | null): WorkbenchLayoutPrefs {
  try {
    const input: unknown = raw ? JSON.parse(raw) : null
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ...DEFAULT_PREFS }
    const record = input as Record<string, unknown>
    const prefs = { ...DEFAULT_PREFS }
    for (const key of ['navCollapsed', 'contentClosed', 'chatClosed', 'explorerOpen', 'conversationsOpen'] as const) {
      if (typeof record[key] === 'boolean') prefs[key] = record[key]
    }
    for (const [key, limits] of [['navWidth', LAYOUT_LIMITS.nav], ['chatWidth', LAYOUT_LIMITS.chat], ['sessionsHeight', LAYOUT_LIMITS.sessions]] as const) {
      if (typeof record[key] === 'number' && Number.isFinite(record[key])) prefs[key] = clamp(record[key], limits.min, limits.max)
    }
    return prefs
  } catch { return { ...DEFAULT_PREFS } }
}
export function resolveWorkbenchWidths(prefs: WorkbenchLayoutPrefs, available: number, focus = false) {
  let nav = prefs.navCollapsed || (!prefs.explorerOpen && !prefs.conversationsOpen) || focus ? 0 : prefs.navWidth
  let chat = prefs.chatClosed ? 0 : prefs.chatWidth
  const content = focus || !prefs.contentClosed
  const gaps = (nav && (content || chat) ? 5 : 0) + (chat && content ? 5 : 0)
  let excess = Math.max(0, nav + chat + gaps + (content ? LAYOUT_LIMITS.content : 0) - available)
  const shrinkChat = Math.min(excess, Math.max(0, chat - LAYOUT_LIMITS.chat.min)); chat -= shrinkChat; excess -= shrinkChat
  const shrinkNav = Math.min(excess, Math.max(0, nav - LAYOUT_LIMITS.nav.min)); nav -= shrinkNav
  return { nav, chat, content, navSplitter: nav > 0 && (content || chat > 0), chatSplitter: chat > 0 && content }
}
export function useWorkbenchLayoutPrefs() {
  const [prefs, setPrefs] = useState<WorkbenchLayoutPrefs>(() => {
    try { return parseLayoutPrefs(window.localStorage.getItem(STORAGE_KEY)) } catch { return { ...DEFAULT_PREFS } }
  })
  const current = useRef(prefs); current.current = prefs
  const dragging = useRef(false)
  const persist = useCallback(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current.current)) } catch { /* Preferences must not block files or editing. */ }
  }, [])
  useEffect(() => { if (!dragging.current) persist() }, [prefs, persist])
  const set = useCallback(<K extends keyof WorkbenchLayoutPrefs>(key: K, value: WorkbenchLayoutPrefs[K]) => {
    setPrefs(prev => { const next = { ...prev, [key]: value }; current.current = next; return next })
  }, [])
  const toggle = useCallback((key: 'navCollapsed' | 'contentClosed' | 'chatClosed') => {
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])
  return {
    prefs,
    beginResize: () => { dragging.current = true },
    endResize: () => { dragging.current = false; persist() },
    setNavWidth: (width: number) => set('navWidth', clamp(width, LAYOUT_LIMITS.nav.min, LAYOUT_LIMITS.nav.max)),
    setChatWidth: (width: number) => set('chatWidth', clamp(width, LAYOUT_LIMITS.chat.min, LAYOUT_LIMITS.chat.max)),
    setSessionsHeight: (height: number) => set('sessionsHeight', clamp(height, LAYOUT_LIMITS.sessions.min, LAYOUT_LIMITS.sessions.max)),
    toggleNav: () => toggle('navCollapsed'),
    setNavCollapsed: (closed: boolean) => set('navCollapsed', closed),
    toggleContentClosed: () => toggle('contentClosed'),
    setContentClosed: (closed: boolean) => set('contentClosed', closed),
    toggleChatClosed: () => toggle('chatClosed'),
    setChatClosed: (closed: boolean) => set('chatClosed', closed),
    setExplorerOpen: (open: boolean) => setPrefs(prev => ({ ...prev, explorerOpen: open, navCollapsed: open ? false : prev.navCollapsed })),
    setConversationsOpen: (open: boolean) => setPrefs(prev => ({ ...prev, conversationsOpen: open, navCollapsed: open ? false : prev.navCollapsed })),
    resetLayout: () => setPrefs({ ...DEFAULT_PREFS }),
  }
}
export type WorkbenchLayoutController = ReturnType<typeof useWorkbenchLayoutPrefs>
