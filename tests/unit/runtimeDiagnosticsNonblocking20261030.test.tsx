import { useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { ComponentRuntimeHost } from '../../src/player/components/runtime/ComponentRuntimeHost'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import type { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { reportRendererDiagnostic } from '../../src/renderer/diagnostics/installRendererDiagnostics'

vi.mock('../../src/renderer/store/editorStore', () => ({ useEditorStore: () => undefined }))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('logs repeated real runtime diagnostics without invoking the operation-error surface or interrupting healthy content', async () => {
  const log = vi.fn(async () => {}), operationError = vi.fn()
  vi.stubGlobal('desktopAPI', { reportDiagnostic: log })
  const sync = vi.spyOn(ComponentRuntimeHost.prototype, 'sync')
  const project = createBlankCourseProjectV10('可继续使用的课件'), rootId = project.rootIds[0]!
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('正常正文'))),
    frame: { width: 400, height: 100, transform: [1, 0, 0, 1, 0, 0] } }
  project.instances[rootId].childIds = ['text']
  const editFailure = new Error('这次文字修改未保存'), edit = vi.fn(async () => { throw editFailure })
  const bridge = { read: () => ({ views: [] }), edit } as unknown as CourseV10DocumentBridge
  let ports!: CourseV10RuntimePorts
  function Editor() {
    const [error, setError] = useState<string | null>(null), [clicks, setClicks] = useState(0)
    return <>
      <CourseV10RuntimeView documentId="diagnostic-document" model={{ kind: 'course-v10', project, resources: { assets: {}, components: {} } }}
        surfaceId={rootId} selectedInstanceId={null} player={false} bridge={bridge}
        onSelect={() => {}} onSurfaceSelect={() => {}}
        report={message => { operationError(message); setError(message) }}
        renderWorkspace={runtime => { ports = runtime; return <section>{runtime.renderInstance('text')}<button onClick={() => setClicks(count => count + 1)}>底部操作 {clicks}</button></section> }} />
      {error && <div role="alert">{error}</div>}
    </>
  }
  const ui = render(<Editor />)
  await waitFor(() => expect(ui.container.textContent).toContain('正常正文'))
  const mountedIndex = sync.mock.calls.findIndex(([request]) => request.instance.id === 'text')
  const mounted = await sync.mock.results[mountedIndex]!.value
  expect(mounted).not.toBeNull()
  act(() => {
    ports.setPlaying(true)
    for (const message of ['兼容排版说明', '未使用的素材缺失', '兼容排版说明']) {
      mounted!.scope.events.emit('component.diagnostic', { message })
    }
  })
  await waitFor(() => expect(log).toHaveBeenCalledTimes(3))
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ source: 'renderer', message: 'text：兼容排版说明',
    details: { operation: 'course-runtime', documentId: 'diagnostic-document' } }))
  expect(operationError).not.toHaveBeenCalled()
  expect(ui.queryByRole('alert')).toBeNull()
  fireEvent.click(ui.getByRole('button', { name: '底部操作 0' }))
  expect(ui.getByRole('button', { name: '底部操作 1' })).toBeTruthy()
  expect(ui.container.textContent).toContain('正常正文')
  await act(async () => { await expect(ports.edit([])).rejects.toBe(editFailure) })
  expect(operationError).toHaveBeenCalledWith('这次文字修改未保存')
  expect(ui.getByRole('alert').textContent).toBe('这次文字修改未保存')
})

it('keeps diagnostics available in the console when the desktop log is unavailable', () => {
  vi.stubGlobal('desktopAPI', undefined)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  reportRendererDiagnostic('局部程序说明')
  expect(warning).toHaveBeenCalledWith('局部程序说明')
  expect(document.body.querySelector('[role="alert"]')).toBeNull()
})
