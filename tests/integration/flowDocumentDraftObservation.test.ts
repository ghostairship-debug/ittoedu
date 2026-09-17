import { beforeEach, describe, expect, it } from 'vitest'
import { buildFlowEditorView, captureFlowEditorAuthoringTarget } from '@/renderer/course/flowEditorView'
import { flowSurfaceIn } from '@/renderer/course/flowDocumentModel'
import { selectActiveCourseProjectDocument, useEditorStore } from '@/renderer/store/editorStore'
import { plainDocumentText } from '@/shared/document/content'
import { serializeDocumentMarkdown } from '@/shared/document/markdown'

function document() {
  const current = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!current) throw new Error('expected active project')
  return current
}

function target() {
  const state = useEditorStore.getState()
  const session = state.flowSession!
  return captureFlowEditorAuthoringTarget({
    view: buildFlowEditorView({ project: session.history.present, locationId: session.selection.locationId }),
    sessionToken: state.courseAuthoringSession!.token,
    target: { kind: 'surface' },
  })
}

function sourceWithText(text: string): string {
  const current = document()
  const surface = flowSurfaceIn(current, target().surfaceId!)
  const blocks = structuredClone(surface.blocks)
  const paragraph = blocks.find(block => block.type === 'paragraph')
  if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected Flow paragraph')
  paragraph.content = { inlines: [{ type: 'text', text }] }
  return serializeDocumentMarkdown({ content: { blocks }, resources: { assets: [], components: [] } }, 'flow')
}

beforeEach(() => useEditorStore.getState().createNewFlowProject())

describe('Flow document draft observation materialization', () => {
  it('materializes a valid source without committing document or history', () => {
    const baseline = document()
    const history = useEditorStore.getState().flowSession!.history
    const draftTarget = target()
    expect(useEditorStore.getState().runFlowAuthoringIntent(draftTarget, {
      kind: 'update-document-draft', source: sourceWithText('仅供观察的正文草稿'), diagnostics: [], composing: false,
    }).ok).toBe(true)
    const draft = useEditorStore.getState().flowDocumentDraft

    const result = useEditorStore.getState().captureCourseProjectObservationSnapshot()
    if (!result.ok) throw new Error(result.reason)
    const materialized = flowSurfaceIn(result.snapshot.project, draftTarget.surfaceId!).blocks
      .find(block => block.type === 'paragraph')
    expect(materialized?.type === 'paragraph' ? plainDocumentText(materialized.content) : null).toBe('仅供观察的正文草稿')
    expect(document()).toBe(baseline)
    expect(useEditorStore.getState().flowSession!.history).toBe(history)
    expect(useEditorStore.getState().flowDocumentDraft).toBe(draft)
  })

  it('rejects invalid source without changing the canonical project or history', () => {
    const baseline = document()
    const history = useEditorStore.getState().flowSession!.history
    expect(useEditorStore.getState().runFlowAuthoringIntent(target(), {
      kind: 'update-document-draft', source: '未闭合 $x', diagnostics: [], composing: false,
    }).ok).toBe(true)

    expect(useEditorStore.getState().captureCourseProjectObservationSnapshot()).toMatchObject({ ok: false })
    expect(useEditorStore.getState().captureCourseProjectRecoverySnapshot()).toMatchObject({
      ok: true,
      snapshot: { project: baseline },
    })
    expect(document()).toBe(baseline)
    expect(useEditorStore.getState().flowSession!.history).toBe(history)
  })

  it.each([
    ['stale revision', (revision: number, surfaceId: string) => ({ revision: revision - 1, surfaceId }), 'stale-revision'],
    ['another surface', (revision: number) => ({ revision, surfaceId: 'other-flow-surface' }), '正文草稿不属于当前 Flow 页面'],
  ] as const)('rejects a draft for %s', (_label, mismatch, reason) => {
    const currentTarget = target()
    useEditorStore.setState({
      flowDocumentDraft: {
        source: sourceWithText('不能串到当前页面'),
        diagnostics: [],
        composing: false,
        ...mismatch(currentTarget.documentRevision, currentTarget.surfaceId!),
      },
    })
    expect(useEditorStore.getState().captureCourseProjectObservationSnapshot()).toEqual({ ok: false, reason })
    expect(useEditorStore.getState().captureCourseProjectRecoverySnapshot()).toMatchObject({ ok: true })
  })
})
