// @vitest-environment node
import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { describe, expect, it } from 'vitest'
import { createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { insertionContainer, prepareCourseElementEdits, prepareCourseTeacherControllerEdits } from '../../src/core/course/courseElementInsertion'
import { flowPlacementEdits } from '../../src/core/course/courseFlowEdits'
import { createCourseProductivityPreview, planCourseProductivityEdits } from '../../src/core/course/courseProductivityEdits'
import { courseLogicAuthoringView, executeCourseLogicAuthoringCommand } from '../../src/core/course/courseLogicAuthoringCommands'
import { prepareCourseInteractionAction, prepareCourseInteractionRules, type CourseAuthoringReferences } from '../../src/core/course/courseAuthoringReferences'
import { applyComponentOperation, captureComponentOperation, presentationComponentEdits } from '../../src/core/drivers/courseV10Operations'
import { componentSurface, componentSurfaces, createComponentContainerInstance, resolveComponentPresentation,
  type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import { createTextComponentData } from '../../src/components/text/data'

const json = (value: unknown) => JSON.parse(JSON.stringify(value))
const apply = (project: CourseProjectV10, edits: ComponentEdit[]) => applyComponentOperation(project,captureComponentOperation(project,edits))
function fixture(withStates = true): CourseProjectV10 {
  return { schemaVersion: 11, id: 'work', revision: 0, title: '原作品', rootIds: ['root'], entry: { rootInstanceId: 'root' },
    definitions: {
      slide: { id: 'slide', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
      flow: { id: 'flow', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      group: { id: 'group', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.group' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      behavior: { id: 'behavior', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } },
    },
    instances: {
      root: { ...createComponentContainerInstance({ id: 'root', title: '原页面', kind: 'slide', childIds: ['flow'], designSize: { width: 1280, height: 720 } },'slide'),
        frame: { width: 1280, height: 720, transform: [1,0,0,1,100,200] } },
      flow: { ...createComponentContainerInstance({ id: 'flow', title: '嵌套内容', kind: withStates ? 'slide' : 'flow', childIds: ['group', 'behavior'], background: { mode: 'own', color: '#ffffff' },
        ...(withStates ? { presentation: { initialStateId: 'same', states: [{ id: 'same', title: '局部状态', overrides: {
          text: { data: json(createTextComponentData('原文字（状态）')) },
        } }] } } : {}) },withStates ? 'slide' : 'flow'), frame: { width: 860, height: 600, transform: [1,0,0,1,50,30] } },
      group: { id: 'group', definitionId: 'group', data: {}, childIds: ['text'], frame: { width: 400, height: 200, transform: [1,0,0,1,20,10] } },
      text: { id: 'text', definitionId: 'text', data: json(createTextComponentData('原文字')), frame: { width: 300, height: 70, transform: [1,0,0,1,5,6] } },
      behavior: { id: 'behavior', definitionId: 'behavior', data: { rules: [] } },
    }, global: { underlay: [], overlay: [] }, assets: {}, designTokens: { fonts: [], colors: [{ id: 'ink', label: '蓝', color: '#123456' }] } }
}

describe('GLX canonical course authoring consumers', () => {
  it('inserts native content under the real program root without inventing a surface or losing source', () => {
    let nextId = 0
    const project = createBlankProgramProject('程序',() => `id${++nextId}`), root = project.entry!.rootInstanceId
    const source = structuredClone(project.definitions), plan = prepareCourseElementEdits(project,null,null,'text',{ text: '可编辑文字' })
    const next = apply(project,plan.edits)
    expect(next.rootIds).toEqual([root])
    expect(next.instances[root].childIds).toEqual(plan.instanceIds)
    expect(next.instances[plan.instanceIds[0]].frame?.transform.slice(4)).toEqual([0,0])
    expect(next.definitions[project.instances[root].definitionId]).toEqual(source[project.instances[root].definitionId])
    expect(componentSurfaces(next)).toEqual([])
    expect(project.instances[root]).not.toHaveProperty('childIds')
    expect(insertionContainer({ project: next, surfaceId: null, rootInstanceId: root, instanceId: plan.instanceIds[0] })).toEqual({ kind: 'instance', instanceId: root })
    expect(courseLogicAuthoringView(next).surfaces).toEqual([{ id: root, title: '程序' }])
    expect(executeCourseLogicAuthoringCommand(next,{ kind: 'navigation-guard.add', projectId: next.id, baseRevision: next.revision,
      guard: { id: 'guard', effect: 'block', toSurfaceIds: [root], match: 'all', conditions: [], message: '原提示' } }).ok).toBe(true)
    const controller = prepareCourseTeacherControllerEdits(next,null), withController = apply(next,controller.edits)
    expect(withController.global.overlay).toContain(controller.instanceIds[0])
    expect(componentSurfaces(withController)).toEqual([])
    expect(prepareCourseTeacherControllerEdits(withController,null).instanceIds).toEqual(controller.instanceIds)
  })

  it('keeps affine placement while moving a nested Flow item between body and overlay', () => {
    const project = fixture(false), original = structuredClone(project)
    const overlay = apply(project,flowPlacementEdits(project,'text',{ kind: 'overlay', surfaceId: 'flow', placement: { space: 'paper', plane: 'overlay' } }))
    expect(overlay.instances.flow.childIds).toEqual(['group','behavior','text'])
    expect(overlay.instances.group.childIds).toEqual([])
    expect(overlay.instances.text.frame?.transform).toEqual([1,0,0,1,25,16])
    const body = apply(overlay,flowPlacementEdits(overlay,'text',{ kind: 'document', surfaceId: 'flow', parentId: 'group' }))
    expect(body.instances.text.frame?.transform).toEqual(project.instances.text.frame?.transform)
    expect(body.instances.group.childIds).toEqual(['text'])
    expect(body.instances.text.flowPlacement).toBeUndefined()
    expect(project).toEqual(original)
  })

  it('commits a named state edit in a nested Slide and keeps its base author value', () => {
    const project = fixture(), edit: ComponentEdit = { type: 'data.set', instanceId: 'text', path: [], value: json(createTextComponentData('状态已改')) }
    const next = apply(project,presentationComponentEdits(project,'flow','same',[edit]))
    expect(next.instances.text.data).toEqual(project.instances.text.data)
    expect(resolveComponentPresentation(next,'flow','same').instances.text.data).toEqual(edit.value)
    expect(componentSurface(next,'root')!.presentation).toBeUndefined()
  })

  it('edits nested background and both base/state text through canonical operations', () => {
    const project = fixture(), before = structuredClone(project)
    const colored = apply(project,planCourseProductivityEdits(project,'flow',{ kind: 'color', scope: 'surface', tokenId: 'ink', property: 'background' }).edits)
    expect(colored.instances.flow.container!.background).toEqual({ mode: 'own', color: '#123456' })
    const text = planCourseProductivityEdits(project,'root',{ kind: 'text', scope: 'course', find: '原文字', replacement: '新文字' })
    expect(text.items).toHaveLength(2)
    const next = apply(project,text.edits)
    expect(JSON.stringify(next.instances.text.data)).toContain('新文字')
    expect(JSON.stringify(componentSurface(next,'flow')!.presentation)).toContain('新文字（状态）')
    expect(project).toEqual(before)
    const program = createBlankProgramProject()
    const inserted = prepareCourseElementEdits(program,null,null,'text',{ text: '程序中的文字' })
    expect(createCourseProductivityPreview(apply(program,inserted.edits),null,{ kind: 'text', scope: 'page', find: '文字', replacement: '正文' }).items).toHaveLength(1)
  })

  it('resolves local state tokens against the nearest or explicitly named container', () => {
    const project = fixture(), references: CourseAuthoringReferences = new Map([
      ['local',{ kind: 'presentation-state', surfaceId: 'flow', stateId: 'same' }],
      ['container',{ kind: 'instance', instanceId: 'flow' }],
      ['wrong',{ kind: 'presentation-state', surfaceId: 'root', stateId: 'same' }],
    ])
    expect(prepareCourseInteractionAction(project,{ kind: 'instance', instanceId: 'text' },{ type: 'presentation.set', stateId: 'local' },references))
      .toEqual({ type: 'presentation.set', stateId: 'same' })
    expect(prepareCourseInteractionAction(project,{ kind: 'project' },{ type: 'presentation.set', containerId: 'container', stateId: 'local' },references))
      .toEqual({ type: 'presentation.set', containerId: 'flow', stateId: 'same' })
    expect(() => prepareCourseInteractionAction(project,{ kind: 'instance', instanceId: 'text' },{ type: 'presentation.set', stateId: 'wrong' },references)).toThrow('另一页面')
    expect(prepareCourseInteractionRules(project,{ kind: 'instance', instanceId: 'text' },[{ id: 'r', enabled: true, trigger: { type: 'presentation.enter', stateId: 'local' },
      conditions: [{ type: 'presentation.in', stateIds: ['local'] }], actions: [{ id: 'a', start: 'after-previous', delayMs: 0,
        action: { type: 'presentation.set', stateId: 'local' } }] }],references)[0].trigger).toEqual({ type: 'presentation.enter', stateId: 'same' })
    const program = createBlankProgramProject(), programId = program.rootIds[0]
    const programReferences: CourseAuthoringReferences = new Map([['program',{ kind: 'instance', instanceId: programId }]])
    expect(prepareCourseInteractionAction(program,{ kind: 'project' },{ type: 'scene.go', sceneId: 'program' },programReferences))
      .toEqual({ type: 'scene.go', sceneId: programId })
    expect(prepareCourseInteractionAction(program,{ kind: 'project' },{ type: 'location.go', locationId: 'program' },programReferences))
      .toEqual({ type: 'location.go', locationId: programId })
    expect(() => prepareCourseInteractionAction(program,{ kind: 'project' },{ type: 'step.next', containerId: 'program' },programReferences)).toThrow('可呈现容器')
    expect(() => prepareCourseInteractionAction(project,{ kind: 'project' },{ type: 'scene.go', sceneId: 'container' },references)).toThrow('作品根目录')
  })

  it('renames a course state used only in a nested container presentation', () => {
    const project = fixture()
    project.logic = { courseState: [{ key: 'score', valueType: 'number', defaultValue: 0 }], navigationGuards: [] }
    project.instances.flow.container!.presentation!.states[0].overrides.behavior = { data: { rules: [{ id: 'r', enabled: true, trigger: { type: 'scene.enter' }, conditions: [],
      actions: [{ id: 'a', start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'score', value: 1 } }] }] } }
    const plan = executeCourseLogicAuthoringCommand(project,{ projectId: project.id, baseRevision: 0, kind: 'course-state.update', key: 'score',
      declaration: { key: 'points', valueType: 'number', defaultValue: 0 } })
    if (!plan.ok) throw new Error(plan.reason)
    const next = apply(project,plan.edits)
    expect(JSON.stringify(componentSurface(next,'flow')!.presentation)).toContain('"key":"points"')
    expect(next.logic!.courseState[0].key).toBe('points')
  })
})
