import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore,
  selectActiveCourseProjectDocument,
} from '@/renderer/store/editorStore'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { projectDocumentSchema } from '@/shared/projectSchema'

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  useEditorStore.getState().setEditingScope('global')
  useEditorStore.getState().selectNode(null)
  useEditorStore.setState({ editorMode: 'professional' })
})

afterEach(() => cleanup())

describe('presenter settings editor', () => {
  it('关闭画布控制器后显示警告，并可一键修复', () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('导航控制方式'), {
      target: { value: 'none' },
    })
    expect(screen.getByTestId('controller-consistency-notice'))
      .toHaveTextContent('已从成品中隐藏')
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.controls).toBe('none')

    fireEvent.click(screen.getByRole('button', {
      name: '恢复并显示教师控制器',
    }))
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.controls).toBe('canvas')
    expect(screen.queryByTestId('controller-consistency-notice')).not.toBeInTheDocument()
  })

  it('updates the enabled state and the authored-command strategy', () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    const enabled = screen.getByLabelText('启用翻页笔 PageUp/PageDown')
    expect(enabled).toBeChecked()
    fireEvent.click(enabled)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.presenter.enabled).toBe(false)

    fireEvent.click(enabled)
    fireEvent.change(screen.getByLabelText('翻页笔推进方式'), {
      target: { value: 'authored-command' },
    })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.presenter).toMatchObject({
      enabled: true,
      strategy: 'authored-command',
    })
  })

  it('detects, saves, replaces, and removes an additional hardware binding', () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', {
      name: '测试或添加翻页笔按键',
    }))
    fireEvent.keyDown(window, {
      key: 'b',
      code: 'KeyB',
      ctrlKey: true,
    })
    expect(screen.getByRole('status')).toHaveTextContent('Ctrl + b')
    expect(screen.getByRole('status')).toHaveTextContent('code=KeyB')

    fireEvent.click(screen.getByRole('button', { name: '保存为前进键' }))
    let bindings = selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.presenter.additionalBindings
    expect(bindings).toEqual([expect.objectContaining({
      command: 'next',
      key: 'b',
      ctrlKey: true,
    })])

    fireEvent.click(screen.getByRole('button', { name: '保存为后退键' }))
    bindings = selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.presenter.additionalBindings
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.command).toBe('previous')

    fireEvent.click(screen.getByRole('button', {
      name: '删除附加按键 Ctrl + b',
    }))
    expect(
      selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.presenter.additionalBindings,
    ).toEqual([])
  })

  it('recognizes PageDown as built in and does not duplicate it', () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', {
      name: '测试或添加翻页笔按键',
    }))
    fireEvent.keyDown(window, { key: 'PageDown', code: 'PageDown' })

    expect(screen.getByRole('status')).toHaveTextContent('内建“前进”键')
    expect(screen.queryByRole('button', { name: '保存为前进键' }))
      .not.toBeInTheDocument()
    expect(
      selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.presenter.additionalBindings,
    ).toEqual([])
  })

  it('saves a modified PageDown because only the unmodified key is built in', () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '测试或添加翻页笔按键' }))
    fireEvent.keyDown(window, { key: 'PageDown', code: 'PageDown', ctrlKey: true })

    expect(screen.getByRole('status')).toHaveTextContent('Ctrl + PageDown')
    expect(screen.getByRole('button', { name: '保存为前进键' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '保存为前进键' }))

    const binding = selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.presenter
      .additionalBindings[0]
    expect(binding).toMatchObject({ key: 'PageDown', ctrlKey: true })
    expect(courseProjectDocumentSchema.safeParse(selectActiveCourseProjectDocument(useEditorStore.getState())!).success)
      .toBe(true)
  })
})
