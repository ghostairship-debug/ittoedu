import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { projectDesignTokensSchema } from '../../src/shared/contracts/design-v1/schema'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
const store = () => useEditorStore.getState()
const project = () => store().courseView.project!
let host: Awaited<ReturnType<typeof createCourseDocumentHost>>
beforeEach(async () => {
  host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  const fixture = createBlankCourseProjectV10(); fixture.designTokens = projectDesignTokensSchema.parse(undefined)
  await store().createCourseDocumentFrom(fixture)
  store().setEditingScope('global'); store().selectNode(null)
})
afterEach(() => { cleanup(); store().cancelTextEdit(); store().courseBridge.dispose() })

describe('minimal project design tokens', () => {
  it('edits font and color tokens through undoable project commands', async () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加字体' }))
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(project().designTokens!.fonts).toHaveLength(2)

    await act(async () => {
      useEditorStore.getState().undo()
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(project().designTokens!.fonts).toHaveLength(1)

    await act(async () => {
      useEditorStore.getState().redo()
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(project().designTokens!.fonts).toHaveLength(2)

    const idInput = await screen.findByLabelText('字体 Token 2 ID')
    await act(async () => {
      fireEvent.change(idInput, { target: { value: 'display' } })
      fireEvent.blur(idInput)
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(project().designTokens!.fonts[1]!.id).toBe('display')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加颜色' }))
      await useEditorStore.getState().drainCourseDocument()
    })
    const colors = project().designTokens!.colors
    expect(colors).toHaveLength(4)
    const colorInput = await screen.findByLabelText('颜色 Token 4 色值')
    await act(async () => {
      fireEvent.change(colorInput, { target: { value: '#123456' } })
      fireEvent.blur(colorInput)
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(project().designTokens!.colors[3]!.color)
      .toBe('#123456')
  })

  it('disables the bounded design-token UI without writing a disabled add', async () => {
    const fixture = createBlankCourseProjectV10(); fixture.designTokens = projectDesignTokensSchema.parse(undefined)
    fixture.designTokens!.fonts = Array.from({ length: 16 }, (_, index) => ({
      id: `font_${index}`,
      label: `字体 ${index + 1}`,
      fontFamily: 'sans-serif',
    }))
    fixture.designTokens!.colors = Array.from({ length: 32 }, (_, index) => ({
      id: `color_${index}`,
      label: `颜色 ${index + 1}`,
      color: '#123456',
    }))
    await store().createCourseDocumentFrom(fixture)
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
    expect(project().designTokens!.fonts).toHaveLength(16)
    expect(project().designTokens!.colors).toHaveLength(32)
    expect(courseProjectV10Schema.safeParse(project()).success)
      .toBe(true)
  })
})
