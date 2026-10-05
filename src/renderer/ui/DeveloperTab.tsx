import { Braces, Code2, CopyPlus, Play, ShieldCheck, WandSparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ComponentDefinition, ComponentEdit, ComponentInstance } from '../../shared/contracts/component-platform'
import { componentInstanceSchema, componentDefinitionSchema } from '../../shared/contracts/component-platform/schema'
import { interactionRuleSchema } from '../../shared/interactionSchema'
import { ComponentSourceEditor, independentComponentSourceEdits } from '../components/ComponentSourceEditor'
import { ComponentSourcesEditor } from './ComponentSourcesEditor'
import { useEditorStore, selectEditingScope } from '../store/editorStore'
import type { CapturedComponentOperation, CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { componentInteractionView, componentRuleEdits } from '../interactions/componentInteractionAuthoring'
import { replaceCourseNetworkDeclaration } from '../course/courseLogicAuthoringCommands'

type DeveloperSection = 'runtime' | 'object' | 'rules' | 'component'
type ApplyDraft = (raw: string) => Promise<void>
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
type CodeDraft = { key: string; value: string; binding: { apply: ApplyDraft; version: number } | null;
  busy: boolean; composing: boolean; message: string | null; listeners: Set<() => void> }
const codeDrafts = new WeakMap<object, Map<string, CodeDraft>>()

/** Frozen application callback owns its original capture through selection changes and late ACK. */
export function CodeDocumentEditor({ title, description, value, bindingKey, language = 'json', readOnly = false,
  capture, draftOwner, applyLabel = '校验并应用' }: {
  title: string; description: string; value: string; bindingKey: string; language?: 'json' | 'javascript'
  readOnly?: boolean; capture?(): ApplyDraft; draftOwner?: object; applyLabel?: string
}) {
  const [, refresh] = useState(0)
  const localOwner = useRef<object>({}), owner = draftOwner ?? localOwner.current
  let cache = codeDrafts.get(owner)
  if (!cache) { cache = new Map(); codeDrafts.set(owner, cache) }
  const fresh = (): CodeDraft => ({ key: bindingKey, value, binding: null, busy: false, composing: false, message: null, listeners: new Set() })
  const getDraft = () => { let draft = cache!.get(bindingKey); if (!draft) { draft = fresh(); cache!.set(bindingKey, draft) } return draft }
  const current = useRef(getDraft())
  if (!current.current.binding && !current.current.busy && current.current.key !== bindingKey) current.current = getDraft()
  const draft = current.current, stale = !!draft.binding && draft.key !== bindingKey
  const render = () => { for (const notify of draft.listeners) notify() }
  useEffect(() => {
    const notify = () => refresh(version => version + 1)
    draft.listeners.add(notify); return () => { draft.listeners.delete(notify) }
  }, [draft])
  useEffect(() => { if (!draft.binding && !draft.busy && draft.key === bindingKey) { draft.value = value; render() } }, [draft, bindingKey, value])
  const begin = () => {
    if (!draft.binding && capture) draft.binding = { apply: capture(), version: 0 }
    return draft.binding
  }
  const change = (raw: string) => {
    try { const binding = begin(); if (binding) binding.version++; draft.value = raw; draft.message = null; render() }
    catch (error) { draft.message = errorMessage(error); render() }
  }
  const apply = async () => {
    if (draft.busy || draft.composing) return
    let binding: NonNullable<CodeDraft['binding']>
    try { const started = begin(); if (!started) return; binding = started } catch (error) { draft.message = errorMessage(error); render(); return }
    const version = binding.version
    draft.busy = true; render()
    try {
      await binding.apply(draft.value)
      if (draft.binding === binding && binding.version === version) draft.binding = null
      draft.message = '修改已写入工程历史。'
    } catch (error) { if (draft.binding === binding) draft.message = `未应用：${errorMessage(error)}` }
    finally { draft.busy = false; render() }
  }
  return <section className="developer-card">
    <div className="developer-card__heading"><div><strong>{title}</strong><span>{description}</span></div><code>{language === 'json' ? 'JSON' : 'JS'}</code></div>
    <textarea className="developer-code-editor" aria-label={title} value={draft.value} readOnly={readOnly || draft.busy} wrap="off" spellCheck={false}
      onChange={event => change(event.target.value)} onKeyDownCapture={event => { if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) event.stopPropagation() }}
      onCompositionStart={() => { try { begin(); draft.composing = true; render() } catch (error) { draft.message = errorMessage(error); render() } }} onCompositionEnd={() => { draft.composing = false; render() }} />
    {!readOnly && <div className="developer-card__actions">
      {language === 'json' && <button className="secondary-button" disabled={draft.composing || draft.busy} onClick={() => {
        try { change(JSON.stringify(JSON.parse(draft.value), null, 2)) } catch (error) { draft.message = `格式化失败：${errorMessage(error)}`; render() }
      }}><WandSparkles size={13} />格式化</button>}
      {capture && <button className="primary-button" disabled={draft.composing || draft.busy} onClick={() => void apply()}><ShieldCheck size={13} />{applyLabel}</button>}
      <button className="secondary-button" disabled={draft.composing || draft.busy} onClick={() => { cache!.delete(draft.key); current.current = fresh(); cache!.set(bindingKey, current.current); render() }}>放弃草稿</button>
    </div>}
    {stale && <p role="status" data-testid="code-document-stale">草稿属于原文档与原对象；应用仍只提交捕获的目标。</p>}
    {draft.message && <p className="developer-card__message" role="status">{draft.message}</p>}
  </section>
}

export function componentObjectJsonEdits(current: ComponentInstance, next: ComponentInstance): ComponentEdit[] {
  if (next.id !== current.id || next.definitionId !== current.definitionId) throw new Error('对象身份和定义不可在对象 JSON 中修改。')
  if (JSON.stringify(next.childIds ?? []) !== JSON.stringify(current.childIds ?? [])) throw new Error('请通过图层与组合操作修改子对象顺序。')
  if (current.frame && !next.frame) throw new Error('请通过对象布局入口修改 frame；对象 JSON 不支持删除 frame。')
  return [
    { type: 'data.set', instanceId: current.id, path: [], value: next.data },
    { type: 'style.set', instanceId: current.id, path: [], value: next.style ?? {} },
    ...(next.frame ? [{ type: 'frame.set' as const, instanceId: current.id, frame: next.frame }] : []),
    { type: 'instance.patch', instanceId: current.id, patch: { name: next.name ?? current.name ?? '', visible: next.visible ?? true,
      locked: next.locked ?? false, playbackInitialVisibility: next.playbackInitialVisibility ?? 'inherit' } },
    { type: 'implementation.set', instanceId: current.id, implementation: next.implementationOverride ?? null },
    { type: 'attachments.set', instanceId: current.id, attachments: next.attachments ?? [] },
    { type: 'instance.flowPlacement.set', instanceId: current.id, flowPlacement: next.flowPlacement ?? null },
    { type: 'instance.flowLayout.set', instanceId: current.id, flowLayout: next.flowLayout ?? null },
  ]
}
const runtimeSource = `export default {
  mount({ instance, scope }) {
    // 使用 scope.events / scope.state；作者 data 不会被运行状态覆盖。
    if (scope.isActive()) scope.state.set('started', true);
    let task;
    const startMotion = () => {
      task?.cancel();
      const attachment = instance.attachments?.find(item => item.target.kind === 'instance');
      const motion = attachment && scope.target(attachment.target)?.motion;
      task = motion?.replace('lesson-motion', async context => {
        if (context.reducedMotion) return;
        while (!context.signal.aborted) {
          const frame = await context.nextFrame();
          if (!frame) return;
          const t = Math.min(frame.elapsed / 800, 1);
          const x = Math.sin(t * Math.PI * 4) * (1 - t) * 32;
          // 作者变换后叠加局部增量；await 确认宿主实际应用。
          if (!await context.write({ transform: 'translateX(' + x + 'px)' })) return;
          if (t === 1) return;
        }
      });
    };
    const off = scope.events.subscribe('__runtime.playing', playing => { if (playing) startMotion(); });
    startMotion();
    scope.cleanup(off); scope.cleanup(() => task?.cancel());
    return { update(next) { instance = next; startMotion(); }, dispose() { off(); task?.cancel(); } };
  }
};`

export function DeveloperTab() {
  const view = useEditorStore(state => state.courseView), kernel = useEditorStore(state => state.courseKernel)
  const setCanvasMode = useEditorStore(state => state.setCanvasMode), report = useEditorStore(state => state.setError)
  const defaultScope = useEditorStore(selectEditingScope)
  const [scope, setScope] = useState<'scene' | 'global'>(defaultScope)
  const [section, setSection] = useState<DeveloperSection>('runtime'), [ruleId, setRuleId] = useState('')
  const [visitedSources, setVisitedSources] = useState(() => new Set<DeveloperSection>(['runtime']))
  const [sourceScope, setSourceScope] = useState<'definition' | 'instance'>('definition')
  const [visitedSourceScopes, setVisitedSourceScopes] = useState(() => new Set<'definition' | 'instance'>(['definition']))
  const visitSourceScope = (next: 'definition' | 'instance') => {
    setSourceScope(next); setVisitedSourceScopes(current => current.has(next) ? current : new Set([...current, next]))
  }
  const project = view.project, documentId = view.activeDocumentId, surfaceId = view.surfaceId
  const interactions = project && surfaceId ? componentInteractionView(project, surfaceId, scope === 'global') : null
  const rules = interactions?.rules ?? []
  useEffect(() => { if (!rules.some(rule => rule.id === ruleId)) setRuleId(rules[0]?.id ?? '') }, [rules, ruleId])
  if (!project || !documentId || !surfaceId) return <div className="developer-tab" data-testid="developer-tab"><p>请先打开课件。</p></div>
  const instance = view.editingProject?.instances[view.selectedInstanceId ?? ''] ?? project.instances[view.selectedInstanceId ?? '']
  const definition = instance && project.definitions[instance.definitionId]
  const implementation = instance?.implementationOverride ?? definition?.implementation
  const targetKey = JSON.stringify([documentId, view.snapshot?.epoch, instance?.id, view.activeStateId])
  const rule = rules.find(value => value.id === ruleId)
  const runtime = Object.values(project.instances).find(value => value.definitionId.startsWith('guoling.runtime.')
    && value.attachments?.some(attachment => attachment.instanceId === value.id && attachment.target.kind === (scope === 'global' ? 'project' : 'surface')
      && (attachment.target.kind !== 'surface' || attachment.target.surfaceId === surfaceId)))
  const runtimeImplementation = runtime && (runtime.implementationOverride ?? project.definitions[runtime.definitionId]?.implementation)
  const createApply = (target: CapturedCourseTarget, initial: ComponentEdit[], plan: (raw: string) => ComponentEdit[]): ApplyDraft => {
    const command = kernel.capture(initial, target)
    return async raw => {
      // Map named-state edits against the frozen target, never the later selection.
      const planned = kernel.capture(plan(raw), target)
      const next: CapturedComponentOperation = { ...planned, documentId: command.documentId, epoch: command.epoch,
        expected: [...new Map([...command.expected, ...planned.expected].map(expected => [JSON.stringify(expected.path), expected])).values()] }
      await kernel.editCaptured(next)
    }
  }
  const createRuntime = async () => {
    const target = kernel.captureTarget(documentId), id = crypto.randomUUID(), definitionId = `guoling.runtime.${id}`
    const container = scope === 'global' ? { kind: 'global' as const, plane: 'underlay' as const } : { kind: 'surface' as const, surfaceId }
    const roots = container.kind === 'global' ? target.project.global.underlay : target.project.surfaces.find(surface => surface.id === surfaceId)?.childIds
    if (!roots) throw new Error('目标页面已不存在')
    const motionTarget = target.instanceId && target.project.instances[target.instanceId]
    const targetRole = motionTarget && target.project.definitions[motionTarget.definitionId]?.role
    const behavior: ComponentInstance = { id, definitionId, name: scope === 'global' ? '全局运行时' : '页面运行时', data: {},
      attachments: [{ instanceId: id, target: scope === 'global' ? { kind: 'project' } : { kind: 'surface', surfaceId } },
        ...(motionTarget && targetRole !== 'behavior' ? [{ instanceId: id, target: { kind: 'instance' as const, instanceId: motionTarget.id } }] : [])] }
    await kernel.editCaptured(kernel.capture([{ type: 'definition.set', definition: { id: definitionId, role: 'behavior', title: behavior.name,
      implementation: { kind: 'source', source: runtimeSource, language: 'javascript' } } },
      { type: 'instance.insert', container, index: roots.length, instances: [behavior], rootIds: [id] }], target))
  }
  const sections: { id: DeveloperSection; label: string; status: string }[] = [
    { id: 'runtime', label: '运行时', status: runtime ? '组件 API 5' : '未创建' },
    { id: 'object', label: '对象 JSON', status: instance?.name ?? '未选择' },
    { id: 'rules', label: '规则 JSON', status: `${rules.length} 条` },
    { id: 'component', label: '组件代码', status: definition ? '共享定义／实例源码' : '未选择' },
  ]
  return <div className="developer-tab" data-testid="developer-tab">
    <header className="developer-workbench-header"><div className="developer-workbench-title"><Code2 size={19} /><div><strong>工程开发工作台</strong><span>编辑课件组件、行为与工程数据。</span></div></div>
      <div className="developer-workbench-meta"><label>作用域<select aria-label="开发作用范围" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="scene">当前页面</option><option value="global">全局层</option></select></label>
        <button className="secondary-button" onClick={() => setCanvasMode('run')}><Play size={13} />试运行</button></div></header>
    <div className="developer-workspace-tabs" role="tablist" aria-label="开发工作区">{sections.map(value => <button key={value.id} role="tab" aria-selected={section === value.id} className={section === value.id ? 'is-active' : ''} onClick={() => {
      if (value.id === 'runtime' || value.id === 'component') setVisitedSources(current => current.has(value.id) ? current : new Set([...current, value.id]))
      setSection(value.id)
    }}><span>{value.label}</span><small>{value.status}</small></button>)}</div>
    <div className="developer-workspace-content" role="tabpanel" aria-label={sections.find(value => value.id === section)?.label}>
      {visitedSources.has('runtime') && <div hidden={section !== 'runtime'}><ComponentSourceEditor instance={runtime} implementation={runtimeImplementation} bridge={kernel.bridge} documentId={documentId} report={report} /></div>}
      {section === 'runtime' && (!runtime &&
        <section className="developer-empty-card" data-testid="runtime-source-missing"><Code2 size={20} /><strong>当前作用域没有自定义运行时</strong><span>创建可编辑行为源码。若已选择对象，模板会绑定该对象并提供正弦逐帧动效。</span><button className="secondary-button" onClick={() => void createRuntime().catch(error => report(errorMessage(error)))}>创建运行时模板</button></section>)}
      {section === 'runtime' && <CodeDocumentEditor draftOwner={kernel.bridge} title="课程网络声明" description="声明源码实际使用的来源；联网授权由现有宿主处理。" value={JSON.stringify(project.logic?.network ?? { connectOrigins: [] }, null, 2)} bindingKey={JSON.stringify([documentId, view.snapshot?.epoch, 'network'])}
        capture={() => { const target = kernel.captureTarget(documentId), initial = replaceCourseNetworkDeclaration(target.project, { projectId: project.id, baseRevision: target.project.revision }, target.project.logic?.network ?? {})
          if (!initial.ok) throw new Error(initial.reason)
          return createApply(target, initial.edits, raw => { const result = replaceCourseNetworkDeclaration(target.project, { projectId: target.project.id, baseRevision: target.project.revision }, JSON.parse(raw)); if (!result.ok) throw new Error(result.reason); return result.edits }) }} />}
      {section === 'object' && (instance ? <CodeDocumentEditor draftOwner={kernel.bridge} title={`所选对象 · ${instance.name ?? instance.id}`} description="布局、data 与实现进入撤销历史；身份、组合关系由图层操作维护。" value={JSON.stringify(instance, null, 2)} bindingKey={targetKey}
        capture={() => { const target = kernel.captureTarget(documentId), current = target.editingProject.instances[instance.id]; if (!current) throw new Error('对象已经不存在')
          return createApply(target, componentObjectJsonEdits(current, current), raw => componentObjectJsonEdits(current, componentInstanceSchema.parse(JSON.parse(raw)))) }} /> : <section className="developer-empty-card"><Braces size={20} /><strong>未选择对象</strong><span>在画布或图层面板选择对象后修改其 JSON。</span></section>)}
      {section === 'rules' && <div className="developer-rule-workspace"><section className="developer-rule-picker"><label htmlFor="developer-rule-select">当前规则</label><select id="developer-rule-select" value={ruleId} onChange={event => setRuleId(event.target.value)}><option value="">未选择</option>{rules.map(value => <option key={value.id} value={value.id}>{value.name ?? value.id}</option>)}</select></section>
        {rule && interactions ? <CodeDocumentEditor draftOwner={kernel.bridge} title={`规则 · ${rule.name ?? rule.id}`} description="标准 trigger / conditions / actions，使用实际组件与页面身份。" value={JSON.stringify(rule, null, 2)} bindingKey={JSON.stringify([documentId, view.snapshot?.epoch, surfaceId, scope, rule.id])}
          capture={() => { const target = kernel.captureTarget(documentId), current = componentInteractionView(target.project, surfaceId, scope === 'global')
            return createApply(target, componentRuleEdits(target.project, current.target, current.rules), raw => { const next = interactionRuleSchema.parse(JSON.parse(raw)); if (next.id !== rule.id) throw new Error('规则 ID 不可修改');
              if (!current.rules.some(value => value.id === rule.id)) throw new Error('规则已不存在'); return componentRuleEdits(target.project, current.target, current.rules.map(value => value.id === rule.id ? next : value)) }) }} /> :
          <section className="developer-empty-card"><Braces size={20} /><strong>当前作用域没有规则</strong><span>先在“互动与动画”中创建规则，再检查完整 JSON。</span></section>}</div>}
      {visitedSources.has('component') && <div hidden={section !== 'component'}>
        <div className="developer-document-tabs" role="tablist" aria-label="组件源码作用域">
          <button type="button" role="tab" aria-selected={sourceScope === 'definition'} onClick={() => visitSourceScope('definition')}>共享定义源码</button>
          <button type="button" role="tab" aria-selected={sourceScope === 'instance'} onClick={() => visitSourceScope('instance')}>当前实例源码</button>
        </div>
        {visitedSourceScopes.has('definition') && <div hidden={sourceScope !== 'definition'}><ComponentSourcesEditor instance={instance} bridge={kernel.bridge} documentId={documentId} report={report} /></div>}
        {visitedSourceScopes.has('instance') && <div hidden={sourceScope !== 'instance'}><ComponentSourceEditor instance={instance} implementation={implementation} bridge={kernel.bridge} documentId={documentId} report={report} /></div>}
      </div>}
      {section === 'component' && (instance && definition && implementation ? <>
        <section className="developer-card"><strong>{definition.title ?? definition.id}</strong><span>共享定义影响所有继承实例；当前实例源码保持独立。未应用的草稿保留在各自作用域。</span>
          <button className="secondary-button" disabled={instance.locked === true} onClick={() => { try {
            const { target, edits } = independentComponentSourceEdits(kernel.bridge, documentId, instance.id)
            void kernel.editCaptured(kernel.capture(edits, target)).then(() => visitSourceScope('instance')).catch(error => report(errorMessage(error)))
          } catch (error) { report(errorMessage(error)) }
          }}><CopyPlus size={13} />为当前实例创建独立副本</button></section>
        <CodeDocumentEditor draftOwner={kernel.bridge} title="共享定义与编辑元数据" description="定义、数据规则和专业编辑页面随工程保存；源码文件通过上方对应作用域编辑。" readOnly={instance.locked === true} value={JSON.stringify(definition, null, 2)} bindingKey={JSON.stringify([documentId, view.snapshot?.epoch, definition.id, 'shared'])}
          capture={() => { const target = kernel.captureTarget(documentId), current: ComponentDefinition = target.project.definitions[definition.id]; if (!current) throw new Error('组件定义已不存在')
            return createApply(target, [{ type: 'definition.set', definition: current }], raw => {
              const next = componentDefinitionSchema.parse(JSON.parse(raw)); if (next.id !== current.id) throw new Error('共享定义身份不可修改。')
              return [{ type: 'definition.set', definition: next }]
            }) }} />
      </> : <section className="developer-empty-card"><Code2 size={20} /><strong>未选择组件</strong><span>选择对象后编辑共享定义或当前实例源码。</span></section>)}
    </div>
  </div>
}

