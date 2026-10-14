// @vitest-environment node
import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { ModelChatMessage } from '../../src/shared/workbench/modelProvider'
import { contextMessageId, contextSourceIndex, projectExecutionContext } from '../../src/main/workbench/execution/ExecutionContextProjection'
import { contextReadSchema, readContextMessage } from '../../src/main/workbench/execution/ContextReadTool'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
const pixels = (id: number) => `data:image/png;base64,${Buffer.from(`purpose-created-image-${id}`).toString('base64')}`
const picture = (id: number): ModelChatMessage => ({ role: 'user', content: [{ type: 'text', text: `capture ${id}` }, { type: 'image_url', image_url: { url: pixels(id) } }] })
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

it('M26 old images leave only the working view while originals, first input and latest two captures remain exact', () => {
  const messages: ModelChatMessage[] = [{ role: 'system', content: 'frozen scope' }, picture(0), picture(1), picture(2), picture(3), picture(4)]
  const original = hash(messages), result = projectExecutionContext('run-one', messages, 2)
  expect(hash(messages)).toBe(original)
  expect(result.messages.slice(0, 2)).toEqual(messages.slice(0, 2))
  expect(result.messages.slice(-2)).toEqual(messages.slice(-2))
  expect(JSON.stringify(result.messages[2])).not.toContain(pixels(1))
  expect(JSON.stringify(result.messages[2])).toContain(contextMessageId('run-one', 2))
  expect(result.imagesArchived).toBe(2)
  expect(result.encodedImageBytesRemoved).toBe(Buffer.byteLength(pixels(1)) + Buffer.byteLength(pixels(2)))
  const fetched = readContextMessage(messages[2]!, contextReadSchema.parse({ sourceId: contextMessageId('run-one', 2), imageIndexes: [0] }))
  expect(fetched.data).toMatchObject({ imagesPrepared: 1, images: [{ index: 0, available: true }] })
  expect(fetched.modelMessage?.content).toEqual(expect.arrayContaining([{ type: 'image_url', image_url: { url: pixels(1) } }]))
})


it('M26 large calls and replies stay paired after projection and remain losslessly readable from original message indexes', () => {
  const messages: ModelChatMessage[] = [{ role: 'system', content: 'permission is unchanged' }]
  for (let i = 0; i < 3; i++) messages.push({ role: 'assistant', tool_calls: [{ id: `call-${i}`, type: 'function', function: { name: 'file.read', arguments: JSON.stringify({ data: `${i}`.repeat(9000) }) } }] },
    { role: 'tool', tool_call_id: `call-${i}`, content: JSON.stringify({ kind: 'read', text: '中文'.repeat(9000) }) })
  const original = hash(messages), view = projectExecutionContext('r', messages, 1)
  expect(hash(messages)).toBe(original)
  expect(view.messages.map(message => message.role)).toEqual(messages.map(message => message.role))
  expect(view.messages.filter(message => message.role === 'tool').map(message => message.tool_call_id)).toEqual(['call-0', 'call-1', 'call-2'])
  expect(view.messages[1]!.tool_calls).toEqual(messages[1]!.tool_calls)
  expect(JSON.stringify(view.messages[1])).not.toContain('archivedArguments')
  expect(view.messages.slice(-4)).toEqual(messages.slice(-4))
  expect(view.toolBytesRemoved).toBeGreaterThan(20000)
  const first = readContextMessage(messages[2]!, contextReadSchema.parse({ sourceId: 'run:r:2', maxChars: 6000 }))
  const next = readContextMessage(messages[2]!, contextReadSchema.parse({ sourceId: 'run:r:2', offset: first.data.nextOffset, maxChars: 12000 }))
  expect(first.data.text + next.data.text).toBe((messages[2]!.content as string).slice(0, 18000))
  expect(contextSourceIndex('run:r:2')).toEqual({ runId: 'r', index: 2 })
  expect(() => readContextMessage(messages[0]!, contextReadSchema.parse({ sourceId: 'run:r:0' }))).toThrow('公开运行结果')
  expect(() => readContextMessage(picture(1), contextReadSchema.parse({ sourceId: 'run:r:1', imageIndexes: [1] }))).toThrow('图片索引')
  const remote: ModelChatMessage = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.invalid/image.png' } }] }
  expect(() => readContextMessage(remote, contextReadSchema.parse({ sourceId: 'run:r:1', imageIndexes: [0] }))).toThrow('未尝试访问外部地址')
})

it('M27 pages archived text without splitting a UTF-16 surrogate pair', () => {
  const message: ModelChatMessage = { role: 'user', content: 'A😀B' }
  const first = readContextMessage(message, contextReadSchema.parse({ sourceId: 'run:r:1', maxChars: 2 }))
  expect(first.data).toMatchObject({ text: 'A', nextOffset: 1, truncated: true })
  const second = readContextMessage(message, contextReadSchema.parse({ sourceId: 'run:r:1', offset: first.data.nextOffset, maxChars: 2 }))
  expect(second.data).toMatchObject({ text: '😀', nextOffset: 3, truncated: true })
  expect(() => readContextMessage(message, contextReadSchema.parse({ sourceId: 'run:r:1', offset: 2 }))).toThrow('切断了一个字符')
  const third = readContextMessage(message, contextReadSchema.parse({ sourceId: 'run:r:1', offset: second.data.nextOffset }))
  expect(first.data.text + second.data.text + third.data.text).toBe('A😀B')
})

it('retains unknown apply, save and export facts from both current and stored opaque native names', () => {
  const apply = { commit: 'unknown', usability: 'unverified', delivery: 'not_requested', insertedIds: [],
    diagnostics: [{ level: 'error', message: 'Outcome unknown; do not replay' }] }
  const saved = { status: 'saved', documentId: 'doc', epoch: 'epoch', path: 'lesson.glx', savedRevision: 4, currentRevision: 5, dirty: true }
  const exported = { status: 'written', documentId: 'doc', epoch: 'epoch', format: 'html-offline', exportedRevision: 4, currentRevision: 5 }
  for (const [name, data, fact] of [
    ['project.apply', apply, { commit: 'unknown', usability: 'unverified', diagnostics: apply.diagnostics }],
    ['file.save', saved, { save: saved }], ['project.save', saved, { save: saved }],
    ['document.export', exported, { export: exported }], ['task.delivery', saved, { save: saved }],
  ] as const) {
    for (const wire of [modelToolWireName(name), `tool_${createHash('sha256').update(name).digest('hex').slice(0, 48)}`]) {
      const messages: ModelChatMessage[] = [
        { role: 'assistant', tool_calls: [{ id: 'call', type: 'function', function: { name: wire, arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call', content: JSON.stringify({ kind: 'read', data, padding: 'x'.repeat(9000) }) },
      ]
      const view = projectExecutionContext('r', messages, 0, 0)
      expect(view.messages[0]).toEqual(messages[0])
      expect(JSON.parse(view.messages[1]!.content as string).receipt).toMatchObject(fact)
    }
  }
  const ordinaryRead: ModelChatMessage[] = [
    { role: 'assistant', tool_calls: [{ id: 'read', type: 'function', function: { name: 'file.read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'read', content: JSON.stringify({ kind: 'read', data: apply, padding: 'x'.repeat(9000) }) },
  ]
  expect(JSON.parse(projectExecutionContext('r', ordinaryRead, 0, 0).messages[1]!.content as string).receipt).not.toHaveProperty('commit')
})

it('sends a newly requested six-image batch once, then retains individual recent pictures rather than two whole batches', () => {
  const first: ModelChatMessage = { role: 'system', content: 'scope' }
  const batch: ModelChatMessage = { role: 'user', content: Array.from({ length: 6 }, (_, i) => ({ type: 'image_url', image_url: { url: pixels(i) } })) }
  const request: ModelChatMessage = { role: 'assistant', content: null, tool_calls: [{ id: 'observe', type: 'function', function: { name: 'view.observe', arguments: '{}' } }] }
  const result: ModelChatMessage = { role: 'tool', tool_call_id: 'observe', content: '{}' }
  const pending = [first, request, result, batch], original = hash(pending)
  expect(projectExecutionContext('r', pending, 1).messages.at(-1)).toEqual(batch)
  const later = [...pending, { role: 'assistant', content: 'observed' } as ModelChatMessage]
  const projected = projectExecutionContext('r', later, 1)
  const parts = projected.messages[3]!.content as { type: string }[]
  expect(parts.filter(part => part.type === 'image_url')).toHaveLength(2)
  expect(projected.imagesArchived).toBe(4)
  expect(JSON.stringify(parts[0])).toContain('imageIndexes=[0]')
  expect(hash(pending)).toBe(original)
  const reread = readContextMessage(batch, contextReadSchema.parse({ sourceId: 'run:r:3', imageIndexes: [0, 1, 2, 3, 4, 5] }))
  expect(reread.data.imagesPrepared).toBe(6)
})


it('sends every explicit initial image on the first model turn and archives older initial pixels only after acknowledgement', () => {
  const initial: ModelChatMessage[] = [{ role: 'system', content: 'fixed scope' }, { role: 'user', content:
    Array.from({ length: 6 }, (_, i) => ({ type: 'image_url', image_url: { url: pixels(i) } })) }]
  expect(projectExecutionContext('initial', initial, 2).messages).toEqual(initial)
  const messages = [...initial, { role: 'assistant', content: '已观察六张图' } as ModelChatMessage]
  const before = hash(messages), next = projectExecutionContext('initial', messages, 2)
  expect(next.imagesArchived).toBe(4)
  expect(JSON.stringify(next.messages)).not.toContain(pixels(0))
  expect(hash(messages)).toBe(before)
  const reread = readContextMessage(initial[1]!, contextReadSchema.parse({ sourceId: 'run:initial:1', imageIndexes: [0, 1] }))
  expect(reread.data.imagesPrepared).toBe(2)
})

it('archives only superseded HTML snapshots while current native rounds, latest handles, failures and original sources stay complete', () => {
  const identity = { runId: 'r', documentId: 'html-doc', epoch: 'epoch', revision: 2,
    bindingVersion: 1, leaseId: 'lease', loadId: 'load', url: 'courseware-preview://lesson/module.html' }
  const observation = (generation: number) => ({ kind: 'read', data: { identity, generation, source: 'isolated-html-preview',
    currentUrl: identity.url, title: '调度台', readyState: 'complete', pageIndex: 0, pageCount: 1,
    structure: ['页面说明'.repeat(1400)], elements: [{ handle: `element-${generation}`, text: '采用方案' }],
    diagnostics: ['本模型是简化模拟'], errors: [{ level: 'warning', message: '保留原警告' }],
    image: { resourceId: `image-${generation}`, width: 800, height: 600 }, action: { applied: true } } })
  const round = (id: string, name: string, result: unknown): ModelChatMessage[] => {
    const wire = modelToolWireName(name), argumentsText = JSON.stringify({ handle: 'actual-input' })
    return [{ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: wire, arguments: argumentsText } }],
      nativeResponses: { protocol: 'chatgpt-responses', responseId: `response-${id}`, output: [
        { type: 'reasoning', id: `reason-${id}`, encrypted_content: `opaque-${id}` },
        { type: 'function_call', call_id: id, name: wire, arguments: argumentsText },
      ] } }, { role: 'tool', tool_call_id: id, content: JSON.stringify(result) }]
  }
  const failed = { kind: 'error', code: 'html-action-outcome-unknown', message: '已发出动作，不能重放' + 'x'.repeat(9000) }
  const unknown = { ...observation(50), data: { ...observation(50).data, status: 'unknown' } }
  const messages: ModelChatMessage[] = [{ role: 'user', content: '保持授权与当前目标' },
    ...round('old', 'html.click', observation(1)), picture(1),
    ...round('failed', 'html.click', failed),
    ...round('unknown', 'html.observe', unknown),
    ...round('other-binding', 'html.observe', { ...observation(1), data: { ...observation(1).data, identity: { ...identity, loadId: 'other-load' } } }),
    ...round('latest', 'html.observe', observation(2)), picture(2),
    ...round('current-1', 'file.read', { kind: 'read', data: { text: '当前链必须保持完整'.repeat(1800) } }),
    ...round('current-2', 'file.read', { kind: 'read', data: { text: 'x'.repeat(9000) } }),
    ...round('current-3', 'file.read', { kind: 'read', data: { text: 'y'.repeat(9000) } })]
  const before = structuredClone(messages)
  // Bounded retainToolTurns=0 must still leave the last user/producing round intact.
  const view = projectExecutionContext('r', messages, 1, 0, 300)
  const old = JSON.parse(view.messages[2]!.content as string)
  expect(old).toMatchObject({ archivedContext: 'run:r:2', tool: 'html.click', receipt: { kind: 'read', data: {
    identity, generation: 1, currentUrl: identity.url, title: '调度台', readyState: 'complete', pageIndex: 0, pageCount: 1,
    diagnostics: observation(1).data.diagnostics, errors: observation(1).data.errors, image: observation(1).data.image, action: { applied: true } } } })
  expect(old.receipt.data).not.toHaveProperty('structure')
  expect(old.receipt.data).not.toHaveProperty('elements')
  expect((view.messages[2]!.content as string).length).toBeLessThan(1500)
  expect(view.messages.slice(4, 10)).toEqual(messages.slice(4, 10))
  expect(view.messages.slice(10)).toEqual(messages.slice(10))
  expect(view.messages.map(message => [message.role, message.tool_call_id, message.tool_calls, message.nativeResponses]))
    .toEqual(messages.map(message => [message.role, message.tool_call_id, message.tool_calls, message.nativeResponses]))
  expect(messages).toEqual(before)
  const reread = readContextMessage(messages[2]!, contextReadSchema.parse({ sourceId: old.archivedContext, maxChars: 12000 }))
  expect(reread.data.text).toBe(messages[2]!.content)
})
