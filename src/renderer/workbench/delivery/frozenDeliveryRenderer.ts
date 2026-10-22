import type { FrozenDeliveryBuildInput } from '../../../shared/workbench/frozenDelivery'

/** The App drains first; Main resolves this exact revision in the isolated producer. */
export async function buildFrozenDelivery(input: FrozenDeliveryBuildInput, signal?: AbortSignal) {
  const api = window.desktopAPI
  if (!api?.buildFrozenDelivery || !api.cancelFrozenDelivery) throw new Error('隔离导出服务尚未连接')
  signal?.throwIfAborted()
  const cancel = () => { void api.cancelFrozenDelivery!({ requestId: input.requestId }).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const result = await api.buildFrozenDelivery(input)
    signal?.throwIfAborted()
    return result
  } finally { signal?.removeEventListener('abort', cancel) }
}
