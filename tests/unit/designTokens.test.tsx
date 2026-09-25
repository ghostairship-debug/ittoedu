import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { useEditorStore,
  selectActiveCourseProjectDocument,
} from '../../src/renderer/store/editorStore'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'
import { createCourseStoreHost } from '../helpers/courseStoreHost'

afterEach(cleanup)

let host: Awaited<ReturnType<typeof createCourseStoreHost>>

beforeEach(async () => {
  host = await createCourseStoreHost()
  await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  await act(async () => {
    useEditorStore.getState().setEditingScope('global')
    await useEditorStore.getState().drainCourseDocument()
  })
  useEditorStore.getState().selectNode(null)
})

describe('minimal project design tokens', () => {
  it('edits font and color tokens through undoable project commands', async () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加字体' }))
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.fonts).toHaveLength(2)

    await act(async () => {
      useEditorStore.getState().undo()
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.fonts).toHaveLength(1)

    await act(async () => {
      useEditorStore.getState().redo()
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.fonts).toHaveLength(2)

    const idInput = await screen.findByLabelText('字体 Token 2 ID')
    await act(async () => {
      fireEvent.change(idInput, { target: { value: 'display' } })
      fireEvent.blur(idInput)
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.fonts[1]!.id).toBe('display')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加颜色' }))
      await useEditorStore.getState().drainCourseDocument()
    })
    const colors = selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.colors
    expect(colors).toHaveLength(4)
    const colorInput = await screen.findByLabelText('颜色 Token 4 色值')
    await act(async () => {
      fireEvent.change(colorInput, { target: { value: '#123456' } })
      fireEvent.blur(colorInput)
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.colors[3]!.color)
      .toBe('#123456')
  })

  it('does not let add controls exceed schema token limits', async () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    project.designTokens.fonts = Array.from({ length: 16 }, (_, index) => ({
      id: `font_${index}`,
      label: `字体 ${index + 1}`,
      fontFamily: 'sans-serif',
    }))
    project.designTokens.colors = Array.from({ length: 32 }, (_, index) => ({
      id: `color_${index}`,
      label: `颜色 ${index + 1}`,
      color: '#123456',
    }))
    await host.open(project)
    useEditorStore.getState().setEditingScope('global')
    await useEditorStore.getState().drainCourseDocument()

    render(<PropertiesTab onReplaceImage={vi.fn()} />)
    const addFont = screen.getByRole('button', { name: '添加字体' })
    const addColor = screen.getByRole('button', { name: '添加颜色' })
    expect(addFont).toBeDisabled()
    expect(addColor).toBeDisabled()
    fireEvent.click(addFont)
    fireEvent.click(addColor)
    await useEditorStore.getState().drainCourseDocument()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.fonts).toHaveLength(16)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.colors).toHaveLength(32)
    expect(courseProjectDocumentSchema.safeParse(selectActiveCourseProjectDocument(useEditorStore.getState())!).success)
      .toBe(true)
  })
})
