import { z } from 'zod'
import type { ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import { interactionDefinition, interactionStateKey, runtimeLifetime } from '../input/shared'

export const POPOVER_DEFINITION = interactionDefinition('guoling.popover', '浮层')
export const popoverDataSchema = z.object({ label: z.string(), content: z.string(), closeLabel: z.string().default('关闭'), stateKey: z.string().optional() }).strict()
export const createPopoverData = () => popoverDataSchema.parse({ label: '查看提示', content: '提示内容' })
export const popoverRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, root, scope }) {
    let data = popoverDataSchema.parse(instance.data)
    if (!root) throw new Error('浮层组件需要内容容器')
    const life = runtimeLifetime(scope), doc = root.ownerDocument, button = doc.createElement('button'), panel = doc.createElement('div'), content = doc.createElement('div'), close = doc.createElement('button')
    button.type = close.type = 'button'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false')
    // Body portal escapes transformed Slide frames and never occupies Flow reading space.
    Object.assign(panel.style, { position: 'fixed', zIndex: '1000', maxWidth: 'min(28rem, calc(100vw - 24px))', maxHeight: 'calc(100vh - 24px)', overflow: 'auto', background: 'Canvas', color: 'CanvasText', padding: '16px', border: '1px solid', borderRadius: '8px' })
    panel.append(content, close); root.append(button); doc.body.append(panel)
    const key = () => interactionStateKey(instance.id, data.stateKey)
    let open = scope.state.get(key()) === true
    const paint = () => { button.textContent = data.label; button.setAttribute('aria-expanded', String(open)); panel.setAttribute('aria-label', data.label); content.textContent = data.content; close.textContent = data.closeLabel; panel.hidden = !open
      if (open) { const box = button.getBoundingClientRect(); panel.style.left = `${Math.max(12, Math.min(box.left, doc.documentElement.clientWidth - 320))}px`; panel.style.top = `${Math.max(12, Math.min(box.bottom + 8, doc.documentElement.clientHeight - 180))}px` } }
    const setOpen = (value: boolean) => { if (!life.active()) return; open = value; scope.state.set(key(), value); paint(); if (open) close.focus(); else button.focus(); scope.events.emit('popover.toggle', { instanceId: instance.id, open }) }
    life.listen(button, 'click', event => { event.stopPropagation(); setOpen(!open) })
    life.listen(close, 'click', event => { event.stopPropagation(); setOpen(false) })
    life.listen(button, 'keydown', event => event.stopPropagation())
    life.listen(panel, 'keydown', event => { event.stopPropagation(); if ((event as KeyboardEvent).key === 'Escape') { event.preventDefault(); setOpen(false) } })
    life.listen(doc, 'pointerdown', event => { if (open && !panel.contains(event.target as Node) && !button.contains(event.target as Node)) setOpen(false) })
    life.own(() => { panel.remove(); button.remove() }); paint()
    return { update(next) { if (!life.active()) return; data = popoverDataSchema.parse(next.data); paint() }, dispose: life.dispose }
  },
}
