// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { setCourseComponent } from '../../src/core/course/courseComponents'
import { normalizeCourseProject } from '../../src/core/course/normalizeCourseProject'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import { publishedCourseV2Schema } from '../../src/shared/publishedCourseSchema'
import type { CompositionNode } from '../../src/shared/composition/content'
import type { CourseRuntimeDefinition, SlideSurfaceDocument } from '../../src/shared/courseProjectTypes'

type Node = CompositionNode<CourseRuntimeDefinition>
const element = (id: string, tagName: string, attributes: Record<string, string> = {}, children: Node[] = []): Node =>
  ({ id, kind: 'element', tagName, attributes, children })

describe('Published V2 course theme, credits and in-page steps', () => {
  it('publishes the theme, the credits of attributed assets, step states and component copies', () => {
    let project = createBlankCourseProject({ id: 'p1', now: '2026-10-04T00:00:00.000Z', includeDefaultController: false, controls: 'none' })
    project.assets.photo = { id: 'photo', filename: '地球.png', mimeType: 'image/png', kind: 'image', path: 'assets/地球.png', byteLength: 3,
      source: { kind: 'open-library', title: 'Earth', author: 'NASA', url: 'https://commons.wikimedia.org/wiki/File:Earth.png',
        license: { id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, attribution: '“Earth” by NASA, CC BY 4.0' } }
    project.assets.paper = { id: 'paper', filename: 'paper.png', mimeType: 'image/png', kind: 'image', path: 'assets/paper.png', byteLength: 3,
      source: { kind: 'model-svg' } }
    project.theme = { css: 'body{background:url(../assets/paper.png)}' }
    ;(project.surfaces[0] as SlideSurfaceDocument).scenes[0]!.layerItems.push({
      layerItemId: 'page', label: '页面', kind: 'composition', order: 0, visible: true, locked: false, rotation: 0, opacity: 1,
      hitPolicy: 'auto', playbackInitialVisibility: 'inherit', frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
      content: { assets: {}, root: element('doc', '#document', {}, [element('body', 'body', {}, [
        element('a', 'p', { class: 'fragment' }), element('img', 'img', { src: '../assets/地球.png', alt: '地球' }),
        element('frame', 'iframe', { src: '../components/公转模拟.html', title: '公转模拟' }),
      ])]) },
    })
    project = normalizeCourseProject(setCourseComponent(project, '公转模拟', {
      protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
      source: 'CoursewareRuntime.define({ create() { return { destroy() {} } } })', content: { values: {} }, assets: {},
    }))
    const bytes = new Uint8Array([1, 2, 3])
    const payload = buildPublishedCourseV2Payload({ project, assetFiles: { photo: bytes, paper: bytes }, components: {} })
    expect(publishedCourseV2Schema.parse(payload)).toEqual(payload)
    expect(payload.theme).toEqual({ css: 'body{background:url(../assets/paper.png)}', assets: { 'assets/paper.png': { assetId: 'paper' } } })
    expect(Object.keys(payload.assets).sort()).toEqual(['paper', 'photo'])
    expect(payload.credits).toEqual([{ assetId: 'photo', kind: 'open-library', title: 'Earth', author: 'NASA', url: 'https://commons.wikimedia.org/wiki/File:Earth.png',
      license: { id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, attribution: '“Earth” by NASA, CC BY 4.0' }])
    const scene = payload.surfaces[0]!.type === 'slide' ? payload.surfaces[0]!.scenes[0]! : undefined
    expect(scene?.presentation?.states.map(state => state.fragmentStep)).toEqual([0, 1])
    expect(JSON.stringify(scene?.layerItems)).toContain('"kind":"runtime"')
    expect(payload).not.toHaveProperty('components.公转模拟')
  })
})
