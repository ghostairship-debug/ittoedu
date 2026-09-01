import {
  flowAnchorTitle,
  flowPageStartLocationId,
  flowSurfaceOrder,
  isFlowRuntimeTocAnchor,
  walkFlowBlocks,
  type FlowPublishedPlaybackDocument,
} from './flowModel'
import type { PublishedFlowSurface } from '../../../shared/publishedCourseTypes'

export const FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX = 260
export const FLOW_RUNTIME_TOC_TOGGLE_HEIGHT_PX = 56
export const FLOW_RUNTIME_TOC_OPEN_ARIA_LABEL = '收起目录'
export const FLOW_RUNTIME_TOC_CLOSED_ARIA_LABEL = '打开目录'

export interface FlowRuntimeTocShellLayout {
  articleInsetPx: number
  /** Paper-owned overlays follow the reflowed article; viewport chrome does not. */
  paperOverlayInsetPx: number
  viewportOverlayInsetPx: number
}

/** The drawer reflows the article; viewport-owned runtime chrome never moves. */
export function flowRuntimeTocShellLayout(open: boolean): FlowRuntimeTocShellLayout {
  return {
    articleInsetPx: open ? FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX : 0,
    paperOverlayInsetPx: open ? FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX : 0,
    viewportOverlayInsetPx: 0,
  }
}

export type FlowRuntimeTocKind = 'page' | 'heading' | 'section'

export interface FlowRuntimeTocEntry {
  readonly kind: FlowRuntimeTocKind
  readonly surfaceId: string
  readonly title: string
  readonly level: number
  readonly anchorId: string
  readonly blockId?: string
  readonly locationId?: string
}

export interface FlowRuntimeTocChromeOptions {
  getEntries(): readonly FlowRuntimeTocEntry[]
  onNavigate(entry: FlowRuntimeTocEntry): void
  onOpenChange?(open: boolean): void
  initialOpen?: boolean
}

export function flowRuntimeTocAnchorId(blockId: string): string {
  return `flow-toc-${blockId}`
}

export function flowRuntimeTocPageAnchorId(surfaceId: string): string {
  return `flow-toc-page-${surfaceId}`
}

export function buildFlowRuntimeToc(
  playback: FlowPublishedPlaybackDocument,
): FlowRuntimeTocEntry[] {
  const entries: FlowRuntimeTocEntry[] = []
  for (const surfaceId of flowSurfaceOrder(playback)) {
    const surface = playback.surfaces.find((candidate) => candidate.id === surfaceId)
    if (!surface) continue
    const startLocationId = flowPageStartLocationId(playback, surface.id)
    entries.push({
      kind: 'page',
      surfaceId: surface.id,
      title: surface.title.trim() || '未命名页面',
      level: 0,
      anchorId: flowRuntimeTocPageAnchorId(surface.id),
      locationId: startLocationId,
    })
    entries.push(...buildFlowSurfaceToc(playback, surface))
  }
  return entries
}

export function buildFlowSurfaceToc(
  playback: FlowPublishedPlaybackDocument,
  surface: PublishedFlowSurface,
): FlowRuntimeTocEntry[] {
  const locationByBlockId = new Map<string, string>()
  for (const location of playback.locations) {
    if (location.kind === 'flow-block' && location.surfaceId === surface.id) {
      locationByBlockId.set(location.blockId, location.id)
    }
  }
  const entries: FlowRuntimeTocEntry[] = []
  walkFlowBlocks(surface.blocks, ({ block, depth }) => {
    if (!isFlowRuntimeTocAnchor(block)) return
    entries.push({
      kind: block.type,
      surfaceId: surface.id,
      title: flowAnchorTitle(block),
      level: block.type === 'heading' ? block.level + depth : depth + 1,
      anchorId: flowRuntimeTocAnchorId(block.id),
      blockId: block.id,
      locationId: locationByBlockId.get(block.id),
    })
  })
  return entries
}

function applyTriangle(chevron: HTMLElement, direction: 'left' | 'right'): void {
  chevron.dataset.flowRuntimeTocChevron = direction
  chevron.style.display = 'block'
  chevron.style.width = '0'
  chevron.style.height = '0'
  chevron.style.borderTop = '7px solid transparent'
  chevron.style.borderBottom = '7px solid transparent'
  chevron.style.borderLeft = direction === 'right' ? '8px solid #ffffff' : '0'
  chevron.style.borderRight = direction === 'left' ? '8px solid #ffffff' : '0'
}

/**
 * Runtime-session TOC chrome. Scheme 1: drawer and triangle are `position:fixed`
 * against the viewport. Collapsed = drawer fully off-screen + left-edge triangle
 * only. Expanded = 240–280px left column; the host insets the article so body
 * is not covered. Never written to the project, history, print, or DOCX.
 */
export class FlowRuntimeTocChrome {
  #root: HTMLElement
  #drawer: HTMLElement
  #toggle: HTMLButtonElement
  #list: HTMLElement
  #chevron: HTMLElement
  #open: boolean
  #getEntries: () => readonly FlowRuntimeTocEntry[]
  #onNavigate: (entry: FlowRuntimeTocEntry) => void
  #onOpenChange?: (open: boolean) => void

  constructor(root: HTMLElement, options: FlowRuntimeTocChromeOptions) {
    this.#root = root
    this.#getEntries = options.getEntries
    this.#onNavigate = options.onNavigate
    this.#onOpenChange = options.onOpenChange
    this.#open = options.initialOpen === true
    const dom = root.ownerDocument

    this.#drawer = dom.createElement('nav')
    this.#drawer.id = 'flow-runtime-toc-drawer'
    this.#drawer.className = 'flow-runtime-toc-drawer'
    this.#drawer.dataset.testid = 'flow-runtime-toc-drawer'
    this.#drawer.setAttribute('aria-label', '目录')
    this.#drawer.style.position = 'fixed'
    this.#drawer.style.top = '0'
    this.#drawer.style.left = '0'
    this.#drawer.style.bottom = '0'
    this.#drawer.style.width = `${FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX}px`
    this.#drawer.style.zIndex = '29'
    this.#drawer.style.boxSizing = 'border-box'
    this.#drawer.style.padding = '16px 12px'
    this.#drawer.style.overflow = 'auto'
    this.#drawer.style.background = '#172033'
    this.#drawer.style.color = '#f8fafc'
    this.#drawer.style.transition = 'transform 160ms ease'
    this.#drawer.addEventListener('keydown', this.#onChromeKeyDown)

    const heading = dom.createElement('h2')
    heading.textContent = '目录'
    heading.style.margin = '0 0 12px'
    heading.style.fontSize = '14px'
    this.#drawer.appendChild(heading)

    this.#list = dom.createElement('ul')
    this.#list.className = 'flow-runtime-toc-list'
    this.#list.style.listStyle = 'none'
    this.#list.style.margin = '0'
    this.#list.style.padding = '0'
    this.#drawer.appendChild(this.#list)

    this.#toggle = dom.createElement('button')
    this.#toggle.type = 'button'
    this.#toggle.className = 'flow-runtime-toc-toggle'
    this.#toggle.dataset.testid = 'flow-runtime-toc-toggle'
    this.#toggle.style.position = 'fixed'
    this.#toggle.style.top = '42%'
    this.#toggle.style.transform = 'translateY(-50%)'
    this.#toggle.style.zIndex = '30'
    this.#toggle.style.width = '16px'
    this.#toggle.style.height = `${FLOW_RUNTIME_TOC_TOGGLE_HEIGHT_PX}px`
    this.#toggle.style.padding = '0'
    this.#toggle.style.border = '0'
    this.#toggle.style.borderRadius = '0 6px 6px 0'
    this.#toggle.style.background = '#2563eb'
    this.#toggle.style.display = 'grid'
    this.#toggle.style.placeItems = 'center'
    this.#toggle.style.cursor = 'pointer'
    this.#toggle.addEventListener('click', this.#onToggle)
    this.#toggle.addEventListener('keydown', this.#onChromeKeyDown)

    this.#chevron = dom.createElement('span')
    this.#chevron.setAttribute('aria-hidden', 'true')
    this.#toggle.appendChild(this.#chevron)

    root.appendChild(this.#drawer)
    root.appendChild(this.#toggle)
    this.sync()
  }

  get open(): boolean {
    return this.#open
  }

  setOpen(open: boolean): void {
    if (this.#open === open) {
      this.#applyChrome()
      return
    }
    this.#open = open
    this.#applyChrome()
    this.#onOpenChange?.(this.#open)
  }

  sync(): void {
    this.#renderEntries()
    this.#applyChrome()
  }

  destroy(): void {
    this.#toggle.removeEventListener('click', this.#onToggle)
    this.#toggle.removeEventListener('keydown', this.#onChromeKeyDown)
    this.#drawer.removeEventListener('keydown', this.#onChromeKeyDown)
    this.#drawer.remove()
    this.#toggle.remove()
  }

  #onToggle = (): void => {
    this.setOpen(!this.#open)
  }

  #onChromeKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (!this.#open) return
      event.preventDefault()
      this.setOpen(false)
      this.#toggle.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = [...this.#list.querySelectorAll<HTMLButtonElement>('[data-flow-runtime-toc-item]')]
    if (items.length === 0) return
    const current = this.#root.ownerDocument.activeElement
    const index = items.findIndex((item) => item === current)
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(items.length - 1, Math.max(0, index) + 1)
      : Math.max(0, (index < 0 ? items.length : index) - 1)
    event.preventDefault()
    items[nextIndex]?.focus()
  }

  #applyChrome(): void {
    this.#drawer.dataset.tocOpen = this.#open ? 'true' : 'false'
    this.#toggle.dataset.tocOpen = this.#open ? 'true' : 'false'
    this.#toggle.setAttribute('aria-expanded', this.#open ? 'true' : 'false')
    this.#toggle.setAttribute(
      'aria-label',
      this.#open ? FLOW_RUNTIME_TOC_OPEN_ARIA_LABEL : FLOW_RUNTIME_TOC_CLOSED_ARIA_LABEL,
    )
    this.#toggle.setAttribute('aria-controls', this.#drawer.id)
    this.#drawer.style.transform = this.#open ? 'translateX(0)' : 'translateX(-100%)'
    this.#drawer.style.pointerEvents = this.#open ? 'auto' : 'none'
    this.#toggle.style.left = this.#open ? `${FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX}px` : '0'
    this.#root.style.setProperty(
      '--flow-toc-inset',
      this.#open ? `${FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX}px` : '0px',
    )
    applyTriangle(this.#chevron, this.#open ? 'left' : 'right')
  }

  #renderEntries(): void {
    const entries = this.#getEntries()
    this.#list.replaceChildren()
    const dom = this.#root.ownerDocument
    for (const entry of entries) {
      const item = dom.createElement('li')
      const button = dom.createElement('button')
      button.type = 'button'
      button.dataset.flowRuntimeTocItem = 'true'
      button.dataset.flowTocKind = entry.kind
      button.dataset.flowTocSurfaceId = entry.surfaceId
      if (entry.blockId) button.dataset.flowTocBlockId = entry.blockId
      button.dataset.flowTocAnchor = entry.anchorId
      button.setAttribute('aria-label', tocItemAriaLabel(entry))
      button.textContent = entry.title
      button.style.display = 'block'
      button.style.width = '100%'
      button.style.textAlign = 'left'
      button.style.padding = `6px 8px 6px ${8 + Math.max(0, entry.level) * 12}px`
      button.style.border = '0'
      button.style.background = 'transparent'
      button.style.color = 'inherit'
      button.style.cursor = 'pointer'
      button.addEventListener('click', () => this.#onNavigate(entry))
      item.appendChild(button)
      this.#list.appendChild(item)
    }
  }
}

function tocItemAriaLabel(entry: FlowRuntimeTocEntry): string {
  if (entry.kind === 'page') return `跳转到页面：${entry.title}`
  if (entry.kind === 'section') return `跳转到分节：${entry.title}`
  return `跳转到标题 ${entry.level}：${entry.title}`
}
