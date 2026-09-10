// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { componentPackageMeta } from '@/renderer/components/editableComponentPackage'
import { createCourseAuthoringSession } from '@/renderer/authoring/courseAuthoringSession'
import { createCourseChatObservation } from '@/renderer/ui/chat/courseChatObservation'
import { createGenerationCandidateCoordinator } from '@/renderer/authoring/generation/prepareGenerationCandidate'
import { AuthoringToolFailure } from '@/renderer/authoring/tools/executeAuthoringTool'
import { LocalAgentHarness } from '@/main/localAgent/harness'
import { LocalAgentRepository } from '@/main/localAgent/repository'
import { generationHostFeedback } from '@/main/localAgent/generationHostFeedback'
import { createWorkspaceIdentity } from '@/main/workspaceIdentity'
import { MAX_GENERATION_PROMPT_BYTES, readGenerationFailure, type GenerationCandidate } from '@/shared/generationContract'
import { GENERATION_OPEN, GENERATION_CLOSE } from '@/shared/generationResult'
import type { DynamicBehaviorObservation } from '@/shared/dynamicBehaviorObservation'
import type { LocalAgentCapabilities, LocalAgentHostResult } from '@/shared/localAgentContract'
import type { LocalAgentCliAdapterV2, LocalAgentNativeEvent } from '@/shared/localAgentTaskContract'
import type { DesktopAPI } from '@/shared/ipcTypes'

// Only the visual observation/admission ports are fixtures. Source patch
// preparation, captureNext resources, durable Harness records and staging run.
const h = vi.hoisted(() => ({ state: undefined as any, capture: vi.fn(), admit: vi.fn() }))
vi.mock('@/renderer/store/editorStore', () => ({
  useEditorStore: { getState: () => h.state },
  selectActiveCourseProjectDocument: (state: any) => state.document,
  selectEffectiveLayerProjection: () => null,
  selectMediaAssetFiles: () => ({}),
}))
vi.mock('@/renderer/authoring/generation/authoringObservation', () => ({
  createAuthoringObservationController: () => ({ capture: h.capture, dispose() {} }),
}))
vi.mock('@/renderer/authoring/tools/dynamicCandidateAdmission', async importOriginal => ({
  ...(await importOriginal<typeof import('@/renderer/authoring/tools/dynamicCandidateAdmission')>()),
  admitDynamicCandidate: h.admit,
}))

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals(); vi.clearAllMocks()
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

const capabilities: LocalAgentCapabilities = { version: 1, adapter: 'claude', cliVersion: 'fixture',
  models: [{ id: 'fixture', resolvedModel: null, label: 'Fixture', image: 'supported', effort: { kind: 'unsupported' } }],
  current: { model: 'fixture', resolvedModel: null, effort: null },
  input: { image: 'supported', readFile: 'supported', question: 'structured', correction: 'active-turn', cancel: 'supported' } }

class ReadingAdapter implements LocalAgentCliAdapterV2 {
  readonly id = 'claude' as const
  turns: Parameters<LocalAgentCliAdapterV2['startTurn']>[0][] = []
  readFeedback: any
  candidateRoot?: string
  constructor(readonly reply: string, readonly readStagedFeedback = false) {}
  async open(input: Parameters<LocalAgentCliAdapterV2['open']>[0]) {
    this.candidateRoot = input.candidateRoot
    return { externalSessionId: 'confirmed-evidence-session', capabilities }
  }
  getExternalSessionId() { return 'confirmed-evidence-session' }
  async configure() { return capabilities }
  async startTurn(input: Parameters<LocalAgentCliAdapterV2['startTurn']>[0]) {
    this.turns.push(input)
    if (this.readStagedFeedback) {
      const root = this.candidateRoot
      if (!root) throw new Error('The native adapter did not receive the current candidate root')
      // A real child-process file read, using only the paths exposed to the
      // native adapter. No model/CLI credentials or product test backdoor.
      this.readFeedback = JSON.parse(execFileSync(process.execPath, ['-e', `
        const fs=require('node:fs'),path=require('node:path'),root=process.argv[1];
        const read=(file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
        const request=read('request.json');
        const feedbackPath=request.resourceIndex.find(file=>file.path.endsWith('/host-feedback.json')).path;
        const feedback=read(feedbackPath),failure=feedback.result.failure;
        const behavior=read(failure.behaviorEvidence.path);
        process.stdout.write(JSON.stringify({requestId:request.requestId,failure,hostFailure:feedback.hostResult.failure,
          behavior,frames:behavior.observations.flatMap(item=>item.frames.map(frame=>({
            path:frame.path,bytes:fs.readFileSync(path.join(root,frame.path)).toString('base64')
          })))}));
      `, root], { encoding: 'utf8', windowsHide: true, maxBuffer: 2_000_000 }))
    }
    return { nativeTurnId: 'evidence-turn' }
  }
  async input(input: Parameters<LocalAgentCliAdapterV2['input']>[0]): ReturnType<LocalAgentCliAdapterV2['input']> {
    return { taskId: input.taskId, epoch: input.epoch, workspace: input.workspace, inputId: input.inputId,
      turnId: input.turnId, status: 'rejected', reason: 'fixture' }
  }
  async *events(): AsyncIterable<LocalAgentNativeEvent> {
    const input = this.turns.at(-1)!
    const identity = { taskId: input.taskId, epoch: input.epoch, workspace: input.workspace, runId: input.runId, nativeTurnId: 'evidence-turn' }
    yield { ...identity, kind: 'text', phase: 'body', itemId: 'reply', operation: 'replace', text: this.reply }
    yield { ...identity, kind: 'turn-ended', status: 'completed', failure: null }
  }
  async close() {}
}

it('resourceizes over 80KB of failed prepare frames through captureNext and a budgeted real Harness continuation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'failed-evidence-'))
  directories.push(directory)
  const document = createBlankFlowCourseProject(), componentId = 'com.example.failure-evidence'
  const surface = document.surfaces[0]!
  if (surface.type !== 'flow') throw new Error('Expected Flow fixture')
  const runtime = (label: string) => `CoursewareComponent.define({id:${JSON.stringify(componentId)},runtimeApiVersion:4,create(ctx){var p=document.createElement('p');p.textContent=${JSON.stringify(label)};ctx.dom.root.append(p);return{destroy(){p.remove()}}}});`
  const files = { 'manifest.json': Buffer.from(JSON.stringify({ schemaVersion: 4, runtimeApiVersion: 4, id: componentId,
    name: 'Failure evidence fixture', version: '1.0.0', entry: 'runtime.js', defaultSize: { width: 128, height: 96 },
    minSize: { width: 16, height: 16 }, preserveAspectRatio: false, assets: {}, defaultProps: {},
    supportedScopes: ['scene', 'global'], renderMode: 'dom' })), 'runtime.js': Buffer.from(runtime('before')) }
  const data = parseComponentPackageFiles(files)
  document.componentPackages[componentId] = componentPackageMeta(data)
  const fallback = await sharp({ create: { width: 128, height: 96, channels: 4, background: '#334455' } }).png().toBuffer()
  document.assets.fallback = { id: 'fallback', filename: 'fallback.png', path: 'assets/fallback.png', kind: 'image',
    mimeType: 'image/png', byteLength: fallback.byteLength, width: 128, height: 96 }
  surface.blocks.push({ id: 'failed-component', type: 'component', component: { packageId: componentId, version: '1.0.0' },
    props: {}, staticFallbackAssetId: 'fallback', wrap: 'none' })
  const owner = { projectId: document.id, projectPath: path.join(directory, 'course.h5lesson') }
  const workspace = createWorkspaceIdentity(document.id, owner.projectPath)
  h.state = { document, projectPath: owner.projectPath, componentPackages: { [componentId]: data },
    courseAuthoringSession: createCourseAuthoringSession({ locationId: document.startLocationId, surfaceType: 'flow',
      revision: document.revision, itemIds: ['failed-component'] }) }
  h.capture.mockImplementation(async () => ({ document, resourceFiles: [{ path: 'observation/current-frame.png',
    encoding: 'base64', content: fallback.toString('base64'), role: 'image', mediaType: 'image/png' }],
    observation: { documentRevision: document.revision, sessionGeneration: h.state.courseAuthoringSession.token.generation,
      draftEpoch: 0, viewEpoch: 0, runtime: null, surfaceId: surface.id, locationId: document.startLocationId,
      stateId: null, source: 'authoring', capturedAt: Date.now(), files: [{ fileId: 'current-frame',
        relativePath: 'observation/current-frame.png', mediaType: 'image/png', byteLength: fallback.byteLength, role: 'image' }] } }))
  const api = { localAgent: vi.fn(async () => ({ enabled: true, fileStatus: { status: 'current' } })) } as unknown as DesktopAPI
  vi.stubGlobal('window', { desktopAPI: { dynamicAdmission: vi.fn() } })
  const bridge = createCourseChatObservation(api, owner)
  const repository = new LocalAgentRepository(directory)
  let harness: LocalAgentHarness | undefined
  try {
    const request = await bridge.capture({ workspace, scope: 'selection', purpose: 'local-edit', intent: 'edit',
      applyPolicy: 'auto', expectedResult: 'candidate', instruction: 'Fix the existing component source on all instances.' })
    const destination = request.destinations.find(value => value.kind === 'update' && value.target.itemId === componentId)!
    const candidate: GenerationCandidate = { version: 1, requestId: request.requestId, candidateId: randomUUID(),
      summary: 'Repair existing component behavior', afterCommit: { version: 1, action: 'observe', reason: 'Inspect the behavior.' },
      steps: [{ id: 'patch-source', tool: 'component.package', carrier: 'generated-component', destination,
        lowerCarrierReason: 'The requested behavior requires changing the existing component source.',
        input: { operation: 'patch', mode: 'shared', basePackageId: componentId, baseVersion: data.manifest.version,
          baseContentIdentity: document.componentPackages[componentId]!.contentSha256,
          changedFiles: { 'runtime.js': Buffer.from(runtime('after')).toString('base64') }, deleteFiles: [] } }] }
    const frames = await Promise.all(['#110022', '#220044'].map(background =>
      sharp({ create: { width: 128, height: 96, channels: 4, background } }).png({ compressionLevel: 0 }).toBuffer()))
    expect(frames.reduce((bytes, frame) => bytes + frame.byteLength, 0)).toBeGreaterThan(80_000)
    const evidence: DynamicBehaviorObservation = { version: 1, status: 'observed', mode: 'full-admission',
      projectId: document.id, documentRevision: document.revision + 1, locationId: document.startLocationId,
      stateId: null, instanceIds: ['failed-component'], sourceIdentities: { 'failed-component': 'failed-source-identity' },
      actions: [], frames: frames.map((bytes, index) => ({ phase: 'running', elapsedMs: index * 250, capturedAt: index + 1,
        stateVersion: 0, publicState: {}, width: 128, height: 96, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` })),
      elapsedMs: 250, semanticVerdict: 'requires-review' }
    const diagnostic = { code: 'dynamic-host-update-failed', message: 'The resize callback failed after two observed frames.',
      path: ['componentPackages', componentId, 'runtime.js', 'resize'] }
    h.admit.mockRejectedValue(new AuthoringToolFailure([diagnostic], [evidence]))
    const commit = vi.fn(() => true)
    const coordinator = createGenerationCandidateCoordinator({ readDocument: () => document,
      readResources: () => ({ assetFiles: { fallback }, componentPackages: { [componentId]: data } }),
      readWorkspace: () => workspace, readSessionGeneration: () => h.state.courseAuthoringSession.token.generation, commit })
    const before = JSON.stringify(document)
    const error = await coordinator.prepare(request, candidate).catch(error => error)
    const failure = readGenerationFailure(error)
    expect(failure).toMatchObject({ stage: 'dynamic-admission', requestId: request.requestId, candidateId: candidate.candidateId,
      stepId: 'patch-source', tool: 'component.package', destination, diagnostics: [diagnostic], behaviorEvidence: [evidence] })
    expect(h.admit).toHaveBeenCalledOnce()
    expect(commit).not.toHaveBeenCalled()
    expect(JSON.stringify(document)).toBe(before)
    const first = new ReadingAdapter(`${GENERATION_OPEN}${JSON.stringify(candidate)}${GENERATION_CLOSE}`)
    const second = new ReadingAdapter('The failed candidate evidence is available for correction.', true)
    const adapters = [first, second]
    harness = new LocalAgentHarness(repository, () => adapters.shift()!)
    const id = await harness.generate(workspace, 'claude', request)
    await expect.poll(() => harness!.running).toBe(false)
    expect((await harness.candidate(workspace, id)).kind).toBe('candidate')
    const result: LocalAgentHostResult = { requestId: request.requestId, candidateId: candidate.candidateId,
      status: 'rejected', summary: 'Candidate preparation failed; no course changes were committed.', failure: failure! }
    await harness.hostResult(workspace, id, result)
    const storedBefore = (await repository.list(workspace)).v2.find(record => record.id === id)!.hostResults.at(-1)!
    expect(Buffer.byteLength(JSON.stringify(result) + JSON.stringify(storedBefore))).toBeGreaterThan(MAX_GENERATION_PROMPT_BYTES)
    const next = await bridge.captureNext(request, undefined, failure!.behaviorEvidence)
    expect(next.documentRevision).toBe(request.documentRevision)
    expect(next.resourceFiles!.filter(file => file.path.includes('/dynamic/') && file.role === 'image')).toHaveLength(2)
    const missing = { ...next, resourceFiles: next.resourceFiles!.filter(file => !file.path.endsWith('frame-1.png')) }
    expect(() => generationHostFeedback(missing, result, storedBefore)).toThrow('匹配的本轮图片资源')
    const mismatched = { ...next, resourceFiles: next.resourceFiles!.map(file => file.path.endsWith('frame-1.png')
      ? { ...file, content: frames[0]!.toString('base64') } : file) }
    expect(() => generationHostFeedback(mismatched, result, storedBefore)).toThrow('本轮资源不一致')
    const withFrameSource = (source?: string) => {
      const changed = structuredClone(next)
      const resource = changed.resourceFiles!.find(file => file.path === 'observation/dynamic/behavior.json')!
      const metadata = JSON.parse(resource.content)
      for (const observation of metadata.observations) for (const frame of observation.frames) {
        if (source === undefined) delete frame.source
        else frame.source = source
      }
      resource.content = JSON.stringify(metadata)
      changed.observation!.files.find(file => file.relativePath === resource.path)!.byteLength = Buffer.byteLength(resource.content)
      return changed
    }
    expect(() => generationHostFeedback(withFrameSource('current-live-host'), result, storedBefore)).toThrow('来源')
    expect(generationHostFeedback(withFrameSource(), result, storedBefore).result.failure?.behaviorEvidence)
      .toMatchObject({ path: 'resources/observation/dynamic/behavior.json', observations: 1, semanticVerdict: 'requires-review' })
    await harness.continue(workspace, id, next)
    await expect.poll(() => harness!.running).toBe(false)
    expect(second.turns).toHaveLength(1)
    const prompt = second.turns[0]!.text
    expect(Buffer.byteLength(prompt)).toBeLessThan(MAX_GENERATION_PROMPT_BYTES)
    expect(prompt).not.toContain('data:image/png;base64,')
    expect(prompt).toContain(diagnostic.message)
    expect(prompt).toContain('patch-source')
    expect(prompt).toContain(JSON.stringify(destination))
    expect(second.candidateRoot).not.toBe(first.candidateRoot)
    expect(second.readFeedback.requestId).toBe(next.requestId)
    expect(second.readFeedback.failure).toMatchObject({ diagnostics: [diagnostic], stepId: 'patch-source', destination,
      behaviorEvidence: { path: 'resources/observation/dynamic/behavior.json', observations: 1, semanticVerdict: 'requires-review' } })
    expect(second.readFeedback.hostFailure).toEqual(second.readFeedback.failure)
    expect(second.readFeedback.behavior.imageFeedback).toBe('candidate-host-frames')
    expect(second.readFeedback.behavior.observations[0].frames.map((frame: any) => frame.source))
      .toEqual(['candidate-host-before-commit', 'candidate-host-before-commit'])
    expect(second.readFeedback.frames.map((frame: any) => frame.bytes)).toEqual(frames.map(frame => frame.toString('base64')))
    const storedAfter = (await repository.list(workspace)).v2.find(record => record.id === id)!.hostResults.at(-1)!
    expect(storedAfter.failure).toEqual(failure)
    expect(result.failure!.behaviorEvidence).toEqual([evidence])
  } finally { bridge.dispose(); await harness?.close() }
})
