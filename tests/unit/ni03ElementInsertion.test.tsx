import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../src/components/document-block'
import { chartDataSchema } from '../../src/components/chart/data'
import { parseTableData } from '../../src/components/table/data'
import { ElementsTab } from '../../src/renderer/ui/ElementsTab'
import { insertFlowMenu } from '../../src/renderer/ui/flow/flowInsertCommands'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('expected course')
  return snapshot.model.project
}

it.each(['elements', 'slide', 'flow'] as const)('inserts through the real %s consumer with retained defaults, one Undo and disk archive reopen', async entry => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ni03-element-insertion-'))
  try {
    const host = new DocumentHostService(path.join(root, 'host')), project = createBlankCourseProjectV10('原入口专业插入')
    const surfaceId = project.surfaces[0].id
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.instances.manual = { id: 'manual', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('保留人工排版'))),
      frame: { width: 210, height: 72, transform: [1, .1, -.2, 1, 35, 47] } }
    project.surfaces[0].childIds = ['manual']
    if (entry === 'flow') {
      project.surfaces[0].kind = 'flow'
      project.definitions[DOCUMENT_BLOCK_DEFINITION.id] = DOCUMENT_BLOCK_DEFINITION
      project.instances.section = { id: 'section', definitionId: DOCUMENT_BLOCK_DEFINITION.id, childIds: ['manual'],
        data: documentBlockData({ id: 'section', type: 'section', title: { inlines: [] }, collapsedByDefault: false, blocks: [] }) }
      project.surfaces[0].childIds = ['section']
    }
    const opened = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'insert.h5lesson')
    const outside = async (): Promise<never> => { throw new Error('Outside insertion fixture') }
    const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => opened, subscribe: host.subscribeEvents.bind(host),
      saveWithDialog: outside, closeWithDialog: outside, close: outside, discardRecovery: outside }
    await useEditorStore.getState().connectCourseDocuments(api)
    act(() => { useEditorStore.getState().setEditingScope('scene'); useEditorStore.getState().selectNode('manual') })
    if (entry === 'elements') {
      render(<ElementsTab onAddImage={() => {}} />)
      fireEvent.click(screen.getByTestId('add-chart'))
      fireEvent.click(screen.getByTestId('add-chart-donut'))
      await waitFor(async () => expect((await host.internalAPI.read(opened.documentId)).undoDepth).toBe(1))
    } else if (entry === 'slide') {
      await act(async () => { await useEditorStore.getState().addChartNode('line') })
    } else {
      const kernel = useEditorStore.getState().courseKernel
      await act(async () => { await insertFlowMenu(kernel, kernel.captureTarget(), { destination: 'document', kind: 'table', label: '表格' }) })
    }
    const changed = await host.internalAPI.read(opened.documentId), result = course(changed)
    const inserted = Object.values(result.instances).find(instance => !project.instances[instance.id])!
    expect(inserted).toBeDefined()
    expect(changed.undoDepth).toBe(1)
    expect(result.instances.manual).toEqual(project.instances.manual)
    if (entry === 'flow') {
      expect(parseTableData(inserted.data).rows).toHaveLength(3)
      expect(inserted.frame).toEqual({ width: 600, height: 220, transform: [1, 0, 0, 1, 0, 0] })
      expect(inserted.flowPlacement).toBeUndefined()
      expect(result.instances.section.childIds).toEqual(['manual', inserted.id])
      expect(result.surfaces[0].childIds).toEqual(['section'])
    } else {
      expect(chartDataSchema.parse(inserted.data).chartType).toBe(entry === 'elements' ? 'donut' : 'line')
      expect(inserted.frame).toEqual(entry === 'elements'
        ? { width: 520, height: 320, transform: [1, 0, 0, 1, 380, 200] }
        : { width: 560, height: 360, transform: [1, 0, 0, 1, 80, 80] })
      expect(result.surfaces[0].childIds).toEqual(['manual', inserted.id])
    }
    const filename = path.join(root, 'saved.h5lesson')
    await host.internalAPI.save(opened.documentId, filename)
    const cold = new DocumentHostService(path.join(root, 'cold'))
    const reopened = await cold.internalAPI.open(filename)
    expect(course(reopened)).toEqual(result)
    await act(async () => { await useEditorStore.getState().courseBridge.undo(opened.documentId) })
    const undone = await host.internalAPI.read(opened.documentId)
    expect(undone.undoDepth).toBe(0)
    expect(course(undone).instances).toEqual(project.instances)
    expect(course(undone).surfaces).toEqual(project.surfaces)
  } finally {
    cleanup()
    useEditorStore.getState().courseBridge.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})
