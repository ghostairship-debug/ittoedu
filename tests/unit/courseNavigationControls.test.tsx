import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { appendRootContainers, setRootContainers, testContainerInstance } from '../helpers/glxWorkFixture'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { CourseNavigationControls } from '../../src/renderer/ui/workspaces/CourseNavigationControls'
import { CourseAdvancedChrome, CourseEditorChromeContext, CourseEditorFrame, CourseNavigationToolbarHost } from '../../src/renderer/documents/CourseEditorChromeContext'
import { createCrossSurfaceCommands, type CrossSurfaceCommandPorts } from '../../src/renderer/composition/crossSurfaceCommands'

afterEach(cleanup)

it('keeps five controls in edit/run, advances actual steps before pages, and resets only the current paused page', async () => {
  const project = createBlankCourseProjectV10('共同导航'), first = componentSurfaces(project)[0]
  testContainerInstance(project, 0).container!.presentation = { states: [{ id: 'first-step', title: '第一步', overrides: {} }, { id: 'last-step', title: '第二步', overrides: {} }] }
  appendRootContainers(project, { ...first, id: 'next-page', title: '下一页', childIds: [], presentation: undefined })
  const before = structuredClone(project), restart = vi.fn(), replay = vi.fn(), report = vi.fn(), applyDraft = vi.fn(async () => {})
  let current = first.id, playing = false
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => current,
    interactive: () => playing, select: id => { current = id }, restart })
  owner.subscribeSceneReplay(replay)
  function Chrome() {
    const [mode, setMode] = useState<'edit' | 'run'>('edit')
    return <CourseNavigationControls canvasMode={mode} navigation={owner.editorPort()} beforeNavigate={applyDraft}
      onCanvasModeChange={next => { playing = next === 'run'; owner.changed(); setMode(next) }}
      resetPlayback={async () => { await owner.replayCurrentSurface() }} report={report} />
  }
  try {
    render(<Chrome />)
    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(owner.canExecute({ type: 'step.next' })).toBe(false)
    expect(await owner.execute({ type: 'step.next' })).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(owner.currentStateId()).toBe('first-step'))
    expect(current).toBe(first.id); expect(playing).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '试运行' }))
    expect(owner.currentStateId()).toBe('first-step'); expect(playing).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(owner.currentStateId()).toBe('first-step'); expect(playing).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(owner.currentStateId()).toBe('last-step'))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(current).toBe('next-page'))
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    await waitFor(() => { expect(current).toBe(first.id); expect(owner.currentStateId()).toBe('last-step') })
    fireEvent.click(screen.getByRole('button', { name: '回到初始画面' }))
    await waitFor(() => expect(owner.currentStateId()).toBe(null))
    expect(current).toBe(first.id); expect(playing).toBe(false)
    expect(replay).toHaveBeenCalledExactlyOnceWith(first.id); expect(restart).not.toHaveBeenCalled()
    expect(applyDraft).toHaveBeenCalledTimes(4); expect(report).not.toHaveBeenCalled()
    expect(project).toEqual(before)
  } finally { owner.dispose() }
})

it('moves the same live navigation to the active toolbar without duplicating controls or losing the current state', async () => {
  const project = createBlankCourseProjectV10('工具栏导航'), first = componentSurfaces(project)[0]
  testContainerInstance(project, 0).container!.presentation = { states: [{ id: 'first', title: '第一步', overrides: {} }, { id: 'second', title: '第二步', overrides: {} }] }
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => first.id, interactive: () => false, select: () => {} })
  const report = vi.fn()
  function Frame() {
    const [mode, setMode] = useState<'light' | 'deep'>('light')
    return <CourseEditorChromeContext.Provider value={{ documentId: 'current', mode, setMode }}>
      <button onClick={() => setMode(mode === 'light' ? 'deep' : 'light')}>切换工具栏</button>
      <CourseEditorFrame lightTools={<CourseNavigationToolbarHost mode="light" />}>
        <CourseAdvancedChrome><CourseNavigationToolbarHost mode="deep" /></CourseAdvancedChrome>
        <main aria-label="作品画布"><CourseNavigationControls canvasMode="edit" onCanvasModeChange={() => {}}
          navigation={owner.editorPort()} report={report} /></main>
      </CourseEditorFrame>
    </CourseEditorChromeContext.Provider>
  }
  try {
    render(<Frame />)
    await waitFor(() => expect(screen.getByTestId('course-try-run-chrome').parentElement).toHaveAttribute('data-toolbar-mode', 'light'))
    expect(screen.getByRole('main', { name: '作品画布' })).not.toContainElement(screen.getByTestId('course-try-run-chrome'))
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(owner.currentStateId()).toBe('first'))
    fireEvent.click(screen.getByRole('button', { name: '切换工具栏' }))
    await waitFor(() => expect(screen.getByTestId('course-try-run-chrome').parentElement).toHaveAttribute('data-toolbar-mode', 'deep'))
    expect(screen.getAllByTestId('course-try-run-chrome')).toHaveLength(1)
    expect(owner.currentStateId()).toBe('first')
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(owner.currentStateId()).toBe('second'))
    fireEvent.click(screen.getByRole('button', { name: '切换工具栏' }))
    await waitFor(() => expect(screen.getByTestId('course-try-run-chrome').parentElement).toHaveAttribute('data-toolbar-mode', 'light'))
    expect(owner.currentStateId()).toBe('second')
    expect(report).not.toHaveBeenCalled()
  } finally { owner.dispose() }
})

it('leaves the current author location unchanged when its draft cannot be applied', async () => {
  const project = createBlankCourseProjectV10('未完成编辑'), first = componentSurfaces(project)[0]
  testContainerInstance(project, 0).container!.presentation = { states: [{ id: 'next', title: '下一步', overrides: {} }] }
  const select = vi.fn(), report = vi.fn()
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => first.id, interactive: () => false, select })
  try {
    render(<CourseNavigationControls canvasMode="edit" navigation={owner.editorPort()} onCanvasModeChange={() => {}}
      beforeNavigate={async () => false} report={report} />)
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(report).toHaveBeenCalledWith('当前编辑未能应用，请完成编辑后重试'))
    expect(owner.currentStateId()).toBe(null); expect(select).not.toHaveBeenCalled()
  } finally { owner.dispose() }
})

it('propagates a Flow owner refusal through the public command adapter before changing playback mode', async () => {
  const project = createBlankCourseProjectV10('保留未完成 Flow 草稿')
  const headingIds = ['flow-draft-current', 'flow-draft-next']
  project.definitions.heading = { id: 'heading', role: 'content', implementation: { kind: 'builtin', key: 'guoling.document-block' } }
  for (const [index, id] of headingIds.entries()) project.instances[id] = { id, definitionId: 'heading',
    data: { type: 'heading', level: 2, content: { inlines: [{ type: 'text', text: '章节 ' + (index + 1) }] } } }
  setRootContainers(project, [{ id: 'flow-draft', kind: 'flow', title: '未完成草稿', childIds: headingIds,
    flow: { layout: { readingWidth: 860, wideContentWidth: 1100 } } }])
  const patch = vi.fn(), feedback = vi.fn()
  const ports = {
    kernel: { readEditingDocument: () => project, readView: () => ({ activeDocumentId: 'doc', surfaceId: componentSurfaces(project)[0].id }), setFeedback: feedback },
    slide: {}, spatial: {}, flow: { commitTextEdit: async () => false },
    shell: { read: () => ({ canvasMode: 'edit', editingTextNodeId: null }), patch },
    structure: {}, lifecycle: {},
  } as unknown as CrossSurfaceCommandPorts
  const commands = createCrossSurfaceCommands(ports)
  await expect(commands.commitTextEdit()).rejects.toThrow('当前编辑未能应用')
  commands.setCanvasMode('run')
  await waitFor(() => expect(feedback).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: '当前编辑未能应用，请完成编辑后重试' })))
  expect(patch).not.toHaveBeenCalled()
  const report = vi.fn(), goToInstance = vi.fn(async () => true)
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => componentSurfaces(project)[0].id,
    interactive: () => false, select: () => {} })
  owner.registerObservation('flow-draft', { readZoom: () => 1, setZoom() {}, reset() {}, goToInstance,
    readReading: () => ({ activeInstanceId: headingIds[0], progress: 0 }) })
  try {
    render(<CourseNavigationControls canvasMode="edit" navigation={owner.editorPort()} beforeNavigate={commands.commitTextEdit}
      onCanvasModeChange={() => {}} report={report} />)
    const next = screen.getByRole('button', { name: '下一步' })
    expect(next).not.toBeDisabled()
    fireEvent.click(next)
    await waitFor(() => expect(report).toHaveBeenCalledWith('当前编辑未能应用，请完成编辑后重试'))
    expect(goToInstance).not.toHaveBeenCalled()
    expect(owner.read().reading?.activeInstanceId).toBe(headingIds[0])
    expect(owner.currentStateId()).toBe(null)
  } finally { owner.dispose() }
})
