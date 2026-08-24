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
import { courseRuntimeDefinitionSchema } from '../../shared/courseProjectSchema'
import { interactionRuleSchema } from '../../shared/interactionSchema'
import { sceneNodeSchema } from '../../shared/projectSchema'
import type { RuntimeDocument } from '../../shared/runtimeTypes'
import type { SceneNode } from '../../shared/projectTypes'
import { validateRuntimeSource } from '../../player/RuntimeRegistry'
import { validateComponentRuntimeSource } from '../components/importComponentPackage'
import {
  selectRuntimeSourceAuthoringView,
  type AvailableRuntimeSourceAuthoringView,
  type RuntimeSourceAuthoringView,
} from '../runtime/runtimeSourceAuthoringView'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectActiveScene,
  selectSelectedNode,
  useEditorStore,
} from '../store/editorStore'
import type {
  CourseAuthoringTarget,
} from '../authoring/courseAuthoringSession'
import type { RuntimeSourceAuthoringCommitResult } from '../store/editorStore'

type DeveloperSection = 'runtime' | 'object' | 'rules' | 'component'
type ComponentDocument = 'manifest' | 'runtime'

const EMPTY_RUNTIME_SOURCE = `CoursewareRuntime.define({
  runtimeApiVersion: 2,
  create(ctx) {
    return {
      destroy() {},
    }
  },
})`

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  language: 'json' | 'javascript'
  readOnly?: boolean
  applyLabel?: string
  onApply?(value: string): void
}

function CodeDocumentEditor({
  title,
  description,
  value,
  language,
  readOnly = false,
  applyLabel = '校验并应用',
  onApply,
}: CodeDocumentEditorProps) {
  const [draft, setDraft] = useState(value)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    setDraft(value)
    setMessage(null)
  }, [value])

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
    if (!onApply) return
    try {
      onApply(draft)
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
          setDraft(event.currentTarget.value)
          setMessage(null)
        }}
      />
      <div className="developer-card__actions">
        {language === 'json' && !readOnly && (
          <button type="button" className="secondary-button" onClick={format}>
            <WandSparkles size={13} />格式化
          </button>
        )}
        {!readOnly && onApply && (
          <button type="button" className="primary-button" onClick={apply}>
            <ShieldCheck size={13} />{applyLabel}
          </button>
        )}
      </div>
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
  readonly canCreateTemplate: boolean
  readonly onCreateTemplate: () => void
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
  canCreateTemplate,
  onCreateTemplate,
  onApply,
}: RuntimeSourceEditorProps) {
  const initial = view?.availability === 'available'
    ? runtimeDraftBinding(view)
    : null
  const [binding, setBinding] = useState<RuntimeSourceDraftBinding | null>(initial)
  const bindingRef = useRef(binding)
  const [message, setMessage] = useState<RuntimeDraftMessage | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const committedSourceRef = useRef<string | null>(null)

  const replaceBinding = (next: RuntimeSourceDraftBinding | null): void => {
    bindingRef.current = next
    setBinding(next)
  }

  const currentDocumentKey = view?.availability === 'available'
    ? view.documentKey
    : null

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
          {missingRuntime && canCreateTemplate
            ? '创建最小 Runtime API 2 模板后，即可在完整代码区中修改。'
            : runtimeUnavailableCopy(view)}
        </span>
        {missingRuntime && canCreateTemplate ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onCreateTemplate}
          >
            创建运行时模板
          </button>
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

function freshRuntime(): RuntimeDocument {
  return {
    runtimeApiVersion: 2,
    enabled: true,
    renderMode: 'phaser',
    source: EMPTY_RUNTIME_SOURCE,
    content: { values: {} },
    assets: {},
  }
}

export function DeveloperTab() {
  const scene = useEditorStore(selectActiveScene)
  const node = useEditorStore(selectSelectedNode)
  const project = useEditorStore((state) => state.project)
  const courseProject = useEditorStore(selectActiveCourseProjectDocument)
  const activeCourseLocationId = useEditorStore(selectActiveCourseLocationId)
  const courseAuthoringSessionToken = useEditorStore(
    (state) => state.courseAuthoringSession?.token ?? null,
  )
  const componentPackages = useEditorStore((state) => state.componentPackages)
  const editingScope = useEditorStore((state) => state.editingScope)
  const activePresentationStateId = useEditorStore(
    (state) => state.activePresentationStateId,
  )
  const updateNode = useEditorStore((state) => state.updateNode)
  const updateRuntimeSourceAtTarget = useEditorStore(
    (state) => state.updateRuntimeSourceAtTarget,
  )
  const setSceneRuntime = useEditorStore((state) => state.setSceneRuntime)
  const setGlobalRuntime = useEditorStore((state) => state.setGlobalRuntime)
  const activateCourseLocation = useEditorStore(
    (state) => state.activateCourseLocation,
  )
  const setEditingScope = useEditorStore((state) => state.setEditingScope)
  const setActivePresentationState = useEditorStore(
    (state) => state.setActivePresentationState,
  )
  const updateInteractionRule = useEditorStore((state) => state.updateInteractionRule)
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
  const rules = editingScope === 'global'
    ? project.globalInteractions
    : scene.interactions
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
  const selectedComponent = node?.type === 'external-component'
    ? componentPackages[node.component.packageId]
    : undefined
  const selectedComponentMeta =
    node?.type === 'external-component'
      ? Object.values(project.componentPackages).find(
          (meta) =>
            meta.packageId === node.component.packageId &&
            meta.version === node.component.version,
        )
      : undefined
  const componentEditable = selectedComponentMeta?.editableCopy === true
  const copyBlockedByPresentationState =
    editingScope === 'scene' && activePresentationStateId !== null
  const nodeJson = useMemo(
    () => node ? JSON.stringify(node, null, 2) : '',
    [node],
  )
  const activeCourseLocation = courseProject?.locations.find(
    (location) => location.id === activeCourseLocationId,
  )
  const runtimeView = useMemo<RuntimeSourceAuthoringView | null>(() => {
    if (!courseProject || !activeCourseLocationId || !courseAuthoringSessionToken) {
      return null
    }
    return selectRuntimeSourceAuthoringView({
      project: courseProject,
      locationId: activeCourseLocationId,
      editingScope,
      activeStateId: activeCourseLocation?.kind === 'slide-scene'
        ? activePresentationStateId
        : null,
      sessionToken: courseAuthoringSessionToken,
    })
  }, [
    activeCourseLocation?.kind,
    activeCourseLocationId,
    activePresentationStateId,
    courseAuthoringSessionToken,
    courseProject,
    editingScope,
  ])
  const canCreateRuntimeTemplate =
    runtimeView?.availability === 'unavailable'
    && runtimeView.reason === 'runtime-missing'
    && activeCourseLocation?.kind === 'slide-scene'
  const runtimeStatus = runtimeView?.availability === 'available'
    ? runtimeView.effectiveLocked ? '已锁定' : `API ${runtimeView.runtime.runtimeApiVersion}`
    : runtimeView?.reason === 'runtime-missing' ? '未创建' : '不可用'
  const editingScopeLabel = editingScope === 'global'
    ? '全局层'
    : activeCourseLocation?.kind === 'flow-block'
      ? `Flow · ${activeCourseLocation.label}`
      : activeCourseLocation?.kind === 'spatial-camera'
        ? `Spatial · ${activeCourseLocation.label}`
        : `场景 · ${scene.name}`

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
      status: node ? node.name : '未选择',
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
            canCreateTemplate={canCreateRuntimeTemplate}
            onCreateTemplate={() => {
              const preservedScope = editingScope
              const preservedStateId = activePresentationStateId
              if (editingScope === 'global') setGlobalRuntime(freshRuntime())
              else setSceneRuntime(scene.id, freshRuntime())
              if (activeCourseLocationId) {
                activateCourseLocation(activeCourseLocationId)
                if (preservedStateId !== null) {
                  setActivePresentationState(preservedStateId)
                }
                if (preservedScope === 'global') setEditingScope('global')
              }
            }}
            onApply={updateRuntimeSourceAtTarget}
          />
        )}

        {activeSection === 'object' && (
          node ? (
            <CodeDocumentEditor
              title={`所选对象 · ${node.name}`}
              description="ID 和类型不可更改；其他字段按 Project Schema 校验并进入撤销历史。"
              value={nodeJson}
              language="json"
              onApply={(value) => {
                const parsed = sceneNodeSchema.safeParse(JSON.parse(value))
                if (!parsed.success) {
                  throw new Error(parsed.error.issues[0]?.message ?? '对象 JSON 无效')
                }
                if (parsed.data.id !== node.id || parsed.data.type !== node.type) {
                  throw new Error('对象 ID 和类型不可修改')
                }
                updateNode(node.id, parsed.data as SceneNode)
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
                language="json"
                onApply={(value) => {
                  const parsed = interactionRuleSchema.safeParse(JSON.parse(value))
                  if (!parsed.success) {
                    throw new Error(parsed.error.issues[0]?.message ?? '规则 JSON 无效')
                  }
                  if (parsed.data.id !== selectedRule.id) throw new Error('规则 ID 不可修改')
                  if (editingScope === 'global') {
                    updateGlobalInteractionRule(selectedRule.id, parsed.data)
                  } else {
                    updateInteractionRule(scene.id, selectedRule.id, parsed.data)
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
          selectedComponent && node?.type === 'external-component' ? (
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
                      node.id,
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
