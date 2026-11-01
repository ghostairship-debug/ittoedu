export type HtmlPreviewGeometry = 'fixed' | 'flow' | 'camera'

function declaredBox(element: HTMLElement): boolean {
  const doc = element.ownerDocument
  const win = doc.defaultView
  const computed = win?.getComputedStyle(element)
  const bounded = (value: string): boolean => {
    // A percentage/auto reading lane is not a fixed design canvas. Resolve
    // simple custom-property sizes, retaining the same rule for their values.
    let resolved = value.trim()
    for (let depth = 0; depth < 8 && resolved.includes('var('); depth++) {
      const next = resolved.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g,
        (_match, key: string, fallback: string | undefined) => computed?.getPropertyValue(key).trim() || fallback?.trim() || '')
      if (next === resolved) break
      resolved = next
    }
    return Boolean(resolved) && !/%|\b(?:auto|inherit|unset|initial|revert|stretch|fit-content|min-content|max-content)\b|(?:var|calc|min|max|clamp)\(/i.test(resolved)
      && /(?:\d|\.\d)(?:px|r?em|ch|ex|cap|ic|lh|rlh|vw|vh|vmin|vmax|[sld]v[wh]|cm|mm|q|in|pt|pc)\b/i.test(resolved)
  }
  // Typed computed values honor the full cascade while retaining percentages
  // and auto. getComputedStyle returns used pixels for those same values.
  try {
    const values = (element as HTMLElement & {
      computedStyleMap?(): { get(property: string): { toString(): string } | undefined }
    }).computedStyleMap?.()
    if (values) return bounded(values.get('width')?.toString() ?? '') && bounded(values.get('height')?.toString() ?? '')
  } catch { /* An unavailable Typed OM leaves only conservative author evidence. */ }
  let width: boolean | undefined
  let height: boolean | undefined
  let uncertain = false
  const evidence = (previous: boolean | undefined, value: string) => value ? previous !== false && bounded(value) : previous
  const inspect = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.STYLE_RULE) {
        const styleRule = rule as CSSStyleRule
        try {
          if (element.matches(styleRule.selectorText)) {
            width = evidence(width, styleRule.style.width)
            height = evidence(height, styleRule.style.height)
          }
        } catch { /* Invalid or browser-specific selectors are not evidence. */ }
      } else if ('cssRules' in rule) {
        if (rule.type === CSSRule.MEDIA_RULE) {
          if (!win?.matchMedia((rule as CSSMediaRule).conditionText).matches) continue
        } else if (rule.type === CSSRule.SUPPORTS_RULE) {
          if (!CSS.supports((rule as CSSSupportsRule).conditionText)) continue
        } else { uncertain = true; continue }
        try { inspect((rule as CSSGroupingRule).cssRules) } catch { /* Opaque stylesheet. */ }
      }
    }
  }
  for (const sheet of Array.from(doc.styleSheets)) {
    if (sheet.disabled || sheet.media.mediaText && !win?.matchMedia(sheet.media.mediaText).matches) continue
    try { inspect(sheet.cssRules) } catch { /* Cross-origin and opaque CSSOM are optional. */ }
  }
  // Without resolved values, conflicting dimensions or unknown grouping rules
  // cannot establish a fixed canvas. Preserve the document's natural layout.
  return !uncertain && evidence(width, element.style.width) === true && evidence(height, element.style.height) === true
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
  // Opaque stylesheets cannot expose authored dimensions. An intrinsically
  // wider clipped stage still provides a useful fallback; a narrower or tall
  // responsive block (or an absolute decoration) is not such evidence.
  const measuredBox = clipped && rect.width > parentWidth + 2
  const aspectRatio = Boolean(style.aspectRatio && style.aspectRatio !== 'auto')
  const fixedBox = (aspectRatio || declaredBox(section) || measuredBox) &&
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
