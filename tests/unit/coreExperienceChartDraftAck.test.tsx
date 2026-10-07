// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CHART_DEFINITION } from '../../src/components/chart'
import { createChartData } from '../../src/components/chart/data'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { usePropertiesAuthoringBinding } from '../../src/renderer/composition/properties/usePropertiesAuthoringBinding'
import { ChartProperties } from '../../src/renderer/ui/properties/ChartProperties'
import { discardPropertiesDrafts, flushPropertiesDrafts, hasPropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentOperationResult } from '../../src/shared/workbench/document'

function ChartPanel() {
  const context = usePropertiesAuthoringBinding({ onReplaceImage() {} })
  if (context.kind !== 'slide-native' || context.view.type !== 'chart' || !context.commands.chart) throw new Error('Expected chart inspector')
  return <ChartProperties node={context.view} bindingKey={context.draftBindingKey} commands={context.commands.chart} />
}

it('keeps professional chart input dirty while its real submit is pending and preserves it when ACK is refused', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chart-draft-ack-'))
  let documentId = ''
  try {
    const host = new DocumentHostService(root), project = createBlankCourseProjectV10()
    project.definitions[CHART_DEFINITION.id] = CHART_DEFINITION
    project.instances.chart = { id: 'chart', definitionId: CHART_DEFINITION.id, data: JSON.parse(JSON.stringify(createChartData())),
      frame: { transform: [1, 0, 0, 1, 20, 20], width: 600, height: 400 } }
    project.surfaces[0]!.childIds.push('chart')
    const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'chart.h5lesson')
    documentId = snapshot.documentId
    let resolveAck!: (result: DocumentOperationResult) => void, operationId = ''
    const ack = new Promise<DocumentOperationResult>(resolve => { resolveAck = resolve })
    const unavailable = async (): Promise<never> => { throw new Error('Outside chart fixture') }
    const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => snapshot, subscribe: host.subscribeEvents.bind(host),
      dispatch: async operation => { operationId = operation.operationId; return ack },
      saveWithDialog: unavailable, closeWithDialog: unavailable, close: unavailable, discardRecovery: unavailable }
    await useEditorStore.getState().connectCourseDocuments(api)
    useEditorStore.getState().selectNode('chart')
    render(<ChartPanel />)
    const input = screen.getByLabelText('系列一 在 甲 的值')
    fireEvent.change(input, { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: '应用数据' }))
    await waitFor(() => expect(operationId).not.toBe(''))
    expect(hasPropertiesDrafts(documentId)).toBe(true)
    expect(input).toHaveValue('42')
    expect((await host.internalAPI.read(documentId)).undoDepth).toBe(0)
    let flush: Promise<boolean> | undefined, finished = false
    await act(async () => {
      flush = flushPropertiesDrafts(documentId).then(ready => { finished = true; return ready })
      await Promise.resolve()
    })
    expect(finished).toBe(false)
    await act(async () => {
      resolveAck({ status: 'failed', documentId, operationId, code: 'chart-refused', message: '图表正式提交被拒绝', applied: false })
      expect(await flush).toBe(false)
    })
    expect(screen.getByTestId('chart-data-apply-error')).toHaveTextContent('图表正式提交被拒绝')
    expect(screen.getByLabelText('系列一 在 甲 的值')).toBe(input)
    expect(input).toHaveValue('42')
    expect(hasPropertiesDrafts(documentId)).toBe(true)
    expect((await host.internalAPI.read(documentId)).undoDepth).toBe(0)
  } finally {
    cleanup(); discardPropertiesDrafts(documentId); useEditorStore.getState().courseBridge.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})
