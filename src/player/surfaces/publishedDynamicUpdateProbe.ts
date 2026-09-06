/** Admission borrows the actual mounted handle; no second instance or lifecycle. */
interface ComponentUpdateHandle {
  readonly ok: boolean
  updateProps(props: Record<string, unknown>): void
  resize(width: number, height: number): void
  waitForReady(): Promise<void>
}

const updates = new WeakMap<Element, () => Promise<void>>()

export function registerPublishedDynamicUpdateProbe(owner: Element, probe: () => Promise<void>): () => void {
  updates.set(owner, probe)
  return () => { if (updates.get(owner) === probe) updates.delete(owner) }
}

export function registerPublishedComponentUpdateProbe(owner: Element, handle: ComponentUpdateHandle,
  read: () => { props: Record<string, unknown>; width: number; height: number }): () => void {
  const probe = async () => {
    const { props, width, height } = read()
    handle.updateProps(structuredClone(props))
    await handle.waitForReady()
    // Exercise a changed size and restore the authored frame before capture.
    handle.resize(Math.max(1, width * 0.9), Math.max(1, height * 0.9))
    await handle.waitForReady()
    handle.resize(width, height)
    await handle.waitForReady()
    if (!handle.ok) throw new Error('组件更新后进入静态后备')
  }
  return registerPublishedDynamicUpdateProbe(owner, probe)
}

export async function exercisePublishedDynamicUpdates(mount: HTMLElement): Promise<void> {
  const owner = mount.parentElement
  const probe = owner && updates.get(owner)
  if (!probe) throw new Error('动态候选缺少真实宿主更新入口')
  await probe()
}
