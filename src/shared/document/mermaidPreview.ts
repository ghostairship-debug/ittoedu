type MermaidApi = import('mermaid').Mermaid
let mermaidPromise: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  return mermaidPromise ??= import('mermaid').then(api => {
    api.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
    return api.default
  }).catch(error => { mermaidPromise = null; throw error })
}

/** Author and Published consume the same source; a stale render never replaces a newer diagram. */
export function createMermaidPreview(preview: HTMLElement, changed?: (state: string) => void) {
  let disposed = false, token = 0, lastSource: string | undefined, pending = Promise.resolve()
  const state = (value: string) => { preview.dataset.state = value; changed?.(value) }
  preview.classList.add('mermaid-preview')
  preview.contentEditable = 'false'
  preview.setAttribute('aria-label', 'Mermaid 图示预览')
  preview.style.cssText = 'display:block;user-select:none;white-space:normal;'
  const render = (source: string): Promise<void> => {
    if (disposed || source === lastSource) return pending
    lastSource = source
    const generation = ++token, current = () => !disposed && token === generation
    if (!source.trim()) { preview.replaceChildren(); state('empty'); return pending = Promise.resolve() }
    state('loading')
    return pending = loadMermaid().then(async mermaid => {
      if (!current()) return
      const id = `mermaid-${Math.random().toString(36).slice(2)}`
      try {
        const { svg, bindFunctions } = await mermaid.render(id, source)
        if (!current()) return
        const frame = preview.ownerDocument.createElement('div')
        frame.className = 'mermaid-preview__svg'; frame.style.overflowX = 'auto'; frame.innerHTML = svg
        const diagram = frame.querySelector('svg')
        if (diagram) Object.assign(diagram.style, { maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' })
        preview.replaceChildren(frame); bindFunctions?.(frame); state('ready')
      } catch (error) {
        if (!current()) return
        const box = preview.ownerDocument.createElement('div')
        box.className = 'mermaid-preview__error'; box.textContent = `Mermaid 暂无法渲染：${error instanceof Error ? error.message : String(error)}`
        preview.replaceChildren(box); state('error')
        preview.ownerDocument.getElementById(`d${id}`)?.remove(); preview.ownerDocument.getElementById(id)?.remove()
      }
    }).catch(error => {
      if (!current()) return
      const message = preview.ownerDocument.createElement('div'), retry = preview.ownerDocument.createElement('button')
      message.className = 'mermaid-preview__error'; message.textContent = `Mermaid 加载失败：${error instanceof Error ? error.message : String(error)}`
      retry.type = 'button'; retry.textContent = '重试'; retry.addEventListener('click', () => { lastSource = undefined; void render(source) })
      preview.replaceChildren(message, retry); state('error')
    })
  }
  return { render, destroy() { disposed = true; token++ } }
}
