import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { selectActiveCourseProjectDocument, useEditorStore } from '@/renderer/store/editorStore'
import { AutomationTab } from '@/renderer/ui/AutomationTab'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  useEditorStore.setState({ editorMode: 'professional' })
})

afterEach(cleanup)

describe('professional course logic authoring UI', () => {
  it('可发现并编辑默认值、位置、all/any、条件和阻止提示', () => {
    render(<AutomationTab />)

    const panel = screen.getByTestId('course-logic-authoring')
    fireEvent.click(within(panel).getByText(/专业：课程状态与导航守卫/))
    fireEvent.click(within(panel).getByRole('button', { name: '新增课程状态' }))

    const newState = within(panel).getByTestId('course-state-editor-新状态')
    fireEvent.change(within(newState).getByLabelText('状态键'), {
      target: { value: 'mastery' },
    })
    fireEvent.change(within(newState).getByLabelText('值类型'), {
      target: { value: 'number' },
    })
    fireEvent.change(within(newState).getByLabelText('默认值'), {
      target: { value: '20' },
    })
    fireEvent.click(within(newState).getByRole('button', {
      name: '保存课程状态 新状态',
    }))

    let project = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(project?.courseState).toEqual([
      { key: 'mastery', valueType: 'number', defaultValue: 20 },
    ])
    if (!project) throw new Error('课程文档未保存')

    fireEvent.click(within(panel).getByRole('button', { name: '新增导航守卫' }))
    const guardEditor = within(panel).getByTestId('navigation-guard-editor-新守卫')
    fireEvent.click(within(guardEditor).getByLabelText('所有来源位置'))
    fireEvent.click(within(guardEditor).getByLabelText(
      `来源位置 ${project.locations[0]!.label}`,
    ))
    fireEvent.change(within(guardEditor).getByLabelText('条件匹配方式'), {
      target: { value: 'any' },
    })
    fireEvent.change(within(guardEditor).getByLabelText('条件 1 类型'), {
      target: { value: 'compare' },
    })
    fireEvent.change(within(guardEditor).getByLabelText('比较方式'), {
      target: { value: 'gte' },
    })
    fireEvent.change(within(guardEditor).getByLabelText('比较值'), {
      target: { value: '80' },
    })
    fireEvent.change(within(guardEditor).getByLabelText('阻止提示'), {
      target: { value: '掌握度达到 80 后才能进入' },
    })
    fireEvent.click(within(guardEditor).getByRole('button', {
      name: '保存导航守卫 新守卫',
    }))

    project = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!project) throw new Error('导航守卫未保存')
    expect(project?.navigationGuards[0]).toMatchObject({
      effect: 'block',
      fromLocationIds: [project.startLocationId],
      toLocationIds: [project.startLocationId],
      match: 'any',
      conditions: [{ type: 'compare', key: 'mastery', operator: 'gte', value: 80 }],
      message: '掌握度达到 80 后才能进入',
    })
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)

    fireEvent.click(within(panel).getByText(/^mastery · number/))
    const stateEditor = within(panel).getByTestId('course-state-editor-mastery')
    fireEvent.change(within(stateEditor).getByLabelText('状态键'), {
      target: { value: 'masteryScore' },
    })
    fireEvent.click(within(stateEditor).getByRole('button', {
      name: '保存课程状态 mastery',
    }))

    project = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(project?.courseState[0]?.key).toBe('masteryScore')
    expect(project?.navigationGuards[0]?.conditions[0]).toMatchObject({
      key: 'masteryScore',
    })
  })

  it('简单模式不暴露专业课程逻辑表单', () => {
    useEditorStore.setState({ editorMode: 'simple' })
    render(<AutomationTab />)
    expect(screen.queryByTestId('course-logic-authoring')).not.toBeInTheDocument()
  })
})
