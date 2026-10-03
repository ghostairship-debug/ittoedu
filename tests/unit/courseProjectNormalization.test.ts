// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import {
  courseComponentReferences,
  deleteCourseComponent,
  renameCourseComponent,
  setCourseComponent,
  uniqueCourseComponentName,
} from '../../src/core/course/courseComponents'
import { normalizeCourseProject } from '../../src/core/course/normalizeCourseProject'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import type { CompositionNode } from '../../src/shared/composition/content'
import { compositionStateNodeAttributes, STATE_HIDDEN_ATTRIBUTE, STEP_HIDDEN_ATTRIBUTE } from '../../src/shared/composition/stateNodes'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type {
  CompositionLayerItem,
  CourseComponentDefinition,
  CourseProjectDocument,
  CourseRuntimeDefinition,
  SlideSurfaceDocument,
} from '../../src/shared/courseProjectTypes'

type Node = CompositionNode<CourseRuntimeDefinition>
const element = (id: string, tagName: string, attributes: Record<string, string> = {}, children: Node[] = []): Node =>
  ({ id, kind: 'element', tagName, attributes, children })
const text = (id: string, value: string): Node => ({ id, kind: 'text', text: value })

const definition = (source = 'CoursewareRuntime.define({ create() { return { destroy() {} } } })'): CourseComponentDefinition => ({
  protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source, content: { values: {} }, assets: {},
})

function page(): CompositionLayerItem {
  return {
    layerItemId: 'page', label: '页面', kind: 'composition', order: 0, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit', frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
    content: { assets: {}, root: element('doc', '#document', {}, [element('html', 'html', {}, [element('head', 'head'), element('body', 'body', {}, [
      element('title', 'h1', {}, [text('t', '四季的成因')]),
      element('a', 'p', { class: 'fragment' }, [text('at', '地轴倾斜')]),
      element('b', 'p', { class: 'note fragment' }, [text('bt', '公转')]),
      element('img', 'img', { src: '../assets/地轴.svg', alt: '地轴倾斜示意图' }),
      element('frame', 'iframe', { src: '../components/公转模拟.html', title: '公转模拟' }),
    ])])]) },
  }
}

function course(): CourseProjectDocument {
  const project = createBlankCourseProject({ id: 'c1', now: '2026-10-04T00:00:00.000Z', idFactory: (() => { let n = 0; return () => `id${++n}` })() })
  const surface = project.surfaces[0] as SlideSurfaceDocument
  surface.scenes[0]!.layerItems.push({ ...page(), order: 5 })
  return project
}

const scene = (project: CourseProjectDocument) => (project.surfaces[0] as SlideSurfaceDocument).scenes[0]!
const frame = (project: CourseProjectDocument) => {
  const item = scene(project).layerItems.find(entry => entry.kind === 'composition') as CompositionLayerItem
  let found: Node | undefined
  const visit = (node: Node) => { if (node.id === 'frame') found = node; if (node.kind === 'element') node.children.forEach(visit) }
  visit(item.content.root)
  return { item, iframe: found as Extract<Node, { kind: 'element' }> }
}

describe('Course project normalization', () => {
  it('generates one presentation state per fragment and is idempotent', () => {
    const project = normalizeCourseProject(course())
    const presentation = scene(project).presentation!
    expect(presentation.states.map(state => [state.id, state.fragmentStep])).toEqual([
      ['state_initial', 0], ['fragment_step_1', 1], ['fragment_step_2', 2],
    ])
    expect(normalizeCourseProject(project)).toEqual(project)
    expect(courseProjectDocumentSchema.parse(project)).toEqual(project)
  })

  it('keeps authored states and removes generated ones when fragments disappear', () => {
    const project = normalizeCourseProject(course())
    scene(project).presentation!.states.push({ id: 'answer', name: '显示答案', layerItemOverrides: { page: { compositionNodes: { b: { visible: true } } } } })
    const item = scene(project).layerItems.find(entry => entry.kind === 'composition') as CompositionLayerItem
    const body = (item.content.root as Extract<Node, { kind: 'element' }>).children[0] as Extract<Node, { kind: 'element' }>
    const content = (body.children[1] as Extract<Node, { kind: 'element' }>).children
    for (const node of content) if (node.kind === 'element') delete node.attributes.class
    const next = normalizeCourseProject(project)
    expect(scene(next).presentation!.states.map(state => [state.id, state.fragmentStep])).toEqual([['state_initial', undefined], ['answer', undefined]])
  })

  it('derives node visibility per state: steps hide later fragments, explicit node states win', () => {
    const project = normalizeCourseProject(course())
    const current = scene(project)
    const [initial, first] = current.presentation!.states
    expect(compositionStateNodeAttributes(current, initial).get('page')?.get('a')).toMatchObject({ [STEP_HIDDEN_ATTRIBUTE]: '' })
    const afterFirst = compositionStateNodeAttributes(current, first).get('page')!
    expect(afterFirst.get('a')![STEP_HIDDEN_ATTRIBUTE]).toBeUndefined()
    expect(afterFirst.get('b')![STEP_HIDDEN_ATTRIBUTE]).toBe('')
    const answer = { id: 'answer', name: '答案', layerItemOverrides: { page: { compositionNodes: { title: { visible: false } } } } }
    expect(compositionStateNodeAttributes({ ...current, presentation: { states: [answer] } }, answer).get('page')!.get('title')).toMatchObject({ [STATE_HIDDEN_ATTRIBUTE]: '' })
  })

  it('rejects node states for missing nodes or non-composition items', () => {
    const project = normalizeCourseProject(course())
    scene(project).presentation!.states[0]!.layerItemOverrides.page = { compositionNodes: { missing: { visible: false } } }
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(false)
  })

  it('materializes named components into referring iframes, one way, and leaves placeholders otherwise', () => {
    let project = normalizeCourseProject(course())
    expect(frame(project).iframe.children).toEqual([])
    project = normalizeCourseProject(setCourseComponent(project, '公转模拟', definition()))
    const copy = frame(project).iframe.children[0]
    expect(copy).toMatchObject({ kind: 'runtime', runtime: { source: definition().source } })
    expect(courseComponentReferences(project, '公转模拟')).toEqual([{ layerItemId: 'page', nodeId: 'frame' }])

    // A copy changed elsewhere is rewritten from the definition; instance fields stay.
    const changed = structuredClone(project)
    const node = frame(changed).iframe.children[0] as Extract<Node, { kind: 'runtime' }>
    node.runtime.source = 'changed'
    node.runtime.content.overrides = [{ original: 'A', region: 'r', text: 'B' }]
    const restored = normalizeCourseProject(changed)
    const restoredCopy = frame(restored).iframe.children[0] as Extract<Node, { kind: 'runtime' }>
    expect(restoredCopy.runtime.source).toBe(definition().source)
    expect(restoredCopy.runtime.content.overrides).toEqual([{ original: 'A', region: 'r', text: 'B' }])

    project = normalizeCourseProject(renameCourseComponent(project, '公转模拟', '地球公转'))
    expect(frame(project).iframe.attributes.src).toBe('../components/地球公转.html')
    expect(Object.keys(project.components!)).toEqual(['地球公转'])
    expect(frame(project).iframe.children).toHaveLength(1)

    project = normalizeCourseProject(deleteCourseComponent(project, '地球公转'))
    expect(project.components).toBeUndefined()
    expect(frame(project).iframe.children).toEqual([])
  })

  it('validates component names and keeps them unique ignoring case', () => {
    const project = normalizeCourseProject(course())
    expect(() => setCourseComponent(project, 'a/b', definition())).toThrow()
    const withOne = setCourseComponent(project, 'Orbit', definition())
    expect(uniqueCourseComponentName(withOne, 'orbit')).toBe('orbit 2')
    expect(uniqueCourseComponentName(withOne, '公转:模拟')).toBe('公转-模拟')
    const twice = { ...withOne, components: { ...withOne.components, orbit: definition() } }
    expect(courseProjectDocumentSchema.safeParse(twice).success).toBe(false)
    const draft = { ...withOne, components: { Orbit: { ...definition(), draft: { reason: '语法错误' } } } }
    expect(courseProjectDocumentSchema.safeParse(draft).success).toBe(false)
    draft.components.Orbit.enabled = false
    expect(courseProjectDocumentSchema.safeParse(draft).success).toBe(true)
  })

  it('binds asset slots to assets present and drops bindings whose asset is gone', () => {
    const project = course()
    project.assets.a1 = { id: 'a1', filename: '地轴.svg', mimeType: 'image/svg+xml', kind: 'image', path: 'assets/地轴.svg', byteLength: 3,
      source: { kind: 'model-svg', title: '地轴倾斜示意图' } }
    project.theme = { css: 'body{background:url("../assets/地轴.svg")}' }
    const bound = normalizeCourseProject(project)
    expect(frame(bound).item.content.assets).toEqual({ 'assets/地轴.svg': { assetId: 'a1' } })
    expect(bound.theme!.assets).toEqual({ 'assets/地轴.svg': { assetId: 'a1' } })
    expect(courseProjectDocumentSchema.parse(bound)).toEqual(bound)
    delete bound.assets.a1
    const unbound = normalizeCourseProject(bound)
    expect(frame(unbound).item.content.assets).toEqual({})
    expect(unbound.theme!.assets).toBeUndefined()
  })

  it('keeps a source edit made on a page copy and a text edit of one instance across commit, save and reopen', () => {
    const driver = new CourseV9Driver()
    let project = normalizeCourseProject(createBlankCourseProject({ id: 'c2', now: '2026-10-04T00:00:00.000Z', includeDefaultController: false, controls: 'none' }))
    const second = { ...page(), layerItemId: 'page2', order: 6 }
    ;(project.surfaces[0] as SlideSurfaceDocument).scenes[0]!.layerItems.push({ ...page(), order: 5 }, second)
    project = normalizeCourseProject(setCourseComponent(project, '公转模拟', definition()))
    let model = { kind: 'course-v9' as const, project: courseProjectDocumentSchema.parse(project), resources: { assets: {}, components: {} } }

    // Runtime source editor / build artifact: the copy's source changes, the component follows.
    const edited = structuredClone(model.project)
    const copy = frame(edited).iframe.children[0] as Extract<Node, { kind: 'runtime' }>
    copy.runtime.source = definition('CoursewareRuntime.define({ create() { return { destroy() {} } } }) // v2').source
    model = driver.apply(model, { type: 'course.replace', project: edited }) as typeof model
    expect(model.project.components!['公转模拟']!.source).toContain('// v2')
    const copies = scene(model.project).layerItems.map(item => JSON.stringify(item)).filter(value => value.includes('// v2'))
    expect(copies).toHaveLength(2)

    // A text light edit of one instance stays on that instance.
    const lightEdited = structuredClone(model.project)
    ;(frame(lightEdited).iframe.children[0] as Extract<Node, { kind: 'runtime' }>).runtime.content.overrides = [{ original: '春分', region: 'r1', text: '秋分' }]
    model = driver.apply(model, { type: 'course.replace', project: lightEdited }) as typeof model
    const reopened = driver.load(driver.serialize(model)) as typeof model
    const reopenedCopy = frame(reopened.project).iframe.children[0] as Extract<Node, { kind: 'runtime' }>
    expect(reopenedCopy.runtime.content.overrides).toEqual([{ original: '春分', region: 'r1', text: '秋分' }])
    expect(reopenedCopy.runtime.source).toContain('// v2')
    expect(reopened.project.components!['公转模拟']!.content).toEqual({ values: {} })
  })

  it('rejects page copy edits that cannot map to one component definition', () => {
    const driver = new CourseV9Driver()
    let project = normalizeCourseProject(createBlankCourseProject({ id: 'c3', now: '2026-10-04T00:00:00.000Z', includeDefaultController: false, controls: 'none' }))
    ;(project.surfaces[0] as SlideSurfaceDocument).scenes[0]!.layerItems.push({ ...page(), order: 5 }, { ...page(), layerItemId: 'page2', order: 6 })
    project = normalizeCourseProject(setCourseComponent(project, '公转模拟', definition()))
    const model = { kind: 'course-v9' as const, project: courseProjectDocumentSchema.parse(project), resources: { assets: {}, components: {} } }
    const conflicting = structuredClone(model.project)
    const items = scene(conflicting).layerItems.filter(item => item.kind === 'composition') as CompositionLayerItem[]
    items.forEach((item, index) => {
      const visit = (node: Node): void => {
        if (node.kind === 'runtime') node.runtime.source = `CoursewareRuntime.define({}) // ${index}`
        if (node.kind === 'element') node.children.forEach(visit)
      }
      visit(item.content.root)
    })
    expect(() => driver.apply(model, { type: 'course.replace', project: conflicting })).toThrow(/不同内容/)
    const undefinedComponent = structuredClone(model.project)
    delete undefinedComponent.components
    ;(frame(undefinedComponent).iframe.children[0] as Extract<Node, { kind: 'runtime' }>).runtime.source = 'x'
    expect(() => driver.apply(model, { type: 'course.replace', project: undefinedComponent })).toThrow(/没有定义/)
  })

  it('normalizes every committed change through the driver', () => {
    const driver = new CourseV9Driver()
    const base = normalizeCourseProject(createBlankCourseProject({ id: 'c1', now: '2026-10-04T00:00:00.000Z', includeDefaultController: false, controls: 'none' }))
    const model = { kind: 'course-v9' as const, project: courseProjectDocumentSchema.parse(base), resources: { assets: {}, components: {} } }
    const replaced = structuredClone(base)
    ;(replaced.surfaces[0] as SlideSurfaceDocument).scenes[0]!.layerItems.push({ ...page(), order: 5 })
    const next = driver.apply(model, { type: 'course.replace', project: replaced }) as typeof model
    expect(scene(next.project).presentation!.states).toHaveLength(3)
  })
})
