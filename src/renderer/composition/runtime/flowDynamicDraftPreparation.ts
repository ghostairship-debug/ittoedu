export interface FlowDynamicDraftPort {
  readonly documentId: string
  readonly owner: string
  prepare(): Promise<void>
}

const ports = new Map<string, { token: symbol; port: FlowDynamicDraftPort }>()

export function registerFlowDynamicDraft(port: FlowDynamicDraftPort): () => void {
  const key = JSON.stringify([port.documentId, port.owner])
  const token = Symbol()
  ports.set(key, { token, port })
  return () => {
    if (ports.get(key)?.token === token) ports.delete(key)
  }
}

export async function prepareFlowDynamicDrafts(documentId: string): Promise<void> {
  await Promise.all([...ports.values()].filter(({ port }) => port.documentId === documentId)
    .map(({ port }) => port.prepare()))
}
