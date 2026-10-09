import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AutomationTab } from '../../src/renderer/ui/AutomationTab'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

it('discovers live course logic in Automation and commits state defaults, any-match navigation guard and renamed references through one History', async () => {
  const project = createBlankCourseProjectV10('课程逻辑'), h = await createV10StoreHost(project), previous = useEditorStore.getState()
  try {
    await previous.connectCourseDocuments(h.api)
    render(<AutomationTab />)
    const panel = screen.getByTestId('course-logic-authoring')
    fireEvent.click(within(panel).getByText(/专业：课程状态与导航守卫/))
    fireEvent.click(within(panel).getByRole('button', { name: '新增课程状态' }))
    const newState = within(panel).getByTestId('course-state-editor-新状态')
    fireEvent.change(within(newState).getByLabelText('状态键'), { target: { value: 'mastery' } })
    fireEvent.change(within(newState).getByLabelText('值类型'), { target: { value: 'number' } })
    fireEvent.change(within(newState).getByLabelText('默认值'), { target: { value: '20' } })
    await act(async () => { fireEvent.click(within(newState).getByRole('button', { name: '保存课程状态 新状态' })) })
    await waitFor(() => expect(h.model().project.logic!.courseState).toEqual([{ key: 'mastery', valueType: 'number', defaultValue: 20 }]))
    expect(h.first.read().undoDepth).toBe(1)
    fireEvent.click(within(panel).getByRole('button', { name: '新增导航守卫' }))
    const guard = within(panel).getByTestId('navigation-guard-editor-新守卫')
    fireEvent.click(within(guard).getByLabelText('所有来源位置'))
    fireEvent.click(within(guard).getByLabelText('来源位置 ' + project.surfaces[0].title))
    fireEvent.change(within(guard).getByLabelText('条件匹配方式'), { target: { value: 'any' } })
    fireEvent.change(within(guard).getByLabelText('条件 1 类型'), { target: { value: 'compare' } })
    fireEvent.change(within(guard).getByLabelText('比较方式'), { target: { value: 'gte' } })
    fireEvent.change(within(guard).getByLabelText('比较值'), { target: { value: '80' } })
    fireEvent.change(within(guard).getByLabelText('阻止提示'), { target: { value: '请先完成练习' } })
    await act(async () => { fireEvent.click(within(guard).getByRole('button', { name: '保存导航守卫 新守卫' })) })
    await waitFor(() => expect(h.model().project.logic!.navigationGuards).toHaveLength(1))
    expect(h.model().project.logic!.navigationGuards[0]).toMatchObject({ fromSurfaceIds: [project.surfaces[0].id], toSurfaceIds: [project.surfaces[0].id],
      match: 'any', conditions: [{ type: 'compare', key: 'mastery', operator: 'gte', value: 80 }], message: '请先完成练习' })
    expect(h.first.read().undoDepth).toBe(2)
    fireEvent.click(within(panel).getByText(/^mastery · number/))
    const state = within(panel).getByTestId('course-state-editor-mastery')
    fireEvent.change(within(state).getByLabelText('状态键'), { target: { value: 'masteryScore' } })
    await act(async () => { fireEvent.click(within(state).getByRole('button', { name: '保存课程状态 mastery' })) })
    await waitFor(() => expect(h.model().project.logic!.courseState[0].key).toBe('masteryScore'))
    expect(h.model().project.logic!.navigationGuards[0].conditions[0].key).toBe('masteryScore')
    expect(h.first.read().undoDepth).toBe(3)
    expect(h.driver.load(h.driver.serialize(h.model()))).toEqual(h.model())
    await act(async () => { await useEditorStore.getState().courseBridge.undo() })
    expect(h.model().project.logic!.courseState[0].key).toBe('mastery')
    expect(h.model().project.logic!.navigationGuards[0].conditions[0].key).toBe('mastery')
  } finally { cleanup(); useEditorStore.getState().courseBridge.dispose(); useEditorStore.setState(previous, true); h.bridge.dispose() }
})
