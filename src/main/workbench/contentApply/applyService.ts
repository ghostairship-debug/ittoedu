import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { captureComponentOperation, equalComponentValue } from '../../../core/drivers/courseV10Operations'
import { assertCourseSurfaceRemoval, createCourseSurface } from '../../../core/course/courseSurfaceStructure'
import type { InMemoryComponentCompilation } from '../../../core/components/compilation/InMemoryComponentCompilation'
import { componentCompilationInput } from '../../../core/components/compilation/componentCompilationInput'
import { sourceProgramAssembly, type HtmlAssembly } from '../../../core/contentApply/assembly/htmlAssembly'
import { owningContainer, resolveComponentPresentation, type ComponentContainer, type ComponentDefinition, type ComponentEdit, type ComponentImplementation, type CourseProjectV10, type JsonObject, type JsonValue } from '../../../shared/contracts/component-platform'
import { prepareContentResources, type PreparedContentResources } from './resources/contentResources'
import { extractHtmlResources, htmlResourceSources } from '../htmlImport/extractHtmlResources'
import type { HtmlDesignMeasurementRequest } from './measurement/ElectronHtmlDesignMeasurement'
import { prepareMeasurementDocument } from './measurement/prepareMeasurementDocument'
import { assemblyContentDraft, htmlAssemblyFraming, htmlForAssembly, localHtmlInputs, preserveHtmlOuterStyle } from './application/html'
import { NoContentTargetError, planContentApply } from './application/plan'
import type { CanonicalContentApplyRequest, ContentApplyDiagnostic, ContentApplyPlan, ContentApplyRequest, ContentApplyResult, ContentApplySessionPort, ContentChangeRequest, ContentObjectDraft, SurfaceApplyRequest } from './application/types'
import type { DocumentResources } from '../../../shared/workbench/document'

export type { ContentApplyRequest, ContentApplyResult, ContentApplyPlan, ContentApplySessionPort } from './application/types'

export interface ContentApplyServiceOptions {
  session: ContentApplySessionPort
  /** Actual L02 browser worker, injected to keep a pure plan independent of Electron startup. */
  measure(request: HtmlDesignMeasurementRequest): Promise<HtmlAssembly>
  compilation: Pick<InMemoryComponentCompilation, 'compile'>
  createId?(): string
  /** Existing asset URLs are resolved by the canonical resource owner, never persisted. */
  resourceUrls?(project: CourseProjectV10, request: ContentChangeRequest): Readonly<Record<string, string>>
}

function dataObject(data: JsonValue): JsonObject {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('当前对象没有可编辑的 HTML 数据')
  return data
}
function dataBindings(data: JsonObject): Record<string, string> {
  const value = data.resourceBindings
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}
}
function resourceEdits(prepared: PreparedContentResources, createId: () => string): { edits: ComponentEdit[]; bindings: Record<string, string>; urls: Record<string, string> } {
  const edits: ComponentEdit[] = [], bindings: Record<string, string> = {}, urls: Record<string, string> = {}
  const admitted = new Set(prepared.resources)
  const retained: PreparedContentResources['resources'] = [...prepared.resources, ...prepared.unresolvedResources]
  for (const resource of retained) {
    const id = resource.image?.id ?? createId()
    const reference = `cw-resource:${resource.key}`
    bindings[reference] = id
    const extension = resource.mediaType.split('/').at(-1)?.replace(/[^a-z0-9]/gi, '') || 'bin'
    edits.push({ type: 'asset.add', asset: { id, path: `assets/${id}.${extension}`, mimeType: resource.mediaType }, bytes: resource.bytes })
    if (admitted.has(resource)) urls[reference] = `data:${resource.mediaType};base64,${Buffer.from(resource.bytes).toString('base64')}`
  }
  return { edits, bindings, urls }
}
function hasSourceProgram(draft: ContentObjectDraft, definitions: Readonly<Record<string, ComponentDefinition>>): boolean {
  const implementation = draft.implementationOverride ?? definitions[draft.definitionId]?.implementation
  return implementation?.kind === 'builtin' && implementation.key === 'guoling.html-program'
    || implementation?.kind === 'source' || (draft.children ?? []).some(child => hasSourceProgram(child, definitions))
}

/** All callers share this preparation service. Only its Session port can change formal state. */
export class ContentApplyService {
  private readonly createId: () => string
  constructor(private readonly options: ContentApplyServiceOptions) { this.createId = options.createId ?? randomUUID }

  async plan(request: ContentApplyRequest, signal?: AbortSignal): Promise<ContentApplyPlan> {
    const baseProject = structuredClone(this.options.session.project())
    signal?.throwIfAborted()
    if (request.intent === 'canonical') return this.planCanonicalApply(baseProject, request, signal)
    if (!('source' in request)) return this.planSurfaceApply(baseProject, request)
    const context = request.editingContext
    const project = context ? resolveComponentPresentation(baseProject, context.surfaceId, context.stateId) : baseProject
    signal?.throwIfAborted()
    const diagnostics: ContentApplyDiagnostic[] = []
    const edits: ComponentEdit[] = []
    let drafts: ContentObjectDraft[] | undefined, unverified = false, unusable = false
    if (request.source.kind === 'html') {
      // Resolve content before admitting its original or resources. An empty
      // projection cannot turn an asset-only batch into content success.
      const inputs = request.intent === 'content' ? localHtmlInputs(project, request) : undefined
      if (request.source.original) {
        const original = request.source.original, id = this.createId()
        const extension = path.extname(original.filename).replace(/[^.a-z0-9]/gi, '') || '.html'
        edits.push({ type: 'asset.add', asset: { id, path: `assets/${id}${extension}`, filename: original.filename,
          mimeType: original.mimeType ?? 'text/html', byteLength: original.bytes.byteLength }, bytes: original.bytes })
      }
      if (request.intent === 'style') throw new Error('主题修改需要明确的样式字段，不从整页 HTML 猜测布局')
      if (request.intent === 'content') {
        for (const input of inputs!) {
          signal?.throwIfAborted()
          const instance = project.instances[input.instanceId]!
          const definition = project.definitions[instance.definitionId]
          if (definition?.implementation.kind !== 'builtin' || !['guoling.web', 'guoling.html-program'].includes(definition.implementation.key)) {
            throw new Error(`目标需要自己的专业数据 adapter：${input.instanceId}`)
          }
          const previous = dataObject(instance.data)
          if (typeof previous.html !== 'string') throw new Error(`目标没有当前 HTML 数据：${input.instanceId}`)
          const program = definition.implementation.key === 'guoling.html-program'
            || instance.implementationOverride?.kind === 'builtin' && instance.implementationOverride.key === 'guoling.html-program'
            || !!prepareMeasurementDocument({ html: input.html }).documentProgramReason
          const html = program ? input.html : preserveHtmlOuterStyle(previous.html, input.html)
          unverified ||= program
          // Do not admit resources or touch unchanged projected siblings.
          if (html === previous.html && !request.source.siblingFiles?.size) continue
          const retainedModules = previous.modules && typeof previous.modules === 'object' && !Array.isArray(previous.modules)
            ? Object.entries(previous.modules).filter((entry): entry is [string, string] => typeof entry[1] === 'string') : []
          const siblingFiles = new Map(retainedModules.map(([name, source]) => [name, new TextEncoder().encode(source)]))
          request.source.siblingFiles?.forEach((bytes, name) => siblingFiles.set(name, Uint8Array.from(bytes)))
          const prepared = await prepareContentResources({ html, siblingFiles }, this.createId)
          // A content edit keeps this instance's existing CSS. Its real font/
          // image consumers must keep their declaration when only HTML changed.
          const cssSources = typeof previous.css === 'string' ? htmlResourceSources(extractHtmlResources({
            html: `<style>${previous.css.replace(/<\/style/gi, '<\\/style')}</style>`,
          }).remoteReferences) : []
          prepared.resourceSources = [...new Map([...prepared.resourceSources, ...cssSources]
            .map(source => [`${source.usage}\0${source.url}`, source])).values()]
          const resources = resourceEdits(prepared, this.createId)
          edits.push(...resources.edits)
          diagnostics.push(...prepared.diagnostics.map(item => ({ ...item, instanceId: input.instanceId, repairable: true })))
          const add = (path: string[], value: JsonValue) => { if (!equalComponentValue(previous[path[0]!], value)) edits.push({ type: 'data.set', instanceId: input.instanceId, path, value }) }
          add(['html'], prepared.html)
          if (prepared.modules || previous.modules) add(['modules'], prepared.modules ?? {})
          const bindings = { ...dataBindings(previous), ...resources.bindings }
          if (Object.keys(bindings).length) add(['resourceBindings'], bindings)
          if (prepared.resourceSources.length || previous.resourceSources) add(['resourceSources'], prepared.resourceSources.map(({ url, usage }) => ({ url, usage })))
          if (program) {
            unverified = true
            if (definition.implementation.key === 'guoling.web' && !instance.implementationOverride) edits.push({ type: 'implementation.set', instanceId: input.instanceId,
              implementation: { kind: 'builtin', key: 'guoling.html-program' } })
          }
        }
      } else {
        const prepared = await prepareContentResources({ html: htmlForAssembly(request), siblingFiles: request.source.siblingFiles }, this.createId)
        const resources = resourceEdits(prepared, this.createId)
        edits.push(...resources.edits)
        diagnostics.push(...prepared.diagnostics.map(item => ({ ...item, repairable: true })))
        const viewport = this.designViewport(project, request)
        let assembly: HtmlAssembly
        try {
          assembly = await this.options.measure({ html: prepared.html, viewport,
            framing: htmlAssemblyFraming(request),
            themeCss: request.source.themeCss, resourceSources: prepared.resourceSources,
            resourceUrls: { ...this.options.resourceUrls?.(project, request), ...resources.urls }, signal })
        } catch (error) {
          // A failed disposable measurement is not a verdict on the author's
          // source. The existing program carrier can retain and run it; its
          // actual availability remains unverified. Cancellation still stops.
          signal?.throwIfAborted()
          if (error instanceof Error && error.name === 'AbortError') throw error
          assembly = sourceProgramAssembly(viewport, { html: prepared.html,
            ...(request.source.themeCss !== undefined ? { themeCss: request.source.themeCss } : {}) }, 'measurement-unavailable', [{
            level: 'warning', code: 'html-measurement-source-retained', repairable: true,
            message: `实测装配不可用，已保留可运行源码，运行结果待观察：${error instanceof Error ? error.message : String(error)}`,
          } as ContentApplyDiagnostic])
        }
        diagnostics.push(...assembly.diagnostics)
        const assembled = assemblyContentDraft(assembly, resources.bindings, {
          modules: prepared.modules, createFormulaId: this.createId, definitions: project.definitions, flow: this.flowBodyTarget(project, request),
          flowPage: request.intent === 'redo' && request.target.kind === 'container' && request.target.container.kind === 'surface',
        })
        drafts = assembled.drafts ?? [assembled.draft]
        const persistSources = (draft: ContentObjectDraft): void => {
          const definition = assembled.definitions.find(value => value.id === draft.definitionId) ?? project.definitions[draft.definitionId]
          if (prepared.resourceSources.length && definition?.implementation.kind === 'builtin'
            && ['guoling.web', 'guoling.html-program'].includes(definition.implementation.key)) {
            dataObject(draft.data).resourceSources = prepared.resourceSources.map(({ url, usage }) => ({ url, usage }))
          }
          draft.children?.forEach(persistSources)
        }
        drafts.forEach(persistSources)
        if (assembled.flowBackgroundColor && request.target.kind === 'container' && request.target.container.kind === 'surface') {
          const surfaceId = request.target.container.surfaceId
          const surface = project.surfaces.find(value => value.id === surfaceId)
          if (surface?.kind === 'flow' && surface.flow?.layout.paperBackgroundColor !== assembled.flowBackgroundColor) {
            const layout = surface.flow?.layout ?? { widthMode: 'fluid' as const, readingWidth: 860, wideContentWidth: 1100 }
            edits.push({ type: 'flow.set', surfaceId: surface.id, flow: { ...surface.flow,
              layout: { ...layout, paperBackgroundColor: assembled.flowBackgroundColor } } })
          }
        }
        edits.push(...assembled.definitions.map(definition => ({ type: 'definition.set' as const, definition })))
        diagnostics.push(...assembled.diagnostics)
        const definitions = { ...project.definitions, ...Object.fromEntries(assembled.definitions.map(definition => [definition.id, definition])) }
        unverified = drafts.some(draft => hasSourceProgram(draft, definitions))
      }
    }
    if (request.source.kind === 'data' && request.target.kind === 'instance'
      && request.source.fields.some(field => field.path.length === 0 || ['html', 'modules'].includes(field.path[0]!))) {
      const instance = project.instances[request.target.instanceId]
      const implementation = instance?.implementationOverride ?? (instance && project.definitions[instance.definitionId]?.implementation)
      if (implementation?.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key)) unverified = true
    }
    const sourceImplementations: Extract<ComponentImplementation, { kind: 'source' }>[] = []
    let compilationProject = project
    const compilationResources = structuredClone(this.options.session.resources?.() ?? { assets: {}, components: {} })
    if (request.source.kind === 'data' || request.source.kind === 'objects') for (const edit of request.source.componentFiles ?? []) {
      if (edit.files === null) delete compilationResources.components[edit.ownerId]
      else compilationResources.components[edit.ownerId] = structuredClone(edit.files)
    }
    if (request.source.kind === 'data' && request.source.implementation?.kind === 'source') sourceImplementations.push(request.source.implementation)
    if (request.source.kind === 'objects') {
      const definitions = { ...project.definitions, ...Object.fromEntries((request.source.definitions ?? []).map(definition => [definition.id, definition])) }
      compilationProject = { ...project, definitions }
      const visit = (draft: ContentObjectDraft) => {
        const implementation = draft.implementationOverride ?? definitions[draft.definitionId]?.implementation
        if (implementation?.kind === 'source') sourceImplementations.push(implementation)
        draft.children?.forEach(visit)
      }
      request.source.objects.forEach(visit)
    }
    const compiled = await this.compileSources(compilationProject, compilationResources, sourceImplementations, signal)
    diagnostics.push(...compiled.diagnostics)
    unusable ||= compiled.failed && request.source.kind === 'data'
    unverified ||= sourceImplementations.length > 0
    if (request.source.kind === 'objects') unverified ||= request.source.objects.some(draft => hasSourceProgram(draft, compilationProject.definitions))
    signal?.throwIfAborted()
    return planContentApply({ project: baseProject, request, createId: this.createId, drafts, edits, diagnostics, unusable, unverified })
  }

  private async compileSources(project: CourseProjectV10, resources: DocumentResources,
    implementations: Extract<ComponentImplementation, { kind: 'source' }>[], signal?: AbortSignal) {
    const diagnostics: ContentApplyDiagnostic[] = []
    let failed = false
    for (const implementation of new Map(implementations.map(value => [JSON.stringify(value), value])).values()) {
      signal?.throwIfAborted()
      try {
        const compiled = await this.options.compilation.compile(componentCompilationInput(project, implementation, resources))
        const compilationDiagnostics = compiled.status === 'ready' ? compiled.artifact.diagnostics : compiled.diagnostics
        diagnostics.push(...compilationDiagnostics.map(item => ({ level: item.severity, code: `component-${item.stage}`, message: item.message, repairable: true } as ContentApplyDiagnostic)))
        // Author source remains in the canonical operation; a failed compile is never called usable.
        failed ||= compiled.status === 'failed'
      } catch (error) {
        signal?.throwIfAborted()
        // A missing source file or unavailable compiler is a local repair input,
        // just like syntax diagnostics; it must not discard the canonical source.
        diagnostics.push({ level: 'error', code: 'component-compile', message: error instanceof Error ? error.message : String(error), repairable: true })
        failed = true
      }
    }
    return { diagnostics, failed }
  }

  private async planCanonicalApply(project: CourseProjectV10, request: CanonicalContentApplyRequest, signal?: AbortSignal): Promise<ContentApplyPlan> {
    const edits = structuredClone(request.edits), compilationProject = structuredClone(project)
    const resources = structuredClone(this.options.session.resources?.() ?? { assets: {}, components: {} })
    const sourceImplementations: Extract<ComponentImplementation, { kind: 'source' }>[] = []
    const fileOwners = new Set<string>()
    const source = (implementation: ComponentImplementation | null | undefined) => {
      if (implementation?.kind === 'source') sourceImplementations.push(implementation)
    }
    // Prepare the entire software-owned batch before resolving entries or dependencies.
    // Author source/bytes still commit together even when a local compile reports a repair.
    for (const edit of edits) {
      if (edit.type === 'definition.set') compilationProject.definitions[edit.definition.id] = edit.definition
      else if (edit.type === 'definition.remove') delete compilationProject.definitions[edit.definitionId]
      else if (edit.type === 'component.files.set') {
        fileOwners.add(edit.ownerId)
        if (edit.files === null) delete resources.components[edit.ownerId]
        else resources.components[edit.ownerId] = edit.files
      }
    }
    for (const edit of edits) {
      if (edit.type === 'definition.set') source(edit.definition.implementation)
      else if (edit.type === 'implementation.set') source(edit.implementation)
      else if (edit.type === 'instance.insert') for (const instance of edit.instances)
        source(instance.implementationOverride ?? compilationProject.definitions[instance.definitionId]?.implementation)
    }
    for (const implementation of [...Object.values(compilationProject.definitions).map(definition => definition.implementation),
      ...Object.values(compilationProject.instances).map(instance => instance.implementationOverride)].filter(Boolean)) {
      if (implementation?.kind === 'source' && implementation.workspace && fileOwners.has(implementation.workspace.ownerId)) source(implementation)
    }
    const compiled = await this.compileSources(compilationProject, resources, sourceImplementations, signal)
    signal?.throwIfAborted()
    const diagnostics = [...(request.diagnostics ?? []), ...compiled.diagnostics]
    return { command: captureComponentOperation(project, edits), input: request,
      insertedIds: edits.flatMap(edit => edit.type === 'instance.insert' ? edit.rootIds : edit.type === 'surface.insert' ? [edit.surface.id] : []),
      diagnostics, usability: compiled.failed ? 'unusable' : diagnostics.some(item => item.level !== 'info') ? 'partial' : sourceImplementations.length ? 'unverified' : 'usable' }
  }

  async apply(request: ContentApplyRequest, signal?: AbortSignal): Promise<ContentApplyResult> {
    let plan: ContentApplyPlan
    try { plan = await this.plan(request, signal) }
    catch (error) {
      return { commit: 'not_committed', usability: 'unusable', delivery: 'not_requested', input: request, insertedIds: [],
        diagnostics: [{ level: 'error', code: signal?.aborted ? 'content-apply-cancelled'
          : error instanceof NoContentTargetError ? error.code : 'content-apply-unresolved',
          message: error instanceof Error ? error.message : String(error), repairable: true }] }
    }
    if (!plan.command.edits.length) return { input: request, insertedIds: [], diagnostics: plan.diagnostics, usability: plan.usability,
      commit: 'unchanged', delivery: 'not_requested' }
    if (signal?.aborted) return { input: request, insertedIds: [], diagnostics: plan.diagnostics, usability: plan.usability,
      commit: 'not_committed', delivery: 'not_requested' }
    try {
      const receipt = await this.options.session.dispatch(plan.command, signal)
      const committed = receipt.status === 'applied' || receipt.status === 'unchanged'
      return { commit: receipt.status === 'applied' ? 'committed' : receipt.status === 'unchanged' ? 'unchanged' : 'not_committed',
        usability: committed ? plan.usability : 'unusable', delivery: 'not_requested', input: request, insertedIds: committed ? plan.insertedIds : [], receipt,
        diagnostics: 'code' in receipt ? [...plan.diagnostics, { level: 'error', code: receipt.code, message: receipt.message, repairable: true }]
          : plan.diagnostics }
    } catch (error) {
      // A transport exception cannot prove that the sole writer did not commit. Never replay here.
      return { commit: 'unknown', usability: 'unverified', delivery: 'not_requested', input: request, insertedIds: [],
        diagnostics: [...plan.diagnostics, { level: 'error', code: 'content-dispatch-failed', message: error instanceof Error ? error.message : String(error), repairable: true }] }
    }
  }

  private planSurfaceApply(project: CourseProjectV10, request: SurfaceApplyRequest): ContentApplyPlan {
    const edits: ComponentEdit[] = [], insertedIds: string[] = []
    if (request.intent === 'surface.add') {
      const index = request.beforeSurfaceId === undefined ? project.surfaces.length
        : project.surfaces.findIndex(surface => surface.id === request.beforeSurfaceId)
      if (index < 0) throw new Error('插入位置的页面已不存在')
      const surface = createCourseSurface(project, { kind: request.kind, title: request.title,
        referenceSurfaceId: request.beforeSurfaceId }, this.createId)
      edits.push({ type: 'surface.insert', surface, index }); insertedIds.push(surface.id)
    } else {
      const index = project.surfaces.findIndex(surface => surface.id === request.surfaceId)
      const surface = project.surfaces[index]
      if (!surface) throw new Error('目标页面已不存在')
      if (request.intent === 'surface.remove') {
        assertCourseSurfaceRemoval(project)
        edits.push({ type: 'surface.remove', surfaceId: surface.id })
      } else if (request.intent === 'surface.title') {
        const title = request.title.trim()
        if (surface.title !== title) edits.push({ type: 'surface.title.set', surfaceId: surface.id, title })
      } else if (request.beforeSurfaceId !== surface.id) {
        const order = project.surfaces.filter(value => value.id !== surface.id)
        const nextIndex = request.beforeSurfaceId === undefined ? order.length
          : order.findIndex(value => value.id === request.beforeSurfaceId)
        if (nextIndex < 0) throw new Error('移动位置的页面已不存在')
        if (nextIndex !== index) edits.push({ type: 'surface.move', surfaceId: surface.id, index: nextIndex })
      }
    }
    return { command: captureComponentOperation(project, edits), input: request, insertedIds,
      diagnostics: [], usability: 'usable' }
  }

  private designViewport(project: CourseProjectV10, request: ContentChangeRequest): { width: number; height: number } {
    if (request.viewport) return { width: Math.ceil(request.viewport.width), height: Math.ceil(request.viewport.height) }
    if (request.target.kind === 'instance') {
      const frame = project.instances[request.target.instanceId]?.frame
      if (frame) return { width: Math.ceil(frame.width), height: Math.ceil(frame.height) }
    } else if (request.target.container.kind === 'instance') {
      const frame = project.instances[request.target.container.instanceId]?.frame
      if (frame) return { width: Math.ceil(frame.width), height: Math.ceil(frame.height) }
    }
    const surfaceId = request.target.kind === 'container' && request.target.container.kind === 'surface' ? request.target.container.surfaceId : undefined
    const surface = project.surfaces.find(surface => surface.id === surfaceId)
    if (surface?.kind === 'flow') {
      const layout = surface.flow?.layout
      // A file application has no observed browser viewport. Measure at the authored
      // reading width, or the wider fluid viewport, and the workbench host's initial
      // 900px height. These are temporary browser inputs, never Flow designSize.
      const width = layout?.widthMode === 'fluid' ? layout.wideContentWidth : layout?.readingWidth
      return { width: Math.ceil(width ?? (layout?.widthMode === 'fluid' ? 1100 : 860)), height: 900 }
    }
    const size = surface?.designSize
    // Spatial has no page-sized designSize. A newly added world still needs a
    // temporary browser viewport; this input never becomes author geometry.
    if (!size && surface?.kind === 'spatial') return { width: 1280, height: 720 }
    if (!size) throw new Error('新建或重做范围缺少设计尺寸，未擅自采用默认画布')
    return { width: Math.ceil(size.width), height: Math.ceil(size.height) }
  }
  private flowBodyTarget(project: CourseProjectV10, request: ContentChangeRequest): boolean {
    let container: ComponentContainer | undefined = request.target.kind === 'instance'
      ? owningContainer(project, request.target.instanceId) ?? undefined : request.target.container
    while (container?.kind === 'instance') {
      const parent = project.instances[container.instanceId], definition = parent && project.definitions[parent.definitionId]
      if (definition?.implementation.kind !== 'builtin' || definition.implementation.key !== 'guoling.document-block') return false
      container = owningContainer(project, container.instanceId) ?? undefined
    }
    return container?.kind === 'surface' && project.surfaces.some(surface => surface.id === container.surfaceId && surface.kind === 'flow')
  }
}
