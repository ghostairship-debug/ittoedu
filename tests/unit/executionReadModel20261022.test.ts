// @vitest-environment node
import { expect, it } from 'vitest'
import { appendExecutionContent, applyExecutionProjectionOwned, emptyExecutionProjection, foldExecutionEvents, prepareExecutionEvents,
  type ExecutionContent, type ExecutionEvent, type ExecutionItem, type ExecutionProjection } from '../../src/shared/workbench/executionEvents'
import { ExecutionTimelineReadModel, executionActivity, executionDocumentFacts, executionTimelineEntries } from '../../src/shared/workbench/executionTimelineReadModel'

const item = (index: number, type: ExecutionItem['type'] = 'tool'): ExecutionItem => ({ taskId: 'task', runId: 'run', itemId: `item-${index}`, source: 'builtin', type,
  time: index, firstTime: index, sequence: index + 1, data: { status: 'completed', ...(type === 'tool' ? { toolName: 'inspect' } : {}) }, content: [] })
const event = (projection: ExecutionProjection, index: number, data: ExecutionEvent['data'], update: ExecutionEvent['update'] = 'append'): ExecutionEvent => ({
  eventId: `event-${projection.cursor + 1}`, conversationId: projection.conversationId, taskId: 'task', runId: 'run', itemId: `item-${index}`,
  source: 'builtin', type: projection.items[index]?.type ?? 'tool', time: projection.cursor + 1, sequence: projection.cursor + 1, data, update,
})

it('stages complete changed items and publishes the owned array only after the caller accepts its durable append', () => {
  const projection: ExecutionProjection = { conversationId: 'conversation', cursor: 2, items: [item(0), item(1, 'text')] }
  const reader = new ExecutionTimelineReadModel(projection), array = projection.items, prior = projection.items[1]
  const plan = prepareExecutionEvents(projection, [event(projection, 1, { text: '新片段' })])
  expect(projection.cursor).toBe(2); expect(projection.items[1]).toBe(prior)
  expect(reader.entryPage().cursor).toBe(2)
  applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  expect(projection.items).toBe(array); expect(projection.cursor).toBe(3)
  expect(reader.entryPage().entries.at(-1)).toMatchObject({ kind: 'item', item: { body: { parts: [{ text: '新片段' }] } } })
  expect(() => applyExecutionProjectionOwned(projection, plan)).toThrow('当前代')
})

it('compacts adjacent inline runs geometrically while preserving blobs, snapshots and every UTF-16 code unit', () => {
  let content: ExecutionContent[] = [], text = ''
  for (let index = 0; index < 10000; index++) { const unit = index % 2 ? '\uDE00' : '\uD83D'; text += unit; content = appendExecutionContent(content, [{ kind: 'text', text: unit }]) }
  expect(content.map(part => part.kind === 'text' ? part.text : '').join('')).toBe(text)
  expect(content.length).toBeLessThanOrEqual(15)
  const blob = { kind: 'blob' as const, ref: { id: 'a'.repeat(64), bytes: 7, mime: 'text/plain;charset=utf-8' as const } }
  const before = content
  content = appendExecutionContent(content, [blob, { kind: 'text', text: '后' }, { kind: 'text', text: '续' }])
  expect(content.indexOf(blob)).toBe(before.length); expect(before).not.toContain(blob)
  let projection = emptyExecutionProjection('conversation')
  projection = foldExecutionEvents(projection, [{ ...event(projection, 0, { text: '旧' }), type: 'text' }])
  const replaced = foldExecutionEvents(projection, [{ ...event(projection, 0, { text: '最终😀' }, 'snapshot'), type: 'text' }])
  expect(replaced.items[0]!.content).toEqual([{ kind: 'text', text: '最终😀' }]); expect(projection.items[0]!.content).toEqual([{ kind: 'text', text: '旧' }])
})

it('does not reuse equal-cursor sibling generations and keeps the public pure fold immutable', () => {
  const base: ExecutionProjection = { conversationId: 'conversation', cursor: 2, items: [item(0), item(1)] }
  const a = foldExecutionEvents(base, [{ ...event(base, 2, { text: 'A' }), itemId: 'branch-a', type: 'text' }])
  const b = foldExecutionEvents(base, [{ ...event(base, 2, { text: 'B' }), itemId: 'branch-b', type: 'text' }])
  const reader = new ExecutionTimelineReadModel(a)
  const nextB = foldExecutionEvents(b, [event(b, 0, { label: 'B分支现值' })])
  reader.update(nextB)
  expect(reader.entryPage()).toEqual(new ExecutionTimelineReadModel(nextB).entryPage())
  expect(base.items).toHaveLength(2); expect(a.items.at(-1)!.itemId).toBe('branch-a')
  expect(reader.entryPage().entries.some(entry => entry.kind === 'item' && entry.item.itemId === 'branch-a')).toBe(false)
})

it('updates an existing item in a frozen 10000-item session without repeating full grouping/index scans', () => {
  const items = Array.from({ length: 10000 }, (_, index) => item(index, index === 9999 ? 'reasoning' : 'tool'))
  items[9999] = { ...items[9999]!, data: { status: 'running' }, content: [{ kind: 'text', text: '这是公开的长思考文字，继续核对当前方案。 '.repeat(8000) }] }
  const projection: ExecutionProjection = { conversationId: 'conversation', cursor: 10000, items }
  const reader = new ExecutionTimelineReadModel(projection)
  reader.entryPage(); prepareExecutionEvents(projection, [])
  const filter = Array.prototype.filter, sort = Array.prototype.sort
  let fullFilters = 0, fullSorts = 0
  Array.prototype.filter = function (this: unknown[], ...args: Parameters<typeof filter>) { if (this.length >= 1000) fullFilters++; return Reflect.apply(filter, this, args) } as typeof filter
  Array.prototype.sort = function (this: unknown[], ...args: Parameters<typeof sort>) { if (this.length >= 1000) fullSorts++; return Reflect.apply(sort, this, args) } as typeof sort
  try {
    for (let index = 0; index < 64; index++) {
      const plan = prepareExecutionEvents(projection, [event(projection, 9999, { text: '继续分析。 ', status: 'running' })])
      applyExecutionProjectionOwned(projection, plan); reader.apply(plan); reader.entryPage()
    }
  } finally { Array.prototype.filter = filter; Array.prototype.sort = sort }
  expect(fullFilters).toBe(0); expect(fullSorts).toBe(0)
  const page = reader.entryPage(), last = page.entries.at(-1)
  expect(last?.kind).toBe('item')
  if (last?.kind === 'item') {
    expect(last.item).not.toHaveProperty('content')
    expect(last.item.body.parts[0]).toMatchObject({ kind: 'text', text: expect.any(String), hasMore: true })
    expect(last.item.body.parts[0]!.kind === 'text' && last.item.body.parts[0]!.text.length).toBe(12000)
  }
})

it('keeps commit/save/end/parent facts and group file pages aligned with the complete projection', () => {
  const projection: ExecutionProjection = { conversationId: 'conversation', cursor: 3, items: [
    { ...item(0), itemId: 'parent', data: { label: '父项' } },
    { ...item(1), parentItemId: 'parent', data: { operationId: 'op', status: 'running', toolName: 'edit' } },
    { ...item(2, 'document.commit'), data: { operationId: 'op', documentId: 'doc', revision: 4, applicationStatus: 'applied' } },
  ] }
  const reader = new ExecutionTimelineReadModel(projection)
  const inputs = [
    { ...event(projection, 3, { documentId: 'doc', revision: 4, saveStatus: 'saved' }), type: 'document.save' as const },
    { ...event(projection, 4, { status: 'partial' }), sequence: 5, eventId: 'end', type: 'run.end' as const },
  ]
  const plan = prepareExecutionEvents(projection, inputs)
  applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  const page = reader.entryPage({ includeEndedRuns: true }), fact = page.itemFacts.find(value => value.itemId === 'item-1')!
  expect(fact).toMatchObject({ ...executionDocumentFacts(projection.items[1]!, projection), ended: true, endStatus: 'partial', parent: { label: '父项' } })
  expect(page.activity).toEqual(executionActivity(projection)); expect(page.endedRunIds).toEqual(['run'])
  expect(page.total).toBe(executionTimelineEntries(projection, []).length)
})

it('appends chronological tool items and maintains group counters without rescanning a frozen large group', () => {
  const projection: ExecutionProjection = { conversationId: 'conversation', cursor: 10000, items: Array.from({ length: 10000 }, (_, index) => item(index)) }
  const reader = new ExecutionTimelineReadModel(projection)
  prepareExecutionEvents(projection, [])
  const filter = Array.prototype.filter, sort = Array.prototype.sort
  let full = 0
  Array.prototype.filter = function (this: unknown[], ...args: Parameters<typeof filter>) { if (this.length >= 1000) full++; return Reflect.apply(filter, this, args) } as typeof filter
  Array.prototype.sort = function (this: unknown[], ...args: Parameters<typeof sort>) { if (this.length >= 1000) full++; return Reflect.apply(sort, this, args) } as typeof sort
  try {
    for (let index = 10000; index < 10064; index++) {
      const plan = prepareExecutionEvents(projection, [event(projection, index, { toolName: 'file.write', status: 'completed', saveStatus: 'saved', documentName: `文件${index}` })])
      applyExecutionProjectionOwned(projection, plan); reader.apply(plan); reader.entryPage()
    }
  } finally { Array.prototype.filter = filter; Array.prototype.sort = sort }
  expect(full).toBe(0)
  const page = reader.entryPage(), group = page.entries[0]
  expect(group).toMatchObject({ kind: 'tools', itemCount: 10064, fileCount: 64, summary: '10064 次工具调用' })
  expect(reader.groupPage({ key: (group as { key: string }).key, itemStart: 10000, itemLimit: 64 }).items).toHaveLength(64)
})

it('ends external activity only on the run end and does not revive it with a late running tool', () => {
  const external = { ...item(0), source: 'external-mcp' as const, data: { status: 'running' } }
  const projection: ExecutionProjection = { conversationId: 'conversation', cursor: 1, items: [external] }
  const reader = new ExecutionTimelineReadModel(projection)
  expect(reader.entryPage().activity.externalTools).toBe(1)
  const end = { ...event(projection, 1, { status: 'completed' }), source: 'external-mcp' as const, type: 'run.end' as const }
  let plan = prepareExecutionEvents(projection, [end]); applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  expect(reader.entryPage().activity).toMatchObject({ busy: false, externalTools: 0 })
  plan = prepareExecutionEvents(projection, [{ ...event(projection, 0, { status: 'running', text: 'late' }), source: 'external-mcp' }])
  applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  expect(reader.entryPage().activity).toEqual(executionActivity(projection))
  expect(reader.entryPage().activity).toMatchObject({ busy: false, externalTools: 0 })
})


it('initializes cold same-document save/commit buckets once instead of cumulatively sorting all prior records', () => {
  const items = Array.from({ length: 2000 }, (_, index): ExecutionItem => ({ ...item(index, index % 2 ? 'document.commit' : 'document.save'),
    data: { documentId: 'document', operationId: `operation-${index}`, revision: index, status: index % 2 ? 'applied' : 'saved' } }))
  const projection: ExecutionProjection = { conversationId: 'cold-buckets', cursor: items.length, items }
  const sort = Array.prototype.sort, maximum = Math.max
  let sortedElements = 0, scannedMaxElements = 0
  Array.prototype.sort = function (this: unknown[], ...args: Parameters<typeof sort>) { sortedElements += this.length; return Reflect.apply(sort, this, args) } as typeof sort
  Math.max = (...values: number[]) => { if (values.length > 2) scannedMaxElements += values.length; return maximum(...values) }
  let reader: ExecutionTimelineReadModel
  try { reader = new ExecutionTimelineReadModel(projection) }
  finally { Array.prototype.sort = sort; Math.max = maximum }
  console.log(JSON.stringify({ coldItems: items.length, sortedElements, scannedMaxElements }))
  expect(sortedElements).toBeLessThan(items.length * 4)
  expect(scannedMaxElements).toBe(0)
  expect(reader!.entryPage()).toEqual(new ExecutionTimelineReadModel(projection).entryPage())
})


it('retires derived body prefixes with the current static group page and uses temporary bodies for unmounted reads', () => {
  const items = Array.from({ length: 350 }, (_, index): ExecutionItem => ({ ...item(index), content: [{ kind: 'text', text: `正文${index} ` + '说明 '.repeat(5000) }] }))
  items.push({ ...item(350, 'text'), content: [{ kind: 'text', text: '其他页' }] })
  const projection: ExecutionProjection = { conversationId: 'body-owners', cursor: items.length, items }
  const reader = new ExecutionTimelineReadModel(projection), internals = reader as unknown as { bodies: Map<string, unknown> }
  const first = reader.entryPage({ start: 0, limit: 1 }).entries[0]!
  expect(first.kind).toBe('tools'); if (first.kind !== 'tools') throw new Error('fixture group')
  expect(internals.bodies.size).toBe(100)
  for (const itemStart of [100, 200, 300, 0, 100, 200, 300]) {
    const page = reader.groupPage({ key: first.key, itemStart, itemLimit: 100 })
    expect(internals.bodies.size).toBe(page.items.length)
    expect([...internals.bodies.keys()]).toEqual(page.items.map(value => JSON.stringify([value.runId, value.itemId])))
  }
  expect(reader.readBody({ runId: 'run', itemId: 'item-0', part: 0, complete: true }).text).toBe(items[0]!.content[0]!.kind === 'text' ? items[0]!.content[0]!.text : '')
  expect(internals.bodies.size).toBe(50)
  const plan = prepareExecutionEvents(projection, [event(projection, 349, { text: '最新追加 ' })])
  applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  const live = reader.groupPage({ key: first.key, itemStart: 300, itemLimit: 100 })
  expect(live.cursor).toBe(projection.cursor); expect(internals.bodies.size).toBe(50)
  expect(reader.readBody({ runId: 'run', itemId: 'item-349', part: 0, complete: true }).text.endsWith('最新追加 ')).toBe(true)
  reader.entryPage({ start: 1, limit: 1 }); expect(internals.bodies.size).toBe(1)
  reader.groupPage({ key: first.key, itemStart: 0, itemLimit: 100 }); expect(internals.bodies.size).toBe(1)
})
