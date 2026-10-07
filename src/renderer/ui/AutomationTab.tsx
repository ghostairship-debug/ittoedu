import { useState } from 'react'
import type { InteractionRule } from '../../shared/interactionTypes'
import { useEditorStore, selectEditingScope } from '../store/editorStore'
import { componentInteractionView, componentRuleEdits, componentRevealSequenceEdits, duplicateComponentRule } from '../interactions/componentInteractionAuthoring'
import { buildInteractionTemplateRule, SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID } from '../interactions/interactionTemplates'
import { previewComponentMotion } from '../interactions/componentMotionPreview'
import { SceneAutomationEditor, InteractionEditor } from './InteractionEditor'
import { CourseLogicAuthoringPanel } from './CourseLogicAuthoringPanel'
import { courseLogicAuthoringView, commitCourseLogicAuthoringCommand } from '../course/courseLogicAuthoringCommands'
import { TEACHER_CONTROLLER_DEFINITION, createTeacherControllerData, createTeacherControllerFrame } from '../../components/teacher-controller/data'
import type { JsonValue } from '../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform/project'

export function AutomationTab() {
  const courseView = useEditorStore(state => state.courseView)
  const kernel = useEditorStore(state => state.courseKernel)
  const initialScope = useEditorStore(selectEditingScope)
  const setCanvasMode = useEditorStore(state => state.setCanvasMode)
  const setActiveTab = useEditorStore(state => state.setActiveTab)
  const setError = useEditorStore(state => state.setError)
  const [scope, setScope] = useState<'scene' | 'global'>(initialScope)
  const [clickRulesOpen, setClickRulesOpen] = useState(false)
  const project = courseView.project, surfaceId = courseView.surfaceId, documentId = courseView.activeDocumentId
  if (!project || !surfaceId || !documentId) return <div className="properties-scroll" data-testid="automation-tab"><section className="property-section interaction-overview"><h2>互动与动画</h2><p>请打开课件并选择一个页面。</p></section></div>
  const view = componentInteractionView(courseView.editingProject ?? project, surfaceId, scope === 'global')
  const commit = (change: (rules: InteractionRule[]) => InteractionRule[]) => {
    try {
      const target = kernel.captureTarget(documentId)
      const current = componentInteractionView(target.editingProject, surfaceId, scope === 'global')
      const edits = componentRuleEdits(target.project, current.target, change(structuredClone(current.rules)))
      void kernel.editCaptured(kernel.capture(edits, target)).catch(error => setError(String(error)))
    } catch (error) { setError(String(error)) }
  }
  const add = (rule: InteractionRule) => commit(rules => [...rules, rule])
  const reveal = (rule: InteractionRule) => {
    try {
      const target = kernel.captureTarget(documentId)
      const current = componentInteractionView(target.editingProject, surfaceId, scope === 'global')
      const edits = componentRevealSequenceEdits(target.project, current.target, rule, current.rules)
      void kernel.editCaptured(kernel.capture(edits, target)).catch(error => setError(String(error)))
    } catch (error) { setError(String(error)) }
  }
  const update = (ruleId: string, patch: Partial<Omit<InteractionRule, 'id'>>) => commit(rules => {
    if (!rules.some(rule => rule.id === ruleId)) throw new Error('互动规则已不存在')
    return rules.map(rule => rule.id === ruleId ? { ...rule, ...patch } : rule)
  })
  const remove = (ruleId: string) => commit(rules => rules.filter(rule => rule.id !== ruleId))
  const selectedNode = view.nodes.find(node => node.id === courseView.selectedInstanceId)
  const controller = Object.values(project.instances).find(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.navigation')
  const teacher = () => {
    const captured = kernel.captureTarget(documentId), existing = Object.values(captured.project.instances).find(instance => componentDefinitionBuiltinKey(captured.project.definitions[instance.definitionId]) === 'guoling.navigation')
    if (existing) { kernel.selectInstances([existing.id], surfaceId, documentId); setActiveTab('properties'); return }
    const id = crypto.randomUUID()
    const designSize = captured.project.surfaces.find(surface => surface.id === surfaceId)?.designSize
    const edits = [
      ...(captured.project.definitions[TEACHER_CONTROLLER_DEFINITION.id] ? [] : [{ type: 'definition.set' as const, definition: TEACHER_CONTROLLER_DEFINITION }]),
      { type: 'instance.insert' as const, container: { kind: 'global' as const, plane: 'overlay' as const }, index: captured.project.global.overlay.length,
        rootIds: [id], instances: [{ id, definitionId: TEACHER_CONTROLLER_DEFINITION.id, name: '教师控制台', data: JSON.parse(JSON.stringify(createTeacherControllerData(designSize))) as JsonValue,
          frame: createTeacherControllerFrame(designSize) }] },
    ]
    void kernel.editCaptured(kernel.capture(edits, captured)).then(() => {
      if (kernel.readView().activeDocumentId === documentId && kernel.readView().surfaceId === surfaceId) {
        kernel.selectInstances([id], surfaceId, documentId); setActiveTab('properties')
      }
    }).catch(error => setError(String(error)))
  }
  const shared = {
    scene: view.scene, sourceNodes: view.nodes, sourceRules: view.rules,
    selectedNodeId: courseView.selectedInstanceId, sourceScope: scope,
    activeStateId: courseView.activeStateId, scenes: view.scenes, locations: view.locations, sounds: project.media?.audio.sounds ?? {},
    courseState: project.logic?.courseState ?? [],
    onAddRule: add, onUpdateRule: update, onDeleteRule: remove,
    onRunPreview: () => setCanvasMode('run'),
    onPreviewNodeMotion: (action: Parameters<typeof previewComponentMotion>[0]['action'], delayMs: number) => {
      previewComponentMotion({ target: kernel.captureTarget(documentId), action, delayMs })
    },
  }
  return <div className="properties-scroll" data-testid="automation-tab">
    <section className="property-section interaction-overview"><h2>互动与动画</h2><p>用“当—如果—就”组织行为，点击规则与可改源码的动效使用同一工程。</p>
      <label>作用范围<select aria-label="互动作用范围" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="scene">当前页面</option><option value="global">整个课件</option></select></label>
      <button className="secondary-button" onClick={teacher}>{controller ? '编辑教师控制台' : '添加教师控制台'}</button>
      {controller && <button className="secondary-button" onClick={() => {
        const target = kernel.captureTarget(documentId)
        const current = target.project.instances[controller.id]
        if (!current) { setError('教师控制台已不存在'); return }
        void kernel.editCaptured(kernel.capture([{ type: 'data.set', instanceId: current.id, path: ['enabled'], value: !(current.data && typeof current.data === 'object' && !Array.isArray(current.data) && current.data.enabled !== false) }], target)).catch(error => setError(String(error)))
      }}>启用／关闭默认控制台</button>}
    </section>
    <CourseLogicAuthoringPanel key={documentId} project={courseLogicAuthoringView(project)} onCommand={command => commitCourseLogicAuthoringCommand(kernel, documentId, command)} />
    <SceneAutomationEditor {...shared} authoringStates={view.scene.presentation?.states ?? []} conditionSceneId={scope === 'global' ? surfaceId : null}
      revealTemplateTargetNodeIds={view.nodes.filter(node => node.visible && !node.locked).map(node => node.id)}
      onOpenClickRules={() => setClickRulesOpen(true)}
      onApplyRevealSequenceTemplate={intent => reveal(buildInteractionTemplateRule({ templateId: SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID, ...intent,
        conditions: [...(scope === 'global' ? [{ type: 'scene.in' as const, sceneIds: [surfaceId] }] : []),
          ...(courseView.activeStateId ? [{ type: 'presentation.in' as const, stateIds: [courseView.activeStateId] }] : [])] }))}
      onDuplicateRule={ruleId => commit(rules => { const index = rules.findIndex(rule => rule.id === ruleId); if (index >= 0) rules.splice(index + 1, 0, duplicateComponentRule(rules[index]!)); return rules })}
      onMoveRule={(ruleId, direction) => commit(rules => { const index = rules.findIndex(rule => rule.id === ruleId), next = index + direction; if (index >= 0 && next >= 0 && next < rules.length) [rules[index], rules[next]] = [rules[next]!, rules[index]!]; return rules })} />
    {clickRulesOpen && (selectedNode ? <InteractionEditor {...shared} selectedNode={selectedNode} /> : <p role="status">请在画布选择一个对象，再编辑点击规则。</p>)}
  </div>
}
