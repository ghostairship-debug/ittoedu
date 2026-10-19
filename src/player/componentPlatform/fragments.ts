/** Runtime state only; the source HTML and its fragment classes remain author data. */
export const componentFragmentStateKey = (instanceId: string): string => `__component.fragment.${instanceId}`

/** One DOM projection for native Web realms and compiled local documents. */
export function createComponentFragmentProjection(root: HTMLElement, progress: () => unknown, flowContent: () => boolean) {
  const hiddenStyles = new WeakMap<HTMLElement, { property: 'display' | 'visibility'; value: string; priority: string }>()
  const restore = (element: HTMLElement) => {
    const previous = hiddenStyles.get(element)
    if (!previous) return
    if (previous.value) element.style.setProperty(previous.property, previous.value, previous.priority)
    else element.style.removeProperty(previous.property)
    hiddenStyles.delete(element)
  }
  const apply = () => {
    const value = progress(), fragments = [...root.querySelectorAll<HTMLElement>('.fragment')]
    const count = typeof value === 'number' ? value : fragments.length
    fragments.forEach((element, index) => {
      const property = flowContent() ? 'display' : 'visibility', hidden = property === 'display' ? 'none' : 'hidden'
      const previous = hiddenStyles.get(element)
      if (previous && previous.property !== property) restore(element)
      if (index < count) restore(element)
      else if (element.style.getPropertyValue(property) !== hidden || element.style.getPropertyPriority(property) !== 'important') {
        hiddenStyles.set(element, { property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) })
        element.style.setProperty(property, hidden, 'important')
      }
    })
  }
  const Observer = root.ownerDocument.defaultView?.MutationObserver
  const observer = Observer && new Observer(apply)
  observer?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  apply()
  return { apply, dispose() { observer?.disconnect(); root.querySelectorAll<HTMLElement>('.fragment').forEach(restore) } }
}
