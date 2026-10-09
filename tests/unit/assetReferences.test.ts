// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { VIDEO_DEFINITION, createVideoData } from '../../src/components/media'
import { courseAudioSettings } from '../../src/core/course/courseMediaEdits'
import { courseAuthorData, removeCourseAsset } from '../../src/renderer/media/commitCourseMediaAuthoring'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

it('protects the live image originals, posters, named states, backgrounds, sounds, themes and declared source graph while deleting only unreferenced bytes', async () => {
  const cases: [string, (project: CourseProjectV10) => void][] = [
    ['image current', project => { project.instances.image.data = courseAuthorData({ ...createImageData('other'), assetId: 'used' }) }],
    ['image original', project => { project.instances.image.data = courseAuthorData({ ...createImageData('used'), assetId: 'other' }) }],
    ['image named state', project => { project.surfaces[0].presentation = { states: [{ id: 'state', title: '呈现', overrides: { image: { data: courseAuthorData(createImageData('used')) } } }] } }],
    ['video image poster', project => { project.definitions[VIDEO_DEFINITION.id] = VIDEO_DEFINITION; project.instances.image.definitionId = VIDEO_DEFINITION.id;
      project.instances.image.data = courseAuthorData({ ...createVideoData('other'), poster: { mode: 'image', time: 0, assetId: 'used' } }) }],
    ['course background', project => { project.background = { assetId: 'used' } }],
    ...(['slide', 'flow', 'spatial'] as const).map(kind => [kind + ' background', (project: CourseProjectV10) => { project.surfaces.push({ id: kind + '-background', title: kind, kind, childIds: [], background: { assetId: 'used' } }) }] as [string, (project: CourseProjectV10) => void]),
    ['named-state background', project => { project.surfaces[0].presentation = { states: [{ id: 'state', title: '呈现', overrides: {}, background: { assetId: 'used' } }] } }],
    ['course sound', project => { project.media = { audio: { ...courseAudioSettings(project), sounds: { sound: { id: 'sound', name: '提示', assetId: 'used', channel: 'sfx', defaultLoop: false, defaultVolume: 1 } } } } }],
    ['theme asset', project => { project.theme = { css: 'body { background: url(paper) }', assets: { paper: { assetId: 'used' } } } }],
    ['definition source binding', project => { project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }', resourceBindings: { picture: 'used' } } };
      project.instances.image.definitionId = 'source'; project.instances.image.data = {} }],
  ]
  for (const [name, setup] of cases) {
    const project = createBlankCourseProjectV10(name)
    project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
    project.instances.image = { id: 'image', definitionId: IMAGE_DEFINITION.id, data: courseAuthorData(createImageData('other')) }
    project.surfaces[0].childIds.push('image')
    for (const id of ['used', 'other', 'unused']) project.assets[id] = { id, path: `assets/${id}`, mimeType: 'image/png' }
    setup(project)
    const resources = { assets: Object.fromEntries(['used', 'other', 'unused'].map(id => [id, new TextEncoder().encode(id)])), components: {} }
    const h = await createV10StoreHost(project, resources)
    try {
      const before = structuredClone(h.first.read())
      await expect(removeCourseAsset(h.kernel, 'used'), name).rejects.toThrow('素材仍被工程内容使用')
      expect(h.first.read(), name).toEqual(before)
      await removeCourseAsset(h.kernel, 'unused')
      expect(h.model().project.assets.unused, name).toBeUndefined(); expect(h.model().resources.assets.unused, name).toBeUndefined()
      expect(h.first.read().undoDepth).toBe(1)
      await h.bridge.undo(); expect(h.model().project.assets.unused).toEqual(project.assets.unused)
      expect(h.model().resources.assets).toEqual(resources.assets)
      await h.bridge.redo(); expect(h.driver.load(h.driver.serialize(h.model()))).toEqual(h.model())
      expect(h.model().resources.assets.used).toEqual(resources.assets.used)
    } finally { h.bridge.dispose() }
  }
})
