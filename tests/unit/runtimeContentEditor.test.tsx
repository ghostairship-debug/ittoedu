import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseRuntimeContentTextTarget } from '../../src/renderer/runtime/runtimeContentTextAuthoringCommands'
import {
  RuntimeContentEditor,
  type RuntimeContentEditorField,
} from '../../src/renderer/ui/RuntimeContentEditor'

afterEach(() => cleanup())

function target(
  contentKey: string,
  initialValue: string,
  documentRevision = 1,
): CourseRuntimeContentTextTarget {
  return {
    courseTarget: {
      projectId: 'course-1',
      documentRevision,
      revisionPolicy: { kind: 'exact' },
      sessionGeneration: 1,
      surfaceType: 'slide',
      surfaceId: 'surface-1',
      locationId: 'location-1',
      stateId: null,
      owner: 'scene',
      ownerKey: 'surface-1:scene-1',
      itemId: 'runtime-1',
      authoringAddress: `/course/course-1/surface/surface-1/scene/scene-1/runtime/runtime-1/runtime/content/values/${contentKey}`,
    },
    contentKey,
    initialValue,
  }
}

function fields(
  title = '原始标题',
  documentRevision = 1,
): readonly RuntimeContentEditorField[] {
  return [
    {
      key: 'title',
      value: title,
      target: target('title', title, documentRevision),
      metadata: { label: '主标题', maxLength: 20 },
    },
    {
      key: 'feedback.success',
      value: '回答正确',
      target: target('feedback.success', '回答正确', documentRevision),
      metadata: {
        label: '成功反馈',
        description: '答对后显示',
        multiline: true,
      },
    },
  ]
}

describe('RuntimeContentEditor', () => {
  it('buffers each canonical field and commits one keyed value on blur', () => {
    const onCommit = vi.fn(() => ({ ok: true as const, status: 'updated' as const }))
    render(<RuntimeContentEditor fields={fields()} onCommit={onCommit} />)

    expect(screen.getByLabelText('主标题')).toHaveValue('原始标题')
    expect(screen.getByLabelText('主标题')).toHaveAttribute('maxlength', '20')
    expect(screen.getByLabelText('成功反馈').tagName).toBe('TEXTAREA')
    expect(screen.getByText('答对后显示')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('成功反馈'), {
      target: { value: '请继续保持' },
    })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.blur(screen.getByLabelText('成功反馈'))

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        contentKey: 'feedback.success',
        initialValue: '回答正确',
      }),
      '请继续保持',
    )
    expect(screen.getByTestId('runtime-content-result-feedback.success'))
      .toHaveTextContent('已保存')
  })

  it('commits once on Enter and restores the captured value on Escape', () => {
    const onCommit = vi.fn(() => ({ ok: true as const, status: 'unchanged' as const }))
    render(<RuntimeContentEditor fields={fields()} onCommit={onCommit} />)
    const input = screen.getByLabelText('主标题')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '键盘提交' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentKey: 'title' }),
      '键盘提交',
    )

    fireEvent.change(input, { target: { value: '放弃这个草稿' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('原始标题')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('syncs clean replacements but retains a dirty captured target until an explicit retry', () => {
    const onCommit = vi.fn(() => ({
      ok: false as const,
      reason: '运行时文字目标已经过期',
    }))
    const rendered = render(
      <RuntimeContentEditor fields={fields()} onCommit={onCommit} />,
    )
    rendered.rerender(
      <RuntimeContentEditor
        fields={fields('替换后的标题', 2)}
        onCommit={onCommit}
      />,
    )
    const input = screen.getByLabelText('主标题')
    expect(input).toHaveValue('替换后的标题')

    fireEvent.change(input, { target: { value: '需要保留的草稿' } })
    rendered.rerender(
      <RuntimeContentEditor
        fields={fields('外部提交后的标题', 3)}
        onCommit={onCommit}
      />,
    )
    expect(input).toHaveValue('需要保留的草稿')
    fireEvent.blur(input)
    expect(input).toHaveValue('需要保留的草稿')
    expect(screen.getByRole('alert')).toHaveTextContent('运行时文字目标已经过期')
    expect(onCommit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        courseTarget: expect.objectContaining({ documentRevision: 2 }),
      }),
      '需要保留的草稿',
    )

    fireEvent.focus(input)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).toHaveValue('需要保留的草稿')
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        courseTarget: expect.objectContaining({ documentRevision: 3 }),
      }),
      '需要保留的草稿',
    )
  })

  it('disables every field when the effective Runtime target is locked', () => {
    render(
      <RuntimeContentEditor
        fields={fields()}
        disabled
        onCommit={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('主标题')).toBeDisabled()
    expect(screen.getByLabelText('成功反馈')).toBeDisabled()
  })

  it('shows an unaddressable legacy key as read-only and never commits it', () => {
    const onCommit = vi.fn()
    const legacyField: RuntimeContentEditorField = {
      ...fields()[0]!,
      key: 'legacy\u0000key',
      target: null,
      readonlyReason: '该文案键无法生成稳定作者地址，只读显示',
    }
    render(
      <RuntimeContentEditor fields={[legacyField]} onCommit={onCommit} />,
    )

    const input = screen.getByLabelText('主标题')
    expect(input).toBeDisabled()
    expect(screen.getByTestId('runtime-content-readonly-legacy-key'))
      .toHaveTextContent('该文案键无法生成稳定作者地址，只读显示')
    fireEvent.change(input, { target: { value: '不得写入' } })
    fireEvent.blur(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('shows a clear empty state when the runtime owns no authored text', () => {
    render(<RuntimeContentEditor fields={[]} onCommit={vi.fn()} />)
    expect(screen.getByTestId('runtime-content-empty')).toBeInTheDocument()
  })
})
