// @vitest-environment node
import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { ModelChatMessage } from '../../src/shared/workbench/modelProvider'
import { contextMessageId, contextSourceIndex, projectExecutionContext } from '../../src/main/workbench/execution/ExecutionContextProjection'
import { contextReadSchema, readContextMessage } from '../../src/main/workbench/execution/ContextReadTool'
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
  expect(JSON.stringify(view.messages[1])).toContain('archivedArguments')
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
