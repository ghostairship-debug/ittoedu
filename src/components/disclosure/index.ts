import { z } from 'zod'
import type { ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import { interactionDefinition, interactionStateKey, runtimeLifetime } from '../input/shared'

export const DISCLOSURE_DEFINITION = interactionDefinition('guoling.disclosure', '收展')
export const disclosureDataSchema = z.object({ label: z.string(), content: z.string(), initiallyOpen: z.boolean().default(false), stateKey: z.string().optional() }).strict()
export const createDisclosureData = () => disclosureDataSchema.parse({ label: '展开说明', content: '说明内容' })
export const disclosureRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, root, scope }) {
    let data = disclosureDataSchema.parse(instance.data)
    if (!root) throw new Error('收展组件需要内容容器')
    const life = runtimeLifetime(scope), details = root.ownerDocument.createElement('details'), summary = root.ownerDocument.createElement('summary'), content = root.ownerDocument.createElement('div')
    details.append(summary, content); root.append(details); life.own(() => details.remove())
    const key = () => interactionStateKey(instance.id, data.stateKey)
    const saved = scope.state.get(key()); details.open = typeof saved === 'boolean' ? saved : data.initiallyOpen
    const paint = () => { summary.textContent = data.label; content.textContent = data.content }
    life.listen(details, 'keydown', event => event.stopPropagation()); life.listen(details, 'click', event => event.stopPropagation())
    life.listen(details, 'toggle', () => { if (life.active()) { scope.state.set(key(), details.open); scope.events.emit('disclosure.toggle', { instanceId: instance.id, open: details.open }) } })
    paint()
    return { update(next) { if (!life.active()) return; data = disclosureDataSchema.parse(next.data); paint() }, dispose: life.dispose }
  },
}
