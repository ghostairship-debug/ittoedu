/** Shared native-input event semantics, including IME and Escape draft handling. */
export function bindPublishedNativeInputSubmit(
  root: HTMLElement,
  nodeId: string,
  available: () => boolean,
  listener: (rawValue: string) => void,
): () => void {
  const composing = new WeakSet<Element>()
  const resolve = (event: Event): HTMLInputElement | null => {
    const target = event.target as HTMLElement | null
    const input = target?.tagName === 'INPUT' ? target as HTMLInputElement
      : target?.closest('form')?.querySelector<HTMLInputElement>('input[data-input-node-id]')
    return input?.dataset.inputNodeId === nodeId && root.contains(input) ? input : null
  }
  const start = (event: Event) => { const input = resolve(event); if (input) composing.add(input) }
  const end = (event: Event) => { const input = resolve(event); if (input) composing.delete(input) }
  const key = (event: KeyboardEvent) => {
    const input = resolve(event)
    if (!input) return
    event.stopPropagation()
    if (event.key === 'Enter' && (event.isComposing || composing.has(input) || event.keyCode === 229)) event.preventDefault()
    if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); input.value = input.defaultValue }
  }
  const pointer = (event: Event) => { if (resolve(event)) event.stopPropagation() }
  const submit = (event: Event) => {
    const input = resolve(event)
    if (!input) return
    event.preventDefault()
    event.stopPropagation()
    if (!available() || composing.has(input)) return
    const raw = input.value
    input.defaultValue = raw
    listener(raw)
  }
  root.addEventListener('compositionstart', start)
  root.addEventListener('compositionend', end)
  root.addEventListener('keydown', key)
  root.addEventListener('pointerdown', pointer)
  root.addEventListener('click', pointer)
  root.addEventListener('submit', submit)
  return () => {
    root.removeEventListener('compositionstart', start)
    root.removeEventListener('compositionend', end)
    root.removeEventListener('keydown', key)
    root.removeEventListener('pointerdown', pointer)
    root.removeEventListener('click', pointer)
    root.removeEventListener('submit', submit)
  }
}
