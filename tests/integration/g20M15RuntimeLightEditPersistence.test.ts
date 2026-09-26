import { afterEach, beforeEach, expect, it } from 'vitest'
import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '@/core/drivers/codecs/courseProjectArchive'
import { createPublishedCourseSession, type PublishedCourseSession } from '@/player/surfaces/publishedDynamicHosts'
import { useEditorStore, selectActiveSceneId } from '@/renderer/store/editorStore'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, RuntimeLayerItem } from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import { bootTriageCourseHost, formalCourse, formalProject, projectCourse, redoCourse, settleCourse, undoCourse, type TriageCourseHost } from '../helpers/triage-t7-courseHost'

// M15-T03: a Runtime's own text and a picture it shows are edited as a rule and a managed asset; they survive the
// Runtime drawing again, undo and redo, and save and reopen, and its source is never rewritten.
let host: TriageCourseHost
const sessions: PublishedCourseSession[] = []
beforeEach(async () => { host = await bootTriageCourseHost() })
afterEach(async () => { await Promise.all(sessions.splice(0).map(session => session.destroy())); document.body.replaceChildren() })

const SOURCE = `CoursewareRuntime.define({
  runtimeApiVersion: 3,
  create(ctx) {
    var questions = ['听录音，选出正确的图片', '跟读句子'];
    var index = 0;
    var render = function () {
      ctx.dom.root.innerHTML = '<section><h2>' + questions[index] + '</h2><img alt=""><button type="button">下一题</button></section>';
      ctx.dom.root.querySelector('img').setAttribute('src', ctx.assets.url('hero'));
      ctx.dom.root.querySelector('button').addEventListener('click', function () { index = (index + 1) % questions.length; render(); });
    };
    render();
    return { destroy: function () { ctx.dom.root.innerHTML = ''; } };
  }
});`
const OLD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const NEW = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2])
const hero: AssetMeta = { id: 'hero-old', filename: 'hero-old.png', mimeType: 'image/png', kind: 'image', path: 'assets/hero-old.png', byteLength: OLD.byteLength, width: 1, height: 1 }
const replacement: AssetMeta = { id: 'hero-new', filename: 'hero-new.png', mimeType: 'image/png', kind: 'image', path: 'assets/hero-new.png', byteLength: NEW.byteLength, width: 1, height: 1 }

function course(): CourseProjectDocument {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  const quiz: RuntimeLayerItem = {
    layerItemId: 'quiz', label: '小测验', order: 1, visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit', frame: { mode: 'absolute', x: 40, y: 40, width: 640, height: 360 }, kind: 'runtime',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source: SOURCE, content: { values: {} }, assets: { hero: { assetId: hero.id } } },
  }
  surface.scenes[0]!.layerItems = [quiz]
  project.assets = { [hero.id]: hero } as never
  return courseProjectDocumentSchema.parse(project)
}
const quizOf = (project: CourseProjectDocument) => {
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  const item = surface.scenes[0]!.layerItems.find(value => value.layerItemId === 'quiz')
  if (item?.kind !== 'runtime') throw new Error('runtime')
  return item
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

it('M15 a Runtime text rule and a replaced picture survive redraw, undo and redo, save and reopen, and leave the source alone', async () => {
  await projectCourse(host, course(), { [hero.id]: OLD }, {})
  await settleCourse()
  const state = () => useEditorStore.getState()
  const projectId = formalProject(host).id, sceneId = selectActiveSceneId(state())
  const base = { projectId, scope: 'scene' as const, sceneId, nodeId: 'quiz' }

  // The teacher changes the heading where it is shown (original text and its region) and replaces the picture.
  const text = state().captureRuntimeContentTextTarget({ ...base, targetId: 'auto:1:text', kind: 'text', key: '', lightEdit: { original: '听录音，选出正确的图片', region: 'section>h2' } })
  expect(text).not.toBeNull()
  expect(state().updateRuntimeContentTextAtTarget(text!, '听录音，选出你听到的图片')).toMatchObject({ ok: true, status: 'updated' })
  await settleCourse()
  const picture = state().captureRuntimeAssetReplacementTarget({ ...base, targetId: 'auto:2:asset', kind: 'asset', key: 'hero' })
  expect(picture).not.toBeNull()
  expect(state().replaceRuntimeAssetAtTarget(picture!, replacement, NEW)).toMatchObject({ ok: true, status: 'replaced' })
  await settleCourse()
  expect(quizOf(formalProject(host)).runtime).toMatchObject({
    source: SOURCE,
    content: { values: {}, overrides: [{ original: '听录音，选出正确的图片', region: 'section>h2', text: '听录音，选出你听到的图片' }] },
    assets: { hero: { assetId: replacement.id } },
  })

  // Each is one undo step; redo brings it back.
  await undoCourse(host)
  expect(quizOf(formalProject(host)).runtime.assets).toEqual({ hero: { assetId: hero.id } })
  expect(quizOf(formalProject(host)).runtime.content.overrides).toHaveLength(1)
  await undoCourse(host)
  expect(quizOf(formalProject(host)).runtime.content.overrides).toBeUndefined()
  await redoCourse(host); await redoCourse(host)
  expect(quizOf(formalProject(host)).runtime.assets).toEqual({ hero: { assetId: replacement.id } })

  // Saved and reopened: the rule and the picture are there, the source is byte for byte what the AI wrote.
  const snapshot = formalCourse(host)
  if (snapshot.model.kind !== 'course-v9') throw new Error('course')
  const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: snapshot.model.project, assetFiles: snapshot.model.resources.assets ?? {}, componentFiles: {} }))
  expect(quizOf(reopened.project).runtime.source).toBe(SOURCE)
  expect(quizOf(reopened.project).runtime.content.overrides).toEqual([{ original: '听录音，选出正确的图片', region: 'section>h2', text: '听录音，选出你听到的图片' }])
  expect(Array.from(reopened.assetFiles[replacement.id]!)).toEqual(Array.from(NEW))

  // Played from the reopened file: the rule shows, again when the Runtime draws the heading anew, with the new picture.
  const payload = buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: reopened.assetFiles, components: {} })
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const container = frame.contentDocument!.createElement('div')
  frame.contentDocument!.body.append(container)
  const session = createPublishedCourseSession(payload)
  sessions.push(session)
  await session.mount(container)
  await settle()
  expect(container.querySelector('h2')!.textContent).toBe('听录音，选出你听到的图片')
  const newUrl = payload.assets[replacement.id]?.url
  expect(newUrl).toBeTruthy()
  expect(container.querySelector('img')!.getAttribute('src')).toBe(newUrl)
  container.querySelector<HTMLButtonElement>('button')!.click()
  await settle()
  expect(container.querySelector('h2')!.textContent).toBe('跟读句子')
  container.querySelector<HTMLButtonElement>('button')!.click()
  await settle()
  expect(container.querySelector('h2')!.textContent).toBe('听录音，选出你听到的图片')
})

it('M15 a locked Runtime takes no light edit', async () => {
  const locked = course()
  quizOf(locked).locked = true
  await projectCourse(host, locked, { [hero.id]: OLD }, {})
  await settleCourse()
  const state = useEditorStore.getState()
  const base = { projectId: formalProject(host).id, scope: 'scene' as const, sceneId: selectActiveSceneId(state), nodeId: 'quiz' }
  expect(state.captureRuntimeContentTextTarget({ ...base, targetId: 'auto:1:text', kind: 'text', key: '', lightEdit: { original: '听录音，选出正确的图片', region: 'section>h2' } })).toBeNull()
  expect(state.captureRuntimeAssetReplacementTarget({ ...base, targetId: 'auto:2:asset', kind: 'asset', key: 'hero' })).toBeNull()
})
