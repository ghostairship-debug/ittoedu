export type HtmlPreviewGeometry = 'fixed' | 'flow' | 'camera'

function declaredBox(element: HTMLElement): boolean {
  if (element.style.width && element.style.height) return true
  const doc = element.ownerDocument
  const win = doc.defaultView
  let width = Boolean(element.style.width)
  let height = Boolean(element.style.height)
  const inspect = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.STYLE_RULE) {
        const styleRule = rule as CSSStyleRule
        try {
          if (element.matches(styleRule.selectorText)) {
            width ||= Boolean(styleRule.style.width)
            height ||= Boolean(styleRule.style.height)
          }
        } catch { /* Invalid or browser-specific selectors are not evidence. */ }
      } else if ('cssRules' in rule) {
        if (rule.type === CSSRule.MEDIA_RULE && !win?.matchMedia((rule as CSSMediaRule).conditionText).matches) continue
        try { inspect((rule as CSSGroupingRule).cssRules) } catch { /* Opaque stylesheet. */ }
      }
    }
  }
  for (const sheet of Array.from(doc.styleSheets)) {
    try { inspect(sheet.cssRules) } catch { /* Cross-origin and opaque CSSOM are optional. */ }
  }
  return width && height
}

export function classifyHtmlPreviewGeometry(section: HTMLElement): HtmlPreviewGeometry {
  const style = section.ownerDocument.defaultView?.getComputedStyle(section)
  if (!style) return 'flow'
  const rect = section.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return 'flow'
  const clipped = ['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflowY)
  const absoluteContent = Array.from(section.children).some(child => {
    const position = section.ownerDocument.defaultView?.getComputedStyle(child).position
    return position === 'absolute' || position === 'fixed'
  })
  const parentWidth = section.parentElement?.getBoundingClientRect().width ?? section.ownerDocument.documentElement.clientWidth
  const viewportHeight = section.ownerDocument.documentElement.clientHeight
  const widthConstrained = Math.abs(rect.width - parentWidth) > 2
  const oversizedHeight = clipped && rect.height > viewportHeight + 2
  const measuredBox = clipped && (widthConstrained || oversizedHeight || absoluteContent)
  const fixedBox = (style.aspectRatio !== 'auto' || declaredBox(section) || measuredBox) &&
    (clipped || absoluteContent || (section.scrollHeight <= section.clientHeight + 2 && section.scrollWidth <= section.clientWidth + 2))
  if (!fixedBox) return 'flow'
  if (absoluteContent && !clipped) return 'camera'
  return 'fixed'
}

/** Scale the page with CSS zoom so author/script transforms remain untouched. */
export function mountHtmlPreviewGeometry(section: HTMLElement): { refresh(): void; destroy(): void } {
  const doc = section.ownerDocument
  const win = doc.defaultView
  const originalZoom = section.style.getPropertyValue('zoom')
  const originalPriority = section.style.getPropertyPriority('zoom')
  let mounted = true
  const refresh = () => {
    if (!mounted) return
    section.style.removeProperty('zoom')
    if (originalZoom) section.style.setProperty('zoom', originalZoom, originalPriority)
    if (classifyHtmlPreviewGeometry(section) === 'flow') return
    const width = section.getBoundingClientRect().width
    const height = section.getBoundingClientRect().height
    const authoredZoom = Number.parseFloat(win?.getComputedStyle(section).zoom ?? '1') || 1
    const bodyStyle = win?.getComputedStyle(doc.body)
    const availableWidth = Math.max(1, (doc.documentElement.clientWidth || win?.innerWidth || width) -
      (Number.parseFloat(bodyStyle?.marginLeft ?? '0') || 0) - (Number.parseFloat(bodyStyle?.marginRight ?? '0') || 0))
    const availableHeight = Math.max(1, (doc.documentElement.clientHeight || win?.innerHeight || height) -
      (Number.parseFloat(bodyStyle?.marginTop ?? '0') || 0) - (Number.parseFloat(bodyStyle?.marginBottom ?? '0') || 0))
    const fit = Math.min(availableWidth / width, availableHeight / height)
    if (Math.abs(fit - 1) > 0.001) section.style.setProperty('zoom', String(authoredZoom * fit))
  }
  win?.addEventListener('resize', refresh)
  refresh()
  return {
    refresh,
    destroy: () => {
      if (!mounted) return
      mounted = false
      win?.removeEventListener('resize', refresh)
      section.style.removeProperty('zoom')
      if (originalZoom) section.style.setProperty('zoom', originalZoom, originalPriority)
    },
  }
}
