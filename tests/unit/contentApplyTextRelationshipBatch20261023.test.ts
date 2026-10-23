// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createTextComponentData } from '../../src/components/text/data'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import type { CanonicalContentApplyRequest, ContentChangeRequest } from '../../src/core/contentApply/planning/types'
import type { ComponentEdit, CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform'

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue
const body = (text: string, range = false) => json({ ...createTextComponentData(text), content: {
  inlines: [{ type: 'text', text, ...(range ? { rangeIds: ['R'] } : {}) }],
} })
function fixture(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'content-batch', revision: 0, title: 'Content batch', rootIds: ['flow'], entry: { rootInstanceId: 'flow' },
    assets: {}, global: { underlay: [], overlay: [] },
    definitions: {
      flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      popover: { id: 'popover', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.popover' } },
    }, instances: {
      flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['A', 'B', 'note'], container: { kind: 'flow' } },
      A: { id: 'A', definitionId: 'text', data: body('ab', true) },
      B: { id: 'B', definitionId: 'text', data: body('tail') },
      note: { id: 'note', definitionId: 'popover', data: { label: '说明', content: '同一条注释' }, attachments: [
        { instanceId: 'note', target: { kind: 'text-range', instanceId: 'A', dataPath: ['content'], rangeId: 'R' } },
      ] },
    } }
}

describe('ContentApply plans within one final text relationship batch', () => {
  it.each(['data', 'canonical'] as const)('defers %s cleanup until usable sibling plans have finished', async kind => {
    const original = fixture(), before = structuredClone(original)
    let working = original
    const service = new ContentApplyService({ session: { project: () => working, dispatch: vi.fn() },
      compilation: { compile: vi.fn() }, measure: vi.fn(async () => { throw new Error('No HTML measurement expected') }) })
    const change = (instanceId: string, data: JsonValue): ContentChangeRequest | CanonicalContentApplyRequest => kind === 'canonical'
      ? { intent: 'canonical', edits: [{ type: 'data.set', instanceId, path: [], value: data }] }
      : { intent: 'content', target: { kind: 'instance', instanceId }, editingContext: { surfaceId: 'flow', stateId: null },
        source: { kind: 'data', fields: [{ path: [], value: data }] } }
    const request = change('A', body(''))
    request.diagnostics = [{ level: 'warning', code: 'local-repair', message: '保留可用正文', repairable: true }]
    const standalone = await service.plan(request)
    expect(standalone.command.edits).toContainEqual({ type: 'instance.remove', instanceId: 'note' })
    const first = await service.plan(request, undefined, { deferTextRelationships: true })
    expect(first.usability).toBe('partial')
    expect(first.diagnostics).toEqual(request.diagnostics)
    expect(first.command.edits).not.toContainEqual({ type: 'instance.remove', instanceId: 'note' })
    working = applyComponentOperation(working, first.command)
    // A locally invalid sibling leaves the earlier usable candidate available.
    await expect(service.plan({ intent: 'content', target: { kind: 'instance', instanceId: 'missing' },
      source: { kind: 'data', fields: [{ path: [], value: body('invalid') }] } }, undefined,
    { deferTextRelationships: true })).rejects.toThrow('目标')
    const second = await service.plan(change('A', body('ab', true)), undefined, { deferTextRelationships: true })
    const combined: ComponentEdit[] = [...first.command.edits, ...second.command.edits]
    const final = applyComponentOperation(original, captureComponentOperation(original, combined))
    expect(final.instances.note.data).toEqual(original.instances.note.data)
    expect(final.instances.note.attachments).toEqual([
      { instanceId: 'note', target: { kind: 'text-range', instanceId: 'A', dataPath: ['content'], rangeId: 'R' } },
    ])
    expect(Object.values(final.instances).filter(instance => instance.definitionId === 'popover')).toHaveLength(1)
    expect(original).toEqual(before)
  })
})
