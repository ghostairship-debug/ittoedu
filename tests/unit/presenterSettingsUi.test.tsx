import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/renderer/store/editorStore'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { courseProjectV10Schema } from '@/shared/contracts/component-platform/schema'
import { createBlankCourseProjectV10 } from '@/core/course/createCourseProjectV10'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'

const store = () => useEditorStore.getState()
const project = () => store().courseView.project!
let host: Awaited<ReturnType<typeof createCourseDocumentHost>>
beforeEach(async () => {
  host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  const fixture = createBlankCourseProjectV10(); fixture.playback = { controls: 'canvas', keyboardNavigation: true, presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] } }
  await store().createCourseDocumentFrom(fixture)
  store().setEditingScope('global')
  store().selectNode(null)
})
afterEach(() => { cleanup(); store().cancelTextEdit(); store().courseBridge.dispose() })

describe('presenter settings editor', () => {
  it('关闭画布控制器后显示警告，并可一键修复', async () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    await act(async () => {
      fireEvent.change(screen.getByLabelText('导航控制方式'), {
        target: { value: 'none' },
      })
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(screen.getByTestId('controller-consistency-notice'))
      .toHaveTextContent('已从成品中隐藏')
    expect(project().playback!.controls).toBe('none')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', {
        name: '恢复并显示教师控制器',
      }))
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(project().playback!.controls).toBe('canvas')
    expect(screen.queryByTestId('controller-consistency-notice')).not.toBeInTheDocument()
    act(() => store().selectNode(null))


    const enabled = screen.getByLabelText('启用翻页笔 PageUp/PageDown')
    expect(enabled).toBeChecked()
    await act(async () => {
      fireEvent.click(enabled)
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(project().playback!.presenter.enabled).toBe(false)

    await act(async () => {
      fireEvent.click(enabled)
      fireEvent.change(screen.getByLabelText('翻页笔推进方式'), {
        target: { value: 'authored-command' },
      })
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(project().playback!.presenter).toMatchObject({
      enabled: true,
      strategy: 'authored-command',
    })
  })

  it('detects, saves, replaces, and removes an additional hardware binding', async () => {
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

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存为前进键' }))
      await useEditorStore.getState().drainCourseDocument()
    })
    let bindings = project().playback!.presenter.additionalBindings
    expect(bindings).toEqual([expect.objectContaining({
      command: 'next',
      key: 'b',
      ctrlKey: true,
    })])

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存为后退键' }))
      await useEditorStore.getState().drainCourseDocument()
    })
    bindings = project().playback!.presenter.additionalBindings
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.command).toBe('previous')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', {
        name: '删除附加按键 Ctrl + b',
      }))
      await useEditorStore.getState().drainCourseDocument()
    })
    expect(
      project().playback?.presenter.additionalBindings ?? [],
    ).toEqual([])
  })

  it('distinguishes built-in navigation keys from modified hardware bindings', async () => {
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', {
      name: '测试或添加翻页笔按键',
    }))
    fireEvent.keyDown(window, { key: 'PageDown', code: 'PageDown' })

    expect(screen.getByRole('status')).toHaveTextContent('内建“前进”键')
    expect(screen.queryByRole('button', { name: '保存为前进键' }))
      .not.toBeInTheDocument()
    expect(project().playback?.presenter.additionalBindings ?? []).toEqual([])
    expect(screen.getByLabelText('键盘翻页')).toBeChecked()
    expect(screen.getByText(/Shift\+←\/→ 上一场景\/下一场景，Home\/End 第一页\/最后一页/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '测试或添加翻页笔按键' }))
    fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true })

    expect(screen.getByRole('status')).toHaveTextContent('键盘已内建“下一场景”')
    // A remote sending arrows may still be bound to authored rules.
    expect(screen.getByRole('button', { name: '保存为前进键' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '测试或添加翻页笔按键' }))
    fireEvent.keyDown(window, { key: 'PageDown', code: 'PageDown', ctrlKey: true })

    expect(screen.getByRole('status')).toHaveTextContent('Ctrl + PageDown')
    expect(screen.getByRole('button', { name: '保存为前进键' })).toBeEnabled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存为前进键' }))
      await useEditorStore.getState().drainCourseDocument()
    })

    const binding = project().playback!.presenter
      .additionalBindings[0]
    expect(binding).toMatchObject({ key: 'PageDown', ctrlKey: true })
    expect(courseProjectV10Schema.safeParse(project()).success)
      .toBe(true)
  })
})
