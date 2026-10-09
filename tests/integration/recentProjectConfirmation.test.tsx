import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { strToU8, zipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import { useCourseProjectLifecycle, type CourseProjectLifecyclePorts, type CourseProjectLifecycleWatch } from '../../src/renderer/app/useCourseProjectLifecycle'
import { createCourseDocumentHost, type CourseDocumentTestHost } from '../helpers/courseDocumentHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { OpenProjectFileResult } from '../../src/shared/ipcTypes'

const watch: CourseProjectLifecycleWatch = { dirty: false, projectTitle: '', projectPath: null, documentTrigger: null, sidecarTrigger: null,
  componentPackagesTrigger: null, slideDraftTrigger: null, spatialDraftTrigger: null, flowDraftTrigger: null, textEditTrigger: null }
function ports(host: CourseDocumentTestHost, selected: () => OpenProjectFileResult | null, confirm = async (_id: string) => {}) {
  const reportError = vi.fn(), commitStatus = vi.fn(), confirmProjectOpen = vi.fn(confirm), listRecentProjects = vi.fn(async () => [])
  const openRecentProjectFile = vi.fn(async (): Promise<OpenProjectFileResult> => { throw new Error('Renderer byte loader is retired') })
  const value: CourseProjectLifecyclePorts = { documents: host.documents, captureIdentity: host.identity,
    hasUnsavedChanges: () => host.read().dirty, projectPath: () => { const binding = host.read().binding; return binding.kind === 'file' ? binding.path : null },
    async runBusy(work) { try { return await work() } catch (error) { reportError(error instanceof Error ? error.message : String(error)); return undefined } },
    reportError, commitStatus, desktopAvailable: () => true, openProjectFile: vi.fn(async () => selected()), openRecentProjectFile,
    confirmProjectOpen, listRecentProjects, setWindowDirtyState: vi.fn(async () => undefined), subscribeSaveAndCloseRequest: vi.fn(() => () => undefined) }
  return { value, reportError, commitStatus, confirmProjectOpen, listRecentProjects, openRecentProjectFile }
}
const selectedFile = (path: string): OpenProjectFileResult => ({ path, name: path, bytes: new Uint8Array([0]), confirmationId: path + '-confirmation' })

it('validates actual Main archives before confirmation and reselects the same recent document with its unsaved History', async () => {
  const host = await createCourseDocumentHost(); await host.editTitle('之前未保存的人工内容')
  let selected: OpenProjectFileResult | null = null
  const p = ports(host, () => selected, async id => {
    expect(id).toBe('chosen.glx-confirmation')
    expect(host.read()).toMatchObject({ model: { project: { title: '合法工程' } }, binding: { kind: 'file', path: 'chosen.glx' } })
  })
  try {
    const { result } = renderHook(() => useCourseProjectLifecycle(p.value, watch))
    await waitFor(() => expect(p.listRecentProjects).toHaveBeenCalledOnce())
    const original = structuredClone(host.read()), documents = host.registry.list()
    const project = createBlankCourseProjectV10('非法候选')
    const badProjects = [{ ...project, title: 42 }, { ...project, schemaVersion: 11 }, { ...project, assets: { missing: { id: 'missing', path: 'assets/missing.png', mimeType: 'image/png' } } }]
    for (let index = 0; index < badProjects.length; index++) {
      const filename = `bad-${index}.glx`
      host.disk.set(filename, zipSync({ 'project.json': strToU8(JSON.stringify(badProjects[index])) }))
      selected = selectedFile(filename)
      act(() => { result.current.openProject() })
      await waitFor(() => expect(p.reportError).toHaveBeenCalledTimes(index + 1))
      expect(host.read()).toEqual(original); expect(host.registry.list()).toEqual(documents)
      expect(p.confirmProjectOpen).not.toHaveBeenCalled(); expect(p.listRecentProjects).toHaveBeenCalledOnce()
    }
    await host.seedFile('chosen.glx', '合法工程'); selected = selectedFile('chosen.glx')
    p.listRecentProjects.mockClear()
    act(() => { result.current.openProject() })
    await waitFor(() => expect(p.confirmProjectOpen).toHaveBeenCalledOnce())
    await waitFor(() => expect(p.listRecentProjects).toHaveBeenCalledOnce())
    expect(p.confirmProjectOpen.mock.invocationCallOrder[0]).toBeLessThan(p.listRecentProjects.mock.invocationCallOrder[0]!)
    expect(host.registry.get(original.documentId).read()).toEqual(original)
    await act(async () => { await host.editTitle('最近工程的未保存人工修改') })
    const live = structuredClone(host.read())
    await act(async () => { expect(await result.current.openRecentProject('chosen.glx')).toBe(true) })
    expect(host.read()).toEqual(live); expect(host.read().undoDepth).toBe(1)
    expect(p.openRecentProjectFile).not.toHaveBeenCalled(); expect(p.confirmProjectOpen).toHaveBeenCalledOnce()
  } finally { cleanup(); host.dispose() }
})

it('keeps an opened document editable and refreshes recents when only its confirmation receipt fails', async () => {
  const host = await createCourseDocumentHost(); await host.seedFile('valid.glx', '已打开的合法工程')
  const p = ports(host, () => selectedFile('valid.glx'), async () => { throw new Error('recent persistence unavailable') })
  try {
    const { result } = renderHook(() => useCourseProjectLifecycle(p.value, watch))
    await waitFor(() => expect(p.listRecentProjects).toHaveBeenCalledOnce()); p.listRecentProjects.mockClear()
    act(() => { result.current.openProject() })
    await waitFor(() => expect(p.confirmProjectOpen).toHaveBeenCalledOnce())
    await waitFor(() => expect(p.listRecentProjects).toHaveBeenCalledOnce())
    expect(host.read()).toMatchObject({ model: { project: { title: '已打开的合法工程' } }, binding: { path: 'valid.glx' } })
    expect(p.reportError).not.toHaveBeenCalled()
    expect(p.commitStatus).toHaveBeenCalledWith(expect.stringContaining('recent persistence unavailable'))
    await act(async () => { await host.editTitle('确认失败之后仍可编辑') })
    expect(host.read().undoDepth).toBe(1)
    await act(async () => { expect(await result.current.saveProject()).toBe(true) })
    const binding = host.read().binding
    if (binding.kind !== 'file') throw new Error('Expected a saved file')
    const reopened = host.driver.load(host.disk.get(binding.path)!)
    expect(reopened).toMatchObject({ kind: 'course-v10', project: { title: '确认失败之后仍可编辑' } })
  } finally { cleanup(); host.dispose() }
})
