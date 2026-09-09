/** Admission borrows the actual mounted handle; no second instance or lifecycle. */
interface ComponentUpdateHandle {
  readonly ok: boolean
  updateProps(props: Record<string, unknown>): void
  resize(width: number, height: number): void
  waitForReady(): Promise<void>
  suspend(): void | Promise<void>
  resume(): void | Promise<void>
}

interface DynamicUpdateProbeOptions { resize?: boolean }
const updates = new WeakMap<Element, (options?: DynamicUpdateProbeOptions) => Promise<void>>()
interface DynamicLifecycleProbe { suspend(): void | Promise<void>; resume(): void | Promise<void> }
const lifecycles = new WeakMap<Element, DynamicLifecycleProbe>()

export function registerPublishedDynamicUpdateProbe(owner: Element, probe: (options?: DynamicUpdateProbeOptions) => Promise<void>, lifecycle?: DynamicLifecycleProbe): () => void {
  updates.set(owner, probe)
  if (lifecycle) lifecycles.set(owner, lifecycle)
  return () => { if (updates.get(owner) === probe) { updates.delete(owner); lifecycles.delete(owner) } }
}

export function registerPublishedComponentUpdateProbe(owner: Element, handle: ComponentUpdateHandle,
  read: () => { props: Record<string, unknown>; width: number; height: number }): () => void {
  const probe = async (options?: DynamicUpdateProbeOptions) => {
    const { props, width, height } = read()
    handle.updateProps(structuredClone(props))
    await handle.waitForReady()
    // Exercise a changed size and restore the authored frame before capture.
    if (options?.resize !== false) {
      handle.resize(Math.max(1, width * 0.9), Math.max(1, height * 0.9))
      await handle.waitForReady()
      handle.resize(width, height)
      await handle.waitForReady()
    }
    if (!handle.ok) throw new Error('组件更新后进入静态后备')
  }
  return registerPublishedDynamicUpdateProbe(owner, probe, { suspend: () => handle.suspend(), resume: () => handle.resume() })
}

/** Lifecycle on an already mounted instance keeps its actual pixels visible. */
export async function exercisePublishedDynamicLifecycle(mount: HTMLElement, action: 'suspend' | 'resume'): Promise<void> {
  const lifecycle = mount.parentElement && lifecycles.get(mount.parentElement)
  if (!lifecycle) throw new Error('动态候选缺少真实实例生命周期入口')
  if (action !== 'suspend' && action !== 'resume') throw new Error('未开放的动态生命周期动作')
  await lifecycle[action]()
}

export async function exercisePublishedDynamicUpdates(mount: HTMLElement, options?: DynamicUpdateProbeOptions): Promise<void> {
  const owner = mount.parentElement
  const probe = owner && updates.get(owner)
  if (!probe) throw new Error('动态候选缺少真实宿主更新入口')
  await probe(options)
}
