import { useSyncExternalStore } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { serializeDocumentMarkdown, type MarkdownDocument } from '../../src/shared/document/markdown'
import type { SharedDocumentEditorProps } from '../../src/renderer/document/SharedDocumentEditor'
import type { DocumentOperation } from '../../src/renderer/document/editorSession'
import type { FlowDocumentDraft } from '../../src/renderer/store/slices/flowAuthoringTypes'

const probe = vi.hoisted(() => ({ state: {} as Record<string, any>, runtime: {} as Record<string, any>, props: null as unknown as SharedDocumentEditorProps }))
vi.mock('../../src/renderer/store/editorStore', () => ({ selectActiveSlideContentEdit: () => null,
  useEditorStore: Object.assign((select: (state: typeof probe.state) => unknown) => select(probe.state), { getState: () => probe.state }) }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => probe.runtime }))
vi.mock('../../src/renderer/ui/useAssetObjectUrls', () => ({ useAssetObjectUrls: () => ({}) }))
vi.mock('../../src/renderer/ui/workspaces/useComponentAuthorInteraction', () => ({ useComponentAuthorInteraction: () => ({ editor: null, pointerFromElement: () => false }) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))
vi.mock('../../src/renderer/ui/flow/flowParagraphLayout', async importOriginal => ({ ...await importOriginal<object>(),
  observeFlowParagraphLayout: () => Object.assign(() => {}, { invalidate() {} }) }))
vi.mock('../../src/renderer/document', async () => {
  const React = await import('react')
  return { SharedDocumentEditor: React.forwardRef((props: SharedDocumentEditorProps, ref) => {
    probe.props = props
    React.useImperativeHandle(ref, () => ({ flush: () => ({ ready: true, diagnostics: [] }), drain: async () => ({ ready: true, diagnostics: [] }),
      canPreserveDraft: () => true, paintProjection: (paint: () => void) => paint() }))
    return <div ref={props.onLayoutMount} className="ProseMirror" />
  }) }
})
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const operation = (id: string): DocumentOperation => ({ operationId: id, historyGroup: id, source: 'layout', changedBlockIds: ['body'] })
async function mount() {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'late-flow-ack', revision: 0, title: '输入交接',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION }, instances: { body: { id: 'body', definitionId: TEXT_DEFINITION.id, data: createTextData('old') } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['body'], flow: { layout: { widthMode: 'reading', readingWidth: 800, wideContentWidth: 1100, toc: 'hidden' } } }],
    global: { underlay: [], overlay: [] }, assets: {} })
  const h = await createV10StoreHost(project)
  const navigation = new ComponentNavigationOwner({ project: () => h.model().project, surfaceId: () => 'flow', interactive: () => false, select: () => true })
  const preserve = vi.fn(async () => true)
  probe.state = { courseBridge: h.bridge, courseKernel: h.kernel, courseView: h.bridge.read(), editingScope: 'scene', flowDocumentDrafts: {}, slideContentEdit: null,
    setFlowDocumentDraft(draft: FlowDocumentDraft | null, documentId: string, surfaceId?: string) {
      if (draft) probe.state.flowDocumentDrafts[documentId] = draft
      else if (!surfaceId || probe.state.flowDocumentDrafts[documentId]?.surfaceId === surfaceId) delete probe.state.flowDocumentDrafts[documentId]
    }, setFlowContextSelection() {}, commitSlideContentEdit: async () => {}, courseInputs: { prepare: preserve },
    parkFlowDocumentDraft(documentId: string) { delete probe.state.flowDocumentDrafts[documentId] } }
  probe.runtime = { documentId: h.first.documentId, resources: h.model().resources, selectedInstanceIds: [], selectInstances() {}, navigation,
    registerObservation: () => () => {}, renderInstance: () => null, onTargetElement() {}, onElement() {},
    world: { beforeProjectionMutation() {}, afterProjectionMutation() {}, beforeProjectionRemoval() {} } }
  function Harness() {
    const view = useSyncExternalStore(h.bridge.subscribe.bind(h.bridge), () => h.bridge.read())
    probe.state.courseView = view
    return <FlowWorkspace documentId={h.first.documentId} project={h.model().project} surfaceId="flow" onSelectImageAsset={async () => null} />
  }
  const ui = render(<Harness />)
  const document = (value: string): MarkdownDocument => {
    const projected = projectFlowDocument(project, 'flow')
    const block = projected.content.blocks[0]
    if (block.type !== 'paragraph') throw new Error('Expected paragraph')
    block.content = { inlines: [{ type: 'text', text: value }] }
    return projected
  }
  const publish = async (value: string) => {
    const next = document(value)
    let result: boolean | void
    await act(async () => { probe.props.onDraft?.(serializeDocumentMarkdown(next, 'flow'), []); result = await probe.props.onChange(next, operation(value)) })
    return result!
  }
  return { h, ui, document, publish, preserve, dispose() { ui.unmount(); navigation.dispose(); h.bridge.dispose() } }
}

it('queries A original ACK and applies newer B once against A accepted baseline instead of certifying B with A receipt', async () => {
  const f = await mount(), dispatch = f.h.api.dispatch.bind(f.h.api), lookup = f.h.api.lookup.bind(f.h.api)
  let visible = false
  vi.spyOn(f.h.api, 'dispatch').mockImplementationOnce(async (input, options) => { await dispatch(input, options); throw new Error('lost A ACK') })
  vi.spyOn(f.h.api, 'lookup').mockImplementation((id, operationId) => visible ? lookup(id, operationId) : Promise.resolve(null))
  try {
    expect(await f.publish('A')).toBe(false)
    visible = true
    expect(await f.publish('B')).toBe(true)
    expect((f.h.model().project.instances.body.data as any).content.inlines).toEqual([{ type: 'text', text: 'B' }])
    expect(f.h.operations).toHaveLength(2)
    expect(probe.state.flowDocumentDrafts[f.h.first.documentId]).toBeUndefined()
  } finally { f.dispose() }
})

it('keeps a genuinely overlapping external C rather than rebasing newer B onto arbitrary latest facts', async () => {
  const f = await mount(), dispatch = f.h.api.dispatch.bind(f.h.api), lookup = f.h.api.lookup.bind(f.h.api)
  let visible = false
  vi.spyOn(f.h.api, 'dispatch').mockImplementationOnce(async (input, options) => { await dispatch(input, options); throw new Error('lost A ACK') })
  vi.spyOn(f.h.api, 'lookup').mockImplementation((id, operationId) => visible ? lookup(id, operationId) : Promise.resolve(null))
  try {
    expect(await f.publish('A')).toBe(false)
    const snapshot = f.h.first.read()
    await act(async () => { await f.h.first.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: 'external-C', actor: 'agent', mutation: { type: 'command', command: captureComponentOperation(f.h.model().project,
        [{ type: 'data.set', instanceId: 'body', path: ['content'], value: { inlines: [{ type: 'text', text: 'C' }] } }]) } }) })
    visible = true
    expect(await f.publish('B')).toBe(false)
    expect((f.h.model().project.instances.body.data as any).content.inlines).toEqual([{ type: 'text', text: 'C' }])
    expect(probe.state.flowDocumentDrafts[f.h.first.documentId]?.source).toContain('B')
  } finally { f.dispose() }
})

it('retains invalid raw B which does not submit while A late ACK is being queried, then permits its explicit preservation', async () => {
  const f = await mount(), dispatch = f.h.api.dispatch.bind(f.h.api), lookup = f.h.api.lookup.bind(f.h.api), entered = deferred(), gate = deferred()
  vi.spyOn(f.h.api, 'dispatch').mockImplementationOnce(async (input, options) => { await dispatch(input, options); throw new Error('lost A ACK') })
  vi.spyOn(f.h.api, 'lookup').mockImplementation(async (id, operationId) => { entered.resolve(); await gate.promise; return lookup(id, operationId) })
  try {
    const next = f.document('A')
    let pending!: Promise<boolean | void>
    await act(async () => { pending = Promise.resolve(probe.props.onChange(next, operation('A'))); await entered.promise })
    await act(async () => { probe.props.onDraft?.('$unfinished B', [{ message: 'local raw B', offset: 0, endOffset: 1, line: 1, column: 1 }]) })
    await act(async () => { gate.resolve(); expect(await pending).toBe(true) })
    expect(probe.state.flowDocumentDrafts[f.h.first.documentId]?.source).toBe('$unfinished B')
    await act(async () => { expect(await probe.props.onPreserveDraft?.()).toBe(true) })
    expect(f.preserve).toHaveBeenCalledWith([f.h.first.documentId], 'preserve')
    expect(f.h.operations).toHaveLength(1)
  } finally { gate.resolve(); f.dispose() }
})
