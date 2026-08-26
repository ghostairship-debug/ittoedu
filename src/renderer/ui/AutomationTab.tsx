import { useMemo } from 'react'
import type { InteractionCondition } from '../../shared/interactionTypes'
import { collectProjectDiagnostics } from '../../shared/projectDiagnostics'
import {
  selectGlobalInteractionAuthoringView,
  selectLocalInteractionAuthoringView,
  type AvailableLocalInteractionAuthoringView,
  type GlobalInteractionAuthoringView,
} from '../interactions/interactionAuthoringView'
import type { InteractionAuthoringTarget } from '../interactions/interactionAuthoringCommands'
import { SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID } from '../interactions/interactionTemplates'
import {
  useEditorStore,
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectActiveScene,
  selectEditingNodes,
  selectSlideAuthoringSnapshot,
} from '../store/editorStore'
import {
  SceneAutomationEditor,
  type RevealSequenceTemplateIntent,
} from './InteractionEditor'

type AvailableInteractionAuthoringView =
  | AvailableLocalInteractionAuthoringView
  | GlobalInteractionAuthoringView

function authoringTargetFromView(
  view: AvailableInteractionAuthoringView,
): InteractionAuthoringTarget {
  if (view.carrier === 'slide-scene') {
    return {
      carrier: 'slide-scene',
      projectId: view.projectId,
      baseRevision: view.revision,
      locationId: view.locationId,
      activeStateId: view.activeStateId,
    }
  }
  return {
    carrier: 'global',
    projectId: view.projectId,
    baseRevision: view.revision,
    activeStateId: view.activeStateId,
    ...(view.activeLocationId ? { activeLocationId: view.activeLocationId } : {}),
  }
}

function templateConditionsFromView(
  view: AvailableInteractionAuthoringView,
): InteractionCondition[] {
  const conditions: InteractionCondition[] = []
  if (view.carrier === 'global' && view.activeSlideSceneId) {
    conditions.push({ type: 'scene.in', sceneIds: [view.activeSlideSceneId] })
  }
  if (view.activeStateId) {
    conditions.push({ type: 'presentation.in', stateIds: [view.activeStateId] })
  }
  return conditions
}

export function AutomationTab() {
  const scene = useEditorStore(selectActiveScene)
  const editingNodes = useEditorStore(selectEditingNodes)
  const editingScope = useEditorStore((state) => state.editingScope)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const courseProject = useEditorStore(selectActiveCourseProjectDocument)
  const activeLocationId = useEditorStore(selectActiveCourseLocationId)
  const slideAuthoringSnapshot = useEditorStore(selectSlideAuthoringSnapshot)
  const projectedProject = useEditorStore((state) => state.project)
  const addInteractionRule = useEditorStore((state) => state.addInteractionRule)
  const deleteInteractionRule = useEditorStore((state) => state.deleteInteractionRule)
  const duplicateInteractionRule = useEditorStore(
    (state) => state.duplicateInteractionRule,
  )
  const moveInteractionRule = useEditorStore((state) => state.moveInteractionRule)
  const addGlobalInteractionRule = useEditorStore(
    (state) => state.addGlobalInteractionRule,
  )
  const deleteGlobalInteractionRule = useEditorStore(
    (state) => state.deleteGlobalInteractionRule,
  )
  const duplicateGlobalInteractionRule = useEditorStore(
    (state) => state.duplicateGlobalInteractionRule,
  )
  const moveGlobalInteractionRule = useEditorStore(
    (state) => state.moveGlobalInteractionRule,
  )
  const applyInteractionTemplateAtTarget = useEditorStore(
    (state) => state.applyInteractionTemplateAtTarget,
  )
  const updateInteractionRuleAtTarget = useEditorStore(
    (state) => state.updateInteractionRuleAtTarget,
  )
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const setCanvasMode = useEditorStore((state) => state.setCanvasMode)
  const setError = useEditorStore((state) => state.setError)

  const activeSlideStateId = slideAuthoringSnapshot?.locationId === activeLocationId
    ? slideAuthoringSnapshot.stateId
    : null

  const authoringView = useMemo(() => {
    if (!courseProject) return null
    if (editingScope === 'global') {
      return selectGlobalInteractionAuthoringView(
        courseProject,
        activeLocationId,
        activeSlideStateId,
      )
    }
    return activeLocationId
      ? selectLocalInteractionAuthoringView(
          courseProject,
          activeLocationId,
          activeSlideStateId,
        )
      : null
  }, [activeLocationId, activeSlideStateId, courseProject, editingScope])

  const diagnostics = useMemo(
    () => collectProjectDiagnostics(projectedProject).filter(
      (diagnostic) => diagnostic.sceneId === scene.id,
    ),
    [projectedProject, scene.id],
  )
  const ruleWarnings = useMemo(() => {
    const warnings: Record<string, string[]> = {}
    for (const diagnostic of diagnostics) {
      for (const ruleId of diagnostic.ruleIds) {
        warnings[ruleId] = [...(warnings[ruleId] ?? []), diagnostic.message]
      }
    }
    return warnings
  }, [diagnostics])

  if (!courseProject || !authoringView) {
    return (
      <div className="properties-scroll" data-testid="automation-tab">
        <section className="property-section interaction-overview" role="status">
          <h2>互动与动画</h2>
          <p>当前课程位置尚未准备好互动编辑，请重新选择一个页面。</p>
        </section>
      </div>
    )
  }

  if (authoringView.availability === 'unavailable') {
    return (
      <div className="properties-scroll" data-testid="automation-tab">
        <section
          className="property-section interaction-overview"
          data-testid="local-interaction-unavailable"
          role="status"
        >
          <h2>互动与动画</h2>
          <p>当前 Flow 或 Spatial 页面没有本地互动规则载体。</p>
          <p className="property-hint">切换到“全局”范围可编辑整课共享规则；Slide 页面仍可编辑场景规则。</p>
        </section>
      </div>
    )
  }

  const interactionView = authoringView
  const authoringTarget = authoringTargetFromView(interactionView)
  const availableNodeIds = new Set(interactionView.nodes.map((node) => node.id))
  const revealTemplateTargetNodeIds = interactionView.nodes
    .filter((node) => node.visible && !node.locked)
    .map((node) => node.id)
  const sourceNodes = editingNodes.filter((node) => availableNodeIds.has(node.id))
  const applyRevealSequenceTemplate = (intent: RevealSequenceTemplateIntent) => {
    applyInteractionTemplateAtTarget(authoringTarget, {
      templateId: SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID,
      ruleId: intent.ruleId,
      actionIds: intent.actionIds,
      targetLayerItemIds: intent.targetLayerItemIds,
      conditions: templateConditionsFromView(interactionView),
      name: intent.name,
    })
  }
  const updateRule = (
    ruleId: string,
    patch: Parameters<typeof updateInteractionRuleAtTarget>[2],
  ) => {
    updateInteractionRuleAtTarget(authoringTarget, ruleId, patch)
  }
  const openClickRules = () => {
    if (
      interactionView.carrier === 'global'
      && interactionView.activeSurfaceType !== 'slide'
    ) {
      setError('当前 Flow 或 Spatial 页面不在元素属性中提供全局点击规则写入；可继续使用这里的全局模板与专业字段。')
      return
    }
    setActiveTab('properties')
  }
  const sharedProps = {
    scene,
    selectedNodeId,
    sourceNodes,
    sourceRules: interactionView.rules,
    activeStateId: interactionView.activeStateId,
    authoringStates: interactionView.states,
    scenes: interactionView.sceneReferences,
    sounds: courseProject.media.audio.sounds,
    ruleWarnings,
    revealTemplateTargetNodeIds,
    conditionSceneId: interactionView.carrier === 'global'
      ? interactionView.activeSlideSceneId
      : interactionView.sceneId,
    onOpenClickRules: openClickRules,
    onApplyRevealSequenceTemplate: applyRevealSequenceTemplate,
    onRunPreview: () => setCanvasMode('run'),
    onUpdateRule: updateRule,
  }

  if (interactionView.carrier === 'global') {
    const legacyGlobalWritesAvailable = interactionView.activeSurfaceType === 'slide'
    const rejectUnavailableGlobalWrite = () => {
      setError('当前 Flow 或 Spatial 页面只开放原子模板与专业字段更新；请在 Slide 页面管理其他全局规则操作。')
    }
    return (
      <div className="properties-scroll" data-testid="automation-tab">
        <section className="property-section interaction-overview">
          <h2>互动与动画</h2>
          <p>用“当—如果—就”组织行为。点击交互在属性中维护，其他事件规则集中在这里。</p>
        </section>
        <SceneAutomationEditor
          {...sharedProps}
          sourceScope="global"
          legacyRuleActionsAvailable={legacyGlobalWritesAvailable}
          legacyRuleActionsUnavailableReason={legacyGlobalWritesAvailable
            ? undefined
            : '当前 Flow 或 Spatial 页面仅开放原子模板与专业字段更新；其他全局规则操作请在 Slide 页面完成。'}
          onAddRule={legacyGlobalWritesAvailable
            ? addGlobalInteractionRule
            : rejectUnavailableGlobalWrite}
          onDeleteRule={legacyGlobalWritesAvailable
            ? deleteGlobalInteractionRule
            : rejectUnavailableGlobalWrite}
          onDuplicateRule={legacyGlobalWritesAvailable
            ? duplicateGlobalInteractionRule
            : () => {
                rejectUnavailableGlobalWrite()
                return null
              }}
          onMoveRule={legacyGlobalWritesAvailable
            ? moveGlobalInteractionRule
            : rejectUnavailableGlobalWrite}
        />
      </div>
    )
  }

  return (
    <div className="properties-scroll" data-testid="automation-tab">
      <section className="property-section interaction-overview">
        <h2>互动与动画</h2>
        <p>先从模板开始，再用“当—如果—就”微调。这里不重复显示元素单击规则。</p>
      </section>
      {diagnostics.length > 0 ? (
        <section
          className="property-section automation-diagnostics"
          aria-labelledby="automation-diagnostics-title"
        >
          <h3 className="property-title" id="automation-diagnostics-title">
            需要处理的映射
          </h3>
          {diagnostics.map((diagnostic) => (
            <p
              key={`${diagnostic.code}:${diagnostic.nodeId}`}
              className="property-hint"
              role="alert"
            >
              {diagnostic.message}
            </p>
          ))}
        </section>
      ) : null}
      <SceneAutomationEditor
        {...sharedProps}
        onAddRule={(rule) => addInteractionRule(interactionView.sceneId, rule)}
        onDeleteRule={(ruleId) => deleteInteractionRule(interactionView.sceneId, ruleId)}
        onDuplicateRule={(ruleId) => {
          duplicateInteractionRule(interactionView.sceneId, ruleId)
        }}
        onMoveRule={(ruleId, direction) => {
          moveInteractionRule(interactionView.sceneId, ruleId, direction)
        }}
      />
    </div>
  )
}
