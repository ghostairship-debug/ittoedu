// @vitest-environment node
import { expect, it } from 'vitest'
import { observationModelMessage, retireSupersededObservationMessages } from '../../src/main/workbench/execution/observationModelInput'
import { contextReadSchema, readContextMessage } from '../../src/main/workbench/execution/ContextReadTool'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ObservationResult } from '../../src/shared/workbench/toolPorts'
import type { ModelChatMessage } from '../../src/shared/workbench/modelProvider'

const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
const capture = (revision: number, generation: number, text: string): ObservationResult => ({ source: 'isolated-published',
  identity: { documentId: 'document', epoch: 'epoch', revision, locationId: 'page', viewGeneration: `host-${revision}` },
  coverage: { width: 1, height: 1 }, generation, structure: [text], diagnostics: ['保留简化模型说明'],
  elements: [{ handle: `handle-${revision}-${generation}`, tag: 'button', role: '', label: '继续', text: '继续', editable: false,
    rect: { x: 0, y: 0, width: 1, height: 1 } }],
  image: { resourceId: `image-${revision}-${generation}`, mimeType: 'image/png', width: 1, height: 1, byteLength: bytes.byteLength } })
function round(callId: string, observation: ObservationResult): ModelChatMessage[] {
  const name = modelToolWireName('view.observe')
  return [{ role: 'assistant', content: null, tool_calls: [{ id: callId, type: 'function', function: { name, arguments: '{}' } }],
    nativeResponses: { output: [{ type: 'reasoning', encrypted_content: `signature-${callId}` }] } },
  { role: 'tool', tool_call_id: callId, content: JSON.stringify({ kind: 'read', data: observation }) },
  observationModelMessage({ toolCallId: callId, target: 'target', observation, bytes })]
}

it('retires revision and generation authority while current controls, unique feedback, original pixels and native records remain readable', () => {
  const old = capture(1, 1, '预测结果：第一次失败'), current = capture(1, 2, '当前结果：42')
  const messages = [...round('old', old), ...round('current', current)]
  const original = structuredClone(messages)
  const projected = retireSupersededObservationMessages('run', messages, 3)
  const history = JSON.parse(String(projected[1]!.content)).data
  expect(history).toMatchObject({ observationStatus: 'historical', archivedContext: 'run:run:1', historicalText: ['预测结果：第一次失败'] })
  expect(JSON.stringify(projected.slice(0, 3))).not.toContain('handle-1-1')
  expect(JSON.stringify(projected[2])).not.toContain('data:image/png;base64')
  expect(JSON.stringify(projected[2])).toContain('sourceId=run:run:2, imageIndexes=[0]')
  expect(projected.slice(3)).toEqual(messages.slice(3))
  expect(projected[0]).toBe(messages[0])
  expect(messages).toEqual(original)
  const image = readContextMessage(messages[2]!, contextReadSchema.parse({ sourceId: 'run:run:2', imageIndexes: [0] }))
  expect(image.modelMessage?.content).toEqual(expect.arrayContaining([{ type: 'image_url', image_url: {
    url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, detail: 'auto' } }]))
  expect(readContextMessage(messages[1]!, contextReadSchema.parse({ sourceId: 'run:run:1' })).data.text).toContain('handle-1-1')

  const replayed = retireSupersededObservationMessages('run', [...messages, ...round('replayed-old-operation', old)])
  expect(JSON.parse(String(replayed[7]!.content)).data).toMatchObject({ observationStatus: 'historical',
    supersededBy: { toolCallId: 'current', generation: 2 } })
  expect(replayed[4]).toBe(messages[4])
  expect(JSON.stringify(replayed.slice(6))).not.toContain('handle-1-1')

  const secondPage = { ...current, elements: [{ ...current.elements![0]!, handle: 'same-capture-page-2', label: '第2页控件' }] }
  const pages = [...round('page-1', current), ...round('page-2', secondPage)]
  expect(retireSupersededObservationMessages('run', pages)).toEqual(pages)

  const latest = [...messages, ...round('new-revision', capture(2, 1, '修订后：准备继续'))]
  const revisionView = retireSupersededObservationMessages('run', latest, 6)
  expect(revisionView.slice(0, 3)).toEqual(projected.slice(0, 3)) // A third observation does not rewrite the already retired prefix.
  const retired = JSON.parse(String(revisionView[4]!.content)).data
  expect(retired).not.toHaveProperty('structure')
  expect(retired).not.toHaveProperty('elements')
  expect(retired).not.toHaveProperty('historicalText')
  expect(retired.diagnostics).toEqual(current.diagnostics)
  expect(revisionView.slice(6)).toEqual(latest.slice(6))
})

it('does not use failed, unknown or ordinary authored reads as a successor or rewrite explicitly reread historical images', () => {
  const first = round('first', capture(1, 1, '结果待确认'))
  const ordinary = round('ordinary', capture(2, 1, '普通文件内容'))
  ordinary[0] = { role: 'assistant', tool_calls: [{ id: 'ordinary', type: 'function', function: { name: 'file.read', arguments: '{}' } }] }
  const unknown = round('unknown', capture(2, 2, '未知动作'))
  unknown[1] = { role: 'tool', tool_call_id: 'unknown', content: JSON.stringify({ kind: 'read', data: { ...capture(2, 2, '未知动作'), status: 'unknown' } }) }
  const messages = [...first, ...ordinary.slice(0, 2), ...unknown.slice(0, 2)]
  expect(retireSupersededObservationMessages('run', messages)).toEqual(messages)
  const historical = readContextMessage(first[2]!, contextReadSchema.parse({ sourceId: 'run:run:2', imageIndexes: [0] })).modelMessage!
  const later = [...first, ...round('later', capture(2, 1, '当前结果')), historical]
  expect(retireSupersededObservationMessages('run', later).at(-1)).toBe(historical)
})
