import { controllerPackages } from '../fixtures/teacherController'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>, sessions: [] as Array<{ destroy: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn> }>,
  events: [] as string[], wait: null as Promise<void> | null, failure: null as Error | null,
  registerObservation: vi.fn(() => () => undefined),
}))
vi.mock('@/renderer/authoring/generation/authoringObservation', async importOriginal => ({
  ...await importOriginal<typeof import('@/renderer/authoring/generation/authoringObservation')>(),
  registerAuthoringObservationHost: probe.registerObservation,
}))
vi.mock('@/player/surfaces/publishedDynamicHosts', () => ({ createPublishedCourseSession(_payload: unknown, options: Record<string, unknown>) {
  if (probe.failure) throw probe.failure
  probe.options.push(options)
  const index = probe.sessions.length, unsubscribe = vi.fn(), gate = probe.wait
  let button: HTMLButtonElement | null = null
  const session = { destroy: vi.fn(async () => { probe.events.push(`destroy:${index}`); button?.remove() }), unsubscribe }
  probe.sessions.push(session)
  return { ...session,
    async mount(container: HTMLElement) {
      probe.events.push(`mount:${index}`)
      if (gate) await gate
      button = document.createElement('button'); button.textContent = '候选中的互动'
      button.addEventListener('click', () => { button!.textContent = '候选互动已响应' })
      container.append(button)
    },
    subscribeNavigation: () => unsubscribe,
  }
} }))

import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { generationRequestSchema } from '@/shared/generationContract'
import { generationSemanticChangesSchema } from '@/shared/generationChangeSummary'
import { GenerationCandidatePreview, type GenerationCandidatePreviewProps } from '@/renderer/ui/chat/GenerationCandidatePreview'
import { mountPublishedCourseTryRun } from '@/renderer/ui/coursePlayerTryRun'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iKisAAAAASUVORK5CYII='
function fixture(): GenerationCandidatePreviewProps {
  const project = createBlankFlowCourseProject(), surface = project.surfaces[0]!
  const semanticChanges = generationSemanticChangesSchema.parse({ changes: [{ path: 'surfaces[id="flow"].blocks[id="title"].content',
    before: '旧标题', after: '新标题', kind: 'updated', field: 'content', target: { entity: 'flow-block', id: 'title', owner: 'flow',
      ownerKey: `flow:${surface.id}`, impact: 'instance', surfaceId: surface.id, locationId: 'observed-location' } }], omitted: 0,
  comparison: { status: 'complete', scopes: [{ scope: 'document', status: 'complete' }, { scope: 'resource-assets', status: 'complete' },
    { scope: 'resource-packages', status: 'complete' }] },
  truncation: { changeLimit: 200, valueLengthLimit: 500, omittedChanges: 0, truncatedValues: 0 } })
  project.locations.push({ ...project.locations[0]!, id: 'observed-location', label: '被观察的讲义' })
  const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(),
    workspace: { version: 1, projectId: project.id, normalizedPath: 'c:/courses/preview.h5lesson' },
    documentRevision: project.revision, sessionGeneration: 1, purpose: 'local-edit', instruction: '修改当前图片', context: {}, allowedCarriers: ['native'],
    destinations: [{ kind: 'create', scope: { projectId: project.id, documentRevision: project.revision,
      revisionPolicy: { kind: 'exact' }, sessionGeneration: 1, surfaceType: 'flow', surfaceId: surface.id,
      locationId: project.startLocationId, stateId: null, owner: 'surface', ownerKey: `surface:${surface.id}`,
      parent: { kind: 'flow-body', parentBlockId: null }, insertion: { kind: 'append' } } }],
    observation: { documentRevision: project.revision, sessionGeneration: 1, draftEpoch: 1, viewEpoch: 1,
      runtime: null, surfaceId: surface.id, locationId: 'observed-location', stateId: null, source: 'authoring', capturedAt: Date.now(),
      files: [{ fileId: 'current-frame', relativePath: 'observation/current-frame.png', mediaType: 'image/png', byteLength: 68, role: 'image' }] },
    resourceFiles: [{ path: 'observation/current-frame.png', encoding: 'base64', content: png, mediaType: 'image/png', role: 'image' }],
  })
  return { request, prepared: { previewId: crypto.randomUUID(), candidateId: 'candidate-1', summary: '图片改色',
    beforeRevision: project.revision, afterRevision: project.revision + 1, plannedEffects: [], behaviorEvidence: [],
    ...semanticChanges, semanticChanges,
    document: project, resources: { assetFiles: {}, componentPackages: controllerPackages } } }
}

beforeEach(() => {
  probe.options.length = 0; probe.sessions.length = 0; probe.events.length = 0; probe.wait = null; probe.failure = null
  probe.registerObservation.mockClear()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(280)
})
afterEach(async () => { cleanup(); await act(async () => {}); vi.restoreAllMocks() })

describe('temporary candidate effect preview', () => {
  it('shows the captured before image and mounts an interactive Published candidate at the observed location without joining current observations', async () => {
    const props = fixture(), original = JSON.stringify(props.prepared.document)
    const rendered = render(<StrictMode><GenerationCandidatePreview {...props} /></StrictMode>)
    expect(screen.getByAltText('发送请求时的课件画面').getAttribute('src')).toBe(`data:image/png;base64,${png}`)
    await waitFor(() => expect(screen.getByTestId('generation-candidate-player')).toHaveAttribute('data-candidate-ready', 'true'))
    expect(probe.options).toHaveLength(1)
    expect(probe.options[0]?.initialLocationId).toBe('observed-location')
    expect(probe.registerObservation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('候选中的互动'))
    expect(screen.getByText('候选互动已响应')).toBeDefined()
    expect(JSON.stringify(props.prepared.document)).toBe(original)
    rendered.unmount()
    await waitFor(() => expect(probe.sessions[0]!.destroy).toHaveBeenCalledTimes(1))
    expect(probe.sessions[0]!.unsubscribe).toHaveBeenCalledTimes(1)
    // Control case proves the real mount still registers ordinary authoring trial sessions.
    const regular = await mountPublishedCourseTryRun({ container: document.createElement('div'), project: props.prepared.document,
      assetFiles: {}, components: controllerPackages })
    expect(probe.registerObservation).toHaveBeenCalledTimes(1)
    await regular.destroy()
  })

  it('destroys a late cancelled mount before attaching a replacement candidate in the same host', async () => {
    const props = fixture()
    let finish!: () => void
    probe.wait = new Promise<void>(resolve => { finish = resolve })
    const rendered = render(<GenerationCandidatePreview {...props} />)
    await waitFor(() => expect(probe.sessions).toHaveLength(1))
    probe.wait = null
    rendered.rerender(<GenerationCandidatePreview {...props} prepared={{ ...props.prepared, previewId: crypto.randomUUID() }} />)
    expect(probe.sessions).toHaveLength(1)
    await act(async () => { finish() })
    await waitFor(() => expect(screen.getByTestId('generation-candidate-player')).toHaveAttribute('data-candidate-ready', 'true'))
    expect(probe.events).toEqual(['mount:0', 'destroy:0', 'mount:1'])
    expect(screen.getAllByText('候选中的互动')).toHaveLength(1)
    rendered.unmount()
    await waitFor(() => expect(probe.sessions[1]!.destroy).toHaveBeenCalledTimes(1))
  })

  it('cleans a session that finishes after unmount and does not update an unmounted preview', async () => {
    let finish!: () => void
    probe.wait = new Promise<void>(resolve => { finish = resolve })
    const rendered = render(<GenerationCandidatePreview {...fixture()} />)
    await waitFor(() => expect(probe.sessions).toHaveLength(1))
    rendered.unmount()
    await act(async () => { finish() })
    expect(probe.sessions[0]!.destroy).toHaveBeenCalledTimes(1)
    expect(probe.registerObservation).not.toHaveBeenCalled()
  })

  it('reports a failed candidate host and falls back to the candidate start when the old location was removed', async () => {
    const props = fixture()
    props.prepared.document.locations = props.prepared.document.locations.filter(location => location.id !== 'observed-location')
    const rendered = render(<GenerationCandidatePreview {...props} />)
    await waitFor(() => expect(probe.options).toHaveLength(1))
    expect(probe.options[0]?.initialLocationId).toBe(props.prepared.document.startLocationId)
    rendered.unmount()
    await act(async () => {})
    probe.failure = new Error('候选资源未能加载')
    render(<GenerationCandidatePreview {...props} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('候选资源未能加载')
    expect(probe.registerObservation).not.toHaveBeenCalled()
  })

  it('U10-execution-not-goal shows the same bounded changes and preserves checked, skipped, and failed execution facts', async () => {
    const props = fixture()
    const semanticChanges = generationSemanticChangesSchema.parse({ ...props.prepared.semanticChanges,
      changes: props.prepared.semanticChanges.changes.map(change => ({ ...change, truncated: { before: true, after: false } })),
      omitted: 2, comparison: { status: 'partial', scopes: [
        { scope: 'document', status: 'complete' },
        { scope: 'resource-assets', status: 'not-provided', reason: 'resource snapshots were not supplied' },
      ] }, truncation: { ...props.prepared.semanticChanges.truncation, omittedChanges: 2, truncatedValues: 1 } })
    props.prepared.semanticChanges = semanticChanges
    props.prepared.changes = semanticChanges.changes
    props.prepared.omitted = semanticChanges.omitted
    props.prepared.comparison = semanticChanges.comparison
    props.prepared.truncation = semanticChanges.truncation
    props.prepared.interactionChecks = { checked: ['rule-checked'], skipped: [{ ruleId: 'rule-skipped', reason: '条件未满足' }], evidence: [
      { source: 'published-player', ruleId: 'rule-checked', runId: 1, chainId: 11, status: 'checked', runStatus: 'completed',
        start: { locationId: 'page-1', stateId: null }, end: { locationId: 'page-2', stateId: 'answer' } },
      { source: 'published-player', ruleId: 'rule-skipped', runId: 2, chainId: 12, status: 'skipped', runStatus: 'skipped',
        start: { locationId: 'page-2', stateId: 'answer' }, end: { locationId: 'page-2', stateId: 'answer' }, reason: '条件未满足' },
      { source: 'published-player', ruleId: 'rule-failed', runId: 3, chainId: 13, status: 'failed', runStatus: 'failed',
        start: { locationId: 'page-2', stateId: 'answer' }, end: { locationId: 'page-3', stateId: null }, reason: '目的地不一致' },
    ] }

    render(<GenerationCandidatePreview {...props} />)
    expect(screen.getByLabelText('候选实际变更')).toHaveTextContent('比较范围不完整')
    expect(screen.getByLabelText('候选实际变更')).toHaveTextContent('另有 2 项未列出')
    expect(screen.getByLabelText('候选实际变更')).toHaveTextContent('当前结果不包含这些条目的完整详情')
    expect(screen.getByText('显示值已截断；此处不是完整字段内容。')).toBeDefined()
    const evidence = screen.getByLabelText('候选行为检查记录')
    expect(evidence).toHaveTextContent('已检查')
    expect(evidence).toHaveTextContent('已跳过')
    expect(evidence).toHaveTextContent('检查失败')
    expect(evidence).toHaveTextContent('page-1 → page-2 / 状态 answer')
    expect(evidence).toHaveTextContent('来源 Published Player')
    expect(evidence).toHaveTextContent('不代表教学目标已经通过')
    expect(screen.queryByText('教学目标已通过')).toBeNull()
  })
})
