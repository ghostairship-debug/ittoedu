import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import { runDynamicCandidateHostSmoke } from '../../src/renderer/authoring/tools/dynamicCandidateAdmission'
import { AuthoringToolFailure } from '../../src/renderer/authoring/tools/executeAuthoringTool'
import { createPublishedCourseSession, type PublishedCourseSession } from '../../src/player/surfaces/publishedDynamicHosts'
import { CoursePlayer } from '../../src/player/surfaces/CoursePlayer'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseProjectDocument, RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import type { DynamicBehaviorObservation } from '../../src/shared/dynamicBehaviorObservation'

const output = resolve('output/g20/m13/runtime-live-isolation')
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='
const itemId = 'score-runtime'
const sessions: PublishedCourseSession[] = []

function scoreSource(points: number, failUpdate = false) {
  return `CoursewareRuntime.define({
    protocol:'surface-runtime',runtimeApiVersion:3,
    create(ctx){
      var score=ctx.courseState.get('score')||0;
      ctx.courseState.set('score',score);ctx.courseState.set('phase','ready');
      var button=document.createElement('button');button.type='button';button.dataset.scoreButton='true';button.textContent='加分';
      var output=document.createElement('span');output.dataset.scoreValue='true';output.textContent=String(score);
      button.onclick=function(){score+=${points};ctx.courseState.set('score',score);ctx.courseState.set('phase','answered');output.textContent=String(score)};
      ctx.dom.root.replaceChildren(button,output);
      return {updateContent(){${failUpdate ? "throw new Error('candidate update rejected')" : ''}},resize(){},suspend(){},resume(){},
        destroy(){button.onclick=null;ctx.dom.root.replaceChildren()}};
    }
  })`
}

function fixture(source: string): CourseProjectDocument {
  const project = createBlankCourseProject({ id: 'm13-stateful-runtime', title: '计分状态隔离', includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('Slide fixture missing')
  const item: RuntimeLayerItem = {
    kind: 'runtime', layerItemId: itemId, label: '计分 Runtime', order: 1,
    frame: { mode: 'absolute', x: 80, y: 80, width: 320, height: 160 },
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source,
      content: { values: {} }, assets: {} },
  }
  surface.scenes[0]!.layerItems.push(item)
  return courseProjectDocumentSchema.parse(project)
}

function replaceSource(project: CourseProjectDocument, source: string): CourseProjectDocument {
  const candidate = structuredClone(project)
  const surface = candidate.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('Slide fixture missing')
  const item = surface.scenes[0]?.layerItems.find(entry => entry.layerItemId === itemId)
  if (!item || item.kind !== 'runtime') throw new Error('Runtime fixture missing')
  item.runtime.source = source
  return courseProjectDocumentSchema.parse(candidate)
}

function mountDocument() {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const view = frame.contentWindow, frameDocument = frame.contentDocument
  if (!view || !frameDocument) throw new Error('JSDOM iframe realm unavailable')
  const container = frameDocument.createElement('div')
  Object.defineProperties(container, { clientWidth: { configurable: true, value: 1280 }, clientHeight: { configurable: true, value: 720 } })
  frameDocument.body.append(container)
  return { frame, container }
}

async function play(project: CourseProjectDocument) {
  const { frame, container } = mountDocument()
  const session = createPublishedCourseSession(buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} }))
  sessions.push(session)
  await session.mount(container)
  const button = container.querySelector<HTMLButtonElement>('[data-score-button="true"]')
  if (!button) throw new Error('Stateful Runtime did not mount its score button')
  return { frame, container, session, button }
}

function state(session: PublishedCourseSession) {
  const observation = session.readObservationState()
  return { locationId: observation.locationId, stateId: observation.stateId, stateVersion: observation.stateVersion,
    courseState: observation.publicState.courseState }
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.destroy()))
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

it('M13-T02 keeps a scoring live Runtime untouched while private candidate checks fail and pass with honest evidence', async () => {
  mkdirSync(output, { recursive: true })
  const liveProject = fixture(scoreSource(1))
  const liveProjectBefore = structuredClone(liveProject)
  const live = await play(liveProject)
  live.button.click()
  const before = state(live.session)
  expect(before.courseState).toMatchObject({ score: 1, phase: 'answered' })
  expect(live.container.querySelector('[data-score-value="true"]')?.textContent).toBe('1')

  // JSDOM supplies geometry and a sampled PNG token; public state and Runtime execution come from the actual Published host.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0,
    right: 320, bottom: 160, width: 320, height: 160, toJSON: () => ({}) } as DOMRect)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  // JSDOM has no rasterizer. The actual Runtime mount/update/lifecycle still run; only the export capture result is stubbed.
  vi.spyOn(CoursePlayer.prototype, 'captureSurface').mockResolvedValue({ ok: true,
    value: { format: 'data-url', content: png, width: 1, height: 1 } })
  const capturePort = { captureFrame: async () => ({ capturedAt: Date.now(), width: 1, height: 1, dataUrl: png }) }
  const target = [{ locationId: liveProject.locations[0]!.id, instanceIds: [itemId] }]
  const resources = { assetFiles: {}, componentPackages: {} }
  const failedProject = replaceSource(liveProject, scoreSource(2, true))
  let failedCompletions = 0
  const failure = await runDynamicCandidateHostSmoke(failedProject, resources, target, false,
    { verificationMode: 'full-admission', capturePort, onTargetComplete: () => { failedCompletions += 1 } }).catch(error => error)
  expect(failure).toBeInstanceOf(AuthoringToolFailure)
  expect(failedCompletions).toBe(0)
  expect(failure.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('candidate update rejected') })]))
  expect(failure.behaviorEvidence?.[0]).toMatchObject({ status: 'observed', mode: 'full-admission', semanticVerdict: 'requires-review' })
  expect(failure.behaviorEvidence?.[0]?.actions).not.toContain('update-inputs')
  expect(failure.behaviorEvidence?.[0]?.frames[0]?.publicState).toMatchObject({ courseState: { score: 0, phase: 'ready' } })
  expect(state(live.session)).toEqual(before)
  expect(live.button.isConnected).toBe(true)
  expect(live.container.querySelector('[data-score-value="true"]')?.textContent).toBe('1')
  expect(liveProject).toEqual(liveProjectBefore)

  const candidateProject = replaceSource(liveProject, scoreSource(2))
  const observations: DynamicBehaviorObservation[] = []
  let passedCompletions = 0
  const captures = await runDynamicCandidateHostSmoke(candidateProject, resources, target, false,
    { verificationMode: 'full-admission', capturePort, onBehaviorEvidence: evidence => observations.push(...evidence),
      onTargetComplete: () => { passedCompletions += 1 } })
  expect(captures).toEqual([])
  expect(passedCompletions).toBe(1)
  expect(observations).toHaveLength(1)
  expect(observations[0]).toMatchObject({ status: 'observed', mode: 'full-admission', actions: expect.arrayContaining(['update-inputs']), semanticVerdict: 'requires-review' })
  expect(observations[0]!.frames[0]!.publicState).toMatchObject({ courseState: { score: 0, phase: 'ready' } })
  expect(state(live.session)).toEqual(before)
  expect(live.button.isConnected).toBe(true)
  expect(liveProject).toEqual(liveProjectBefore)

  // The scoring mechanic itself is exercised in a second, separate playback session; the private check above does not claim it.
  const candidate = await play(candidateProject)
  candidate.button.click()
  expect(state(candidate.session).courseState).toMatchObject({ score: 2, phase: 'answered' })
  expect(state(live.session)).toEqual(before)
  const evidence = { liveBefore: before, liveAfter: state(live.session), failed: { completed: failedCompletions, diagnostics: failure.diagnostics,
    frames: failure.behaviorEvidence?.[0]?.frames.map((frame: { phase: string; publicState: unknown }) => ({ phase: frame.phase, publicState: frame.publicState })) },
    passed: { completed: passedCompletions, status: observations[0]?.status, mode: observations[0]?.mode, actions: observations[0]?.actions,
      semanticVerdict: observations[0]?.semanticVerdict, frames: observations[0]?.frames.map(frame => ({ phase: frame.phase, publicState: frame.publicState })) },
    separatelyPlayedCandidate: state(candidate.session), projectUnchanged: true, captureStubbed: true,
    limitation: 'Vitest JSDOM runs real Published Runtime mounts, updates, and lifecycle. Canvas capture and sample PNG are stubs; this does not prove OS process separation, actual pixels, or an Electron mouse click.' }
  writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
})
