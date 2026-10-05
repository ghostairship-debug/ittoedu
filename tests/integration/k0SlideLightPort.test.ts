// @vitest-environment jsdom
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { createSlideLightEditingPort } from '../../src/renderer/composition/selection/slideLightEditingPort'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

it('starts the App light-editing port without a document and commits its page action through the formal History', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'k0-slide-light-'))
  const bridge = new CourseV10DocumentBridge()
  try {
    const host = new DocumentHostService(path.join(directory, 'recovery'))
    const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: () => host.bootstrapCourse(),
      saveWithDialog: id => host.internalAPI.save(id, path.join(directory, 'course.h5lesson')),
      closeWithDialog: async id => { await host.operate({ type: 'close', documentId: id }); return true },
      discardRecovery: async id => { await host.operate({ type: 'discard-recovery', documentId: id }) },
      subscribe: listener => host.subscribeEvents(listener) }
    const kernel = createEditorStoreKernel({ bridge, commit() {} })
    const port = createSlideLightEditingPort({ kernel })
    expect(port.capturePage()).toBeNull()
    expect(port.captureObject()).toBeNull()

    await bridge.connect(api)
    const target = port.capturePage()!
    expect(target).toMatchObject({ kind: 'page', documentId: bridge.read().activeDocumentId })
    const before = await host.internalAPI.read(target.documentId)
    if (before.model.kind !== 'course-v10') throw new Error('Expected V10')
    const command = port.viewPage(target).commands.find(value => value.id === 'slide.background.dbeafe')!
    await port.runPage(target, command)
    const changed = await host.internalAPI.read(target.documentId)
    expect(changed).toMatchObject({ undoDepth: before.undoDepth + 1, model: { kind: 'course-v10' } })
    if (changed.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(changed.model.project.surfaces.find(surface => surface.id === target.surfaceId)?.background?.color).toBe('#dbeafe')

    await kernel.navigateHistory('undo')
    const undone = await host.internalAPI.read(target.documentId)
    if (undone.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(undone.model.project.surfaces).toEqual(before.model.project.surfaces)
    expect(undone.undoDepth).toBe(before.undoDepth)
  } finally {
    bridge.dispose()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
