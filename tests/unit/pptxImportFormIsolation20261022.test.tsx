import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PptxImportForm } from '../../src/renderer/ui/productivity/PptxImportForm'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { DesignProductionStep, ProductivityContext } from '../../src/renderer/authoring/productivity'
import type { PptxImportBuildInput, PptxImportBuildResult } from '../../src/shared/workbench/pptxImport'
const originalDesktopAPI = window.desktopAPI
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.desktopAPI = originalDesktopAPI })
const draft = () => ({ slides: [{ title: 'Imported', backgroundColor: '#ffffff', items: [] }], assets: [], notes: [], issues: [] })
function context(): ProductivityContext {
  const project = createBlankCourseProjectV10('Existing')
  return { document: project, target: { project, resources: { assets: {}, components: {} }, documentId: 'document', epoch: 'epoch',
    surfaceId: project.rootIds[0], instanceId: null, instanceIds: [], activeStateId: null, editingProject: project } }
}
function file() { return { name: 'lesson.pptx', arrayBuffer: async () => new Uint8Array([1, 2]).buffer } }
it('uses the captured canvas and commits the isolated draft through the original planner', async () => {
  const build = vi.fn(async (_input: PptxImportBuildInput): Promise<PptxImportBuildResult> => ({ mode: 'draft', draft: draft() }))
  window.desktopAPI = { buildPptxImport: build, cancelPptxImport: vi.fn(async () => true) } as unknown as Window['desktopAPI']
  const captured = context(), commit = vi.fn(async (_step: DesignProductionStep) => true), close = vi.fn()
  render(<PptxImportForm getContext={() => captured} getAssetFiles={() => ({})} onCommit={commit} onClose={close} />)
  fireEvent.change(screen.getByLabelText('选择 PPTX'), { target: { files: [file()] } })
  await screen.findByRole('button', { name: '确认导入可用内容' })
  expect(build.mock.calls[0]![0]).toMatchObject({ mode: 'draft', filename: 'lesson.pptx', canvas: { width: 1280, height: 720 } })
  fireEvent.click(screen.getByRole('button', { name: '确认导入可用内容' }))
  await waitFor(() => expect(commit).toHaveBeenCalledOnce())
  expect(commit.mock.calls[0]![0]).toMatchObject({ documentId: 'document', epoch: 'epoch' })
  expect(commit.mock.calls[0]![0].edits).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'surface.insert' }), expect.objectContaining({ type: 'asset.add' })]))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
})
it('sends real request cancellation and ignores a late draft after cancel or unmount', async () => {
  const pending: Array<(value: PptxImportBuildResult) => void> = []
  const build = vi.fn((_input: PptxImportBuildInput) => new Promise<PptxImportBuildResult>(resolve => pending.push(resolve))), cancel = vi.fn(async () => true), commit = vi.fn((_step: DesignProductionStep) => true)
  window.desktopAPI = { buildPptxImport: build, cancelPptxImport: cancel } as unknown as Window['desktopAPI']
  const captured = context(), view = render(<PptxImportForm getContext={() => captured} getAssetFiles={() => ({})} onCommit={commit} onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('选择 PPTX'), { target: { files: [file()] } })
  await screen.findByRole('button', { name: '取消读取' }); await waitFor(() => expect(build).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: '取消读取' }))
  expect(cancel).toHaveBeenCalledWith({ requestId: build.mock.calls[0]![0].requestId })
  await act(async () => pending[0]!({ mode: 'draft', draft: draft() }))
  expect(screen.queryByRole('button', { name: '确认导入可用内容' })).toBeNull(); expect(commit).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('选择 PPTX'), { target: { files: [file()] } })
  await waitFor(() => expect(build).toHaveBeenCalledTimes(2)); view.unmount()
  expect(cancel).toHaveBeenCalledWith({ requestId: build.mock.calls[1]![0].requestId })
  await act(async () => pending[1]!({ mode: 'draft', draft: draft() })); expect(commit).not.toHaveBeenCalled()
})
