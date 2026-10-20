import { componentDataEdits } from '../../../core/course/componentDataEdits'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { captureComponentOperation, componentValueAt, equalComponentValue } from '../../../core/drivers/courseV10Operations'
import { assertCourseSurfaceRemoval, createCourseSurface } from '../../../core/course/courseSurfaceStructure'
import type { InMemoryComponentCompilation } from '../../../core/components/compilation/InMemoryComponentCompilation'
import { componentCompilationInput } from '../../../core/components/compilation/componentCompilationInput'
import { sourceProgramAssembly, type HtmlAssembly } from '../../../core/contentApply/assembly/htmlAssembly'
import { componentDefinitionBuiltinKey, owningContainer, resolveComponentPresentation, type ComponentContainer, type ComponentDefinition, type ComponentEdit, type ComponentImplementation, type CourseProjectV10, type JsonObject, type JsonValue } from '../../../shared/contracts/component-platform'
import { prepareContentResources, type PreparedContentResources } from './resources/contentResources'
import { extractHtmlResources, htmlResourceSources } from '../htmlImport/extractHtmlResources'
import type { HtmlDesignMeasurementRequest } from './measurement/ElectronHtmlDesignMeasurement'
import { prepareMeasurementDocument } from './measurement/prepareMeasurementDocument'
import { assemblyContentDraft, htmlAssemblyFraming, htmlForAssembly, localHtmlInputs, preserveHtmlOuterStyle } from './application/html'
import { contentTargetIds, NoContentTargetError, planContentApply } from './application/plan'
import type { CanonicalContentApplyRequest, ContentApplyDiagnostic, ContentApplyPlan, ContentApplyRequest, ContentApplyResult, ContentApplySessionPort, ContentChangeRequest, ContentObjectDraft, SurfaceApplyRequest } from './application/types'
import type { DocumentResources } from '../../../shared/workbench/document'
import { extractHtmlAuthoringRecords, type HtmlAuthoringRecords } from '../../../shared/html/htmlAuthoringRecords'
import { decodeHtmlEntities } from '../../../shared/html/htmlSourceScanner'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { textComponentDataSchema } from '../../../components/text/data'
import { readHtmlDocumentText, type DocumentHtmlNode } from '../../../shared/document/htmlText'
import { adoptFormulas } from '../../../shared/document/html'
import { courseThemeStyleText } from '../../../shared/contracts/design-v1/theme'
import { contentPlacementRegion } from '../../../core/contentApply/planning/placement'

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
/** Adopt source-owned records once; image overrides use the existing resource preparation. */
async function prepareHtmlAuthoring(html: string, siblingFiles: ReadonlyMap<string, Uint8Array> | undefined, createId: () => string,
  resourceReferences?: ReadonlyMap<string, { bytes: Uint8Array; mediaType: string }>) {
  const extracted = extractHtmlAuthoringRecords(html)
  const prepared = await prepareContentResources({ html: extracted.source, siblingFiles, resourceReferences }, createId)
  const records: HtmlAuthoringRecords = structuredClone(extracted.authoringRecords)
  const reference = async (src: string) => {
    if (!src) return src
    const attr = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    const image = await prepareContentResources({ html: `<img src="${attr}">`, siblingFiles, resourceReferences }, createId)
    prepared.resources.push(...image.resources); prepared.unresolvedResources.push(...image.unresolvedResources)
    prepared.diagnostics.push(...image.diagnostics); prepared.resourceSources.push(...image.resourceSources)
    return decodeHtmlEntities(/src="([^"]*)"/.exec(image.html)?.[1] ?? attr)
  }
  for (const record of Object.values(records)) {
    if (record.kind === 'image') record.binding.baseline = await reference(record.binding.baseline)
    if (record.overrides.src) record.overrides.src = await reference(record.overrides.src)
  }
  prepared.resources = [...new Map(prepared.resources.map(resource => [resource.key, resource])).values()]
  prepared.unresolvedResources = [...new Map(prepared.unresolvedResources.map(resource => [resource.key, resource])).values()]
  return { prepared, records }
}
/** Fold only a source change whose existing local binding still names one object. */
function reconcileSourceAuthoring(before: string, after: string, records: HtmlAuthoringRecords,
  imageIdentity: (reference: string) => string = reference => reference): { records: HtmlAuthoringRecords; unresolved: string[] } {
  type Element = DefaultTreeAdapterTypes.Element
  const root = (html: string) => parse(html).childNodes.find((node): node is Element => 'tagName' in node && node.tagName === 'html')!
  const roots = [root(before), root(after)]
  const value = (htmlRoot: Element, record: HtmlAuthoringRecords[string]): string | undefined => {
    // React's keyed runtime scope has no source DOM counterpart. Its owner must
    // provide an explicit data/region mapping; do not invent one from HTML order.
    if (Object.keys(record.scope ?? {}).some(key => !key.startsWith('dom:'))) return undefined
    let elements = [htmlRoot]
    for (const step of record.binding.path) elements = elements.flatMap(parent => parent.childNodes.filter((node): node is Element => 'tagName' in node)
      .filter(element => element.tagName === step.tag && Object.entries(step.attributes ?? {}).every(([name, text]) => {
        const actual = element.attrs.find(attribute => attribute.name === name)?.value
        return name === 'class' ? text.split(/\s+/).every(token => actual?.split(/\s+/).includes(token)) : actual === text
      })))
    elements = elements.filter(element => Object.entries(record.scope ?? {}).every(([key, expected]) => {
      const [, depth, name] = /^dom:(\d+):(.+)$/.exec(key) ?? []
      let ancestor: Element | undefined = element
      for (let at = 0; at < Number(depth); at++) ancestor = ancestor?.parentNode && 'tagName' in ancestor.parentNode ? ancestor.parentNode : undefined
      return !!ancestor && ancestor.attrs.find(attribute => attribute.name === name)?.value === expected
    }))
    if (elements.length !== 1) return undefined
    const element = elements[0]!
    if (record.kind === 'image') return element.tagName === 'img' ? element.attrs.find(attribute => attribute.name === 'src')?.value : undefined
    const text = element.childNodes.filter((node): node is DefaultTreeAdapterTypes.TextNode => node.nodeName === '#text')
    return text[record.binding.textIndex ?? 0]?.value
  }
  const next = structuredClone(records), unresolved: string[] = []
  for (const [key, record] of Object.entries(next)) {
    const old = value(roots[0]!, record), current = value(roots[1]!, record)
    if (old === undefined || current === undefined) { unresolved.push(key); continue }
    const same = (left: string, right: string) => record.kind === 'image' ? imageIdentity(left) === imageIdentity(right) : left === right
    if (!same(old, current) && same(old, record.binding.baseline)) {
      record.binding.baseline = current
      if (record.kind === 'text') delete record.overrides.text
      else delete record.overrides.src
    }
  }
  return { records: next, unresolved }
}
/** Static normalization of a known resource reference is not an author image change. */
function authoringImageIdentity(project: CourseProjectV10, prepared: PreparedContentResources,
  bindings: Record<string, string>, projectNamespace: boolean): (reference: string) => string {
  const canonical = Object.keys(project.assets).map(id => [`cw-resource:${id}`, id] as const)
  const local = Object.entries(bindings)
  const identities = new Map(projectNamespace ? [...local, ...canonical] : [...canonical, ...local])
  for (const resource of [...prepared.resources, ...prepared.unresolvedResources]) {
    const existing = resource.origins.map(origin => identities.get(origin.reference)).find(Boolean)
    if (existing) identities.set(`cw-resource:${resource.key}`, existing)
  }
  return reference => identities.has(reference) ? `asset:${identities.get(reference)}` : reference
}
function resourceEdits(prepared: PreparedContentResources, createId: () => string,
  reuse?: (reference: string) => string | undefined): { edits: ComponentEdit[]; bindings: Record<string, string>; urls: Record<string, string> } {
  const edits: ComponentEdit[] = [], bindings: Record<string, string> = {}, urls: Record<string, string> = {}
  const admitted = new Set(prepared.resources)
  const retained: PreparedContentResources['resources'] = [...prepared.resources, ...prepared.unresolvedResources]
  for (const resource of retained) {
    const existing = resource.origins.map(origin => reuse?.(origin.reference)).find(Boolean)
    const id = existing ?? resource.image?.id ?? createId()
    const reference = `cw-resource:${resource.key}`
    bindings[reference] = id
    const extension = resource.mediaType.split('/').at(-1)?.replace(/[^a-z0-9]/gi, '') || 'bin'
    if (!existing) edits.push({ type: 'asset.add', asset: { ...resource.image, id, path: `assets/${id}.${extension}`, mimeType: resource.mediaType }, bytes: resource.bytes })
    const url = admitted.has(resource) ? `data:${resource.mediaType};base64,${Buffer.from(resource.bytes).toString('base64')}` : undefined
    if (url) urls[reference] = url
    for (const origin of resource.origins) {
      const existing = reuse?.(origin.reference)
      if (!existing) continue
      bindings[origin.reference] = existing
      if (url) urls[origin.reference] = url
    }
  }
  return { edits, bindings, urls }
}
function resourceDiagnostics(prepared: PreparedContentResources, instanceId?: string): ContentApplyDiagnostic[] {
  return prepared.diagnostics.map(item => {
    const retained = item.code === 'image-resource-unavailable' ? prepared.unresolvedResources.find(resource =>
      resource.origins.some(origin => origin.reference === item.reference)) : undefined
    return { ...item, ...(retained ? { reference: `cw-resource:${retained.key}` } : {}),
      ...(instanceId ? { instanceId } : {}), repairable: true }
  })
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
    const originalRequest = request
    const surfaceId = request.target.kind === 'container' && request.target.container.kind === 'surface'
      ? request.target.container.surfaceId : undefined
    // An observed empty page has no existing object to overwrite. Its first
    // content uses the normal assembly/insert owner and captured container CAS.
    if (request.intent === 'content' && request.source.kind === 'html' && surfaceId
      && project.surfaces.some(surface => surface.id === surfaceId && surface.childIds.length === 0)) {
      request = { ...request, intent: 'insert' }
    }
    signal?.throwIfAborted()
    const diagnostics: ContentApplyDiagnostic[] = [...request.diagnostics ?? []]
    const edits: ComponentEdit[] = []
    const measurementDependencies: string[][] = []
    let drafts: ContentObjectDraft[] | undefined, unverified = false, unusable = false, preserveLayout = false
    if (request.source.kind === 'html') {
      const projectNamespace = request.source.resourceNamespace === 'project'
      const projectResources = (bindings: Record<string, string> = {}) => {
        const references = new Map(request.source.kind === 'html' ? request.source.resourceReferences : undefined)
        const bytes = this.options.session.resources?.()?.assets ?? {}
        const canonical = Object.values(project.assets).map(asset => [`cw-resource:${asset.id}`, asset.id])
        const local = Object.entries(bindings)
        for (const [reference, id] of projectNamespace ? [...local, ...canonical] : [...canonical, ...local]) {
          const asset = project.assets[id!]
          if (asset && bytes[id!]) references.set(reference!, { bytes: bytes[id!]!, mediaType: asset.mimeType ?? 'application/octet-stream' })
        }
        return references
      }
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
          if (input.unchanged) continue
          const implementation = instance.implementationOverride ?? definition?.implementation
          if (implementation?.kind === 'builtin' && implementation.key === 'guoling.text') {
            const previous = textComponentDataSchema.parse(instance.data)
            const document = parse(input.html)
            const textNode = (node: DefaultTreeAdapterTypes.Node): DefaultTreeAdapterTypes.Element | undefined =>
              'tagName' in node && node.attrs.some(attr => attr.name === 'data-text-component-content') ? node
                : 'childNodes' in node ? node.childNodes.map(textNode).find(Boolean) : undefined
            const node = textNode(document)
            if (!node) throw new Error('文字源文缺少当前正文区域，请保留正文区域或修改专业数据文件')
            const annotation = (node: DefaultTreeAdapterTypes.ChildNode): string | undefined =>
              'tagName' in node && node.tagName === 'annotation' && node.attrs.some(attr => attr.name === 'encoding' && attr.value === 'application/x-tex')
                ? node.childNodes.map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join('')
                : 'childNodes' in node ? node.childNodes.map(annotation).find(value => value !== undefined) : undefined
            const projected = (node: DefaultTreeAdapterTypes.ChildNode): DocumentHtmlNode => {
              if (!('tagName' in node)) return { kind: node.nodeName === '#comment' ? 'comment' : 'text', text: node.nodeName === '#text' ? (node as DefaultTreeAdapterTypes.TextNode).value : '' }
              const latex = node.attrs.some(attr => attr.name === 'data-formula-id') ? annotation(node) : undefined
              return { kind: 'element', tagName: node.tagName, attributes: { ...Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value])),
                ...(latex === undefined ? {} : { class: 'math' }) }, children: latex === undefined ? node.childNodes.map(projected) : [{ kind: 'text', text: `\\(${latex}\\)` }] }
            }
            const content = adoptFormulas(readHtmlDocumentText(node.childNodes.map(projected), { createFormulaId: this.createId,
              onMedia: () => { throw new Error('专业文字中的媒体应插入为独立对象，原文字与输入已保留') } })
              , previous.content)
            const value = textComponentDataSchema.parse({ ...previous, content })
            if (!equalComponentValue(instance.data, value)) edits.push(...componentDataEdits(baseProject, { instanceId: input.instanceId, surfaceId: context?.surfaceId ?? surfaceId ?? null, stateId: context?.stateId ?? null }, { kind: 'replace', data: value as unknown as JsonValue }))
            continue
          }
          const webKey = implementation?.kind === 'builtin' ? implementation.key : componentDefinitionBuiltinKey(definition)
          if (!['guoling.web', 'guoling.html-program'].includes(webKey ?? '')) {
            const key = implementation?.kind === 'builtin' ? implementation.key : definition?.professionalBuiltinKey
            const label = key === 'guoling.image' ? '图片' : definition?.title ?? key ?? '专业组件'
            throw new Error(`当前 content 目标是${label}，不是可改写的 HTML 正文。修改该对象请使用其专业数据文件或 object.update；追加标题或其他新内容请使用 intent: "insert"；明确重做当前页才使用 intent: "redo"。原对象和本次输入已保留。`)
          }
          const previous = dataObject(instance.data)
          if (typeof previous.html !== 'string') throw new Error(`目标没有当前 HTML 数据：${input.instanceId}`)
          const program = webKey === 'guoling.html-program'
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
          const { prepared, records } = await prepareHtmlAuthoring(html, siblingFiles, this.createId, projectResources(dataBindings(previous)))
          let authoringRecords = instance.authoring?.records
          if (authoringRecords && previous.html !== prepared.html) {
            const reconciled = reconcileSourceAuthoring(previous.html as string, prepared.html, authoringRecords,
              authoringImageIdentity(project, prepared, { ...dataBindings(previous), ...instance.authoring?.resourceBindings }, projectNamespace))
            authoringRecords = reconciled.records
            if (reconciled.unresolved.length) diagnostics.push({ level: 'warning', code: 'author-record-source-unmapped', instanceId: input.instanceId,
              message: '源码已保留；部分已有作者对象在源码中没有唯一对应，原作者值和几何保留，需通过该对象的正式目标续改。', repairable: true })
          }
          if (Object.keys(records).length) {
            const merged = { ...authoringRecords }
            for (const [key, incoming] of Object.entries(records)) {
              const previous = merged[key]
              const sameObject = previous && previous.kind === incoming.kind && equalComponentValue(previous.scope ?? {}, incoming.scope ?? {})
                && equalComponentValue(previous.binding, incoming.binding)
              merged[key] = sameObject ? { ...incoming, overrides: { ...previous.overrides, ...incoming.overrides,
                ...(previous.overrides.geometry || incoming.overrides.geometry ? { geometry: { ...previous.overrides.geometry, ...incoming.overrides.geometry } } : {}),
                ...(previous.overrides.style || incoming.overrides.style ? { style: { ...previous.overrides.style, ...incoming.overrides.style } } : {}) } } : incoming
            }
            authoringRecords = merged
          }
          // A content edit keeps this instance's existing CSS. Its real font/
          // image consumers must keep their declaration when only HTML changed.
          const cssSources = typeof previous.css === 'string' ? htmlResourceSources(extractHtmlResources({
            html: `<style>${previous.css.replace(/<\/style/gi, '<\\/style')}</style>`,
          }).remoteReferences) : []
          prepared.resourceSources = [...new Map([...prepared.resourceSources, ...cssSources]
            .map(source => [`${source.usage}\0${source.url}`, source])).values()]
          const resources = resourceEdits(prepared, this.createId, reference => {
            const canonicalId = reference.startsWith('cw-resource:') ? reference.slice('cw-resource:'.length) : undefined
            const id = projectNamespace && canonicalId && project.assets[canonicalId] ? canonicalId : dataBindings(previous)[reference] ?? canonicalId
            return id && project.assets[id] && this.options.session.resources?.()?.assets[id] ? id : undefined
          })
          edits.push(...resources.edits)
          diagnostics.push(...resourceDiagnostics(prepared, input.instanceId))
          const add = (path: string[], value: JsonValue) => { if (!equalComponentValue(previous[path[0]!], value)) edits.push({ type: 'data.set', instanceId: input.instanceId, path, value }) }
          add(['html'], prepared.html)
          if (authoringRecords && !equalComponentValue(instance.authoring?.records, authoringRecords)) edits.push({ type: 'authoring.set', instanceId: input.instanceId,
            path: ['records'], value: authoringRecords as unknown as JsonValue })
          // Preparation owns the executable closure, not the author's complete
          // module workspace. Unreferenced and unfinished drafts remain editable.
          if (prepared.modules || previous.modules) add(['modules'], { ...Object.fromEntries(retainedModules), ...prepared.modules })
          const bindings = { ...dataBindings(previous), ...resources.bindings }
          if (Object.keys(bindings).length) add(['resourceBindings'], bindings)
          if (prepared.resourceSources.length || previous.resourceSources) add(['resourceSources'], prepared.resourceSources.map(({ url, usage }) => ({ url, usage })))
          if (program) {
            unverified = true
            if (definition.implementation.kind === 'builtin' && definition.implementation.key === 'guoling.web' && !instance.implementationOverride) edits.push({ type: 'implementation.set', instanceId: input.instanceId,
              implementation: { kind: 'builtin', key: 'guoling.html-program' } })
          }
        }
      } else {
        const redoOwners = request.intent === 'redo' ? contentTargetIds(project, request).map(id => project.instances[id]!)
          .filter(instance => Object.keys(instance.authoring?.records ?? {}).length) : []
        const redoBindings: Record<string, string> = {}, authoringBindings: Record<string, string> = {}
        for (const instance of redoOwners) {
          const data = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : {}
          const bindings = { ...dataBindings(data), ...instance.authoring?.resourceBindings }
          for (const [reference, id] of Object.entries(bindings)) {
            if (redoBindings[reference] && redoBindings[reference] !== id) return {
              command: captureComponentOperation(baseProject, []), input: originalRequest, insertedIds: [], usability: 'partial',
              diagnostics: [...diagnostics, { level: 'warning', code: 'redo-authoring-source-retained', instanceId: instance.id, reference, repairable: true,
                message: '所选范围的作者记录使用不同资源身份解释同一引用，原程序与记录保留，尚未替换结构。请缩小到各原对象分别重做。' }] }
            redoBindings[reference] = id
          }
          Object.assign(authoringBindings, instance.authoring?.resourceBindings)
        }
        const { prepared, records } = await prepareHtmlAuthoring(htmlForAssembly(request), request.source.siblingFiles, this.createId, projectResources(redoBindings))
        if (request.intent === 'redo') {
          // Redo changes the selected structure, but is not permission to erase
          // persisted human edits. Reuse the existing source reconciliation;
          // ambiguous DOM/React bindings keep their original runnable owner.
          const retained: HtmlAuthoringRecords = {}
          for (const id of contentTargetIds(project, request)) {
            const instance = project.instances[id]!, previousRecords = instance.authoring?.records
            if (!previousRecords || !Object.keys(previousRecords).length) continue
            const previous = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : undefined
            const reconciled = typeof previous?.html === 'string' ? reconcileSourceAuthoring(previous.html, prepared.html, previousRecords,
              authoringImageIdentity(project, prepared, redoBindings, projectNamespace)) : undefined
            const conflicting = Object.keys(previousRecords).filter(key => retained[key] && !equalComponentValue(retained[key], previousRecords[key]))
            if (!reconciled || reconciled.unresolved.length || conflicting.length) {
              const references = reconciled?.unresolved.length ? reconciled.unresolved : conflicting.length ? conflicting : Object.keys(previousRecords)
              return { command: captureComponentOperation(baseProject, []), input: originalRequest, insertedIds: [], usability: 'partial',
                diagnostics: [...diagnostics, { level: 'warning', code: 'redo-authoring-source-retained', instanceId: id,
                  reference: references.slice(0, 5).join(', '), repairable: true,
                  message: '本次重做无法把既有作者记录可靠对应到新源文，原程序、作者记录与本次输入均保留，尚未替换结构。请保留记录绑定的原元素后重做，或沿原对象使用 content 局改。' }] }
            }
            Object.assign(retained, reconciled.records)
          }
          if (Object.keys(retained).length) {
            // A source wrapper can be older than the current human projection.
            // Reconciled current records retain authority for existing keys;
            // deliberate source text changes were already folded above.
            Object.assign(records, { ...records, ...retained })
            diagnostics.push({ level: 'info', code: 'redo-authoring-records-retained',
              message: '既有作者记录已沿当前元素绑定保留；重做继续使用共同程序承载，未把记录拆散或清空。' })
          }
        }
        const resources = resourceEdits(prepared, this.createId, reference => {
          const canonicalId = reference.startsWith('cw-resource:') ? reference.slice('cw-resource:'.length) : undefined
          const id = projectNamespace && canonicalId && project.assets[canonicalId] ? canonicalId : redoBindings[reference] ?? canonicalId
          return id && project.assets[id] && this.options.session.resources?.()?.assets[id] ? id : undefined
        })
        for (const [reference, id] of Object.entries(redoBindings)) if (!Object.hasOwn(resources.bindings, reference)) resources.bindings[reference] = id
        edits.push(...resources.edits)
        diagnostics.push(...resourceDiagnostics(prepared))
        const viewport = this.designViewport(project, request)
        diagnostics.push({ level: 'info', code: 'content-design-viewport',
          message: `本次按${contentPlacementRegion(request) ? '明确局部区域' : request.target.kind === 'instance' || request.target.container.kind === 'instance' ? '当前对象/容器' : '页面默认'}视口 ${viewport.width}×${viewport.height} 准备内容；采用回执提供实际对象 frame/viewport。` })
        let assembly: HtmlAssembly
        try {
          if (Object.keys(records).length) assembly = sourceProgramAssembly(viewport, { html: prepared.html,
            ...(request.source.themeCss !== undefined ? { themeCss: request.source.themeCss } : {}) }, 'persistent-html-authoring')
          else {
            // Match the runtime's live course layer without turning its current
            // rules into per-object source CSS. Only captured geometry owns this read.
            const resourceUrls = { ...this.options.resourceUrls?.(project, request), ...resources.urls }
            const assetBytes = this.options.session.resources?.()?.assets ?? {}
            const themeBindings: Record<string, string> = {}
            const themeReferences = new Map<string, string>()
            let themeAssetSerial = 0
            const themeDependencies: string[][] = [['theme'], ['designTokens']]
            for (const { assetId } of Object.values(project.theme?.assets ?? {})) {
              if (themeReferences.has(assetId)) continue
              const asset = project.assets[assetId], bytes = assetBytes[assetId]
              if (!asset) continue
              let reference: string
              do { reference = `cw-resource:theme-asset-${themeAssetSerial++}` }
              while (Object.hasOwn(resourceUrls, reference) || Object.hasOwn(resourceUrls, reference.slice('cw-resource:'.length)) || Object.hasOwn(resources.bindings, reference))
              themeReferences.set(assetId, reference)
              themeBindings[reference] = assetId
              const url = bytes ? `data:${asset.mimeType ?? 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}` : asset.remote?.url
              if (url) resourceUrls[reference] = url
              themeDependencies.push(['assets', assetId])
            }
            const courseThemeCss = courseThemeStyleText({ designTokens: project.designTokens ?? { fonts: [], colors: [] }, theme: project.theme }, id => themeReferences.get(id))
            const themeHtml = prepareMeasurementDocument({ html: '', courseThemeCss, resourceUrls }).html
            const themeSources = htmlResourceSources(extractHtmlResources({ html: themeHtml }).remoteReferences)
            assembly = await this.options.measure({ html: prepared.html, viewport,
              framing: htmlAssemblyFraming(request), courseThemeCss,
              themeCss: request.source.themeCss, resourceSources: [...prepared.resourceSources, ...themeSources], resourceUrls, signal })
            if (assembly.root.kind !== 'program' || assembly.diagnostics.some(item => item.code === 'html-program-shell-size')) {
              Object.assign(resources.bindings, themeBindings)
              measurementDependencies.push(...themeDependencies)
            }
          }
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
        const pageSurfaceId = request.target.kind === 'container' && request.target.container.kind === 'surface'
          && ['insert', 'redo'].includes(request.intent) ? request.target.container.surfaceId : undefined
        const pageSurface = pageSurfaceId ? project.surfaces.find(value => value.id === pageSurfaceId) : undefined
        const assembled = assemblyContentDraft(assembly, resources.bindings, {
          admittedResourceBindings: Object.fromEntries(Object.keys(resources.urls).map(reference => [reference, resources.bindings[reference]!])),
          modules: prepared.modules, createFormulaId: this.createId, definitions: project.definitions, flow: this.flowBodyTarget(project, request),
          flowPage: !contentPlacementRegion(request) && request.intent === 'redo' && request.target.kind === 'container' && request.target.container.kind === 'surface',
          ...(pageSurface && pageSurface.kind !== 'flow' && !contentPlacementRegion(request) ? { page: {
            ...(pageSurface.designSize ?? viewport),
            adoptBackground: request.intent === 'redo' || pageSurface.childIds.length === 0 && !pageSurface.background && !project.background,
          } } : {}),
        })
        drafts = assembled.drafts ?? [assembled.draft]
        preserveLayout = assembled.pageLayout === true
        if (Object.keys(records).length) for (const draft of drafts) draft.authoring = { records,
          ...(Object.keys(authoringBindings).length ? { resourceBindings: authoringBindings } : {}) }
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
        if (assembled.pageBackground && pageSurface) {
          if (!equalComponentValue(pageSurface.background ?? null, assembled.pageBackground)) {
            edits.push({ type: 'surface.background.set', surfaceId: pageSurface.id, background: assembled.pageBackground })
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
    const plan = planContentApply({ project: baseProject, request, createId: this.createId, drafts, edits, diagnostics, unusable, unverified, preserveLayout })
    const expectedPaths = new Set(plan.command.expected.map(value => JSON.stringify(value.path)))
    for (const path of measurementDependencies) if (!expectedPaths.has(JSON.stringify(path))) {
      expectedPaths.add(JSON.stringify(path))
      plan.command.expected.push({ path, ...structuredClone(componentValueAt(baseProject, path)) })
    }
    plan.input = originalRequest
    // Bind the diagnosed source to the identities allocated by the existing
    // planner. A later read can verify its current bytes without another state.
    const inserted = plan.command.edits.flatMap(edit => edit.type === 'instance.insert' ? edit.instances : [])
    plan.diagnostics = plan.diagnostics.flatMap(item => {
      if (item.code !== 'image-resource-unavailable' || item.instanceId || !item.reference) return [item]
      const reference = item.reference
      const owners = inserted.filter(instance => instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data)
        && dataBindings(instance.data)[reference])
      return owners.length ? owners.map(instance => ({ ...item, instanceId: instance.id })) : [item]
    })
    return plan
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
        diagnostics.push(...compilationDiagnostics.map(item => ({ level: item.severity, code: `component-${item.stage}`, message: item.message, repairable: true,
          ...(item.file !== undefined ? { file: item.file } : {}), ...(item.line !== undefined ? { line: item.line } : {}),
          ...(item.column !== undefined ? { column: item.column } : {}), ...(item.lineText !== undefined ? { lineText: item.lineText } : {}),
        } as ContentApplyDiagnostic)))
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
      const pages = 'pages' in request ? request.pages : [request]
      if (!pages.length) throw new Error('批量建页需要至少一个页面')
      const planning = structuredClone(project)
      for (const page of pages) {
        const index = page.beforeSurfaceId === undefined ? planning.surfaces.length
          : planning.surfaces.findIndex(surface => surface.id === page.beforeSurfaceId)
        if (index < 0) throw new Error('插入位置的页面已不存在')
        const surface = createCourseSurface(planning, { kind: page.kind, title: page.title,
          referenceSurfaceId: page.beforeSurfaceId }, this.createId)
        edits.push({ type: 'surface.insert', surface, index }); insertedIds.push(surface.id)
        planning.surfaces.splice(index, 0, surface)
      }
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
    const region = contentPlacementRegion(request)
    if (region) return { width: Math.ceil(region.width), height: Math.ceil(region.height) }
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
