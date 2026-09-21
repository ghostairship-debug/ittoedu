import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import { createGenerationCandidateCoordinator } from '@/renderer/authoring/generation/prepareGenerationCandidate'
import { readGenerationFailure, type GenerationCandidate, type GenerationRequest } from '@/shared/generationContract'
import { describe, expect, it } from 'vitest'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { flowContextSelectionIntent, resolveFlowContextSelection, flowTextSlot } from '@/renderer/course/flowContextSelection'
import { executeFlowDelete, executeFlowEditorCommand } from '@/renderer/course/flowEditorCommands'
import { selectFlowEditorBlocks } from '@/renderer/course/flowEditorSlice'
import { buildFlowEditorView, captureFlowEditorAuthoringTarget } from '@/renderer/course/flowEditorView'
import { flowAuthoringTool } from '@/renderer/authoring/tools/flowAuthoringTool'
import { executeAuthoringTool } from '@/renderer/authoring/tools/executeAuthoringTool'
import { applyEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { captureGenerationFixture } from '../fixtures/generationSnapshot'
import { validateContextualCourseCommand } from '@/renderer/ui/chat/contextualCourseCommand'
import type { DocumentSelection, DocumentSlot } from '@/shared/document/ports'
import type { DocumentBlock } from '@/shared/document/content'

const text = (value = '甲😀乙') => ({ inlines: [{ type: 'text' as const, text: value }] })
function fixture() {
  const document = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = document.surfaces[0]!
  if (surface.type !== 'flow') throw new Error('flow')
  const blocks: DocumentBlock[] = [
    { id: 'p', type: 'paragraph', content: text() },
    { id: 'q', type: 'quote', content: text('保留正文'), citation: text() },
    { id: 'l', type: 'list', ordered: false, items: [{ id: 'i', content: text() }, { id: 'other', content: text('保持') }] },
    { id: 't', type: 'table', caption: text(), columns: [{ id: 'c', header: text() }], rows: [{ id: 'r', cells: { c: text() } }] },
    { id: 'call', type: 'callout', tone: 'note', title: text(), body: text() },
    { id: 'section', type: 'section', title: text(), collapsedByDefault: false, blocks: [] },
    { id: 'f', type: 'formula', formulaId: 'formula', latex: 'x', accessibleText: 'x' },
  ]
  surface.blocks.push(...blocks)
  syncFlowCourseLocations(document, surface.id)
  const sessionToken = { locationId: document.startLocationId, surfaceType: 'flow' as const, revision: document.revision, generation: 1 }
  const selection = (id: string, slot: DocumentSlot, reverse = true): DocumentSelection => ({ kind: 'text', revision: String(document.revision),
    anchor: { blockId: id, slot, offset: reverse ? 2 : 1, affinity: 'after' }, head: { blockId: id, slot, offset: reverse ? 1 : 2, affinity: 'before' } })
  return { document, surface, sessionToken, selection }
}
const cases: [string, DocumentSlot][] = [
  ['p', { kind: 'field', field: 'content' }], ['q', { kind: 'field', field: 'citation' }], ['l', { kind: 'item', itemId: 'i' }],
  ['t', { kind: 'header', columnId: 'c' }], ['t', { kind: 'cell', rowId: 'r', columnId: 'c' }], ['t', { kind: 'field', field: 'caption' }],
  ['call', { kind: 'field', field: 'title' }], ['call', { kind: 'field', field: 'body' }], ['section', { kind: 'field', field: 'title' }],
]

describe('Flow contextual native target', () => {
  it('freezes reverse logical slots for card and chat into precise native edit inputs', () => {
    const f = fixture()
    for (const [id, slot] of cases) {
      const logical = f.selection(id, slot), intent = flowContextSelectionIntent(logical)
      const selected = selectFlowEditorBlocks(f.document, f.document.startLocationId, intent.blockIds, intent)
      expect(selected.documentSelection).toEqual(logical)
      expect(resolveFlowContextSelection(f.surface.blocks, f.document.revision, logical)).toEqual({ kind: 'text', blockId: id, textRange: { slot, start: 1, end: 2 } })
      expect(() => validateContextualCourseCommand({ instruction: '改这里', projectId: f.document.id, sessionToken: f.sessionToken, documentSelection: logical }, selected)).not.toThrow()
      const request = captureGenerationFixture({ document: f.document, sessionToken: f.sessionToken, workspace: { version: 1, projectId: f.document.id, normalizedPath: '/flow.h5lesson' },
        projection: projectEffectiveLayers({ project: f.document, locationId: f.document.startLocationId }), selectedIds: [id], flowSelection: selected, scope: 'selection', instruction: '删除所选文字', purpose: 'local-edit' })
      expect(request.context).toMatchObject({ flowTextEdit: { tool: 'flow.content', destination: { kind: 'update', target: { itemId: id, documentRevision: f.document.revision } }, input: { operation: 'edit', textRange: { slot, start: 1, end: 2 } } } })
      expect(request.selectionActions ?? []).toEqual([])
      if (slot.kind === 'header' || slot.kind === 'field' && slot.field !== 'content') expect(selected.textRange).toBeNull()
    }
    expect(resolveFlowContextSelection(f.surface.blocks, f.document.revision, { kind: 'cells', revision: String(f.document.revision), tableId: 't', anchor: { rowId: 'r', columnId: 'c' }, head: { rowId: 'r', columnId: 'c' } })).toEqual({ kind: 'text', blockId: 't', textRange: { slot: { kind: 'cell', rowId: 'r', columnId: 'c' }, start: 0, end: 3 } })
    // Observation after our own commit may inspect the result, but cannot renew stale offsets.
    const logical = f.selection('q', { kind: 'field', field: 'citation' }), selected = selectFlowEditorBlocks(f.document, f.document.startLocationId, ['q'], flowContextSelectionIntent(logical))
    const next = structuredClone(f.document); next.revision++
    const feedback = captureGenerationFixture({ document: next, sessionToken: { ...f.sessionToken, revision: next.revision }, workspace: { version: 1, projectId: next.id, normalizedPath: '/flow.h5lesson' },
      projection: projectEffectiveLayers({ project: next, locationId: next.startLocationId }), selectedIds: ['q'], flowSelection: selected, scope: 'selection', instruction: '检查修改', purpose: 'local-edit', previousResult: { status: 'committed', afterRevision: next.revision } })
    expect(feedback.context).toMatchObject({ flowTextEdit: { status: 'stale' } })
    expect((feedback.context as any).flowTextEdit.input).toBeUndefined()
    const formula: DocumentSelection = { revision: String(f.document.revision), kind: 'object', blockId: 'f' }
    expect(resolveFlowContextSelection(f.surface.blocks, f.document.revision, formula)).toEqual({ kind: 'object', blockId: 'f' })
  })

  it('commits precise slots and formula atoms through the canonical tool with reversible history', async () => {
    const f = fixture()
    f.surface.blocks.push({ id: 'math', type: 'paragraph', content: { inlines: [{ type: 'text', text: '前' }, { type: 'math', formulaId: 'inline-math', latex: 'x', accessibleText: 'x' }, { type: 'text', text: '后' }] } })
    f.surface.blocks[0] = { ...f.surface.blocks[0], content: text() } as DocumentBlock
    const allCases: [string, DocumentSlot][] = [...cases, [f.surface.blocks[0]!.id, { kind: 'field', field: 'content' }], ['math', { kind: 'field', field: 'content' }]]
    for (const [id, slot] of allCases) {
      let state = { document: structuredClone(f.document), resources: { assetFiles: {}, componentPackages: {} } }
      const before = structuredClone(state.document), steps: EditorTransactionStep[] = []
      const destination = { kind: 'update' as const, target: captureFlowEditorAuthoringTarget({ view: buildFlowEditorView({ project: state.document, locationId: state.document.startLocationId }), sessionToken: f.sessionToken, target: { kind: 'block', blockId: id } }) }
      const port = { readDocument: () => state.document, validateDestination: () => null, commit: (step: EditorTransactionStep) => { steps.push(step); state = applyEditorTransactionStep(state, step, 'forward'); return true } }
      const request = { version: 1, requestId: 'range', tool: 'flow.content', destination, input: { operation: 'edit', textRange: { slot, start: 1, end: 2 }, content: text('新') } }
      const receipt = await executeAuthoringTool(request, flowAuthoringTool, port)
      expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
      const changed = state.document.surfaces[0]!
      if (changed.type !== 'flow') throw new Error('flow')
      const changedBlock = changed.blocks.find(block => block.id === id)!
      expect(flowTextSlot(changedBlock, slot).get()).toEqual(text(id === 'math' ? '前新后' : '甲新乙'))
      const expected = structuredClone(before)
      if (expected.surfaces[0]!.type !== 'flow') throw new Error('flow')
      flowTextSlot(expected.surfaces[0]!.blocks.find(block => block.id === id)!, slot).set(text(id === 'math' ? '前新后' : '甲新乙'))
      expect(changed.blocks).toEqual(expected.surfaces[0]!.blocks)
      expect(steps).toHaveLength(1)
      expect(applyEditorTransactionStep(state, steps[0]!, 'inverse').document).toEqual(before)
      expect((await executeAuthoringTool(request, flowAuthoringTool, port)).status).toBe('stale')
    }
  })

  it('rejects stale cross-slot cross-block and multi-cell selections without whole-block fallback', () => {
    const f = fixture(), logical = f.selection('q', { kind: 'field', field: 'citation' })
    if (logical.kind !== 'text') throw new Error('text')
    const invalid: DocumentSelection[] = [ { ...logical, revision: '-1' }, { ...logical, head: { ...logical.head, blockId: 'p' } },
      { ...logical, head: { ...logical.head, slot: { kind: 'field', field: 'content' } } },
      { ...logical, head: { ...logical.head, offset: 99 } },
      { kind: 'cells', revision: String(f.document.revision), tableId: 't', anchor: { rowId: 'r', columnId: 'c' }, head: { rowId: 'other', columnId: 'c' } },
    ]
    for (const value of invalid) {
      const intent = flowContextSelectionIntent(value), selected = selectFlowEditorBlocks(f.document, f.document.startLocationId, intent.blockIds, intent)
      expect(selected.documentSelection).toEqual(value)
      expect(executeFlowDelete(f.document, selected).ok).toBe(false)
      expect(executeFlowEditorCommand(f.document, selected, { name: 'format', spec: { kind: 'text-style', style: { bold: true } } }).ok).toBe(false)
      expect(() => resolveFlowContextSelection(f.surface.blocks, f.document.revision, value)).toThrow()
      expect(() => captureGenerationFixture({ document: f.document, sessionToken: f.sessionToken, workspace: { version: 1, projectId: f.document.id, normalizedPath: '/flow.h5lesson' },
        projection: projectEffectiveLayers({ project: f.document, locationId: f.document.startLocationId }), selectedIds: intent.blockIds, flowSelection: selected, scope: 'selection', instruction: '改这里', purpose: 'local-edit' })).toThrow()
    }
    const sourceSelection = selectFlowEditorBlocks(f.document, f.document.startLocationId, ['q'], { focus: 'text', textRange: null, documentSelectionIssue: '源文选区不支持' })
    expect(() => captureGenerationFixture({ document: f.document, sessionToken: f.sessionToken, workspace: { version: 1, projectId: f.document.id, normalizedPath: '/flow.h5lesson' },
      projection: projectEffectiveLayers({ project: f.document, locationId: f.document.startLocationId }), selectedIds: ['q'], flowSelection: sourceSelection, scope: 'selection', instruction: '改这里', purpose: 'local-edit' })).toThrow('源文选区不支持')
    const selected = selectFlowEditorBlocks(f.document, f.document.startLocationId, ['q'], flowContextSelectionIntent(logical))
    expect(() => validateContextualCourseCommand({ projectId: f.document.id, sessionToken: f.sessionToken, instruction: '改这里', documentSelection: { ...logical, head: { ...logical.head, offset: 0 } } }, selected)).toThrow()
  })
})

function candidateHarness(f: ReturnType<typeof fixture>, selection: ReturnType<typeof selectFlowEditorBlocks>) {
  const request = captureGenerationFixture({ document: f.document, sessionToken: f.sessionToken,
    workspace: { version: 1, projectId: f.document.id, normalizedPath: '/flow.h5lesson' },
    projection: projectEffectiveLayers({ project: f.document, locationId: f.document.startLocationId }),
    selectedIds: [...selection.selectedBlockIds], flowSelection: selection, scope: 'selection', instruction: '改这里', purpose: 'local-edit' })
  let state = { document: f.document, resources: { assetFiles: {}, componentPackages: {} } }
  const commits: EditorTransactionStep[] = []
  const coordinator = createGenerationCandidateCoordinator({ readDocument: () => state.document, readResources: () => state.resources,
    readWorkspace: () => request.workspace, readSessionGeneration: () => 1,
    commit(step) { state = applyEditorTransactionStep(state, step, 'forward'); commits.push(step); return true } })
  const candidate = (steps: GenerationCandidate['steps']): GenerationCandidate => ({ version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '修改选中正文', steps })
  return { request, coordinator, candidate, commits, read: () => state }
}
function destination(request: GenerationRequest, id: string) {
  const value = request.destinations.find(value => value.kind === 'update' && value.target.itemId === id)
  if (!value) throw new Error('missing target')
  return value
}

describe('Flow candidate range enforcement', () => {
  it('blocks omitted expanded and legacy whole-block candidates for cell citation and inline formula with zero writes', async () => {
    for (const [id, slot] of [['t', { kind: 'cell', rowId: 'r', columnId: 'c' }], ['q', { kind: 'field', field: 'citation' }], ['p', { kind: 'field', field: 'content' }]] as [string, DocumentSlot][]) {
      const f = fixture()
      if (id === 'p') flowTextSlot(f.surface.blocks.find(block => block.id === id)!, slot).set({ inlines: [
        { type: 'text', text: '前' }, { type: 'math', formulaId: 'atom', latex: 'x', accessibleText: 'x' }, { type: 'text', text: '后' }] })
      const selected = selectFlowEditorBlocks(f.document, f.document.startLocationId, [id], flowContextSelectionIntent(f.selection(id, slot)))
      const h = candidateHarness(f, selected), before = structuredClone(h.read())
      const good: GenerationCandidate['steps'][number] = { id: 'edit', carrier: 'native', tool: 'flow.content', destination: destination(h.request, id),
        input: { operation: 'edit', textRange: { slot, start: 1, end: 2 }, content: text('新') } }
      const block = structuredClone(f.surface.blocks.find(block => block.id === id)!)
      flowTextSlot(block, slot).set(text('整个位置被覆盖'))
      const bad: GenerationCandidate['steps'][] = [
        [{ ...good, input: { operation: 'edit', content: text('错误覆盖正文') } }],
        [{ ...good, input: { operation: 'edit', textRange: { slot, start: 0, end: 3 }, content: text('越界') } }],
        [{ ...good, input: { operation: 'edit', textRange: { slot: { kind: 'field', field: 'content' }, start: 0, end: 1 }, content: text('错字段') } }],
        [{ ...good, input: JSON.parse(JSON.stringify({ operation: 'replace', block })) }], [{ ...good, input: { operation: 'delete' } }],
        [{ ...good, tool: 'project.document', input: { operation: 'replace' } }],
        [{ ...good, destination: destination(h.request, id === 'p' ? 'q' : 'p') }],
        [good, { ...good, id: 'again' }],
      ]
      for (const steps of bad) {
        const error = await h.coordinator.prepare(h.request, h.candidate(steps)).catch(error => error)
        expect(readGenerationFailure(error)?.diagnostics[0]?.code).toBe('flow-selection-range')
        expect(h.commits).toHaveLength(0); expect(h.read()).toEqual(before)
      }
      const preview = await h.coordinator.prepare(h.request, h.candidate([good]))
      expect(h.commits).toHaveLength(0)
      expect(h.coordinator.apply(preview.previewId).status).toBe('committed')
      expect(h.commits).toHaveLength(1)
      const expected = structuredClone(before.document)
      const surface = expected.surfaces[0]!
      if (surface.type !== 'flow') throw new Error('flow')
      flowTextSlot(surface.blocks.find(block => block.id === id)!, slot).set(text(id === 'p' ? '前新后' : '甲新乙'))
      expected.revision++
      expected.updatedAt = h.read().document.updatedAt
      expect(h.read().document).toEqual(expected)
      expect(applyEditorTransactionStep(h.read(), h.commits[0]!, 'inverse')).toEqual(before)
    }
  })

  it('accepts full single-cell selection and standalone formula through actual candidate commits', async () => {
    for (const id of ['t', 'f']) {
      const f = fixture(), logical: DocumentSelection = id === 't'
        ? { kind: 'cells', revision: String(f.document.revision), tableId: id, anchor: { rowId: 'r', columnId: 'c' }, head: { rowId: 'r', columnId: 'c' } }
        : { kind: 'object', revision: String(f.document.revision), blockId: id }
      const selected = selectFlowEditorBlocks(f.document, f.document.startLocationId, [id], flowContextSelectionIntent(logical)), h = candidateHarness(f, selected)
      const input = id === 't' ? { operation: 'edit', textRange: { slot: { kind: 'cell', rowId: 'r', columnId: 'c' }, start: 0, end: 3 }, content: text('单格') }
        : { operation: 'edit', formula: { latex: 'y', accessibleText: 'y' } }
      const preview = await h.coordinator.prepare(h.request, h.candidate([{ id: 'edit', carrier: 'native', tool: 'flow.content', destination: destination(h.request, id), input: JSON.parse(JSON.stringify(input)) }]))
      expect(h.coordinator.apply(preview.previewId).status).toBe('committed')
      const surface = h.read().document.surfaces[0]!
      if (surface.type !== 'flow') throw new Error('flow')
      expect(surface.blocks.filter(block => block.id !== id)).toEqual(f.surface.blocks.filter(block => block.id !== id))
      if (id === 'f') expect(surface.blocks.find(block => block.id === id)).toMatchObject({ formulaId: 'formula', latex: 'y', accessibleText: 'y' })
      else expect(flowTextSlot(surface.blocks.find(block => block.id === id)!, { kind: 'cell', rowId: 'r', columnId: 'c' }).get()).toEqual(text('单格'))
    }
  })

  it('preserves legacy caret chat and manual properties and deletes at a logical citation caret', async () => {
    const f = fixture()
    const legacy = selectFlowEditorBlocks(f.document, f.document.startLocationId, ['p'], { focus: 'text', textRange: { blockId: 'p', start: 1, end: 1 } })
    const h = candidateHarness(f, legacy)
    expect((h.request.context as any).flowTextEdit).toBeUndefined()
    const preview = await h.coordinator.prepare(h.request, h.candidate([{ id: 'edit', carrier: 'native', tool: 'flow.content', destination: destination(h.request, 'p'), input: { operation: 'edit', content: text('正常整段') } }]))
    expect(h.coordinator.apply(preview.previewId).status).toBe('committed')
    const logical = f.selection('q', { kind: 'field', field: 'citation' })
    if (logical.kind !== 'text') throw new Error('text')
    logical.head.offset = logical.anchor.offset = 2
    const selected = selectFlowEditorBlocks(f.document, f.document.startLocationId, ['q'], flowContextSelectionIntent(logical))
    const deleted = executeFlowDelete(f.document, selected)
    expect(deleted.ok).toBe(true)
    const changed = deleted.nextDocument!.surfaces[0]!
    if (changed.type !== 'flow') throw new Error('flow')
    expect(changed.blocks.find(block => block.id === 'q')).toMatchObject({ content: text('保留正文'), citation: text('甲乙') })
    const paragraph = selectFlowEditorBlocks(f.document, f.document.startLocationId, ['p'], flowContextSelectionIntent(f.selection('p', { kind: 'field', field: 'content' })))
    const property = executeFlowEditorCommand(f.document, paragraph, { name: 'format', spec: { kind: 'convert-heading', level: 2 } })
    expect(property.ok).toBe(true)
    const result = property.nextDocument!.surfaces[0]!
    if (result.type !== 'flow') throw new Error('flow')
    expect(result.blocks.find(block => block.id === 'p')).toMatchObject({ type: 'heading', level: 2, content: text() })
  })
})
