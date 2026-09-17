import { useCallback, useEffect, useState } from 'react'

/**
 * F02 冻结的应用布局偏好：只保存停靠方向、宽度、收展与工作位置。
 * 本地持久化，不进 V9，不持有正文或课程副本。
 */
export type ContentDock = 'right' | 'left' | 'top' | 'bottom'

export interface WorkbenchLayoutPrefs {
  contentDock: ContentDock
  navWidth: number
  navCollapsed: boolean
  contentWidth: number
  contentHeight: number
  contentClosed: boolean
  chatClosed: boolean
  explorerOpen: boolean
  conversationsOpen: boolean
}

const STORAGE_KEY = 'guoling-workbench-layout-v1'

export const LAYOUT_LIMITS = {
  nav: { min: 200, max: 440 },
  contentWidth: { min: 340, max: 72 },
  contentHeight: { min: 220, max: 80 },
} as const

const DEFAULT_PREFS: WorkbenchLayoutPrefs = {
  contentDock: 'right',
  navWidth: 264,
  navCollapsed: false,
  contentWidth: 46,
  contentHeight: 52,
  contentClosed: true,
  chatClosed: false,
  explorerOpen: true,
  conversationsOpen: true,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function loadPrefs(): WorkbenchLayoutPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<WorkbenchLayoutPrefs>
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      contentDock: ['right', 'left', 'top', 'bottom'].includes(parsed.contentDock as string)
        ? (parsed.contentDock as ContentDock)
        : DEFAULT_PREFS.contentDock,
      navWidth: clamp(Number(parsed.navWidth) || DEFAULT_PREFS.navWidth, LAYOUT_LIMITS.nav.min, LAYOUT_LIMITS.nav.max),
      contentWidth: Number(parsed.contentWidth) || DEFAULT_PREFS.contentWidth,
      contentHeight: Number(parsed.contentHeight) || DEFAULT_PREFS.contentHeight,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export interface WorkbenchLayoutController {
  prefs: WorkbenchLayoutPrefs
  setDock(dock: ContentDock): void
  setNavWidth(width: number): void
  toggleNav(): void
  setContentSize(size: number): void
  toggleContentClosed(): void
  setContentClosed(closed: boolean): void
  toggleChatClosed(): void
  setChatClosed(closed: boolean): void
  setExplorerOpen(open: boolean): void
  setConversationsOpen(open: boolean): void
  resetLayout(): void
}

export function useWorkbenchLayoutPrefs(): WorkbenchLayoutController {
  const [prefs, setPrefs] = useState<WorkbenchLayoutPrefs>(loadPrefs)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      // 本地持久化失败不影响当前布局使用
    }
  }, [prefs])

  const setDock = useCallback((dock: ContentDock) => {
    setPrefs(prev => ({ ...prev, contentDock: dock, contentClosed: false }))
  }, [])
  const setNavWidth = useCallback((width: number) => {
    setPrefs(prev => ({ ...prev, navWidth: clamp(width, LAYOUT_LIMITS.nav.min, LAYOUT_LIMITS.nav.max), navCollapsed: false }))
  }, [])
  const toggleNav = useCallback(() => {
    setPrefs(prev => ({ ...prev, navCollapsed: !prev.navCollapsed }))
  }, [])
  const setContentSize = useCallback((size: number) => {
    setPrefs(prev => ({ ...prev, contentWidth: clamp(size, 18, 80), contentHeight: clamp(size, 18, 80) }))
  }, [])
  const toggleContentClosed = useCallback(() => {
    setPrefs(prev => ({ ...prev, contentClosed: !prev.contentClosed }))
  }, [])
  const setContentClosed = useCallback((closed: boolean) => {
    setPrefs(prev => ({ ...prev, contentClosed: closed }))
  }, [])
  const toggleChatClosed = useCallback(() => {
    setPrefs(prev => ({ ...prev, chatClosed: !prev.chatClosed }))
  }, [])
  const setChatClosed = useCallback((closed: boolean) => {
    setPrefs(prev => ({ ...prev, chatClosed: closed }))
  }, [])
  const setExplorerOpen = useCallback((open: boolean) => {
    setPrefs(prev => ({ ...prev, explorerOpen: open }))
  }, [])
  const setConversationsOpen = useCallback((open: boolean) => {
    setPrefs(prev => ({ ...prev, conversationsOpen: open }))
  }, [])
  const resetLayout = useCallback(() => {
    setPrefs(DEFAULT_PREFS)
  }, [])

  return { prefs, setDock, setNavWidth, toggleNav, setContentSize, toggleContentClosed, setContentClosed, toggleChatClosed, setChatClosed, setExplorerOpen, setConversationsOpen, resetLayout }
}
