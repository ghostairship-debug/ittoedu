import {
  Braces,
  Code2,
  CopyPlus,
  Play,
  ShieldCheck,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentManifest } from '../../shared/componentTypes'
import { componentManifestSchema } from '../../shared/componentSchema'
import {
  courseRuntimeDefinitionSchema,
  layerItemSchema,
} from '../../shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  LayerItem,
  SlideSceneDocument,
} from '../../shared/courseProjectTypes'
import { interactionRuleSchema } from '../../shared/interactionSchema'
import { validateRuntimeSource } from '../../player/RuntimeRegistry'
import { validateComponentRuntimeSource } from '../components/importComponentPackage'
import type {
  CourseRuntimeTemplateCreationTarget,
} from '../runtime/runtimeTemplateAuthoringCommands'
import {
  selectRuntimeSourceAuthoringView,
  type AvailableRuntimeSourceAuthoringView,
  type RuntimeSourceAuthoringView,
} from '../runtime/runtimeSourceAuthoringView'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectEffectiveLayerProjection,
  selectSlideAuthoringBackend,
  useEditorStore,
} from '../store/editorStore'
import { courseLayerItemToEditorCanvasNode } from '../store/slideEditorProjection'
import type { EditorCanvasNodePatch } from '../phaser/editorCanvasNode'
import {
  updateCourseAuthoringSessionRevision,
  type CourseAuthoringTarget,
} from '../authoring/courseAuthoringSession'
import type {
  RuntimeSourceAuthoringCommitResult,
  RuntimeTemplateCreationCommitResult,
} from '../store/editorStore'
import {
  commandTargetFromRow,
  type EffectiveLayerProjectionRow,
} from '../course/effectiveLayerProjection'
import type { EffectiveLayerPropertyPatch } from '../course/effectiveLayerCommands'
import {
  coalesceSlideAuthoringCommands,
  patchSlideEffectiveLayerProperties,
  updateSlideComponentProps,
  updateSlideNativeLayerContent,
  updateSlideRuntimeDefinition,
} from '../course/v9SlideContentCommands'
import { updateSlideSceneInteractionRule } from '../course/v9SlideActionCommands'

type DeveloperSection = 'runtime' | 'object' | 'rules' | 'component'
type ComponentDocument = 'manifest' | 'runtime'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function developerSlideScene(
  document: CourseProjectDocument | null,
  locationId: string | null,
): SlideSceneDocument | null {
  if (!document || !locationId) return null
  const location = document.locations.find((candidate) => candidate.id === locationId)
  if (!location || location.kind !== 'slide-scene') return null
  const surface = document.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') return null
  return surface.scenes.find((scene) => scene.id === location.sceneId) ?? null
}

function applyDeveloperLayerItemJson(
  row: EffectiveLayerProjectionRow,
  raw: string,
): void {
  const parsed = layerItemSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? '对象 JSON 无效')
  }
  const current = row.item
  const next = parsed.data
  if (next.layerItemId !== current.layerItemId || next.kind !== current.kind) {
    throw new Error('对象 ID 和类型不可修改')
  }
  const store = useEditorStore.getState()
  const backend = selectSlideAuthoringBackend(store)
  const namedStateScene = row.owner === 'scene' && row.scopeToken.stateId !== null
  if (!backend || namedStateScene || row.isTeacherController) {
    const node = courseLayerItemToEditorCanvasNode(next)
    if (!node) {
      throw new Error('当前对象没有可用的属性写入命令')
    }
    store.updateNode(current.layerItemId, { ...node } as EditorCanvasNodePatch)
    return
  }
  const result = store.applySlideCandidateCommand((session) => (
    coalesceSlideAuthoringCommands(session, (currentSession) => {
      const layout: EffectiveLayerPropertyPatch = {
        label: next.label,
        frame: {
          x: next.frame.x,
          y: next.frame.y,
          width: next.frame.width,
          height: next.frame.height,
        },
        rotation: next.rotation,
        opacity: next.opacity,
        visible: next.visible,
        locked: next.locked,
        playbackInitialVisibility: next.playbackInitialVisibility,
      }
      let working = currentSession
      const layoutResult = patchSlideEffectiveLayerProperties(working, [{
        target: commandTargetFromRow(row),
        patch: layout,
      }], { expectedRevision: working.history.present.revision })
      if (!layoutResult.ok) return layoutResult
      working = layoutResult.nextSession ?? working
      if (next.kind === 'native') {
        const nativeResult = updateSlideNativeLayerContent(working, next.layerItemId, {
          nativeData: next.content.data as Record<string, unknown>,
          label: next.label,
        }, { expectedRevision: working.history.present.revision })
        if (!nativeResult.ok) return nativeResult
        working = nativeResult.nextSession ?? working
      } else if (next.kind === 'component') {
        const propsResult = updateSlideComponentProps(
          working,
          next.layerItemId,
          next.props,
          { expectedRevision: working.history.present.revision },
        )
        if (!propsResult.ok) return propsResult
        working = propsResult.nextSession ?? working
      } else {
        const runtimeResult = updateSlideRuntimeDefinition(working, next.layerItemId, {
          source: next.runtime.source,
          enabled: next.runtime.enabled,
          contentValues: next.runtime.content.values,
          assets: next.runtime.assets,
        }, { expectedRevision: working.history.present.revision })
        if (!runtimeResult.ok) return runtimeResult
        working = runtimeResult.nextSession ?? working
      }
      return {
        ok: true,
        historyEntry: working.history.present !== currentSession.history.present,
        nextSession: working,
        selection: working.selection,
      }
    })
  ))
  if (!result.ok) {
    throw new Error(result.reason ?? '对象 JSON 未写入')
  }
}

function componentItemOf(item: LayerItem): Extract<LayerItem, { kind: 'component' }> | null {
  return item.kind === 'component' ? item : null
}

function syntaxCheck(source: string): void {
  // Compile without executing. Registration and lifecycle execution continue
  // to happen only inside the existing isolated player/component host.
  Function(`"use strict";\n${source}`)
}

interface CodeDocumentEditorProps {
  title: string
  description: string
  value: string
  bindingKey: string
  language: 'json' | 'javascript'
  readOnly?: boolean
  applyLabel?: string
  onApply?(value: string): void
}

function CodeDocumentEditor({
  title,
  description,
  value,
  bindingKey,
  language,
  readOnly = false,
  applyLabel = '校验并应用',
  onApply,
}: CodeDocumentEditorProps) {
  const [draft, setDraft] = useState(value)
  const [message, setMessage] = useState<string | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const bindingRef = useRef({
    key: bindingKey,
    baseline: value,
    dirty: false,
    onApply,
  })
  const stale = bindingRef.current.dirty && bindingRef.current.key !== bindingKey
  useEffect(() => {
    const binding = bindingRef.current
    if (binding.dirty) {
      if (binding.key === bindingKey) binding.onApply = onApply
      return
    }
    binding.key = bindingKey
    binding.baseline = value
    binding.onApply = onApply
    setDraft(value)
    setMessage(null)
  }, [bindingKey, onApply, value])

  const format = (): void => {
    if (language !== 'json') return
    try {
      setDraft(JSON.stringify(JSON.parse(draft), null, 2))
      setMessage('JSON 已格式化，尚未写入工程。')
    } catch (error) {
      setMessage(`格式化失败：${errorMessage(error)}`)
    }
  }
  const apply = (): void => {
    const binding = bindingRef.current
    if (!binding.onApply || isComposing) return
    if (binding.dirty && binding.key !== bindingKey) {
      setMessage('未应用：当前编辑目标已经改变，请放弃草稿后重新编辑。')
      return
    }
    try {
      binding.onApply(draft)
      binding.baseline = draft
      binding.dirty = false
      setMessage('校验通过，修改已写入工程历史。')
    } catch (error) {
      setMessage(`未应用：${errorMessage(error)}`)
    }
  }

  return (
    <section className="developer-card">
      <div className="developer-card__heading">
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <code>{language === 'json' ? 'JSON' : 'JS'}</code>
      </div>
      <textarea
        className="developer-code-editor"
        aria-label={title}
        value={draft}
        readOnly={readOnly}
        wrap="off"
        spellCheck={false}
        onChange={(event) => {
          const nextDraft = event.currentTarget.value
          const binding = bindingRef.current
          if (!binding.dirty) {
            binding.key = bindingKey
            binding.baseline = value
            binding.onApply = onApply
          }
          binding.dirty = nextDraft !== binding.baseline
          setDraft(nextDraft)
          setMessage(null)
        }}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
      />
      <div className="developer-card__actions">
        {language === 'json' && !readOnly && (
          <button
            type="button"
            className="secondary-button"
            disabled={isComposing || stale}
            onClick={format}
          >
            <WandSparkles size={13} />格式化
          </button>
        )}
        {!readOnly && onApply && (
          <button
            type="button"
            className="primary-button"
            disabled={isComposing || stale}
            onClick={apply}
          >
            <ShieldCheck size={13} />{applyLabel}
          </button>
        )}
        {!readOnly && stale && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              bindingRef.current = {
                key: bindingKey,
                baseline: value,
                dirty: false,
                onApply,
              }
              setDraft(value)
              setMessage(null)
              setIsComposing(false)
            }}
          >
            放弃草稿
          </button>
        )}
      </div>
      {stale && (
        <p
          className="developer-card__message developer-card__message--error"
          data-testid="code-document-stale"
          role="status"
        >
          当前编辑目标已经改变；草稿未写入工程。你可以返回原目标，或放弃草稿后编辑当前目标。
        </p>
      )}
      {message && (
        <p
          className={message.startsWith('未应用') || message.startsWith('格式化失败')
            ? 'developer-card__message developer-card__message--error'
            : 'developer-card__message'}
          role="status"
        >
          {message}
        </p>
      )}
    </section>
  )
}

interface RuntimeSourceDraftBinding {
  readonly documentKey: string
  readonly carrier: AvailableRuntimeSourceAuthoringView['carrier']
  readonly label: string
  readonly protocol: AvailableRuntimeSourceAuthoringView['runtime']['protocol']
  readonly runtimeApiVersion: AvailableRuntimeSourceAuthoringView['runtime']['runtimeApiVersion']
  readonly runtime: AvailableRuntimeSourceAuthoringView['runtime']
  readonly target: CourseAuthoringTarget
  readonly effectiveLocked: boolean
  readonly baseline: string
  readonly draft: string
}

interface RuntimeSourceEditorProps {
  readonly view: RuntimeSourceAuthoringView | null
  readonly onCreateTemplate: (
    target: CourseRuntimeTemplateCreationTarget,
  ) => RuntimeTemplateCreationCommitResult
  readonly onApply: (
    target: CourseAuthoringTarget,
    source: string,
  ) => RuntimeSourceAuthoringCommitResult
}

interface RuntimeDraftMessage {
  readonly kind: 'success' | 'unchanged' | 'error' | 'cancelled'
  readonly text: string
}

function runtimeDraftBinding(
  view: AvailableRuntimeSourceAuthoringView,
): RuntimeSourceDraftBinding {
  return {
    documentKey: view.documentKey,
    carrier: view.carrier,
    label: view.label,
    protocol: view.runtime.protocol,
    runtimeApiVersion: view.runtime.runtimeApiVersion,
    runtime: view.runtime,
    target: view.target,
    effectiveLocked: view.effectiveLocked,
    baseline: view.runtime.source,
    draft: view.runtime.source,
  }
}

function runtimeUnavailableCopy(view: RuntimeSourceAuthoringView | null): string {
  if (!view) return '当前 Course Project 或作者会话尚未准备好，运行时源码不会写入。'
  if (view.availability === 'available') return view.label
  switch (view.reason) {
    case 'invalid-location':
      return '当前课程位置没有有效的 Runtime 载体，请重新选择页面。'
    case 'invalid-session':
      return 'Runtime 编辑会话已经失效，请重新选择当前页面后再编辑。'
    case 'invalid-state':
      return '当前呈现状态无效，请切回基础状态或有效的命名状态。'
    case 'runtime-missing':
      return view.label
  }
}

function RuntimeSourceEditor({
  view,
  onCreateTemplate,
  onApply,
}: RuntimeSourceEditorProps) {
  const initial = view?.availability === 'available'
    ? runtimeDraftBinding(view)
    : null
  const [binding, setBinding] = useState<RuntimeSourceDraftBinding | null>(initial)
  const bindingRef = useRef(binding)
  const [message, setMessage] = useState<RuntimeDraftMessage | null>(null)
  const [templateMessage, setTemplateMessage] = useState<string | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const committedSourceRef = useRef<string | null>(null)

  const replaceBinding = (next: RuntimeSourceDraftBinding | null): void => {
    bindingRef.current = next
    setBinding(next)
  }

  const currentDocumentKey = view?.availability === 'available'
    ? view.documentKey
    : null
  const creationTarget =
    view?.availability === 'unavailable'
    && view.reason === 'runtime-missing'
      ? view.creationTarget
      : null
  const creationTargetKey = creationTarget
    ? JSON.stringify(creationTarget)
    : null

  useEffect(() => {
    setTemplateMessage(null)
  }, [creationTargetKey])

  useEffect(() => {
    const current = bindingRef.current
    if (view?.availability === 'available') {
      if (current?.documentKey === view.documentKey) return
      if (current && current.draft !== current.baseline) return

      const keepCommitMessage =
        committedSourceRef.current !== null
        && view.runtime.source === committedSourceRef.current
        && current?.target.itemId === view.target.itemId
      committedSourceRef.current = null
      replaceBinding(runtimeDraftBinding(view))
      if (!keepCommitMessage) setMessage(null)
      return
    }

    if (current && current.draft !== current.baseline) return
    committedSourceRef.current = null
    replaceBinding(null)
    setMessage(null)
  }, [currentDocumentKey, view])

  if (!binding) {
    const missingRuntime = view?.availability === 'unavailable'
      && view.reason === 'runtime-missing'
    return (
      <section
        className="developer-empty-card"
        data-testid={missingRuntime ? 'runtime-source-missing' : 'runtime-source-unavailable'}
        role={missingRuntime ? undefined : 'status'}
      >
        <Code2 size={20} />
        <strong>
          {missingRuntime ? '当前作用域没有自定义运行时' : '当前运行时源码不可编辑'}
        </strong>
        <span>
          {missingRuntime && creationTarget
            ? '创建最小 Runtime API 2 模板后，即可在完整代码区中修改。'
            : runtimeUnavailableCopy(view)}
        </span>
        {missingRuntime && creationTarget ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              const result = onCreateTemplate(creationTarget)
              setTemplateMessage(
                result.ok ? null : `未创建：${result.reason}`,
              )
            }}
          >
            创建运行时模板
          </button>
        ) : null}
        {templateMessage ? (
          <p
            className="developer-card__message developer-card__message--error"
            role="status"
            data-testid="runtime-template-create-error"
          >
            {templateMessage}
          </p>
        ) : null}
      </section>
    )
  }

  const dirty = binding.draft !== binding.baseline
  const stale = currentDocumentKey !== binding.documentKey
  const title = binding.carrier === 'global-layer'
    ? '全局运行时源码'
    : binding.carrier === 'surface-layer'
      ? 'Flow 页面运行时源码'
      : binding.carrier === 'spatial-world'
        ? 'Spatial 世界运行时源码'
        : '场景运行时源码'
  const protocolLabel = binding.protocol === 'surface-runtime'
    ? 'Surface Runtime'
    : 'Canvas Runtime'
  const status = stale
    ? {
        kind: 'error' as const,
        text: `草稿仍绑定到“${binding.label}”，当前目标已经切换。返回原目标后应用，或取消草稿以加载当前目标。`,
      }
    : message

  const updateDraft = (draft: string): void => {
    const next = { ...bindingRef.current!, draft }
    replaceBinding(next)
    setMessage(null)
  }

  const cancel = (): void => {
    if (isComposing) return
    if (view?.availability === 'available') {
      replaceBinding(runtimeDraftBinding(view))
      setMessage({
        kind: 'cancelled',
        text: '草稿已取消，已重新载入当前 Runtime 源码。',
      })
    } else {
      replaceBinding(null)
      setMessage(null)
    }
  }

  const apply = (): void => {
    if (isComposing || stale || binding.effectiveLocked) return
    try {
      validateRuntimeSource(binding.draft)
      syntaxCheck(binding.draft)
      const parsed = courseRuntimeDefinitionSchema.safeParse({
        ...binding.runtime,
        source: binding.draft,
      })
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? '运行时数据无效')
      }
      const result = onApply(binding.target, binding.draft)
      if (!result.ok) throw new Error(result.reason)
      if (result.status === 'unchanged') {
        replaceBinding({ ...binding, baseline: binding.draft })
        setMessage({
          kind: 'unchanged',
          text: '源码没有变化，未写入工程历史。',
        })
        return
      }
      committedSourceRef.current = parsed.data.source
      replaceBinding({ ...binding, baseline: binding.draft })
      setMessage({
        kind: 'success',
        text: '校验通过，修改已写入工程历史。',
      })
    } catch (error) {
      setMessage({ kind: 'error', text: `未应用：${errorMessage(error)}` })
    }
  }

  return (
    <section className="developer-card" data-testid="runtime-source-editor">
      <div className="developer-card__heading">
        <div>
          <strong>{title}</strong>
          <span>
            {binding.label} · {protocolLabel} / Runtime API {binding.runtimeApiVersion}。
            校验模块、JavaScript 语法与完整 V9 Runtime 定义后写入工程；执行仍发生在隔离播放器。
            {binding.effectiveLocked ? ' 捕获状态中的 Runtime 已锁定，当前为只读。' : ''}
          </span>
        </div>
        <code>JS</code>
      </div>
      <textarea
        className="developer-code-editor"
        aria-label={title}
        value={binding.draft}
        readOnly={binding.effectiveLocked}
        wrap="off"
        spellCheck={false}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onChange={(event) => updateDraft(event.currentTarget.value)}
      />
      <div className="developer-card__actions">
        <button
          type="button"
          className="secondary-button"
          disabled={isComposing}
          onClick={cancel}
        >
          取消
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={isComposing || stale || binding.effectiveLocked}
          onClick={apply}
        >
          <ShieldCheck size={13} />校验并应用
        </button>
      </div>
      {status ? (
        <p
          className={status.kind === 'error'
            ? 'developer-card__message developer-card__message--error'
            : 'developer-card__message'}
          role="status"
          data-testid={stale ? 'runtime-source-stale' : undefined}
        >
          {status.text}
        </p>
      ) : dirty ? (
        <p className="developer-card__message" role="status">
          源码草稿尚未写入工程。
        </p>
      ) : null}
    </section>
  )
}

export function DeveloperTab() {
  const courseProject = useEditorStore(selectActiveCourseProjectDocument)
  const activeCourseLocationId = useEditorStore(selectActiveCourseLocationId)
  const courseAuthoringSession = useEditorStore(
    (state) => state.courseAuthoringSession,
  )
  const projection = useEditorStore(selectEffectiveLayerProjection)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectedRow = (projection?.unifiedRows ?? []).find((row) => row.id === selectedNodeId)
    ?? null
  const selectedItem = selectedRow?.item ?? null
  const componentTarget = selectedItem ? componentItemOf(selectedItem) : null
  const componentPackages = useEditorStore((state) => state.componentPackages)
  const editingScope = useEditorStore((state) => state.editingScope)
  const activePresentationStateId = useEditorStore(
    (state) => state.activePresentationStateId,
  )
  const applySlideCandidateCommand = useEditorStore(
    (state) => state.applySlideCandidateCommand,
  )
  const updateRuntimeSourceAtTarget = useEditorStore(
    (state) => state.updateRuntimeSourceAtTarget,
  )
  const createRuntimeTemplateAtTarget = useEditorStore(
    (state) => state.createRuntimeTemplateAtTarget,
  )
  const updateGlobalInteractionRule = useEditorStore(
    (state) => state.updateGlobalInteractionRule,
  )
  const createEditableComponentCopy = useEditorStore(
    (state) => state.createEditableComponentCopy,
  )
  const updateEditableComponentPackage = useEditorStore(
    (state) => state.updateEditableComponentPackage,
  )
  const setCanvasMode = useEditorStore((state) => state.setCanvasMode)
  const slideScene = developerSlideScene(courseProject, activeCourseLocationId)
  const rules = editingScope === 'global'
    ? courseProject?.globalInteractions ?? []
    : slideScene?.interactions ?? []
  const [activeSection, setActiveSection] = useState<DeveloperSection>('runtime')
  const [componentDocument, setComponentDocument] =
    useState<ComponentDocument>('runtime')
  const [selectedRuleId, setSelectedRuleId] = useState<string>('')
  useEffect(() => {
    if (!rules.some((rule) => rule.id === selectedRuleId)) {
      setSelectedRuleId(rules[0]?.id ?? '')
    }
  }, [rules, selectedRuleId])
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId)
  const selectedComponent = componentTarget
    ? componentPackages[componentTarget.component.packageId]
    : undefined
  const selectedComponentMeta = componentTarget
    ? courseProject?.componentPackages[componentTarget.component.packageId]
    : undefined
  const componentEditable = selectedComponentMeta?.editableCopy === true
  const copyBlockedByPresentationState =
    editingScope === 'scene' && activePresentationStateId !== null
  const nodeJson = useMemo(
    () => selectedItem ? JSON.stringify(selectedItem, null, 2) : '',
    [selectedItem],
  )
  const activeCourseLocation = courseProject?.locations.find(
    (location) => location.id === activeCourseLocationId,
  )
  const authoringDocumentKey = JSON.stringify([
    courseProject?.id ?? null,
    courseProject?.revision ?? null,
    courseAuthoringSession?.token.generation ?? null,
    activeCourseLocationId,
    editingScope,
    activePresentationStateId,
  ])
  const objectDocumentKey = JSON.stringify([
    authoringDocumentKey,
    selectedRow?.authoringAddress ?? null,
    selectedRow?.kind ?? null,
  ])
  const ruleDocumentKey = JSON.stringify([
    authoringDocumentKey,
    selectedRule?.id ?? null,
  ])
  const componentCodeDocumentKey = JSON.stringify([
    authoringDocumentKey,
    selectedComponent?.manifest.id ?? null,
    selectedComponent?.manifest.version ?? null,
    componentDocument,
  ])
  const runtimeView = useMemo<RuntimeSourceAuthoringView | null>(() => {
    if (!courseProject || !activeCourseLocationId || !courseAuthoringSession) {
      return null
    }
    const currentAuthoringSession = updateCourseAuthoringSessionRevision(
      courseAuthoringSession,
      courseProject.revision,
    )
    return selectRuntimeSourceAuthoringView({
      project: courseProject,
      locationId: activeCourseLocationId,
      editingScope,
      activeStateId: activeCourseLocation?.kind === 'slide-scene'
        ? activePresentationStateId
        : null,
      sessionToken: currentAuthoringSession.token,
    })
  }, [
    activeCourseLocation?.kind,
    activeCourseLocationId,
    activePresentationStateId,
    courseAuthoringSession,
    courseProject,
    editingScope,
  ])
  const runtimeStatus = runtimeView?.availability === 'available'
    ? runtimeView.effectiveLocked ? '已锁定' : `API ${runtimeView.runtime.runtimeApiVersion}`
    : runtimeView?.reason === 'runtime-missing' ? '未创建' : '不可用'
  const editingScopeLabel = editingScope === 'global'
    ? '全局层'
    : activeCourseLocation?.kind === 'flow-block'
      ? `Flow · ${activeCourseLocation.label}`
      : activeCourseLocation?.kind === 'spatial-camera'
        ? `Spatial · ${activeCourseLocation.label}`
        : `场景 · ${slideScene?.name ?? activeCourseLocation?.label ?? '当前页'}`

  const sections: Array<{
    id: DeveloperSection
    label: string
    status: string
  }> = [
    {
      id: 'runtime',
      label: '运行时',
      status: runtimeStatus,
    },
    {
      id: 'object',
      label: '对象 JSON',
      status: selectedItem ? selectedItem.label : '未选择',
    },
    {
      id: 'rules',
      label: '规则 JSON',
      status: `${rules.length} 条`,
    },
    {
      id: 'component',
      label: '组件代码',
      status: selectedComponent
        ? componentEditable ? '工程副本' : '只读'
        : '未选择',
    },
  ]

  return (
    <div className="developer-tab" data-testid="developer-tab">
      <header className="developer-workbench-header">
        <div className="developer-workbench-title">
          <Code2 size={19} />
          <div>
            <strong>工程开发工作台</strong>
            <span>受控修改课件运行时与工程数据，不开放编辑器源码、文件系统或 Shell。</span>
          </div>
        </div>
        <div className="developer-workbench-meta">
          <span>作用域</span>
          <strong>{editingScopeLabel}</strong>
          <button type="button" className="secondary-button" onClick={() => setCanvasMode('run')}>
            <Play size={13} />试运行
          </button>
        </div>
      </header>

      <div
        className="developer-workspace-tabs"
        role="tablist"
        aria-label="开发工作区"
      >
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={activeSection === section.id}
            className={activeSection === section.id ? 'is-active' : ''}
            onClick={() => setActiveSection(section.id)}
          >
            <span>{section.label}</span>
            <small>{section.status}</small>
          </button>
        ))}
      </div>

      <div
        className="developer-workspace-content"
        role="tabpanel"
        aria-label={sections.find((section) => section.id === activeSection)?.label}
      >
        {activeSection === 'runtime' && (
          <RuntimeSourceEditor
            view={runtimeView}
            onCreateTemplate={createRuntimeTemplateAtTarget}
            onApply={updateRuntimeSourceAtTarget}
          />
        )}

        {activeSection === 'object' && (
          selectedRow && selectedItem ? (
            <CodeDocumentEditor
              title={`所选对象 · ${selectedItem.label}`}
              description="ID 和类型不可更改；其他字段按 Project Schema 校验并进入撤销历史。"
              value={nodeJson}
              bindingKey={objectDocumentKey}
              language="json"
              onApply={(value) => {
                applyDeveloperLayerItemJson(selectedRow, value)
              }}
            />
          ) : (
            <section className="developer-empty-card">
              <Braces size={20} />
              <strong>未选择对象</strong>
              <span>在画布或图层面板选择对象后，可在这里受控修改其 JSON。</span>
            </section>
          )
        )}

        {activeSection === 'rules' && (
          <div className="developer-rule-workspace">
            <section className="developer-rule-picker">
              <label htmlFor="developer-rule-select">当前规则</label>
              <select
                id="developer-rule-select"
                value={selectedRuleId}
                onChange={(event) => setSelectedRuleId(event.currentTarget.value)}
              >
                <option value="">未选择</option>
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>{rule.name}</option>
                ))}
              </select>
            </section>
            {selectedRule ? (
              <CodeDocumentEditor
                title={`规则 · ${selectedRule.name}`}
                description="规则使用标准 trigger / conditions / actions 模型。"
                value={JSON.stringify(selectedRule, null, 2)}
                bindingKey={ruleDocumentKey}
                language="json"
                onApply={(value) => {
                  const parsed = interactionRuleSchema.safeParse(JSON.parse(value))
                  if (!parsed.success) {
                    throw new Error(parsed.error.issues[0]?.message ?? '规则 JSON 无效')
                  }
                  if (parsed.data.id !== selectedRule.id) throw new Error('规则 ID 不可修改')
                  if (editingScope === 'global') {
                    updateGlobalInteractionRule(selectedRule.id, parsed.data)
                    return
                  }
                  const result = applySlideCandidateCommand((session) => (
                    updateSlideSceneInteractionRule(
                      session,
                      selectedRule.id,
                      parsed.data,
                      { expectedRevision: session.history.present.revision },
                    )
                  ))
                  if (!result.ok) {
                    throw new Error(result.reason ?? '规则 JSON 未写入')
                  }
                }}
              />
            ) : (
              <section className="developer-empty-card">
                <Braces size={20} />
                <strong>当前作用域没有规则</strong>
                <span>先在“互动与动画”中创建规则，再到这里检查或修改完整 JSON。</span>
              </section>
            )}
          </div>
        )}

        {activeSection === 'component' && (
          selectedComponent && componentTarget ? (
            <div className="developer-component-workspace">
              <section className="developer-component-heading">
                <div>
                  <strong>{selectedComponent.manifest.name}</strong>
                  <span>
                    {componentEditable
                      ? '工程内可编辑副本，修改不会覆盖原第三方组件。'
                      : copyBlockedByPresentationState
                        ? '请先切换到“基础”状态，再创建可编辑副本。'
                        : '第三方组件只读；创建新 ID 的工程副本后才能修改。'}
                  </span>
                </div>
                {!componentEditable && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={copyBlockedByPresentationState}
                    onClick={() => createEditableComponentCopy(
                      selectedComponent.manifest.id,
                      componentTarget.layerItemId,
                    )}
                  >
                    <CopyPlus size={13} />创建可编辑副本
                  </button>
                )}
              </section>
              <div
                className="developer-document-tabs"
                role="tablist"
                aria-label="组件文档"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={componentDocument === 'runtime'}
                  className={componentDocument === 'runtime' ? 'is-active' : ''}
                  onClick={() => setComponentDocument('runtime')}
                >
                  Runtime.js
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={componentDocument === 'manifest'}
                  className={componentDocument === 'manifest' ? 'is-active' : ''}
                  onClick={() => setComponentDocument('manifest')}
                >
                  Manifest.json
                </button>
              </div>
              {componentDocument === 'manifest' ? (
                <CodeDocumentEditor
                  title="组件 Manifest"
                  description="需通过版本、作用域、公开字段和素材引用校验。"
                  value={JSON.stringify(selectedComponent.manifest, null, 2)}
                  bindingKey={componentCodeDocumentKey}
                  language="json"
                  readOnly={!componentEditable}
                  onApply={componentEditable
                    ? (value) => {
                        const result = componentManifestSchema.safeParse(JSON.parse(value))
                        if (!result.success) {
                          throw new Error(result.error.issues[0]?.message ?? 'Manifest 无效')
                        }
                        if (
                          result.data.id !== selectedComponent.manifest.id ||
                          result.data.version !== selectedComponent.manifest.version
                        ) {
                          throw new Error('可编辑副本的 ID 和版本不可在代码框中修改')
                        }
                        updateEditableComponentPackage(
                          selectedComponent.manifest.id,
                          { manifest: result.data as ComponentManifest },
                        )
                      }
                    : undefined}
                />
              ) : (
                <CodeDocumentEditor
                  title="组件 Runtime"
                  description="只接受离线普通 JavaScript；禁止 import、export 和 require。"
                  value={selectedComponent.runtimeSource}
                  bindingKey={componentCodeDocumentKey}
                  language="javascript"
                  readOnly={!componentEditable}
                  onApply={componentEditable
                    ? (source) => {
                        validateComponentRuntimeSource(source)
                        syntaxCheck(source)
                        updateEditableComponentPackage(
                          selectedComponent.manifest.id,
                          { runtimeSource: source },
                        )
                      }
                    : undefined}
                />
              )}
            </div>
          ) : (
            <section className="developer-empty-card">
              <Code2 size={20} />
              <strong>未选择互动组件</strong>
              <span>在画布或图层面板选择互动组件后，可查看其代码权限和工程副本。</span>
            </section>
          )
        )}
      </div>
    </div>
  )
}
