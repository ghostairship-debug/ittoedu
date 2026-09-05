import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore, selectActiveCourseProjectDocument } from '@/renderer/store/editorStore'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import { configureSlideInputAtTarget } from '@/renderer/course/v9SlideContentCommands'
import { makeSlideAuthoringTarget } from '@/renderer/course/slideAuthoringBackend'
import { deleteSlideSceneLayers, duplicateSlideSceneLayers, deleteSlideSceneInteractionRule } from '@/renderer/course/v9SlideActionCommands'
import { buildInputRuleFamily, inspectInputRuleFamily, type InputRuleConfig } from '@/renderer/interactions/inputRuleFamily'
import { CourseStateStore } from '@/player/CourseStateStore'
import { PublishedInteractionController } from '@/player/interactions/PublishedInteractionController'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { copySlideSceneClipboard } from '@/renderer/course/v9SlideClipboard'
import { buildCoursePptx } from '@/renderer/export/course/buildCoursePptx'
import { collectCourseProjectExportPreflight } from '@/renderer/export/exportPreflight'
import { unzipSync } from 'fflate'

function active() { return selectActiveCourseProjectDocument(useEditorStore.getState())! }
function inputIn(project = active()) {
  const surface = project.surfaces.find(surface => surface.type === 'slide')!
  if (surface.type !== 'slide') throw new Error('slide')
  const scene = surface.scenes[0]!
  const item = scene.layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'input')!
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'input') throw new Error('input missing')
  return { scene, item, data: item.content.data }
}

describe('input authoring delivery', () => {
  beforeEach(() => useEditorStore.getState().createNewProject())
  it('creates, saves, undoes and redoes the input, declarations and feedback together', () => {
    const before = active()
    useEditorStore.getState().addInputNode()
    const { item, data, scene } = inputIn()
    expect(data.ruleFamilyRuleIds).toHaveLength(3)
    expect(inspectInputRuleFamily(item.layerItemId, data, scene.interactions).conflict).toBe(false)
    expect(active().courseState).toHaveLength(before.courseState.length + 2)
    const reopened = openCourseProjectArchive(useEditorStore.getState().exportV9SlideCandidateArchive()!)
    expect(inputIn(reopened.project).data).toEqual(data)
    useEditorStore.getState().undo()
    expect(active()).toEqual(before)
    useEditorStore.getState().redo()
    expect(inputIn().data).toEqual(data)
  })
  it('copies fresh keys and rule IDs, then deletes unused copied declarations', () => {
    useEditorStore.getState().addInputNode()
    const { item, data } = inputIn()
    const session = useEditorStore.getState().slideBackend!.getSession()
    const copied = duplicateSlideSceneLayers(session, [item.layerItemId])
    expect(copied.ok, copied.reason).toBe(true)
    const next = copied.nextSession!
    const project = courseProjectDocumentSchema.parse(next.history.present)
    expect(project.courseState).toHaveLength(session.history.present.courseState.length + 2)
    const id = next.selection.selectionIds[0]!
    const scene = inputIn(project).scene
    const copy = scene.layerItems.find(item => item.layerItemId === id)!
    if (copy.kind !== 'native' || copy.content.nativeType !== 'input') throw new Error('input')
    expect(copy.content.data.stateKey).not.toBe(data.stateKey)
    expect(inspectInputRuleFamily(id, copy.content.data, scene.interactions).conflict).toBe(false)
    const removed = deleteSlideSceneLayers(next, [id])
    expect(removed.ok, removed.reason).toBe(true)
    expect(removed.nextSession!.history.present.courseState).toEqual(session.history.present.courseState)
  })
  it('switches to number atomically and rejects stale or invalid answers', () => {
    useEditorStore.getState().addInputNode()
    const session = useEditorStore.getState().slideBackend!.getSession()
    const { item, data, scene } = inputIn()
    const initial = inspectInputRuleFamily(item.layerItemId, data, scene.interactions).config!
    const target = makeSlideAuthoringTarget(session, item.layerItemId, 'item')
    const config: InputRuleConfig = { answerType: 'number', min: 10, max: 12, correct: initial.correct, error: initial.error }
    const changed = configureSlideInputAtTarget(session, target, { mode: 'apply', config })
    expect(changed.ok, changed.reason).toBe(true)
    expect(inputIn(changed.nextSession!.history.present).data.answerType).toBe('number')
    expect(inputIn(changed.nextSession!.history.present).data.ruleFamilyRuleIds).toHaveLength(4)
    expect(configureSlideInputAtTarget(changed.nextSession!, target, { mode: 'apply', config }).ok).toBe(false)
    const invalid = configureSlideInputAtTarget(session, target, { mode: 'apply', config: { ...config, min: 20 } })
    expect(invalid.ok).toBe(false)
    expect(invalid.nextSession!.history.present).toEqual(session.history.present)
  })
  it('carries managed feedback with the clipboard and can delete that feedback safely', () => {
    useEditorStore.getState().addInputNode()
    const { item, scene } = inputIn()
    const session = useEditorStore.getState().slideBackend!.getSession()
    const clipboard = copySlideSceneClipboard(session, [item.layerItemId])
    expect(clipboard.items).toHaveLength(3)
    const feedbackIds = scene.layerItems.filter(node => node.layerItemId !== item.layerItemId).map(node => node.layerItemId)
    const removed = deleteSlideSceneLayers(session, feedbackIds)
    expect(removed.ok, removed.reason).toBe(true)
    expect(inputIn(removed.nextSession!.history.present).data.ruleFamilyRuleIds).toEqual([])
  })
  it('exports a parseable editable PPTX field and reports the static interaction boundary', async () => {
    useEditorStore.getState().addInputNode()
    const project = active()
    const resources = { assetFiles: {}, components: {} }
    const preflight = collectCourseProjectExportPreflight(project, 'pptx', resources)
    expect(preflight.items.some(item => item.message.includes('静态填写区'))).toBe(true)
    expect(preflight.items.some(item => item.code === 'project-health:published-interaction-trigger-unsupported')).toBe(false)
    const result = await buildCoursePptx({ project, ...resources })
    const entries = unzipSync(result.bytes)
    const xml = new TextDecoder().decode(entries['ppt/slides/slide1.xml'])
    const parsed = new DOMParser().parseFromString(xml, 'application/xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    expect(xml).toContain('填写答案')
    expect(xml).toContain('静态填写区')
  })
  it('allows professional rule deletion and releases the family atomically', () => {
    useEditorStore.getState().addInputNode()
    const { data } = inputIn()
    const session = useEditorStore.getState().slideBackend!.getSession()
    const removed = deleteSlideSceneInteractionRule(session, data.ruleFamilyRuleIds[0]!)
    expect(removed.ok, removed.reason).toBe(true)
    const next = inputIn(removed.nextSession!.history.present)
    expect(next.data.ruleFamilyRuleIds).toEqual([])
    expect(next.scene.interactions).toHaveLength(2)
    expect(removed.nextSession!.history.past).toHaveLength(session.history.past.length + 1)
  })
})

describe('input atomic submission', () => {
  it('rejects an invalid or duplicate entry before any state or notification changes', () => {
    const changes = vi.fn()
    const store = new CourseStateStore(changes)
    store.set('value', 1)
    changes.mockClear()
    expect(() => store.setMany([{ key: 'value', value: 2 }, { key: 'bad', value: () => 3 }])).toThrow()
    expect(() => store.setMany([{ key: 'value', value: 2 }, { key: 'value', value: 3 }])).toThrow()
    expect(store.snapshot()).toEqual({ value: 1 })
    expect(changes).not.toHaveBeenCalled()
  })
  it.each([
    ['text', ' ＡＮＳＷＥＲ  ', true, 'answer', 'correct'], ['text', 'wrong', true, 'wrong', 'error'],
    ['text', '  ', false, '', 'error'], ['number', '１.５', true, 1.5, 'correct'],
    ['number', '1e0', true, 1, 'correct'], ['number', '0', true, 0, 'error'],
    ['number', '3', true, 3, 'error'], ['number', '0x10', false, 0, 'error'],
    ['number', '1,000', false, 0, 'error'], ['number', '', false, 0, 'error'],
    ['number', 'Infinity', false, 0, 'error'], ['number', '12x', false, 0, 'error'],
  ] as const)('%s %s writes both keys before one branch', async (answerType, raw, valid, value, feedback) => {
    const changes = vi.fn()
    const store = new CourseStateStore(changes)
    store.setMany([{ key: 'value', value: answerType === 'text' ? 'old' : 99 }, { key: 'valid', value: true }])
    changes.mockClear()
    let submit: ((raw: string) => void) | undefined
    let sequence = 0
    const actions = { correct: [{ type: 'course-state.set' as const, key: 'feedback', value: 'correct' }], error: [{ type: 'course-state.set' as const, key: 'feedback', value: 'error' }] }
    const rules = buildInputRuleFamily('input', { stateKey: 'value', validityKey: 'valid' }, answerType === 'text'
      ? { answerType, answers: ['answer'], ...actions } : { answerType, min: 1, max: 2, ...actions }, () => String(++sequence))
    const controller = new PublishedInteractionController({ surfaceId: 'surface', rules,
      surface: { bindNodeClick: () => null, executeNodeMotion: () => true,
        describeInput: () => ({ answerType, stateKey: 'value', validityKey: 'valid', defaultValue: answerType === 'text' ? '' : 0 }),
        bindInputSubmit: (_id, listener) => { submit = listener; return () => { submit = undefined } },
      },
      session: { courseState: store, setCourseStateBatch: entries => store.setMany(entries), currentSceneId: () => 'scene',
        goToScene: () => false, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false },
    })
    submit!(raw)
    await vi.waitFor(() => expect(store.get('feedback')).toBe(feedback))
    expect(store.get('value')).toBe(value)
    expect(store.get('valid')).toBe(valid)
    expect(changes.mock.calls.filter(([change]) => change.type === 'batch')).toHaveLength(1)
    expect(changes.mock.calls.filter(([change]) => change.key === 'feedback')).toHaveLength(1)
    controller.destroy()
    expect(submit).toBeUndefined()
  })
})
