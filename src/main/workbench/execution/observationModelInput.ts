import type { ModelChatMessage } from '../../../shared/workbench/modelProvider'
import type { ObservationResult } from '../../../shared/workbench/toolPorts'

export interface ObservationModelInput {
  toolCallId: string
  target: string
  observation: ObservationResult
  bytes: Uint8Array
  detail?: 'auto' | 'low' | 'high'
}

/** Caller appends these only after every tool receipt of the same assistant turn. */
export function observationModelMessage(input: ObservationModelInput): ModelChatMessage {
  const { observation, bytes } = input
  if (observation.image.mimeType !== 'image/png' || bytes.byteLength !== observation.image.byteLength
    || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error('观察图像资源与回执不符')
  const identity = observation.identity
  return { role: 'user', content: [
    { type: 'text', text: `工具 view.observe 的真实画面。toolCallId=${input.toolCallId}; target=${input.target}; documentId=${identity.documentId}; epoch=${identity.epoch}; revision=${identity.revision}; locationId=${identity.locationId}; source=${observation.source}。请只据此版本的画面判断。` },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, detail: input.detail ?? 'auto' } },
  ] }
}

export function appendObservationModelMessages(messages: ModelChatMessage[], observations: readonly ObservationModelInput[]): void {
  if (!observations.length) return
  const content = observations.flatMap(observation => {
    const message = observationModelMessage(observation)
    return message.role === 'user' && Array.isArray(message.content) ? message.content : []
  })
  messages.push({ role: 'user', content })
}
