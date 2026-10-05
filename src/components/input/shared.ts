import type { ComponentDefinition, ComponentEdit, ComponentRuntimeScope, JsonValue } from '../../shared/contracts/component-platform'

export const interactionStateKey = (instanceId: string, explicit?: string) => explicit ?? `interaction:${instanceId}`
export function interactionDefinition(id: string, title: string, role: ComponentDefinition['role'] = 'content'): ComponentDefinition {
  return { id, title, role, implementation: { kind: 'builtin', key: id } }
}
export function interactionDataEdit(instanceId: string, value: JsonValue): ComponentEdit {
  return { type: 'data.set', instanceId, path: [], value: structuredClone(value) }
}
/** A component owns only these listeners/nodes; the author frame remains host-owned. */
export function runtimeLifetime(scope: ComponentRuntimeScope) {
  let disposed = false
  const disposers: (() => void)[] = []
  const dispose = () => { if (disposed) return; disposed = true; disposers.splice(0).reverse().forEach(fn => fn()) }
  scope.cleanup(dispose)
  return { active: () => !disposed && scope.isActive() && !scope.signal.aborted, dispose,
    own: (fn: () => void) => { disposers.push(fn) },
    listen(target: EventTarget, event: string, fn: EventListener) {
      target.addEventListener(event, fn); disposers.push(() => target.removeEventListener(event, fn))
    } }
}
