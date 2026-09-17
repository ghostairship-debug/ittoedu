import { expect, it } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { addCourseScene } from '@/renderer/course/courseLocationCommands'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { verifyNativeInteractions } from '@/renderer/authoring/generation/nativeInteractionVerification'
import { PublishedInteractionRuns } from '@/player/interactions/PublishedInteractionSurfacePort'

it('U03-navigation-session retains causal completion across real session state and scene teardown', async () => {
  let project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  let slide = project.surfaces.find(surface => surface.type === 'slide')!
  const added = addCourseScene(project, { surfaceId: slide.id, expectedRevision: project.revision, now: new Date().toISOString() })
  if (!added.ok) throw new Error(added.reason)
  project = added.project
  slide = project.surfaces.find(surface => surface.type === 'slide')!
  const scene = slide.scenes[0]!, target = slide.scenes[1]!
  scene.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: 'button', text: '继续' }), 1))
  scene.presentation = { initialStateId: 'initial', states: [
    { id: 'initial', name: '初始', layerItemOverrides: {} },
    { id: 'revealed', name: '揭示', layerItemOverrides: {} },
  ] }
  const before = structuredClone(project)
  const input = { before, document: project, resources: { assetFiles: {}, componentPackages: {} }, signal: new AbortController().signal, deadlineAt: Date.now() + 10_000 }
  scene.interactions = [{ id: 'click', enabled: true, trigger: { type: 'node.click', nodeId: 'button' }, conditions: [], actions: [
    { id: 'navigate', start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', stateId: 'revealed' } },
  ] }, { id: 'entry', enabled: true, trigger: { type: 'scene.enter' }, conditions: [], actions: [
    { id: 'show', start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId: 'button', effect: 'none', durationMs: 0, easing: 'linear' } },
  ] }]
  const stateReport = await verifyNativeInteractions(input)
  expect(stateReport.checked).toEqual(['click'])
  expect(stateReport.evidence?.find(value => value.ruleId === 'click')).toMatchObject({
    source: 'published-player', status: 'checked', runStatus: 'navigation-terminal',
    start: { locationId: project.startLocationId, stateId: 'initial' },
    end: { locationId: project.startLocationId, stateId: 'revealed' },
  })
  expect(stateReport.executions?.find(run => run.ruleId === 'click')).toMatchObject({ status: 'navigation-terminal', navigation: { started: true, settled: true, matched: true, stateId: 'revealed' } })
  expect(stateReport.executions?.find(run => run.ruleId === 'entry')).toMatchObject({ parentRunId: stateReport.executions?.[0]?.runId, chainId: stateReport.executions?.[0]?.chainId })
  expect(stateReport.skipped.some(run => run.ruleId === 'entry')).toBe(true)

  scene.interactions[0]!.actions[0]!.action = { type: 'scene.go', sceneId: target.id }
  expect((await verifyNativeInteractions(input)).executions?.[0]?.status).toBe('navigation-terminal')
  scene.interactions[0]!.actions[0]!.action = { type: 'scene.go', sceneId: 'missing-scene' }
  await expect(verifyNativeInteractions(input)).rejects.toMatchObject({ nativeInteractionEvidence: [expect.objectContaining({ ruleId: 'click', status: 'failed', source: 'published-player' })] })
  expect(before.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.interactions).toEqual([])

  // A resolved operation or an unrelated transition cannot certify navigation.
  const runs = new PublishedInteractionRuns(), signal = new AbortController().signal
  const id = runs.start({ ruleId: 'navigation', surfaceId: 'surface', trigger: { type: 'node.click', nodeId: 'button' } }, signal)
  runs.prepareNavigation(signal, 'start', 'expected', 'revealed')
  runs.beginNavigation(id, 'start', 'expected')
  runs.settleNavigation(id, 'wrong', 'revealed')
  runs.finish(id, 'cancelled')
  expect(runs.read(id)?.status).toBe('failed')
  const stopped = runs.start({ ruleId: 'navigation', surfaceId: 'surface', trigger: { type: 'node.click', nodeId: 'button' } }, signal)
  runs.prepareNavigation(signal, 'start', 'expected')
  runs.beginNavigation(stopped, 'start', 'expected')
  runs.cancelAll('session-destroyed')
  runs.settleNavigation(stopped, 'expected', null)
  expect(runs.read(stopped)?.status).toBe('cancelled')
})
