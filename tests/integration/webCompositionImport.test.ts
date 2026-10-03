// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { prepareHtmlCourseCandidate } from '../../src/main/workbench/htmlImport/prepareHtmlCourseCandidate'
import { splitHtmlSections } from '../../src/main/workbench/htmlImport/splitHtmlSections'
import { walkComposition } from '../../src/shared/composition/content'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'

it('uses the actual target scene canvas for both HTML import routes and preserves the default scene size', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-composition-scene-size-'))
  try {
    const sourcePath = path.join(root, 'lesson.html')
    const html = '<!doctype html><html><body><section><h1>目标页尺寸</h1><p>内容随当前场景排版。</p></section></body></html>'
    await fs.writeFile(sourcePath, html)
    for (const canvas of [undefined, { width: 720, height: 1280 }]) {
      const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
      const slide = project.surfaces.find(surface => surface.type === 'slide')!
      slide.scenes[0]!.canvas = canvas
      const locationId = project.locations[0]!.id
      const snapshot: DocumentSnapshot = {
        documentId: 'scene-size-import-document', epoch: 'test-epoch', revision: project.revision,
        binding: { kind: 'untitled', suggestedName: 'lesson.h5lesson' },
        model: { kind: 'course-v9', project, resources: { assets: {}, components: {} } },
        dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0,
      }
      for (const mode of ['whole', 'sections'] as const) {
        const candidate = await prepareHtmlCourseCandidate({ snapshot, sourcePath,
          ...(mode === 'whole' ? { locationId } : { mode, sections: splitHtmlSections(html, mode).sections,
            destinations: [{ kind: 'slide-existing' as const, location: locationId }] }),
        })
        const importedSlide = candidate.model.project.surfaces.find(surface => surface.type === 'slide')!
        expect(importedSlide.scenes[0]!.layerItems[0]!.frame).toEqual({ mode: 'absolute', x: 0, y: 0, ...(canvas ?? slide.canvas) })
      }
    }
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('imports ordinary HTML as editable compositions, saves and reopens both page routes, and preserves actual programs as Runtime', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-composition-import-'))
  try {
    const sourcePath = path.join(root, 'lesson.html')
    const html = '<!doctype html><html lang="zh"><head><style>.lesson{display:grid;grid-template-columns:2fr 3fr;gap:24px}</style></head><body><section id="observe" class="lesson"><h1>观察</h1><img src="diagram.png" alt="示意图"></section><section id="explain"><h1>解释</h1><p>根据观察说明结论。</p></section></body></html>'
    await fs.writeFile(sourcePath, html)
    await sharp({ create: { width: 2, height: 3, channels: 4, background: '#336699' } }).png().toFile(path.join(root, 'diagram.png'))
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const slide = project.surfaces.find(surface => surface.type === 'slide')!
    const snapshot: DocumentSnapshot = {
      documentId: 'composition-import-document', epoch: 'test-epoch', revision: project.revision,
      binding: { kind: 'untitled', suggestedName: 'lesson.h5lesson' },
      model: { kind: 'course-v9', project, resources: { assets: {}, components: {} } },
      dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0,
    }
    for (const mode of ['whole', 'sections'] as const) {
      const candidate = await prepareHtmlCourseCandidate({ snapshot, sourcePath,
        ...(mode === 'whole' ? { locationId: project.locations[0]!.id }
          : { mode, sections: splitHtmlSections(html, mode).sections, destinations: [{ kind: 'slide-new' as const, surface: slide.id }] }),
      })
      const archivePath = path.join(root, `${mode}.h5lesson`)
      await fs.writeFile(archivePath, createCourseProjectArchive({ project: candidate.model.project,
        assetFiles: candidate.model.resources.assets, componentFiles: candidate.model.resources.components }))
      const reopened = openCourseProjectArchive(new Uint8Array(await fs.readFile(archivePath)))
      const imported = reopened.project.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems) : [])
      expect(imported).toHaveLength(mode === 'whole' ? 1 : 2)
      expect(imported.every(item => item.kind === 'composition')).toBe(true)
      expect(Object.keys(reopened.project.assets).some(id => id.startsWith('runtime-capture-'))).toBe(false)
      const foundText: string[] = []
      for (const item of imported) {
        if (item.kind !== 'composition') throw new Error('Static HTML was flattened into a Runtime')
        walkComposition(item.content.root, node => {
          if (node.kind === 'text') foundText.push(node.text)
          if (node.kind === 'element' && node.tagName === 'img') {
            const key = node.attributes.src!.replace('cw-resource:', '')
            expect(item.content.assets[key]?.assetId).toBeDefined()
            expect(reopened.assetFiles[item.content.assets[key]!.assetId]).toBeDefined()
          }
        })
        expect(candidate.pages?.some(page => page.runtimeId === item.layerItemId)).toBe(true)
      }
      expect(foundText.join(' ')).toContain('grid-template-columns:2fr 3fr')
      expect(foundText.join(' ')).toContain('根据观察说明结论')
      const imageAsset = Object.values(reopened.project.assets).find(asset => asset.kind === 'image')!
      expect(await sharp(reopened.assetFiles[imageAsset.id]).metadata()).toMatchObject({ format: 'png', width: 2, height: 3 })
    }
    const programHtml = '<!doctype html><button onclick="this.textContent=\'已揭示\'">揭示</button>'
    await fs.writeFile(sourcePath, programHtml)
    const program = await prepareHtmlCourseCandidate({ snapshot, sourcePath, locationId: project.locations[0]!.id })
    const programSlide = program.model.project.surfaces.find(surface => surface.type === 'slide')!
    const programItem = programSlide.scenes[0]!.layerItems[0]!
    if (programItem.kind !== 'runtime') throw new Error('Interactive HTML lost its Runtime')
    expect(unpackHtmlDocumentRuntimeSource(programItem.runtime.source)?.html).toBe(programHtml)
    expect(programItem.runtime.staticFallback?.assetId).toBeDefined()
    expect(slide.scenes[0]!.layerItems).toHaveLength(0)
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
