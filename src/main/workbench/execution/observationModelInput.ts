import type { ModelChatMessage } from '../../../shared/workbench/modelProvider'
import type { ObservationResult } from '../../../shared/workbench/toolPorts'
import { createHash } from 'node:crypto'
import { modelToolWireName } from '../providers/OpenAIChatProvider'

export interface ObservationModelInput {
  toolCallId: string
  toolName?: string
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
    { type: 'text', text: `工具 ${input.toolName ?? 'view.observe'} 的真实画面。toolCallId=${input.toolCallId}; target=${input.target}; documentId=${identity.documentId}; epoch=${identity.epoch}; revision=${identity.revision}; locationId=${identity.locationId}; viewGeneration=${identity.viewGeneration ?? ''}; generation=${observation.generation ?? ''}; resourceId=${observation.image.resourceId}; source=${observation.source}。这是捕获时的画面；操作只使用最新观察回执的元素句柄。` },
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

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const observationTools = ['view.observe', 'view.click', 'view.input', 'html.observe', 'html.navigate', 'html.click', 'html.input']
const observationWireNames = new Set(observationTools.flatMap(name => [name, modelToolWireName(name),
  `tool_${createHash('sha256').update(name).digest('hex').slice(0, 48)}`]))
interface WorkingObservation {
  index: number
  callId: string
  result: Record<string, unknown>
  data: Record<string, unknown>
  identity: Record<string, unknown>
  resourceId: string
}

/** Retire only host observations with a confirmed successor. Originals, source
 * indexes, native assistant records and the unconsumed tool round stay intact. */
export function retireSupersededObservationMessages(runId: string, messages: readonly ModelChatMessage[],
  protectedStart = messages.length): ModelChatMessage[] {
  const calls = new Map<string, string>(), observations = new Map<number, WorkingObservation>(), byCall = new Map<string, WorkingObservation>()
  messages.forEach((message, index) => {
    for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      if (record(call) && typeof call.id === 'string' && record(call.function) && typeof call.function.name === 'string')
        calls.set(call.id, call.function.name)
    }
    if (message.role !== 'tool' || typeof message.tool_call_id !== 'string'
      || !observationWireNames.has(calls.get(message.tool_call_id) ?? '') || typeof message.content !== 'string') return
    try {
      const result: unknown = JSON.parse(message.content)
      if (!record(result) || result.kind !== 'read' || result.status !== undefined || !record(result.data)) return
      const data = result.data, identity = data.identity, image = data.image
      if (data.status !== undefined || !record(identity) || typeof identity.documentId !== 'string' || typeof identity.epoch !== 'string'
        || !Number.isSafeInteger(identity.revision) || !Array.isArray(data.structure) || !Array.isArray(data.diagnostics)
        || !record(image) || image.mimeType !== 'image/png' || typeof image.resourceId !== 'string'
        || !['live', 'isolated-published', 'live-html-preview', 'isolated-html-preview'].includes(String(data.source))) return
      const observation = { index, callId: message.tool_call_id, result, data, identity, resourceId: image.resourceId }
      observations.set(index, observation); byCall.set(observation.callId, observation)
    } catch { /* An error, unknown receipt or ordinary authored read cannot retire evidence. */ }
  })
  const ordered = [...observations.values()]
  const sameCapture = (a: WorkingObservation, b: WorkingObservation): boolean => a.identity.documentId === b.identity.documentId
    && a.identity.epoch === b.identity.epoch && a.identity.revision === b.identity.revision
    && a.identity.loadId === b.identity.loadId && a.identity.viewGeneration === b.identity.viewGeneration
    && a.data.generation === b.data.generation && a.resourceId === b.resourceId
  const successor = (previous: WorkingObservation | undefined, candidate: WorkingObservation): WorkingObservation => {
    if (!previous || previous.identity.documentId !== candidate.identity.documentId
      || previous.identity.epoch !== candidate.identity.epoch) return candidate
    if (Number(candidate.identity.revision) < Number(previous.identity.revision)) return previous
    if (candidate.identity.revision === previous.identity.revision
      && candidate.identity.loadId === previous.identity.loadId
      && candidate.identity.viewGeneration === previous.identity.viewGeneration
      && Number.isSafeInteger(candidate.data.generation) && Number.isSafeInteger(previous.data.generation)
      && Number(candidate.data.generation) <= Number(previous.data.generation)) return previous
    return candidate
  }
  // An idempotent read of an old action receipt is not a new capture. Its later
  // arrival must never make a spent generation actionable again.
  const latest = ordered.reduce<WorkingObservation | undefined>(successor, undefined)
  if (!latest) return [...messages]
  const latestForDocument = new Map<string, WorkingObservation>()
  for (const observation of ordered) {
    const documentId = String(observation.identity.documentId)
    latestForDocument.set(documentId, successor(latestForDocument.get(documentId), observation))
  }
  const sourceId = (index: number) => `run:${runId}:${index}`
  return messages.map((message, index) => {
    if (index >= protectedStart) return message
    const observation = observations.get(index)
    if (observation && !sameCapture(observation, latest)) {
      const successor = latestForDocument.get(String(observation.identity.documentId))!
      const retiredRevision = observation !== successor && (observation.identity.epoch !== successor.identity.epoch
        || observation.identity.revision !== successor.identity.revision)
      const { elements, structure, elementsPage: _page, ...facts } = observation.data
      // Unique earlier feedback is still task evidence, but its old geometry and
      // handles cannot describe the current actionable page.
      const samePage = observation !== successor && observation.identity.documentId === successor.identity.documentId
        && observation.identity.locationId === successor.identity.locationId
        && observation.data.pageIndex === successor.data.pageIndex
      const textKey = (value: unknown) => record(value) ? JSON.stringify([value.tag, value.role, value.label, value.text, value.value]) : ''
      const currentElements = new Set((Array.isArray(successor.data.elements) ? successor.data.elements : []).map(textKey))
      const historicalElements = !retiredRevision && Array.isArray(elements) ? elements.flatMap(element => {
        if (!record(element) || samePage && currentElements.has(textKey(element))) return []
        const { tag, role, label, text, value } = element
        return [{ tag, role, label, text, ...(value === undefined ? {} : { value }) }]
      }) : []
      const historicalText = !retiredRevision && Array.isArray(structure) ? structure.filter(text =>
        !samePage || !Array.isArray(successor.data.structure) || !successor.data.structure.includes(text)) : []
      return { ...message, content: JSON.stringify({ ...observation.result, data: { ...facts,
        observationStatus: 'historical', archivedContext: sourceId(index),
        ...(historicalText.length ? { historicalText } : {}), ...(historicalElements.length ? { historicalElements } : {}),
        supersededBy: { toolCallId: latest.callId, identity: latest.identity, generation: latest.data.generation },
        notice: '历史观察的结构和元素句柄已退役；保留的文字仅为当时独有反馈。完整原回执可用 context.read 按 archivedContext 回读，当前操作使用最新观察。' } }) }
    }
    if (message.role !== 'user' || !Array.isArray(message.content)) return message
    let changed = false, active: WorkingObservation | undefined, imageIndex = -1
    const content = message.content.map(part => {
      if (record(part) && part.type === 'text' && typeof part.text === 'string') {
        active = undefined
        // Match only our own capture introduction, never a context.read wrapper
        // that the model explicitly requested as historical comparison material.
        if (/^工具 (?:view|html)\.(?:observe|navigate|click|input) (?:的真实画面|后的真实画面)/.test(part.text)) {
          const callId = /toolCallId=([^;\n]+)/.exec(part.text)?.[1]
          active = callId ? byCall.get(callId) : undefined
          if (active && !sameCapture(active, latest)) {
            changed = true
            return { type: 'text', text: `历史观察：documentId=${active.identity.documentId}; epoch=${active.identity.epoch}; revision=${active.identity.revision}; resourceId=${active.resourceId}。该画面与元素句柄不代表当前可操作页；完整回执来源=${sourceId(active.index)}，原图来源=${sourceId(index)}。当前操作使用最新观察。` }
          }
        }
      } else if (record(part) && part.type === 'image_url') {
        imageIndex++
        if (active && !sameCapture(active, latest)) {
          changed = true
          return { type: 'text', text: `原图由观察资源 owner 保留；需要比较时用 context.read 的 sourceId=${sourceId(index)}, imageIndexes=[${imageIndex}] 取回捕获时原图。` }
        }
      }
      return part
    })
    return changed ? { ...message, content } : message
  })
}
