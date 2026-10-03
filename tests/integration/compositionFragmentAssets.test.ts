// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { importComponentPackage } from '../../src/core/drivers/codecs/importComponentPackage'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { findCompositionNode, walkComposition } from '../../src/shared/composition/content'
import { applyHistoryResourceChanges } from '../../src/renderer/store/courseResourceState'
import { openSlideAuthoringSession } from '../../src/renderer/course/slideAuthoringBackend'
import { planComponentPackageInsertion } from '../../src/renderer/components/insertComponentPackages'
import { createCompositionFragmentPackage, exportCompositionFragmentPackage } from '../../src/renderer/components/compositionFragments/compositionFragmentPackage'
import { componentPackagesToArchiveFiles, componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import type { CompositionLayerItem, CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { compositionFragmentFixture, fragmentPrompt } from '../helpers/compositionFragmentFixture'
import { mutateAddSlideScene } from '../../src/core/tools/slideStructure'

it('extracts a useful mixed asset, reuses managed resources in a second saved course, and retains independent responsive interactions', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-fragment-assets-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const source = compositionFragmentFixture()
    const data = createCompositionFragmentPackage({ ...source, componentPackages: {}, layerItemId: source.item.layerItemId, name: '两栏观察与解释' })
    const assetFile = path.join(folder, 'two-column.h5component')
    await fs.writeFile(assetFile, exportCompositionFragmentPackage(data))
    const imported = importComponentPackage(new Uint8Array(await fs.readFile(assetFile)))
    expect(imported.manifest.content?.kind).toBe('composition')
    expect(imported.runtimeSource).toBe('')
    let project: CourseProjectDocument = createBlankCourseProject({ title: '第二份作品', canvas: { width: 800, height: 1100 }, includeDefaultController: false, controls: 'none' })
    project.assets['existing-picture'] = { ...source.project.assets['source-photo']!, id: 'existing-picture' }
    let resources = { assetFiles: { 'existing-picture': source.assetFiles['source-photo']! }, componentPackages: {} }
    const insert = (locationId: string) => {
      const slide = openSlideAuthoringSession(project, { locationId })
      const result = planComponentPackageInsertion({ document: project, componentPackages: resources.componentPackages, assetFiles: resources.assetFiles,
        target: { projectId: project.id, revision: project.revision, generation: 1, locationId, stateId: null, scope: 'scene' },
        slide, spatial: null, flow: null, packages: [imported] })
      project = result.step.nextDocument
      resources = applyHistoryResourceChanges(resources, result.step.resourceChanges, 'forward') as typeof resources
      expect(result.step.resourceChanges.assetFileChanges).toBeUndefined()
      return result.layerItemIds[0]!
    }
    const firstId = insert(project.locations[0]!.id)
    project = mutateAddSlideScene(project, project.surfaces[0]!.id, { name: '独立复用实例' })
    const secondId = insert(project.locations[1]!.id)
    const sceneItems = project.surfaces.find(surface => surface.type === 'slide')!.scenes.flatMap(scene => scene.layerItems)
    const first = sceneItems.find(item => item.layerItemId === firstId) as CompositionLayerItem
    const second = sceneItems.find(item => item.layerItemId === secondId) as CompositionLayerItem
    const firstIds = new Set<string>(), secondIds = new Set<string>()
    walkComposition(first.content.root, node => firstIds.add(node.id))
    walkComposition(second.content.root, node => secondIds.add(node.id))
    expect([...firstIds].some(id => secondIds.has(id))).toBe(false)
    const chartIds = (item: CompositionLayerItem) => {
      const ids: string[] = []
      walkComposition(item.content.root, node => { if (node.kind === 'native' && node.content.nativeType === 'chart') {
        ids.push(...node.content.data.categories.map(category => category.id), ...node.content.data.series.map(series => series.id))
      } })
      return ids
    }
    expect(chartIds(first).some(id => chartIds(second).includes(id))).toBe(false)
    const locateText = (item: CompositionLayerItem) => {
      let id = ''
      walkComposition(item.content.root, node => { if (node.kind === 'text' && node.text === fragmentPrompt) id = node.id })
      if (!id) throw new Error('Missing editable text')
      return id
    }
    const firstText = locateText(first), secondText = locateText(second)
    const driver = new CourseV9Driver()
    const model = await driver.apply({ kind: 'course-v9', project, resources: { assets: resources.assetFiles, components: componentPackagesToArchiveFiles(resources.componentPackages) } },
      { type: 'composition.edit', layerItemId: firstId, edit: { type: 'text', nodeId: firstText, text: '不同的课堂内容需要更长的解释，但仍由浏览器自动排列，不手工填坐标。'.repeat(12) } })
    const lessonFile = path.join(folder, 'second.h5lesson')
    await fs.writeFile(lessonFile, driver.serialize(model))
    const reopened = driver.load(new Uint8Array(await fs.readFile(lessonFile)))
    if (reopened.kind !== 'course-v9') throw new Error('Wrong document format')
    const reopenedItems = reopened.project.surfaces.find(surface => surface.type === 'slide')!.scenes.flatMap(scene => scene.layerItems)
    const reopenedFirst = reopenedItems.find(item => item.layerItemId === firstId) as CompositionLayerItem
    const reopenedSecond = reopenedItems.find(item => item.layerItemId === secondId) as CompositionLayerItem
    expect(findCompositionNode(reopenedSecond.content.root, secondText)).toMatchObject({ text: fragmentPrompt })
    expect(Object.keys(reopened.resources.assets)).toEqual(['existing-picture'])
    const components = componentPackagesFromArchive(reopened.project, reopened.resources.components)
    const payload = buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: reopened.resources.assets, components })
    expect(Object.keys(payload.components)).toHaveLength(0)
    const published = payload.surfaces.find(surface => surface.type === 'slide')!.scenes.flatMap(scene => scene.layerItems)
    const bundle = (await build({ stdin: { contents: `export {mountWebComposition} from './src/player/composition/mountWebComposition';export {createPublishedSurfaceRuntimeSession} from './src/player/surfaces/runtime/publishedSurfaceRuntimeMount'`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true,
      write: false, platform: 'browser', format: 'iife', globalName: 'FragmentTest', define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
    const page = await browser.newPage({ viewport: { width: 1800, height: 1300 } })
    try {
      await page.setContent('<div id="first" style="display:inline-block;vertical-align:top"></div><div id="second" style="display:inline-block;vertical-align:top"></div>')
      await page.addScriptTag({ content: bundle })
      const result = await page.evaluate(async ({ items, assets }) => {
        const api = (window as any).FragmentTest
        const handles = []
        const errors: string[] = []
        for (const [index, item] of items.entries()) {
          if (item.kind !== 'composition') throw new Error('Wrong published kind')
          const handle = api.mountWebComposition(document.getElementById(index === 0 ? 'first' : 'second'), {
            instanceId: item.layerItemId, content: item.content, width: 800, height: 1100, mode: 'playback',
            session: api.createPublishedSurfaceRuntimeSession(), resolveAsset: (id: string) => assets[id]?.url, reportError: (error: Error) => errors.push(error.message),
          })
          await handle.waitForObservationReady(); handles.push(handle)
        }
        const documents = handles.map(handle => handle.element.contentDocument)
        const button = documents[0].querySelector('[data-fragment-counter]')
        button.click()
        const before = documents.map(dom => ({ interactionY: dom.querySelector('.interaction').getBoundingClientRect().y,
          grid: dom.defaultView.getComputedStyle(dom.querySelector('.columns')).gridTemplateColumns,
          chart: dom.querySelector('.chart').querySelectorAll('svg,canvas,[data-native-type]').length,
          imageReady: dom.querySelector('img').naturalWidth === 1 }))
        handles[0].resize(400, 1500); await handles[0].waitForObservationReady()
        const afterGrid = documents[0].defaultView.getComputedStyle(documents[0].querySelector('.columns')).gridTemplateColumns
        const result = { before, afterGrid, countFirst: button.textContent, countSecond: documents[1].querySelector('[data-fragment-counter]').textContent,
          sameRuntime: button === documents[0].querySelector('[data-fragment-counter]'), errors }
        ;(window as any).fragmentHandles = handles
        return result
      }, { items: published, assets: payload.assets })
      expect(result.errors).toEqual([])
      expect(result.before[0]!.interactionY).toBeGreaterThan(result.before[1]!.interactionY)
      expect(result.before.every(value => value.grid.split(' ').length === 2)).toBe(true)
      expect(result.before.every(value => value.chart > 0 && value.imageReady)).toBe(true)
      expect(result.afterGrid.split(' ')).toHaveLength(1)
      expect(result.sameRuntime).toBe(true)
      expect(result.countFirst).toBe('观察次数：1')
      expect(result.countSecond).toBe('观察次数：0')
      if (process.env.GUOLING_FRAGMENT_EVIDENCE_DIRECTORY) {
        const evidence = path.resolve(process.env.GUOLING_FRAGMENT_EVIDENCE_DIRECTORY)
        await fs.mkdir(evidence, { recursive: true })
        await Promise.all([fs.copyFile(assetFile, path.join(evidence, 'two-column.h5component')),
          fs.copyFile(lessonFile, path.join(evidence, 'second.h5lesson')),
          page.screenshot({ path: path.join(evidence, 'reuse.png'), fullPage: true })])
      }
      await page.evaluate(() => (window as any).fragmentHandles.forEach((handle: any) => handle.destroy()))
    } finally { await page.close() }
    expect(findCompositionNode(reopenedFirst.content.root, firstText)?.kind).toBe('text')
  } finally { await browser.close(); await fs.rm(folder, { recursive: true, force: true }) }
}, 30000)
