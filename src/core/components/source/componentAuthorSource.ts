import type { ComponentDefinition, ComponentEdit, ComponentImplementation, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { DocumentResources } from '../../../shared/workbench/document'
import { getBuiltinComponentSource } from './builtinSources'
import { componentSourceAuthoringEdits, type ComponentSourceEditTarget } from './sourceAuthoringEdits'
import { componentEnhancementRuntimeSource, componentEnhancementWrapperSource } from './componentEnhancement'

type Source = Extract<ComponentImplementation, { kind: 'source' }>
export interface ComponentAuthorSource {
  implementation: Source
  /** Read-only preparation. These definitions enter the project only with an actual edit. */
  definitions: ComponentDefinition[]
}

/** Author-facing facts from ComponentRuntimeContext/Scope and TeacherControllerPort. */
export const componentAuthorSourceRuntimeNote = [
  'API5：DOM 和监听在 mount(context) 内建立；context.root 是当前组件的可选 HTMLElement，context.instance 是当前实例。',
  '共享运行状态使用 context.scope.state：get(name) 返回 JSON 值或 undefined，set(name, value) 写 JSON 值，subscribe(name, listener) 返回退订函数并自动随挂载清理。相同名称在同一运行会话的组件/页面间共享；这是运行态，不写作者工程或保存文件。subscribe 不回放当前值，首次显示另读 get(name)。',
  '导航使用可选的 const tc = context.teacherController：tc.read().scenes 返回实际 {id,name,targets?}，tc.read().locationId 是当前页；用实际 scene.id 执行 await tc.execute({type:"scene.go",sceneId:scene.id}, context.scope.signal)，也支持 {type:"scene.next"}/{type:"scene.previous"}。tc.canExecute(action) 返回当前能否执行；tc.subscribe(listener) 返回退订函数并自动随挂载清理。',
  '给当前实例追加业务行为时，用 project.apply {path:主Source路径,intent:"enhance",content:业务模块}，或 from 提供普通 JS/TS 文件及相对依赖。软件在原实现挂载后执行增强，接力 update/dispose，保留 frame、HTML/专业数据与其他实例；回执 enhancementPath 指向实际业务模块，继续编辑它即可。共享定义和依赖仍用 content 深改。',
  '增强模块导出 default 函数或 enhance(context)。context 提供原 API5 端口及 listen(type,selector,handler) 的根节点委托监听、observe(key,paint) 的首次读取和订阅；重绘后继续使用这些受管监听/显示，更新时先清理增强再执行原 update 并重新接入。可返回清理函数或含 dispose() 的对象，异步 dispose 会等待。scope.cleanup 用于计时器、Observer 和外部资源。',
  '显式连接由 object.update.properties.stateBindings 提供 alias→已声明的 courseState.key；增强用 bindings.get/set/observe(alias)，observe 同时首显与订阅。软件维护这些声明引用的改名与复制映射，不改写业务 JS 字符串。scope.state 的普通 JSON 业务仍可直接使用。',
  'scope.state/events.subscribe 和 tc.subscribe 已自动随挂载清理，无需重复登记；state.subscribe 不回放当前值，直接使用时首显另读 get。scope.signal 随该次挂载结束而取消，scope.isActive() 表示挂载仍存活；普通暂停、离屏和跨页保留沿原生命周期。',
  '跨对象位置用 await context.scope.measure?.([{kind:"instance",instanceId:实际目标ID}, ...]) 批量取同一时刻的几何；返回 {sampleTime,targets}，sampleTime 是宿主 performance.timeOrigin+performance.now() 毫秒。每项 viewportFrame={width,height,transform} 将目标局部边框像素映射到调用者视口；不可测/未挂载时为 null，已挂载离屏目标仍可测。Flow 项另有 flow.containerId/contentFrame/contentToViewport/viewport/scrollSize；contentFrame 位于实际滚动 owner 未缩放内容坐标，viewport 的 x/y 是同批 scrollLeft/scrollTop，contentToViewport 映射该内容坐标到调用者视口。仿射矩阵 [a,b,c,d,e,f] 作用于点为 {x:a*x+c*y+e,y:b*x+d*y+f}。一次动画计算只用同一批返回值，不混用历史视口 rect 和异步导航快照；布局变化后重测，挂载取消后返回 null，不写作者工程或 scope.state。',
  '瞬态动效复用 scope.target({kind:"instance",instanceId}).motion?.replace(channel, async ctx=>{...})；await ctx.write({transform,opacity})、await ctx.nextFrame()、ctx.animate(keyframes,timing) 只更新当前呈现，不能每帧用 object.update/project.apply 写持久 frame。channel 替换、task.cancel()、scope 退出会释放 effect；ctx.signal/nextFrame null/write false 表示停止。局部 Canvas 与具体路线仍由作品自己的单一渲染循环管理。',
  `局部增强示例：
export default ({root, scope, listen, observe}) => {
  observe('value', value => {
    const output = root?.querySelector('[data-value]');
    if (output) output.textContent = String(value ?? '');
  });
  listen('click', '[data-increment]', () => scope.state.set('value', Number(scope.state.get('value') ?? 0) + 1));
};`,
  '仍可完整深改 API5：保留 import、...implementation；await implementation.mount(context) 后自行接入，return mounted 或显式转交原 update/dispose；新增 DOM/外部资源需要 cleanup。',
].join('\n')

/** UI and file observations use the same author entry, without mutating a builtin on read. */
export function prepareComponentAuthorSource(project: CourseProjectV10, effective: ComponentImplementation | undefined): ComponentAuthorSource | undefined {
  if (!effective) return undefined
  if (effective.kind === 'source') return { implementation: effective, definitions: [] }
  const source = getBuiltinComponentSource(effective.key)
  if (!source) return undefined
  const base = `source-${effective.key}`
  let id = base, suffix = 1
  while (Object.hasOwn(project.definitions, id)) {
    const existing = project.definitions[id].implementation
    if (existing.kind === 'source' && existing.source === source.source && existing.language === source.language
      && !existing.workspace && !existing.moduleBindings && !existing.dependencies && !existing.resourceBindings) break
    id = `${base}-${++suffix}`
  }
  return {
    implementation: { kind: 'source', language: 'javascript', moduleBindings: { './implementation': id },
      source: "import implementation from './implementation';\n\nexport default {\n  ...implementation,\n  mount(context) {\n    return implementation.mount(context);\n  },\n};\n" },
    definitions: Object.hasOwn(project.definitions, id) ? [] : [{ id, title: `${effective.key} 实现`, role: 'mixed', implementation: source }],
  }
}

/** A local enhancement is ordinary Source modules; the file adapter only chooses this planner. */
export function componentAuthorEnhancementEdits(project: CourseProjectV10, resources: DocumentResources,
  instanceId: string, content: string | Source, language: Source['language'] = 'javascript'): ComponentEdit[] {
  const instance = project.instances[instanceId]
  if (!instance) throw new Error('增强目标对象已不存在')
  const effective = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  const prepared = prepareComponentAuthorSource(project, effective)
  if (!prepared) throw new Error('当前组件没有可增强的 Source 实现')
  const target = { kind: 'instance' as const, instanceId }, root = prepared.implementation
  const replacement: Source = typeof content === 'string' ? { kind: 'source', language, source: content } : content
  const enhancementId = root.moduleBindings?.['./enhancement']
  if (enhancementId && root.moduleBindings?.['./implementation'] && root.moduleBindings?.['./enhancement-runtime']) {
    if (root.workspace || root.source !== componentEnhancementWrapperSource)
      throw new Error('增强组合入口已被人工深改；请修改其当前 enhancement 依赖或完整 Source，原增强输入已保留。')
    return componentAuthorSourceEdits(project, resources, target, prepared, replacement, undefined, enhancementId)
  }
  // A defined Source may import itself or participate in a cycle. Retain that actual module identity.
  const definedBase = !instance.implementationOverride && effective?.kind === 'source'
  const baseId = definedBase ? instance.definitionId : crypto.randomUUID()
  const behaviorId = crypto.randomUUID(), runtimeId = 'guoling.source-enhancement-runtime'
  const runtime = project.definitions[runtimeId]
  const actualRuntimeId = !runtime || runtime.implementation.kind === 'source' && runtime.implementation.source === componentEnhancementRuntimeSource
    ? runtimeId : crypto.randomUUID()
  const definitions: ComponentDefinition[] = [...prepared.definitions,
    ...(!definedBase ? [{ id: baseId, title: '局部增强的原实现', role: 'mixed' as const, implementation: root }] : []),
    { id: behaviorId, title: '局部业务增强', role: 'mixed', implementation: replacement },
    ...(!runtime || actualRuntimeId !== runtimeId ? [{ id: actualRuntimeId, title: '局部增强生命周期', role: 'mixed' as const,
      implementation: { kind: 'source' as const, language: 'javascript' as const, source: componentEnhancementRuntimeSource } }] : [])]
  const implementation: Source = { kind: 'source', language: 'javascript', source: componentEnhancementWrapperSource,
    moduleBindings: { './implementation': baseId, './enhancement': behaviorId, './enhancement-runtime': actualRuntimeId },
    ...(root.resourceBindings ? { resourceBindings: root.resourceBindings } : {}) }
  return [...definitions.map(definition => ({ type: 'definition.set' as const, definition })), ...componentSourceAuthoringEdits(target, implementation)]
}

export function componentAuthorSourceProject(project: CourseProjectV10, prepared: ComponentAuthorSource): CourseProjectV10 {
  return prepared.definitions.length ? { ...project, definitions: { ...project.definitions,
    ...Object.fromEntries(prepared.definitions.map(definition => [definition.id, definition])) } } : project
}

/** Dependencies are formal source owners, never a second writable expanded closure. */
export function componentAuthorSourceModules(project: CourseProjectV10, resources: DocumentResources, prepared: ComponentAuthorSource): Array<{
  id?: string; title: string; implementation: Source
}> {
  const current = componentAuthorSourceProject(project, prepared)
  const ids = new Set<string>(), pending = Object.values(prepared.implementation.moduleBindings ?? {})
  pending.push(...prepared.implementation.dependencies ?? [])
  while (pending.length) {
    const id = pending.shift()!, source = current.definitions[id]?.implementation
    if (ids.has(id) || source?.kind !== 'source') continue
    ids.add(id); pending.push(...Object.values(source.moduleBindings ?? {}), ...source.dependencies ?? [])
  }
  return [{ title: '作者入口', implementation: prepared.implementation },
    ...[...ids].map(id => ({
      id, title: current.definitions[id].title ?? id, implementation: current.definitions[id].implementation as Source,
    }))]
}

const sourceBindings = (source: Source) => source.moduleBindings ?? Object.fromEntries((source.dependencies ?? []).map(id => [id, id]))

export function componentAuthorSourceDependencyPaths(project: CourseProjectV10, prepared: ComponentAuthorSource,
  dependencyId: string, resources?: DocumentResources): string[][] {
  const current = componentAuthorSourceProject(project, prepared)
  const paths: string[][] = []
  const visit = (source: Source, path: string[], seen: Set<string>) => {
    for (const [specifier, id] of Object.entries(sourceBindings(source))) {
      if (id === dependencyId) paths.push([...path, specifier])
      if (seen.has(id)) continue
      const next = current.definitions[id]?.implementation
      if (next?.kind === 'source') visit(next, [...path, specifier], new Set([...seen, id]))
    }
  }
  visit(prepared.implementation, [], new Set())
  return paths
}

/** Recovery stores import spellings, not a second dependency registry or source snapshot. */
export function resolveComponentAuthorSourceDependencyPaths(project: CourseProjectV10, prepared: ComponentAuthorSource,
  paths: readonly (readonly string[])[], resources?: DocumentResources): string | undefined {
  const current = componentAuthorSourceProject(project, prepared)
  const targets = new Set<string>()
  for (const path of paths) {
    let source: ComponentImplementation | undefined = prepared.implementation, id: string | undefined
    for (const specifier of path) {
      id = source?.kind === 'source' ? sourceBindings(source)[specifier] : undefined
      source = id ? current.definitions[id]?.implementation : undefined
    }
    if (!id || source?.kind !== 'source') return undefined
    targets.add(id)
  }
  return targets.size === 1 ? [...targets][0] : undefined
}

/** Replace one module through the selected author root. Only its live ancestors are copied. */
export function componentAuthorSourceEdits(project: CourseProjectV10, resources: DocumentResources,
  target: ComponentSourceEditTarget, prepared: ComponentAuthorSource, replacement: Source,
  files?: Extract<ComponentEdit, { type: 'component.files.set' }>, dependencyId?: string): ComponentEdit[] {
  const current = componentAuthorSourceProject(project, prepared)
  const rootId = Object.values(current.definitions).find(definition => definition.implementation === prepared.implementation)?.id
  if (!dependencyId || target.kind === 'definition' && dependencyId === rootId) return [...prepared.definitions.map(definition => ({ type: 'definition.set' as const, definition })),
    ...componentSourceAuthoringEdits(target, replacement, files)]
  const modules = componentAuthorSourceModules(project, resources, prepared)
  const definitions = new Set(modules.flatMap(module => module.id ? [module.id] : []))
  const references = (source: Source) => new Set(Object.values(sourceBindings(source)))
  if (!definitions.has(dependencyId)) throw new Error('原源码依赖已不在当前作者入口中，请读取当前源码。')
  const copied = new Set([dependencyId])
  let changed = true
  while (changed) {
    changed = false
    for (const id of definitions) if (!copied.has(id)) {
      const definition = current.definitions[id]
      if (definition.implementation.kind === 'source' && [...references(definition.implementation)].some(value => copied.has(value))) {
        copied.add(id); changed = true
      }
    }
  }
  // A dependency already private to this author root can be edited in place.
  // Preserve modules reached by other instances and by independent definition roots.
  const incoming = new Set<string>()
  for (const definition of Object.values(current.definitions)) if (definition.implementation.kind === 'source')
    Object.values(sourceBindings(definition.implementation)).forEach(id => incoming.add(id))
  for (const instance of Object.values(current.instances)) if (instance.implementationOverride?.kind === 'source')
    Object.values(sourceBindings(instance.implementationOverride)).forEach(id => incoming.add(id))
  const protectedIds = new Set<string>()
  const protect = (implementation: ComponentImplementation, id?: string) => {
    if (id) { if (protectedIds.has(id)) return; protectedIds.add(id) }
    if (implementation.kind !== 'source') return
    for (const nextId of Object.values(sourceBindings(implementation))) {
      const next = current.definitions[nextId]
      if (next) protect(next.implementation, nextId)
    }
  }
  for (const definition of Object.values(current.definitions)) if ((!incoming.has(definition.id) || !definitions.has(definition.id) && definition.id !== rootId)
    && !(target.kind === 'definition' && definition.id === target.definition.id)) protect(definition.implementation, definition.id)
  for (const instance of Object.values(current.instances)) {
    if (target.kind === 'instance' && instance.id === target.instanceId
      || target.kind === 'definition' && instance.definitionId === target.definition.id && !instance.implementationOverride) continue
    const effective = instance.implementationOverride ?? current.definitions[instance.definitionId]?.implementation
    if (effective) protect(effective, instance.implementationOverride ? undefined : instance.definitionId)
  }
  // A definition is itself a public author root, even when only this instance uses it.
  if (target.kind === 'instance' && rootId) protect(prepared.implementation, rootId)
  const ids = new Map([...copied].map(id => [id, protectedIds.has(id) ? crypto.randomUUID() : id]))
  if (rootId && copied.has(rootId) && target.kind === 'definition') ids.set(rootId, target.definition.id)
  const rebind = (source: Source): Source => {
    const bindings = { ...(source.moduleBindings ?? Object.fromEntries((source.dependencies ?? []).map(id => [id, id]))) }
    return { ...source, moduleBindings: Object.fromEntries(Object.entries(bindings).map(([name, id]) => [name, ids.get(id) ?? id])),
      ...(source.dependencies ? { dependencies: source.dependencies.map(id => ids.get(id) ?? id) } : {}) }
  }
  const edits: ComponentEdit[] = prepared.definitions.filter(definition => !copied.has(definition.id))
    .map(definition => ({ type: 'definition.set', definition }))
  for (const id of copied) {
    if (id === rootId && target.kind === 'definition') continue
    const original = current.definitions[id], definition = { ...original, id: ids.get(id)!, implementation: rebind(id === dependencyId ? replacement : original.implementation as Source) }
    const added = componentSourceAuthoringEdits({ kind: 'definition', definition }, definition.implementation,
      id === dependencyId ? files : undefined)
    // The source origin is a captured read dependency of this copy, not a write to the shared module.
    for (const edit of added) if (edit.type === 'definition.set') edit.sourceOriginId = id
    edits.push(...added)
  }
  // An instance override has its own module identity. A cycle back to the original
  // definition must resolve to the same private module, not evaluate a duplicate root.
  const implementation = rootId && copied.has(rootId) && target.kind === 'instance'
    ? { kind: 'source' as const, language: 'javascript' as const,
      source: "import * as implementation from './implementation';\nexport default Reflect.get(implementation, 'default') ?? implementation;\nexport * from './implementation';\n",
      moduleBindings: { './implementation': ids.get(rootId)! },
      ...(prepared.implementation.resourceBindings ? { resourceBindings: prepared.implementation.resourceBindings } : {}) }
    : rebind(prepared.implementation)
  return [...edits, ...componentSourceAuthoringEdits(target, implementation)]
}
