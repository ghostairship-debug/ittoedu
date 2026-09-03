import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { useEditorStore,
  selectActiveCourseProjectDocument,
} from '../../src/renderer/store/editorStore'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'

afterEach(cleanup)

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  useEditorStore.getState().setEditingScope('global')
  useEditorStore.getState().selectNode(null)
  useEditorStore.setState({ editorMode: 'professional' })
})

describe('minimal project design tokens', () => {
  it('edits font and color tokens through undoable project commands', () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '添加字体' }))
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.fonts).toHaveLength(2)
    useEditorStore.getState().undo()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.fonts).toHaveLength(1)
    useEditorStore.getState().redo()

    const idInput = screen.getByLabelText('字体 Token 2 ID')
    fireEvent.change(idInput, { target: { value: 'display' } })
    fireEvent.blur(idInput)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.fonts[1]!.id).toBe('display')

    fireEvent.click(screen.getByRole('button', { name: '添加颜色' }))
    const colors = selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.colors
    expect(colors).toHaveLength(4)
    const colorInput = screen.getByLabelText('颜色 Token 4 色值')
    fireEvent.change(colorInput, { target: { value: '#123456' } })
    fireEvent.blur(colorInput)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.colors[3]!.color)
      .toBe('#123456')
  })

  it('does not let add controls exceed schema token limits', () => {
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
    useEditorStore.getState().loadCourseProject(project, null, {}, {})
    useEditorStore.getState().setEditingScope('global')

    render(<PropertiesTab onReplaceImage={vi.fn()} />)
    const addFont = screen.getByRole('button', { name: '添加字体' })
    const addColor = screen.getByRole('button', { name: '添加颜色' })
    expect(addFont).toBeDisabled()
    expect(addColor).toBeDisabled()
    fireEvent.click(addFont)
    fireEvent.click(addColor)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.fonts).toHaveLength(16)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.designTokens.colors).toHaveLength(32)
    expect(courseProjectDocumentSchema.safeParse(selectActiveCourseProjectDocument(useEditorStore.getState())!).success)
      .toBe(true)
  })
})
