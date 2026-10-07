import { z } from 'zod'
import type { ComponentEdit, CourseProjectV10 } from '../../shared/contracts/component-platform'
import { componentPresentationSchema } from '../../shared/contracts/component-platform/schema'
import type { ToolTarget } from '../../shared/workbench/tools'

export const coursePresentationInputSchema = z.object({
  target: z.string().min(1),
  action: z.enum(['add', 'rename', 'duplicate', 'delete', 'set-initial', 'set-thumbnail', 'clear-overrides']),
  state: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).optional(),
}).strict().superRefine((input, context) => {
  if (['rename', 'duplicate', 'delete', 'clear-overrides'].includes(input.action) && !input.state)
    context.addIssue({ code: 'custom', path: ['state'], message: '请选择一个已有命名状态' })
  if (input.action === 'rename' && input.title === undefined)
    context.addIssue({ code: 'custom', path: ['title'], message: '请输入状态名称' })
})
export type CoursePresentationInput = z.output<typeof coursePresentationInputSchema>

/** Plan author state only. The captured surface and DocumentSession own identity, CAS and history. */
export function coursePresentationEdits(project: CourseProjectV10,
  target: Extract<ToolTarget, { kind: 'course-surface' }>, input: Omit<CoursePresentationInput, 'target'>,
  createId: () => string = () => crypto.randomUUID()): ComponentEdit[] {
  const value = coursePresentationInputSchema.parse({ ...input, target: target.surfaceId })
  const surface = project.surfaces.find(entry => entry.id === target.surfaceId)
  if (!surface || surface.kind !== 'slide') throw new Error('请选择一个演示页面')
  const presentation = structuredClone(surface.presentation ?? { states: [] })
  const requireState = () => {
    const exact = presentation.states.find(entry => entry.id === value.state)
    if (exact) return exact
    const matches = presentation.states.filter(entry => entry.title === value.state)
    if (matches.length > 1) throw new Error('有多个同名展示状态，请从当前读取结果选择具体状态')
    if (!matches.length) throw new Error('展示状态已不存在，请重新读取当前页面')
    return matches[0]!
  }
  const newId = () => {
    const id = createId()
    if (!id || presentation.states.some(entry => entry.id === id)) throw new Error('展示状态身份已存在')
    return id
  }
  switch (value.action) {
    case 'add': presentation.states.push({ id: newId(), title: value.title ?? '新状态', overrides: {} }); break
    case 'duplicate': {
      const source = requireState(), index = presentation.states.indexOf(source)
      presentation.states.splice(index + 1, 0, { ...structuredClone(source), id: newId(), title: value.title ?? source.title + ' 副本' })
      break
    }
    case 'rename': requireState().title = value.title!; break
    case 'delete': {
      const state = requireState()
      presentation.states = presentation.states.filter(entry => entry.id !== state.id)
      if (presentation.initialStateId === state.id) presentation.initialStateId = null
      if (presentation.thumbnailStateId === state.id) presentation.thumbnailStateId = null
      break
    }
    case 'set-initial': presentation.initialStateId = value.state == null ? null : requireState().id; break
    case 'set-thumbnail': presentation.thumbnailStateId = value.state == null ? null : requireState().id; break
    case 'clear-overrides': {
      const state = requireState()
      state.overrides = {}; delete state.order; delete state.background
      break
    }
  }
  return [{ type: 'surface.presentation.set', surfaceId: surface.id, presentation: componentPresentationSchema.parse(presentation) }]
}
