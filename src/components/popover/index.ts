import { z } from 'zod'
import type { ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import { interactionDefinition, interactionStateKey, runtimeLifetime } from '../input/shared'

export const POPOVER_DEFINITION = interactionDefinition('guoling.popover', '浮层')
export const popoverDataSchema = z.object({ label: z.string(), content: z.string(), closeLabel: z.string().default('关闭'), stateKey: z.string().optional() }).strict()
export const createPopoverData = () => popoverDataSchema.parse({ label: '查看提示', content: '提示内容' })
export const popoverRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, root, scope }) {
    let data = popoverDataSchema.parse(instance.data)
    let current = instance
    const attachment = instance.attachments?.find(value => value.instanceId === instance.id && value.target.kind === 'text-range')
    const target = attachment && scope.target(attachment.target)
    let anchors = target?.elements?.length ? [...target.elements] : target?.element ? [target.element] : []
    root ??= anchors[0]
    if (!root) throw new Error('浮层组件需要内容容器或正文范围')
    const life = runtimeLifetime(scope), doc = root.ownerDocument, button = doc.createElement('button'), panel = doc.createElement('div'), content = doc.createElement('div'), close = doc.createElement('button')
    button.type = close.type = 'button'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false')
    // Body portal escapes transformed Slide frames and never occupies Flow reading space.
    Object.assign(panel.style, { position: 'fixed', zIndex: '1000', maxWidth: 'min(28rem, calc(100vw - 24px))', maxHeight: 'calc(100vh - 24px)', overflow: 'auto', background: 'Canvas', color: 'CanvasText', padding: '16px', border: '1px solid', borderRadius: '8px' })
    panel.append(content, close); if (!anchors.length) root.append(button); doc.body.append(panel)
    const key = () => interactionStateKey(instance.id, data.stateKey)
    let open = scope.state.get(key()) === true
    const visible = () => { for (let ancestor: HTMLElement | null = anchors[0] ?? root; ancestor; ancestor = ancestor.parentElement) if (ancestor.hidden) return false; return (anchors[0] ?? root).isConnected }
    const paint = () => {
      if (open && !visible()) { open = false; scope.state.set(key(), false) }
      button.textContent = data.label; button.setAttribute('aria-expanded', String(open)); panel.setAttribute('aria-label', data.label); content.textContent = data.content; close.textContent = data.closeLabel; panel.hidden = !open || !visible()
      if (open) { const box = (anchors[0] ?? button).getBoundingClientRect(); panel.style.left = `${Math.max(12, Math.min(box.left, doc.documentElement.clientWidth - 320))}px`; panel.style.top = `${Math.max(12, Math.min(box.bottom + 8, doc.documentElement.clientHeight - 180))}px` } }
    const setOpen = (value: boolean) => { if (!life.active()) return; open = value; scope.state.set(key(), value); paint(); if (open) close.focus(); else (anchors[0] ?? button).focus(); scope.events.emit('popover.toggle', { instanceId: instance.id, open }) }
    let releaseAnchors = () => {}
    const bindAnchors = () => {
      const reference = current.attachments?.find(value => value.instanceId === current.id && value.target.kind === 'text-range')?.target
      const nextTarget = reference && scope.target(reference)
      const next = nextTarget?.elements?.length ? [...nextTarget.elements] : nextTarget?.element ? [nextTarget.element] : []
      if (next.length === anchors.length && next.every((element, index) => element === anchors[index]) && bound) return
      releaseAnchors(); anchors = next; bound = true
      const disposers: Array<() => void> = []
      for (const anchor of anchors) {
      const tabIndex = anchor.getAttribute('tabindex'), title = anchor.getAttribute('title'), role = anchor.getAttribute('role'), cursor = anchor.style.cursor
      anchor.tabIndex = 0; anchor.title = data.label; anchor.style.cursor = 'help'; anchor.setAttribute('role', 'button')
      disposers.push(() => { if (tabIndex === null) anchor.removeAttribute('tabindex'); else anchor.setAttribute('tabindex', tabIndex); if (title === null) anchor.removeAttribute('title'); else anchor.setAttribute('title', title); if (role === null) anchor.removeAttribute('role'); else anchor.setAttribute('role', role); anchor.style.cursor = cursor })
      // A range can include links and inline widgets. Their own controls keep
      // their native click/keyboard operation; plain range text still opens the note.
      const interactive = (event: Event) => { const target = event.target as Element | null; const control = target?.closest?.('button,input,textarea,select,a[href],[contenteditable="true"]'); return Boolean(control && control !== anchor && anchor.contains(control)) }
      const click = (event: Event) => { if (interactive(event)) return; event.stopPropagation(); setOpen(!open) }
      const keydown = (event: Event) => { if (interactive(event)) return; if (['Enter', ' '].includes((event as KeyboardEvent).key)) { event.preventDefault(); event.stopPropagation(); setOpen(!open) } }
      anchor.addEventListener('click', click); anchor.addEventListener('keydown', keydown)
      disposers.push(() => { anchor.removeEventListener('click', click); anchor.removeEventListener('keydown', keydown) })
      }
      releaseAnchors = () => disposers.reverse().forEach(dispose => dispose())
    }
    let bound = false
    bindAnchors(); life.own(() => releaseAnchors())
    life.listen(button, 'click', event => { event.stopPropagation(); setOpen(!open) })
    life.listen(close, 'click', event => { event.stopPropagation(); setOpen(false) })
    life.listen(button, 'keydown', event => event.stopPropagation())
    life.listen(panel, 'keydown', event => { event.stopPropagation(); if ((event as KeyboardEvent).key === 'Escape') { event.preventDefault(); setOpen(false) } })
    life.listen(doc, 'pointerdown', event => { if (open && !panel.contains(event.target as Node) && !button.contains(event.target as Node) && !anchors.some(anchor => anchor.contains(event.target as Node))) setOpen(false) })
    life.own(scope.events.subscribe('__runtime.text-ranges', value => { if (value && typeof value === 'object' && !Array.isArray(value) && attachment?.target.kind === 'text-range' && value.instanceId === attachment.target.instanceId) { bindAnchors(); paint() } }))
    life.own(scope.events.subscribe('__runtime.visibility', paint))
    life.own(scope.events.subscribe('__runtime.scene.reset', () => { open = false; paint() }))
    life.own(() => { panel.remove(); button.remove() }); paint()
    return { update(next) { if (!life.active()) return; current = next; data = popoverDataSchema.parse(next.data); bindAnchors(); paint() }, dispose: life.dispose }
  },
}
