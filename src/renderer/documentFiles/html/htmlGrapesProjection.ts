import grapesjs, { type Component, type ComponentDefinition, type Editor } from 'grapesjs'
import { inspectHtmlSource, flattenHtmlSourceNodes, type HtmlSourceNode } from '../../../shared/html/htmlSourceStructure'
import type { HtmlSourceEditCommand, HtmlSourceEditLeafCommand } from '../../../shared/html/sourceEditCommands'

type Ports = { commit(command: HtmlSourceEditCommand): Promise<void>; select(key: string): void }

/** Disposable GJS models contain source addresses only; the HTML Session owns every change. */
export function createHtmlGrapesProjection(container: HTMLElement, ports: Ports) {
  let replay = false, dragging = false, busy = false
  const modelByKey = new Map<string, Component>()
  const nodeByKey = new Map<string, HtmlSourceNode>()
  const before = new Map<Component, { parent: Component | undefined; index: number; style: Record<string, unknown> }>()
  const pendingStyles = new Map<Component, Record<string, string | null>>()
  const editor: Editor = grapesjs.init({ container, height: '280px', width: '100%',
    storageManager: false, panels: { defaults: [] }, fromElement: false,
    selectorManager: { componentFirst: true }, avoidInlineStyle: false,
    canvas: { scripts: [], styles: [] }, parser: { optionsHtml: { allowScripts: false } } })
  editor.UndoManager.stop()
  editor.UndoManager.removeAll()
  editor.Keymaps.removeAll()

  const address = (model: Component) => model.get('cwSourceAddress') as HtmlSourceNode['address']
  const snapshot = () => {
    before.clear()
    for (const model of modelByKey.values()) before.set(model, {
      parent: model.parent(), index: model.index(), style: { ...model.getStyle() },
    })
  }
  const flush = async (moved?: Component) => {
    if (replay || busy) return
    const commands: HtmlSourceEditLeafCommand[] = []
    for (const [model, patch] of pendingStyles) {
      const target = address(model)
      if (target && Object.keys(patch).length) commands.push({ type: 'style', target, patch })
    }
    pendingStyles.clear()
    if (moved) {
      const old = before.get(moved), parent = moved.parent(), target = address(moved)
      const destination = parent && address(parent)
      if (old && destination && target && (old.parent !== parent || old.index !== moved.index())) {
        const original = nodeByKey.get(parent!.get('cwSourceKey'))
        const siblings = original?.children.filter(node => node.key !== moved.get('cwSourceKey')) ?? []
        const next = parent!.components().at(moved.index() + 1)?.get('cwSourceKey')
        const index = next ? siblings.findIndex(node => node.key === next) : siblings.length
        if (index >= 0) commands.push({ type: 'move', target, parent: destination, index })
      }
    }
    if (!commands.length) return
    busy = true
    try { await ports.commit(commands.length === 1 ? commands[0]! : { type: 'batch', commands }) }
    finally { busy = false }
  }
  editor.on('component:selected', model => { if (!replay) ports.select(model.get('cwSourceKey') ?? '') })
  editor.on('component:drag:start', () => { if (!replay) { snapshot(); dragging = true } })
  editor.on('component:drag:end', (event: { target?: Component }) => {
    dragging = false
    void flush(event.target)
  })
  // add/remove are GJS's implementation of a move, never formal deletion commands.
  editor.on('component:update:style', (model: Component, _style: unknown, options: { partial?: boolean } = {}) => {
    if (replay || busy) return
    const old = before.get(model)?.style ?? {}, current = model.getStyle()
    const patch: Record<string, string | null> = {}
    for (const key of new Set([...Object.keys(old), ...Object.keys(current)])) {
      if (old[key] !== current[key]) patch[key] = current[key] == null ? null : String(current[key])
    }
    pendingStyles.set(model, patch)
    if (!dragging && !options.partial) void flush()
  })

  const project = (source: string, previewUrl?: string) => {
    replay = true
    try {
      modelByKey.clear(); nodeByKey.clear(); pendingStyles.clear()
      const structure = inspectHtmlSource(source)
      const nodes = flattenHtmlSourceNodes(structure.roots)
      for (const node of nodes) nodeByKey.set(node.key, node)
      const body = nodes.find(node => node.name === 'body')!
      const attributes = (node: HtmlSourceNode) => Object.fromEntries(Object.entries(node.attributes).flatMap(([name, value]) => {
        // Program behaviour belongs to the sandbox preview, never GJS's workbench frame.
        if (/^on/i.test(name) || ['srcdoc', 'href', 'action', 'formaction'].includes(name)) return []
        if (name === 'src' && previewUrl && !/^(?:data:|https?:|blob:)/i.test(value)) {
          try { return [[name, new URL(value, previewUrl).href]] } catch { return [[name, value]] }
        }
        return [[name, value]]
      }))
      const projected = (node: HtmlSourceNode) => node.kind !== 'source' && !['iframe', 'object', 'embed'].includes(node.name)
      const definition = (node: HtmlSourceNode): ComponentDefinition => ({
        ...(node.kind === 'text' ? { type: 'textnode', content: (node.value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;') }
          : { tagName: node.name, attributes: attributes(node),
            components: node.children.filter(projected).map(definition) }),
        cwSourceKey: node.key, cwSourceAddress: node.address,
        removable: false, copyable: false, editable: false, draggable: Boolean(node.address),
        droppable: Boolean(node.contentSpan),
      })
      editor.setComponents(body.children.filter(projected).map(definition))
      editor.getWrapper()!.set({ cwSourceKey: body.key, cwSourceAddress: body.address })
      const gather = (model: Component) => {
        const key = model.get('cwSourceKey')
        if (key) modelByKey.set(key, model)
        model.components().forEach(gather)
      }
      gather(editor.getWrapper()!)
      // CSS is a read-only view here. Explicit style inputs use component inline styles.
      editor.setStyle(nodes.filter(node => node.name === 'style' && node.contentSpan)
        .map(node => source.slice(node.contentSpan!.from, node.contentSpan!.to)).join('\n'))
      snapshot()
      editor.UndoManager.removeAll()
    } finally { replay = false }
  }
  return { editor, project,
    select(key: string) { const model = modelByKey.get(key); if (model) editor.select(model) },
    style(key: string, patch: Record<string, string | null>) {
      const model = modelByKey.get(key)
      if (!model) return false
      if (busy) return true
      snapshot()
      const next = { ...model.getStyle() }
      for (const [name, value] of Object.entries(patch)) { if (value === null) delete next[name]; else next[name] = value }
      model.setStyle(next)
      return true
    },
    move(key: string, parentKey: string, index: number) {
      const model = modelByKey.get(key), parent = modelByKey.get(parentKey)
      if (!model || !parent) return false
      if (busy) return true
      const original = nodeByKey.get(parentKey)
      const siblings = original?.children.filter(node => node.key !== key) ?? []
      const next = siblings.slice(index).find(node => modelByKey.has(node.key))
      const nextModel = next && modelByKey.get(next.key)
      const at = nextModel?.index() ?? parent.components().length
      snapshot(); model.move(parent, { at }); void flush(model)
      return true
    },
    dispose() {
      // A panel can close while GJS's iframe is still loading.
      for (const frame of container.querySelectorAll('iframe')) frame.onload = null
      editor.destroy(); modelByKey.clear()
    },
  }
}
