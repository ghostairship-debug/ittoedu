// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { usePropertiesAuthoringBinding } from '../../src/renderer/composition/properties/usePropertiesAuthoringBinding'
import { SlideCanvasSizeSection } from '../../src/renderer/ui/properties/CourseGlobalPropertiesPanel'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

function ResizePanel() {
  const context = usePropertiesAuthoringBinding({ onReplaceImage() {} })
  if (context.kind === 'empty-scene' && context.scene?.canvas && context.commands.resizeCanvas)
    return <SlideCanvasSizeSection canvas={context.scene.canvas.effective} scope={context.scene.canvas.scope} onApply={context.commands.resizeCanvas} />
  if (context.kind === 'course-global' && context.empty?.canvas)
    return <SlideCanvasSizeSection canvas={context.empty.canvas} scope={context.empty.canvasScope} onApply={context.commands.resizeSlideCanvas} />
  throw new Error(`Expected page or global resize controls, got ${context.kind}`)
}

it('uses current, checked and all Slide scopes through the existing property owner with explicit content fitting', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'course-resize-controls-'))
  try {
    const host = new DocumentHostService(root), project = createBlankCourseProjectV10()
    const first = project.surfaces[0]!, hud = project.global.overlay[0]!, hudFrame = structuredClone(project.instances[hud]!.frame)
    first.id = 'first'; first.title = '一页'
    project.surfaces.push({ id: 'second', kind: 'slide', title: '二页', childIds: [], designSize: { width: 1280, height: 720 } },
      { id: 'third', kind: 'slide', title: '三页', childIds: [], designSize: { width: 1280, height: 720 } },
      { id: 'flow', kind: 'flow', title: '正文', childIds: [] })
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    for (const id of ['first', 'second', 'third', 'shared']) {
      project.instances[id] = { id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData(id))),
        frame: { transform: [1, 0, 0, 1, 20, 30], width: 200, height: 100 } }
      if (id === 'shared') project.global.underlay.push(id)
      else project.surfaces.find(surface => surface.id === id)!.childIds.push(id)
    }
    first.presentation = { states: [{ id: 'shown', title: '展示状态', overrides: { first: { frame: { transform: [1, 0, 0, 1, 100, 100], width: 300, height: 100 } } } }] }
    const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'resize.h5lesson')
    const unavailable = async (): Promise<never> => { throw new Error('Outside resize fixture') }
    const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => snapshot, subscribe: host.subscribeEvents.bind(host),
      saveWithDialog: unavailable, closeWithDialog: unavailable, close: unavailable, discardRecovery: unavailable }
    await useEditorStore.getState().connectCourseDocuments(api)
    useEditorStore.setState({ editingScope: 'scene' })
    useEditorStore.getState().courseBridge.selectPresentationState(snapshot.documentId, 'shown')
    render(<ResizePanel />)
    const resize = async (width: number, height: number, depth: number) => {
      fireEvent.change(screen.getByLabelText('宽度'), { target: { value: String(width) } })
      fireEvent.change(screen.getByLabelText('高度'), { target: { value: String(height) } })
      fireEvent.click(screen.getByRole('button', { name: '应用' }))
      await waitFor(() => expect(useEditorStore.getState().courseView.snapshot?.undoDepth).toBe(depth))
      const current = await host.internalAPI.read(snapshot.documentId)
      if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
      return current.model.project
    }
    expect(screen.getByLabelText('应用范围')).toHaveValue('current')
    expect(screen.getByLabelText('等比适配页面内容')).not.toBeChecked()
    let current = await resize(1600, 900, 1)
    expect(current.surfaces[0]!.designSize).toEqual({ width: 1600, height: 900 })
    expect(current.surfaces[1]!.designSize).toEqual({ width: 1280, height: 720 })
    expect(current.instances.first!.frame).toEqual(project.instances.first!.frame)
    expect(current.surfaces[0]!.presentation).toEqual(first.presentation)
    expect(current.instances.shared!.frame).toEqual(project.instances.shared!.frame)
    fireEvent.change(screen.getByLabelText('应用范围'), { target: { value: 'selected' } })
    expect(screen.queryByLabelText('选择页面 正文')).toBeNull()
    fireEvent.click(screen.getByLabelText('选择页面 一页'))
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('选择页面 二页')); fireEvent.click(screen.getByLabelText('选择页面 三页'))
    fireEvent.click(screen.getByLabelText('等比适配页面内容'))
    fireEvent.click(screen.getByLabelText('同时适配共享全局层'))
    current = await resize(640, 360, 2)
    expect(current.surfaces.slice(0, 3).map(surface => surface.designSize)).toEqual([
      { width: 1600, height: 900 }, { width: 640, height: 360 }, { width: 640, height: 360 }])
    expect(current.instances.second!.frame?.transform).toEqual([.5, 0, 0, .5, 10, 15])
    expect(current.instances.third!.frame?.transform).toEqual([.5, 0, 0, .5, 10, 15])
    expect(current.instances.first!.frame).toEqual(project.instances.first!.frame)
    expect(current.instances.shared!.frame?.transform).toEqual([.4, 0, 0, .4, 8, 12])
    expect(current.instances[hud]!.frame).toEqual(hudFrame)
    act(() => useEditorStore.setState({ editingScope: 'global' }))
    fireEvent.change(screen.getByLabelText('应用范围'), { target: { value: 'all' } })
    fireEvent.click(screen.getByLabelText('等比适配页面内容'))
    const frames = Object.fromEntries(Object.entries(current.instances).map(([id, instance]) => [id, instance.frame]))
    current = await resize(800, 450, 3)
    expect(current.surfaces.slice(0, 3).every(surface => surface.designSize?.width === 800 && surface.designSize.height === 450)).toBe(true)
    expect(current.surfaces[3]!.designSize).toBeUndefined()
    expect(Object.fromEntries(Object.entries(current.instances).map(([id, instance]) => [id, instance.frame]))).toEqual(frames)
  } finally {
    cleanup(); useEditorStore.getState().courseBridge.dispose(); useEditorStore.setState({ editingScope: 'scene' })
    await fs.rm(root, { recursive: true, force: true })
  }
})
