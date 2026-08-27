import { strToU8, zip, zipSync } from 'fflate'
import { parse as parseJavaScript } from 'acorn'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import { courseProjectDocumentSchema } from '../../../shared/courseProjectSchema'
import type {
  CourseAssetMeta,
  CourseProjectDocument,
} from '../../../shared/courseProjectTypes'
import type { PublishedCourseV2Payload } from '../../../shared/publishedCourseTypes'
import { createTimezoneStableZipMtime } from '../../../shared/archiveTimestamp'
import { visitCourseProject } from '../../../shared/courseProjectModel'
import { compareStableStrings } from '../../../shared/stableOrder'
import {
  bundledFontDataUrlCss,
  bundledFontNoticeHtmlComment,
  bundledFontNoticeMarkdown,
  bundledFontPackageFiles,
  bundledFontRelativeUrlCss,
  resolveEmbeddedBundledFonts,
  withBundledFontCss,
} from '../bundledFontEmbedding'
import {
  buildPublishedCourseV2Payload,
  collectPublishedCourseAssetIds,
  collectPublishedCourseComponentKeys,
  collectPublishedCourseSourceIssues,
  type CoursePublishSources,
  type PublishedCourseSourceIssue,
} from './buildPublishedCourse'

export interface PublishedCoursePackageOptions {
  /** IIFE bundle exposing/bootstrapping the Course Player. */
  playerBundle: string
  lang?: string
  /** Defaults to the existing fully embedded, offline-portable output. */
  singleHtmlMode?: SingleHtmlExportMode
}

export type CoursePackageDelivery = 'standalone-html' | 'web-package'
export type SingleHtmlExportMode = 'offline-portable' | 'online-lightweight'

export interface CoursePackagePreflightOptions {
  singleHtmlMode?: SingleHtmlExportMode
}

export interface CoursePackageExportResources {
  assetFiles: Readonly<Record<string, Uint8Array>>
  components: Readonly<Record<string, ComponentPackageData>>
}

export interface CoursePackagePreflightItem {
  severity: 'error' | 'warning' | 'info'
  code:
    | PublishedCourseSourceIssue['code']
    | 'player-bundle-empty'
    | 'online-remote-asset'
    | 'online-remote-url-invalid'
    | 'online-connect-origin-undeclared'
    | 'online-connect-origin-unresolved'
  message: string
  path?: ReadonlyArray<string | number>
}

export interface CoursePackagePreflightReport {
  reportVersion: 1
  projectId: string
  schemaVersion: number
  delivery: CoursePackageDelivery
  generatedAt: string
  items: CoursePackagePreflightItem[]
  summary: {
    error: number
    warning: number
    info: number
    total: number
    canExport: boolean
  }
}

export interface BuildCoursePackagesResult {
  /** Relative archive paths only; no absolute machine paths. */
  manifest: string[]
  files: Record<string, Uint8Array>
  payload: PublishedCourseV2Payload
}

export const COURSE_PLAYER_CSS = `
:root{color-scheme:light;font-family:Inter,"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif;background:#f8fafc;color:#172033}
*{box-sizing:border-box}
html,body,#course-root{width:100%;height:100%;margin:0}
body{overflow:hidden;background:#f8fafc}
.course-shell{width:100%;height:100%}
.course-stage{position:relative;width:100%;height:100%;min-width:0;min-height:0;overflow:auto}
.course-surface-host{position:relative;width:100%;min-height:100%}
.flow-surface-stack{position:relative;min-height:100%;isolation:isolate}
.flow-surface{box-sizing:border-box;max-width:var(--flow-reading-width,760px);margin:0 auto;padding:48px 32px;line-height:1.75}
.flow-scoped-layer-mount{position:absolute;inset:0 auto auto 0;width:1280px;height:720px;pointer-events:none}
.flow-scoped-layer-surface{margin:0!important;background:transparent!important;pointer-events:none}
.flow-scoped-layer-surface>.slide-layer-item{pointer-events:auto}
.flow-surface img,.flow-surface video{max-width:100%;height:auto}
.flow-surface table{width:100%;border-collapse:collapse}
.flow-surface th,.flow-surface td{padding:.5rem;border:1px solid #cbd5e1;text-align:left}
.flow-surface aside{padding:.75rem 1rem;border-left:4px solid #3b82f6;background:#eff6ff}
.flow-runtime-article{pointer-events:auto;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.flow-runtime-overlay{pointer-events:none}
.spatial-surface{position:relative;display:grid;min-width:100%;min-height:100%;place-items:center;overflow:hidden;outline:none;touch-action:none;background:#f8fafc}
.spatial-surface>svg:not(.spatial-minimap){display:block;max-width:100%;max-height:100%}
.spatial-controls{position:absolute;z-index:2;left:12px;top:12px;display:flex;max-width:calc(100% - 24px);gap:6px;overflow-x:auto;padding:6px;border:1px solid #cbd5e1;border-radius:10px;background:rgba(255,255,255,.94);box-shadow:0 4px 14px rgba(15,23,42,.12)}
.spatial-controls button{flex:none;padding:6px 9px;border:1px solid #94a3b8;border-radius:7px;background:#fff;color:#172033;cursor:pointer}
.spatial-controls button:focus-visible{outline:3px solid #60a5fa;outline-offset:1px}
.spatial-minimap{position:absolute;z-index:2;right:12px;bottom:12px;border:1px solid #94a3b8;border-radius:8px;background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(15,23,42,.14)}
.slide-surface{position:relative;margin:auto;overflow:hidden;transform-origin:top left;background:#fff}
.course-player-error{display:grid;width:100%;height:100%;place-items:center;padding:32px;color:#991b1b;background:#fef2f2;text-align:center}
`.trim()

/** Archive directory of the embedded faces, and its path seen from the CSS. */
const PLAYER_FONT_DIRECTORY = 'player/fonts'
const PLAYER_FONT_URL_PREFIX = './fonts'

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'video/webm': 'webm', 'font/woff': 'woff',
  'font/woff2': 'woff2', 'font/ttf': 'ttf', 'font/otf': 'otf',
  'application/json': 'json', 'model/gltf-binary': 'glb', 'model/gltf+json': 'gltf',
  'text/plain': 'txt',
}

function summarize(items: readonly CoursePackagePreflightItem[]): CoursePackagePreflightReport['summary'] {
  const summary = { error: 0, warning: 0, info: 0, total: items.length, canExport: true }
  items.forEach(({ severity }) => { summary[severity] += 1 })
  summary.canExport = summary.error === 0
  return summary
}

interface OnlineRemoteAssetDependency {
  assetId: string
  recordKey: string
  metadata: CourseAssetMeta
  url: string
}

function onlineRemoteDeliveryMessage(dependency: OnlineRemoteAssetDependency): string {
  return `素材“${dependency.metadata.filename}”的远程地址不能用于在线轻量单 HTML：请使用不含 wildcard 的精确 HTTPS 地址（${dependency.url}）。`
}

export class OnlineSingleHtmlDeliveryError extends Error {
  readonly code = 'online-remote-url-invalid' as const
  readonly path: ReadonlyArray<string | number>

  constructor(dependency: OnlineRemoteAssetDependency) {
    super(onlineRemoteDeliveryMessage(dependency))
    this.name = 'OnlineSingleHtmlDeliveryError'
    this.path = ['assets', dependency.recordKey, 'remote', 'url']
  }
}

function findCourseAssetEntry(
  project: CourseProjectDocument,
  assetId: string,
): readonly [string, CourseAssetMeta] | undefined {
  const direct = project.assets[assetId]
  if (direct) return [assetId, direct]
  return Object.entries(project.assets).find(([, metadata]) => metadata.id === assetId)
}

function collectOnlineRemoteAssetDependencies(
  project: CourseProjectDocument,
  components: CoursePackageExportResources['components'],
): OnlineRemoteAssetDependency[] | null {
  const parsed = courseProjectDocumentSchema.safeParse(project)
  if (!parsed.success) return null

  let assetIds: Set<string>
  try {
    assetIds = collectPublishedCourseAssetIds({
      project: parsed.data,
      components,
    })
  } catch {
    return null
  }

  const dependencies: OnlineRemoteAssetDependency[] = []
  for (const assetId of [...assetIds].sort(compareStableStrings)) {
    const entry = findCourseAssetEntry(parsed.data, assetId)
    if (!entry?.[1].remote) continue
    dependencies.push({
      assetId,
      recordKey: entry[0],
      metadata: entry[1],
      url: entry[1].remote.url,
    })
  }
  return dependencies.sort((left, right) => (
    compareStableStrings(left.url, right.url)
    || compareStableStrings(left.assetId, right.assetId)
  ))
}

function exactOnlineRemoteOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:'
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.hostname.includes('*')
      || parsed.origin === 'null'
    ) {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

type ConnectApi = 'fetch' | 'WebSocket' | 'EventSource' | 'sendBeacon' | 'XMLHttpRequest.open'
type ConnectCertainty = 'exact' | 'ambiguous' | 'none'
type JavaScriptBindingKind = 'const' | 'let' | 'var' | 'function' | 'class' | 'import' | 'parameter' | 'catch'

interface PublishedConnectSource {
  label: string
  source: string
  path: ReadonlyArray<string | number>
}

interface JavaScriptNode {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

interface JavaScriptBindingDeclaration {
  kind: JavaScriptBindingKind
  node: JavaScriptNode
  initializer: JavaScriptNode | null
}

interface JavaScriptBinding {
  name: string
  scope: JavaScriptScope
  declarations: JavaScriptBindingDeclaration[]
  mutated: boolean
  xhrAlias: 'none' | 'exact' | 'ambiguous'
}

interface JavaScriptScope {
  kind: 'program' | 'function' | 'block'
  parent: JavaScriptScope | null
  functionOwner: JavaScriptScope
  bindings: Map<string, JavaScriptBinding>
}

interface JavaScriptScopeModel {
  root: JavaScriptScope
  scopeByNode: WeakMap<object, JavaScriptScope>
  bindings: JavaScriptBinding[]
  mutatedGlobals: Set<string>
  hasDynamicScope: boolean
  hasDynamicExecution: boolean
}

interface ConnectCallSite {
  api: ConnectApi
  start: number
  argument: JavaScriptNode | null
  ambiguous: boolean
}

interface ConnectCallScan {
  sites: ConnectCallSite[]
  parseFailed: boolean
  hasDynamicExecution: boolean
}

interface ConnectArgument {
  kind: 'literal' | 'unresolved'
  value?: string
}

const browserRootNames = new Set(['globalThis', 'window', 'self'])
const connectBuiltinNames = new Set([
  'fetch',
  'WebSocket',
  'EventSource',
  'navigator',
  'sendBeacon',
  'XMLHttpRequest',
])

function isJavaScriptNode(value: unknown): value is JavaScriptNode {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
}

function nodeProperty(node: JavaScriptNode, key: string): JavaScriptNode | null {
  const value = node[key]
  return isJavaScriptNode(value) ? value : null
}

function nodeArray(node: JavaScriptNode, key: string): JavaScriptNode[] {
  const value = node[key]
  return Array.isArray(value) ? value.filter(isJavaScriptNode) : []
}

function forEachJavaScriptChild(
  node: JavaScriptNode,
  visit: (child: JavaScriptNode) => void,
): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    if (isJavaScriptNode(value)) {
      visit(value)
      continue
    }
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (isJavaScriptNode(entry)) visit(entry)
    }
  }
}

function walkJavaScript(node: JavaScriptNode, visit: (current: JavaScriptNode) => void): void {
  visit(node)
  forEachJavaScriptChild(node, (child) => walkJavaScript(child, visit))
}

function parsePublishedJavaScript(source: string): JavaScriptNode | null {
  const commonOptions = {
    ecmaVersion: 'latest' as const,
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
    allowReturnOutsideFunction: true,
  }
  try {
    return parseJavaScript(source, {
      ...commonOptions,
      sourceType: 'script',
    }) as unknown as JavaScriptNode
  } catch {
    try {
      return parseJavaScript(source, {
        ...commonOptions,
        sourceType: 'module',
      }) as unknown as JavaScriptNode
    } catch {
      return null
    }
  }
}

function createJavaScriptScope(
  parent: JavaScriptScope | null,
  kind: JavaScriptScope['kind'],
): JavaScriptScope {
  const scope = {
    kind,
    parent,
    functionOwner: undefined as unknown as JavaScriptScope,
    bindings: new Map<string, JavaScriptBinding>(),
  }
  scope.functionOwner = kind === 'program' || kind === 'function'
    ? scope
    : parent!.functionOwner
  return scope
}

function nearestVariableScope(scope: JavaScriptScope): JavaScriptScope {
  let current = scope
  while (current.kind === 'block' && current.parent) current = current.parent
  return current
}

function patternIdentifiers(pattern: JavaScriptNode | null): JavaScriptNode[] {
  if (!pattern) return []
  if (pattern.type === 'Identifier') return [pattern]
  if (pattern.type === 'RestElement') {
    return patternIdentifiers(nodeProperty(pattern, 'argument'))
  }
  if (pattern.type === 'AssignmentPattern') {
    return patternIdentifiers(nodeProperty(pattern, 'left'))
  }
  if (pattern.type === 'ArrayPattern') {
    return nodeArray(pattern, 'elements').flatMap((entry) => patternIdentifiers(entry))
  }
  if (pattern.type === 'ObjectPattern') {
    return nodeArray(pattern, 'properties').flatMap((property) => {
      if (property.type === 'RestElement') return patternIdentifiers(nodeProperty(property, 'argument'))
      return patternIdentifiers(nodeProperty(property, 'value'))
    })
  }
  return []
}

function addBinding(
  model: JavaScriptScopeModel,
  scope: JavaScriptScope,
  identifier: JavaScriptNode,
  kind: JavaScriptBindingKind,
  declarationNode: JavaScriptNode,
  initializer: JavaScriptNode | null,
): JavaScriptBinding {
  const name = typeof identifier.name === 'string' ? identifier.name : ''
  const target = kind === 'var' ? nearestVariableScope(scope) : scope
  let binding = target.bindings.get(name)
  if (!binding) {
    binding = {
      name,
      scope: target,
      declarations: [],
      mutated: false,
      xhrAlias: 'none',
    }
    target.bindings.set(name, binding)
    model.bindings.push(binding)
  }
  binding.declarations.push({
    kind,
    node: declarationNode,
    initializer,
  })
  return binding
}

function addPatternBindings(
  model: JavaScriptScopeModel,
  scope: JavaScriptScope,
  pattern: JavaScriptNode | null,
  kind: JavaScriptBindingKind,
  declarationNode: JavaScriptNode,
  initializer: JavaScriptNode | null = null,
): void {
  const identifiers = patternIdentifiers(pattern)
  for (const identifier of identifiers) {
    addBinding(
      model,
      scope,
      identifier,
      kind,
      declarationNode,
      pattern?.type === 'Identifier' ? initializer : null,
    )
  }
}

function buildJavaScriptScopeModel(program: JavaScriptNode): JavaScriptScopeModel {
  const root = createJavaScriptScope(null, 'program')
  const model: JavaScriptScopeModel = {
    root,
    scopeByNode: new WeakMap<object, JavaScriptScope>(),
    bindings: [],
    mutatedGlobals: new Set<string>(),
    hasDynamicScope: false,
    hasDynamicExecution: false,
  }

  const visit = (node: JavaScriptNode, scope: JavaScriptScope): void => {
    model.scopeByNode.set(node, scope)

    if (node.type === 'Program') {
      for (const child of nodeArray(node, 'body')) visit(child, scope)
      return
    }

    if (
      node.type === 'FunctionDeclaration'
      || node.type === 'FunctionExpression'
      || node.type === 'ArrowFunctionExpression'
    ) {
      const identifier = nodeProperty(node, 'id')
      if (node.type === 'FunctionDeclaration' && identifier) {
        addPatternBindings(model, scope, identifier, 'function', node)
      }
      const functionScope = createJavaScriptScope(scope, 'function')
      if (node.type === 'FunctionExpression' && identifier) {
        addPatternBindings(model, functionScope, identifier, 'function', node)
      }
      if (identifier) model.scopeByNode.set(identifier, functionScope)
      for (const parameter of nodeArray(node, 'params')) {
        addPatternBindings(model, functionScope, parameter, 'parameter', parameter)
      }
      for (const parameter of nodeArray(node, 'params')) visit(parameter, functionScope)
      const body = nodeProperty(node, 'body')
      if (body) visit(body, functionScope)
      return
    }

    if (node.type === 'BlockStatement' || node.type === 'StaticBlock') {
      const blockScope = createJavaScriptScope(scope, 'block')
      model.scopeByNode.set(node, blockScope)
      for (const child of nodeArray(node, 'body')) visit(child, blockScope)
      return
    }

    if (node.type === 'CatchClause') {
      const catchScope = createJavaScriptScope(scope, 'block')
      model.scopeByNode.set(node, catchScope)
      const parameter = nodeProperty(node, 'param')
      if (parameter) {
        addPatternBindings(model, catchScope, parameter, 'catch', parameter)
        visit(parameter, catchScope)
      }
      const body = nodeProperty(node, 'body')
      if (body) visit(body, catchScope)
      return
    }

    if (
      node.type === 'ForStatement'
      || node.type === 'ForInStatement'
      || node.type === 'ForOfStatement'
    ) {
      const loopScope = createJavaScriptScope(scope, 'block')
      model.scopeByNode.set(node, loopScope)
      forEachJavaScriptChild(node, (child) => visit(child, loopScope))
      return
    }

    if (node.type === 'SwitchStatement') {
      const discriminant = nodeProperty(node, 'discriminant')
      if (discriminant) visit(discriminant, scope)
      const switchScope = createJavaScriptScope(scope, 'block')
      for (const switchCase of nodeArray(node, 'cases')) visit(switchCase, switchScope)
      return
    }

    if (node.type === 'VariableDeclaration') {
      const kind = node.kind === 'const' || node.kind === 'let' ? node.kind : 'var'
      for (const declaration of nodeArray(node, 'declarations')) {
        const identifier = nodeProperty(declaration, 'id')
        const initializer = nodeProperty(declaration, 'init')
        addPatternBindings(model, scope, identifier, kind, declaration, initializer)
      }
      forEachJavaScriptChild(node, (child) => visit(child, scope))
      return
    }

    if (node.type === 'ImportDeclaration') {
      for (const specifier of nodeArray(node, 'specifiers')) {
        const local = nodeProperty(specifier, 'local')
        if (local) addPatternBindings(model, scope, local, 'import', specifier)
      }
      forEachJavaScriptChild(node, (child) => visit(child, scope))
      return
    }

    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const identifier = nodeProperty(node, 'id')
      if (node.type === 'ClassDeclaration' && identifier) {
        addPatternBindings(model, scope, identifier, 'class', node)
      }
      const superClass = nodeProperty(node, 'superClass')
      if (superClass) visit(superClass, scope)
      const classScope = createJavaScriptScope(scope, 'block')
      if (identifier) addPatternBindings(model, classScope, identifier, 'class', node)
      const body = nodeProperty(node, 'body')
      if (body) visit(body, classScope)
      return
    }

    forEachJavaScriptChild(node, (child) => visit(child, scope))
  }

  visit(program, root)
  return model
}

function resolveBinding(scope: JavaScriptScope, name: string): JavaScriptBinding | null {
  let current: JavaScriptScope | null = scope
  while (current) {
    const binding = current.bindings.get(name)
    if (binding) return binding
    current = current.parent
  }
  return null
}

function unwrapChain(node: JavaScriptNode | null): JavaScriptNode | null {
  let current = node
  while (current?.type === 'ChainExpression') current = nodeProperty(current, 'expression')
  return current
}

function staticMemberName(member: JavaScriptNode): string | null {
  if (member.type !== 'MemberExpression') return null
  const property = unwrapChain(nodeProperty(member, 'property'))
  if (!property) return null
  if (!member.computed && property.type === 'Identifier') {
    return typeof property.name === 'string' ? property.name : null
  }
  if (property.type === 'Literal' && typeof property.value === 'string') return property.value
  if (property.type === 'TemplateLiteral' && nodeArray(property, 'expressions').length === 0) {
    const quasi = nodeArray(property, 'quasis')[0]
    const value = quasi?.value
    if (typeof value === 'object' && value !== null && typeof (value as { cooked?: unknown }).cooked === 'string') {
      return (value as { cooked: string }).cooked
    }
  }
  return null
}

function globalIdentifierCertainty(
  node: JavaScriptNode | null,
  name: string,
  scope: JavaScriptScope,
  model: JavaScriptScopeModel,
): ConnectCertainty {
  const current = unwrapChain(node)
  if (current?.type !== 'Identifier' || current.name !== name) return 'none'
  if (resolveBinding(scope, name)) return 'ambiguous'
  return model.hasDynamicScope || model.mutatedGlobals.has(name) ? 'ambiguous' : 'exact'
}

function globalMemberCertainty(
  node: JavaScriptNode | null,
  memberName: string,
  scope: JavaScriptScope,
  model: JavaScriptScopeModel,
): ConnectCertainty {
  const current = unwrapChain(node)
  if (current?.type !== 'MemberExpression' || staticMemberName(current) !== memberName) return 'none'
  const object = unwrapChain(nodeProperty(current, 'object'))
  if (object?.type !== 'Identifier' || !browserRootNames.has(String(object.name))) return 'none'
  const rootCertainty = globalIdentifierCertainty(object, String(object.name), scope, model)
  if (rootCertainty === 'none') return 'none'
  return rootCertainty === 'ambiguous'
    || model.mutatedGlobals.has(memberName)
    ? 'ambiguous'
    : 'exact'
}

function directGlobalApiCertainty(
  callee: JavaScriptNode | null,
  apiName: 'fetch' | 'WebSocket' | 'EventSource',
  scope: JavaScriptScope,
  model: JavaScriptScopeModel,
): ConnectCertainty {
  const direct = globalIdentifierCertainty(callee, apiName, scope, model)
  return direct !== 'none'
    ? direct
    : globalMemberCertainty(callee, apiName, scope, model)
}

function navigatorCertainty(
  node: JavaScriptNode | null,
  scope: JavaScriptScope,
  model: JavaScriptScopeModel,
): ConnectCertainty {
  const direct = globalIdentifierCertainty(node, 'navigator', scope, model)
  return direct !== 'none'
    ? direct
    : globalMemberCertainty(node, 'navigator', scope, model)
}

function xhrConstructorCertainty(
  constructor: JavaScriptNode | null,
  scope: JavaScriptScope,
  model: JavaScriptScopeModel,
): ConnectCertainty {
  const direct = globalIdentifierCertainty(constructor, 'XMLHttpRequest', scope, model)
  return direct !== 'none'
    ? direct
    : globalMemberCertainty(constructor, 'XMLHttpRequest', scope, model)
}

function xhrConstructionCertainty(
  node: JavaScriptNode | null,
  scope: JavaScriptScope,
  model: JavaScriptScopeModel,
): ConnectCertainty {
  const current = unwrapChain(node)
  if (current?.type !== 'NewExpression') return 'none'
  return xhrConstructorCertainty(nodeProperty(current, 'callee'), scope, model)
}

function isUnboundNavigatorReference(
  node: JavaScriptNode | null,
  scope: JavaScriptScope,
): boolean {
  const current = unwrapChain(node)
  if (current?.type === 'Identifier' && current.name === 'navigator') {
    return resolveBinding(scope, 'navigator') === null
  }
  if (current?.type !== 'MemberExpression' || staticMemberName(current) !== 'navigator') {
    return false
  }
  const root = unwrapChain(nodeProperty(current, 'object'))
  return root?.type === 'Identifier'
    && typeof root.name === 'string'
    && browserRootNames.has(root.name)
    && resolveBinding(scope, root.name) === null
}

function isUnboundXhrConstructorReference(
  node: JavaScriptNode | null,
  scope: JavaScriptScope,
): boolean {
  const current = unwrapChain(node)
  if (current?.type === 'Identifier' && current.name === 'XMLHttpRequest') {
    return resolveBinding(scope, 'XMLHttpRequest') === null
  }
  if (current?.type !== 'MemberExpression' || staticMemberName(current) !== 'XMLHttpRequest') {
    return false
  }
  const root = unwrapChain(nodeProperty(current, 'object'))
  return root?.type === 'Identifier'
    && typeof root.name === 'string'
    && browserRootNames.has(root.name)
    && resolveBinding(scope, root.name) === null
}

function isUnboundXhrPrototypeReference(
  node: JavaScriptNode | null,
  scope: JavaScriptScope,
): boolean {
  const current = unwrapChain(node)
  return current?.type === 'MemberExpression'
    && staticMemberName(current) === 'prototype'
    && isUnboundXhrConstructorReference(nodeProperty(current, 'object'), scope)
}

function markMutationTarget(
  target: JavaScriptNode | null,
  scope: JavaScriptScope,
  model: JavaScriptScopeModel,
): void {
  const current = unwrapChain(target)
  if (!current) return
  if (current.type === 'Identifier' && typeof current.name === 'string') {
    const binding = resolveBinding(scope, current.name)
    if (binding) {
      binding.mutated = true
    } else if (connectBuiltinNames.has(current.name) || browserRootNames.has(current.name)) {
      model.mutatedGlobals.add(current.name)
    }
    return
  }
  if (current.type === 'MemberExpression') {
    const propertyName = staticMemberName(current)
    const object = unwrapChain(nodeProperty(current, 'object'))
    if (propertyName === 'sendBeacon' && isUnboundNavigatorReference(object, scope)) {
      model.mutatedGlobals.add('sendBeacon')
    }
    if (
      (propertyName === 'prototype' && isUnboundXhrConstructorReference(object, scope))
      || (propertyName === 'open' && isUnboundXhrPrototypeReference(object, scope))
    ) {
      model.mutatedGlobals.add('XMLHttpRequest')
    }
    if (object?.type === 'Identifier' && typeof object.name === 'string') {
      const binding = resolveBinding(scope, object.name)
      if (binding && propertyName === 'open') binding.mutated = true
      if (
        !binding
        && propertyName
        && (
          browserRootNames.has(object.name)
          || (object.name === 'navigator' && propertyName === 'sendBeacon')
        )
        && (connectBuiltinNames.has(propertyName) || browserRootNames.has(propertyName))
      ) {
        model.mutatedGlobals.add(propertyName)
      }
    }
    return
  }
  if (
    current.type === 'ArrayPattern'
    || current.type === 'ObjectPattern'
    || current.type === 'AssignmentPattern'
    || current.type === 'RestElement'
  ) {
    for (const identifier of patternIdentifiers(current)) {
      markMutationTarget(identifier, scope, model)
    }
  }
}

function collectMutationFacts(program: JavaScriptNode, model: JavaScriptScopeModel): void {
  walkJavaScript(program, (node) => {
    const scope = model.scopeByNode.get(node) ?? model.root
    if (node.type === 'WithStatement') model.hasDynamicScope = true
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = unwrapChain(nodeProperty(node, 'callee'))
      const directEval = (
        node.type === 'CallExpression'
        && callee?.type === 'Identifier'
        && callee.name === 'eval'
        && !resolveBinding(scope, 'eval')
      )
      const globalEval = node.type === 'CallExpression'
        && callee?.type === 'MemberExpression'
        && staticMemberName(callee) === 'eval'
        && (() => {
          const root = unwrapChain(nodeProperty(callee, 'object'))
          return root?.type === 'Identifier'
            && typeof root.name === 'string'
            && browserRootNames.has(root.name)
            && !resolveBinding(scope, root.name)
        })()
      if (directEval) {
        model.hasDynamicScope = true
      }
      if (directEval || globalEval) {
        model.hasDynamicExecution = true
      }
      const directFunction = callee?.type === 'Identifier'
        && callee.name === 'Function'
        && !resolveBinding(scope, 'Function')
      const globalFunction = callee?.type === 'MemberExpression'
        && staticMemberName(callee) === 'Function'
        && (() => {
          const root = unwrapChain(nodeProperty(callee, 'object'))
          return root?.type === 'Identifier'
            && typeof root.name === 'string'
            && browserRootNames.has(root.name)
            && !resolveBinding(scope, root.name)
        })()
      if (directFunction || globalFunction) {
        model.hasDynamicExecution = true
      }
    }
    if (node.type === 'AssignmentExpression') {
      markMutationTarget(nodeProperty(node, 'left'), scope, model)
    } else if (node.type === 'UpdateExpression') {
      markMutationTarget(nodeProperty(node, 'argument'), scope, model)
    }
  })
}

function finalizeXhrAliases(model: JavaScriptScopeModel): void {
  for (const binding of model.bindings) {
    const xhrDeclarations = binding.declarations.map((declaration) => ({
      declaration,
      certainty: declaration.initializer
        ? xhrConstructionCertainty(
            declaration.initializer,
            model.scopeByNode.get(declaration.initializer) ?? binding.scope,
            model,
          )
        : 'none' as ConnectCertainty,
    })).filter(({ certainty }) => certainty !== 'none')
    if (xhrDeclarations.length === 0) continue
    const only = xhrDeclarations[0]!
    binding.xhrAlias = binding.declarations.length === 1
      && only.declaration.kind === 'const'
      && only.certainty === 'exact'
      && !binding.mutated
      ? 'exact'
      : 'ambiguous'
  }
}

function callArgument(node: JavaScriptNode, index: number): JavaScriptNode | null {
  return nodeArray(node, 'arguments')[index] ?? null
}

function connectCallSite(
  node: JavaScriptNode,
  model: JavaScriptScopeModel,
): ConnectCallSite | null {
  const scope = model.scopeByNode.get(node) ?? model.root

  if (node.type === 'NewExpression') {
    for (const api of ['WebSocket', 'EventSource'] as const) {
      const certainty = directGlobalApiCertainty(nodeProperty(node, 'callee'), api, scope, model)
      if (certainty !== 'none') {
        return {
          api,
          start: node.start,
          argument: callArgument(node, 0),
          ambiguous: certainty === 'ambiguous',
        }
      }
    }
    return null
  }

  if (node.type !== 'CallExpression') return null
  const callee = unwrapChain(nodeProperty(node, 'callee'))

  for (const api of ['fetch', 'WebSocket', 'EventSource'] as const) {
    const certainty = directGlobalApiCertainty(callee, api, scope, model)
    if (certainty !== 'none') {
      return {
        api,
        start: node.start,
        argument: callArgument(node, 0),
        ambiguous: certainty === 'ambiguous',
      }
    }
  }

  if (callee?.type !== 'MemberExpression') return null
  const propertyName = staticMemberName(callee)
  const object = unwrapChain(nodeProperty(callee, 'object'))

  if (propertyName === 'sendBeacon') {
    const certainty = navigatorCertainty(object, scope, model)
    if (certainty !== 'none') {
      return {
        api: 'sendBeacon',
        start: node.start,
        argument: callArgument(node, 0),
        ambiguous: certainty === 'ambiguous' || model.mutatedGlobals.has('sendBeacon'),
      }
    }
  }

  if (propertyName !== 'open') return null
  const inlineCertainty = xhrConstructionCertainty(object, scope, model)
  if (inlineCertainty !== 'none') {
    return {
      api: 'XMLHttpRequest.open',
      start: node.start,
      argument: callArgument(node, 1),
      ambiguous: inlineCertainty === 'ambiguous',
    }
  }
  if (object?.type !== 'Identifier' || typeof object.name !== 'string') return null
  const binding = resolveBinding(scope, object.name)
  if (!binding || binding.xhrAlias === 'none') return null
  const crossesFunctionBoundary = binding.scope.functionOwner !== scope.functionOwner
  return {
    api: 'XMLHttpRequest.open',
    start: node.start,
    argument: callArgument(node, 1),
    ambiguous: binding.xhrAlias !== 'exact' || crossesFunctionBoundary,
  }
}

function collectConnectCallSites(source: string): ConnectCallScan {
  const program = parsePublishedJavaScript(source)
  if (!program) return { sites: [], parseFailed: true, hasDynamicExecution: false }
  const model = buildJavaScriptScopeModel(program)
  collectMutationFacts(program, model)
  finalizeXhrAliases(model)
  const sites: ConnectCallSite[] = []
  walkJavaScript(program, (node) => {
    const site = connectCallSite(node, model)
    if (site) sites.push(site)
  })
  return {
    sites: sites.sort((left, right) => left.start - right.start || left.api.localeCompare(right.api)),
    parseFailed: false,
    hasDynamicExecution: model.hasDynamicExecution,
  }
}

function literalConnectArgument(site: ConnectCallSite): ConnectArgument {
  if (site.ambiguous || !site.argument) return { kind: 'unresolved' }
  const argument = unwrapChain(site.argument)
  if (!argument) return { kind: 'unresolved' }
  if (argument.type === 'Literal' && typeof argument.value === 'string') {
    return { kind: 'literal', value: argument.value }
  }
  if (argument.type === 'TemplateLiteral' && nodeArray(argument, 'expressions').length === 0) {
    const quasi = nodeArray(argument, 'quasis')[0]
    const value = quasi?.value
    if (typeof value === 'object' && value !== null && typeof (value as { cooked?: unknown }).cooked === 'string') {
      return { kind: 'literal', value: (value as { cooked: string }).cooked }
    }
  }
  return { kind: 'unresolved' }
}

function collectPublishedConnectSources(
  project: CourseProjectDocument,
  components: CoursePackageExportResources['components'],
): PublishedConnectSource[] {
  const parsed = courseProjectDocumentSchema.safeParse(project)
  if (!parsed.success) return []
  const sources: PublishedConnectSource[] = []
  visitCourseProject(parsed.data, {
    layerItem(item, path) {
      if (item.kind !== 'runtime' || !item.runtime.enabled) return
      sources.push({
        label: `Runtime“${item.layerItemId}”`,
        source: item.runtime.source,
        path: [...path, 'runtime', 'source'],
      })
    },
  })
  const referencedComponents = collectPublishedCourseComponentKeys(parsed.data)
  for (const [recordKey, metadata] of Object.entries(parsed.data.componentPackages)) {
    const key = `${metadata.packageId}@${metadata.version}`
    if (!referencedComponents.has(key)) continue
    const component = components[recordKey]
      ?? components[key]
      ?? components[metadata.packageId]
      ?? Object.values(components).find(({ manifest }) => (
        manifest.id === metadata.packageId && manifest.version === metadata.version
      ))
    if (!component) continue
    sources.push({
      label: `组件包“${key}”`,
      source: component.runtimeSource,
      path: ['componentPackages', recordKey, 'runtimePath'],
    })
  }
  return sources.sort((left, right) => (
    compareStableStrings(JSON.stringify(left.path), JSON.stringify(right.path))
    || compareStableStrings(left.label, right.label)
  ))
}

function collectOnlineConnectPreflightItems(
  project: CourseProjectDocument,
  components: CoursePackageExportResources['components'],
): CoursePackagePreflightItem[] {
  const declaredOrigins = new Set(
    (project.network?.connectOrigins ?? [])
      .map(exactConnectOrigin)
      .filter((origin): origin is string => origin !== null),
  )
  const items: CoursePackagePreflightItem[] = []
  for (const entry of collectPublishedConnectSources(project, components)) {
    const scan = collectConnectCallSites(entry.source)
    const missingOrigins = new Set<string>()
    let unresolved = scan.parseFailed || scan.hasDynamicExecution
    for (const site of scan.sites) {
      const argument = literalConnectArgument(site)
      if (argument.kind === 'unresolved' || !argument.value) {
        unresolved = true
        continue
      }
      let parsed: URL
      try {
        parsed = new URL(argument.value)
      } catch {
        unresolved = true
        continue
      }
      if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') continue
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'wss:')
        && parsed.username === ''
        && parsed.password === ''
        && parsed.origin !== 'null'
      ) {
        if (!declaredOrigins.has(parsed.origin)) missingOrigins.add(parsed.origin)
        continue
      }
      missingOrigins.add(argument.value)
    }
    for (const origin of [...missingOrigins].sort(compareStableStrings)) {
      items.push({
        severity: 'error',
        code: 'online-connect-origin-undeclared',
        message: `${entry.label}使用了未声明或不可声明的网络地址“${origin}”；在线轻量单 HTML 只允许工程 network.connectOrigins 中精确声明的 HTTPS/WSS origin。`,
        path: entry.path,
      })
    }
    if (unresolved) {
      items.push({
        severity: 'warning',
        code: 'online-connect-origin-unresolved',
        message: `${entry.label}包含无法静态确定 origin 的网络调用；请确认运行时地址已在 network.connectOrigins 中精确声明。`,
        path: entry.path,
      })
    }
  }
  return items
}

export function collectCoursePackageExportPreflight(
  project: CourseProjectDocument,
  delivery: CoursePackageDelivery,
  resources: CoursePackageExportResources,
  playerBundle = '',
  now = new Date(),
  options: CoursePackagePreflightOptions = {},
): CoursePackagePreflightReport {
  const items: CoursePackagePreflightItem[] = []
  if (!playerBundle.trim()) {
    items.push({
      severity: 'error',
      code: 'player-bundle-empty',
      message: 'Player Runtime 为空，无法生成课程导出物。',
    })
  }

  const sourceIssues = collectPublishedCourseSourceIssues({ project, ...resources })
  for (const issue of sourceIssues) {
    items.push({ severity: 'error', ...issue })
  }

  if (
    delivery === 'standalone-html'
    && options.singleHtmlMode === 'online-lightweight'
  ) {
    const dependencies = collectOnlineRemoteAssetDependencies(project, resources.components) ?? []
    for (const dependency of dependencies) {
      if (exactOnlineRemoteOrigin(dependency.url)) continue
      const error = new OnlineSingleHtmlDeliveryError(dependency)
      items.push({
        severity: 'error',
        code: error.code,
        path: error.path,
        message: error.message,
      })
    }
    const urls = [...new Set(dependencies.map((dependency) => dependency.url))]
      .sort(compareStableStrings)
    for (const url of urls) {
      items.push({
        severity: 'info',
        code: 'online-remote-asset',
        message: `在线轻量单 HTML 将依赖远程素材：${url}`,
      })
    }
    items.push(...collectOnlineConnectPreflightItems(project, resources.components))
  }

  const sorted = [...items].sort((left, right) => {
    const severityOrder = { error: 0, warning: 1, info: 2 }
    return severityOrder[left.severity] - severityOrder[right.severity] ||
      compareStableStrings(left.code, right.code) ||
      compareStableStrings(left.message, right.message) ||
      compareStableStrings(JSON.stringify(left.path ?? []), JSON.stringify(right.path ?? []))
  })

  return {
    reportVersion: 1,
    projectId: project.id,
    schemaVersion: project.schemaVersion,
    delivery,
    generatedAt: now.toISOString(),
    items: sorted,
    summary: summarize(sorted),
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeScript(value: string): string {
  return value
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '\\x3C!--')
    .replaceAll('https://', 'https:\\x2F\\x2F')
    .replaceAll('http://', 'http:\\x2F\\x2F')
}

function options(input: string | PublishedCoursePackageOptions): Required<PublishedCoursePackageOptions> {
  const normalized = typeof input === 'string'
    ? { playerBundle: input, lang: 'zh-CN', singleHtmlMode: 'offline-portable' as const }
    : {
      playerBundle: input.playerBundle,
      lang: input.lang ?? 'zh-CN',
      singleHtmlMode: input.singleHtmlMode ?? 'offline-portable',
    }
  if (!normalized.playerBundle.trim()) throw new Error('Player Runtime 为空，无法生成课程导出物')
  return normalized
}

function buildStandalonePayload(
  sources: CoursePublishSources,
  mode: SingleHtmlExportMode,
): PublishedCourseV2Payload {
  if (mode === 'online-lightweight') {
    const dependencies = collectOnlineRemoteAssetDependencies(
      sources.project,
      sources.components,
    )
    const invalid = dependencies?.find(
      (dependency) => exactOnlineRemoteOrigin(dependency.url) === null,
    )
    if (invalid) throw new OnlineSingleHtmlDeliveryError(invalid)
    return buildPublishedCourseV2Payload(sources, {
      projectAssetUrl(_assetId, meta) {
        return meta.remote?.url
      },
    })
  }
  return buildPublishedCourseV2Payload(sources)
}

function safeSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '')
  return normalized || 'resource'
}

function extension(mimeType: string): string {
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return EXTENSIONS[normalized] ?? 'bin'
}

function addFile(
  files: Record<string, Uint8Array>,
  path: string,
  bytes: Uint8Array,
): void {
  const parts = path.split('/')
  if (
    !path || path.startsWith('/') || path.includes('\\') || path.includes('\0') ||
    /^[A-Za-z]:/.test(path) || parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`网页包包含不安全路径：${path}`)
  }
  if (Object.hasOwn(files, path)) throw new Error(`网页包文件路径重复：${path}`)
  files[path] = bytes
}

function serializedAssignment(payload: PublishedCourseV2Payload): string {
  const serialized = JSON.stringify(payload)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `window.__H5_COURSE_PAYLOAD__=${serialized};`
}

const OFFLINE_STANDALONE_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src data: blob:; worker-src blob:"

function exactHttpsOrigin(url: string): string | null {
  return exactOnlineRemoteOrigin(url)
}

function exactConnectOrigin(value: string): string | null {
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'wss:'
      ? parsed.origin
      : null
  } catch {
    return null
  }
}

function cspSources(
  fixed: readonly string[],
  origins: ReadonlySet<string>,
): string {
  return [...fixed, ...[...origins].sort(compareStableStrings)].join(' ')
}

function onlineStandaloneCsp(
  sources: CoursePublishSources,
  payload: PublishedCourseV2Payload,
): string {
  const imageOrigins = new Set<string>()
  const mediaOrigins = new Set<string>()
  const fontOrigins = new Set<string>()
  const connectOrigins = new Set(
    (sources.project.network?.connectOrigins ?? [])
      .map(exactConnectOrigin)
      .filter((origin): origin is string => origin !== null),
  )

  for (const [assetId, asset] of Object.entries(payload.assets)) {
    const origin = exactHttpsOrigin(asset.url)
    if (!origin) continue
    const metadata = sources.project.assets[assetId]
      ?? Object.values(sources.project.assets).find((candidate) => candidate.id === assetId)
    const mimeType = asset.mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (
      mimeType.startsWith('font/')
      || mimeType === 'application/font-woff'
      || mimeType === 'application/vnd.ms-fontobject'
    ) {
      fontOrigins.add(origin)
    }
    if (mimeType.startsWith('image/') || metadata?.kind === 'image') {
      imageOrigins.add(origin)
    }
    if (
      mimeType.startsWith('audio/')
      || mimeType.startsWith('video/')
      || metadata?.kind === 'audio'
      || metadata?.kind === 'video'
    ) {
      mediaOrigins.add(origin)
    }
  }

  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'unsafe-inline'",
    `img-src ${cspSources(['data:', 'blob:'], imageOrigins)}`,
    `media-src ${cspSources(['data:', 'blob:'], mediaOrigins)}`,
    `font-src ${cspSources(['data:'], fontOrigins)}`,
    `connect-src ${cspSources(['data:', 'blob:'], connectOrigins)}`,
    'worker-src blob:',
  ].join('; ')
}

function packageIndex(payload: PublishedCourseV2Payload, lang: string): string {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src blob:">
  <title>${escapeHtml(payload.title)}</title>
  <link rel="stylesheet" href="./player/player.css">
</head>
<body>
  <div id="course-root" aria-label="${escapeHtml(payload.title)}"></div>
  <script defer src="./course-data.js"></script>
  <script defer src="./player/player.iife.js"></script>
</body>
</html>
`
}

export function buildPublishedCourseStandaloneHtml(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): string {
  const normalized = options(playerBundleOrOptions)
  const payload = buildStandalonePayload(sources, normalized.singleHtmlMode)
  const contentSecurityPolicy = normalized.singleHtmlMode === 'online-lightweight'
    ? onlineStandaloneCsp(sources, payload)
    : OFFLINE_STANDALONE_CSP
  // Only the bundled families this course declares, carried as `data:` URIs
  // because a single file has no sibling to point at. Both single-HTML modes
  // already allow `font-src data:`.
  const fonts = resolveEmbeddedBundledFonts(payload)
  return `<!doctype html>
<html lang="${escapeHtml(normalized.lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <title>${escapeHtml(payload.title)}</title>
  <style>${withBundledFontCss(COURSE_PLAYER_CSS, bundledFontDataUrlCss(fonts))}</style>${bundledFontNoticeHtmlComment(fonts)}
</head>
<body>
  <div id="course-root" aria-label="${escapeHtml(payload.title)}"></div>
  <script>${escapeScript(serializedAssignment(payload))}</script>
  <script>${escapeScript(normalized.playerBundle)}</script>
</body>
</html>
`
}

function buildPublishedCourseWebPackageBundle(
  sources: CoursePublishSources,
  normalized: Required<PublishedCoursePackageOptions>,
): { files: Record<string, Uint8Array>; payload: PublishedCourseV2Payload } {
  const files = Object.create(null) as Record<string, Uint8Array>
  const payload = buildPublishedCourseV2Payload(sources, {
    projectAssetUrl(assetId, meta, bytes) {
      const path = `assets/${String(Object.keys(files).filter((key) => key.startsWith('assets/')).length).padStart(3, '0')}-${safeSegment(assetId)}.${extension(meta.mimeType)}`
      addFile(files, path, bytes)
      return `./${path}`
    },
    componentAssetUrl(componentKey, assetKey, mimeType, bytes) {
      const directory = `component-assets/${safeSegment(componentKey)}`
      const prefix = `${directory}/`
      const path = `${prefix}${String(Object.keys(files).filter((key) => key.startsWith(prefix)).length).padStart(3, '0')}-${safeSegment(assetKey)}.${extension(mimeType)}`
      addFile(files, path, bytes)
      return `./${path}`
    },
  })
  // Only the bundled families this course declares, written as sibling files
  // next to the stylesheet that references them. `font-src 'self' data:` is
  // already in the package CSP.
  const fonts = resolveEmbeddedBundledFonts(payload)
  for (const [path, bytes] of Object.entries(
    bundledFontPackageFiles(fonts, PLAYER_FONT_DIRECTORY),
  )) {
    addFile(files, path, bytes)
  }
  addFile(files, 'course-data.js', strToU8(`${serializedAssignment(payload)}\n`))
  addFile(files, 'player/player.iife.js', strToU8(normalized.playerBundle))
  addFile(
    files,
    'player/player.css',
    strToU8(withBundledFontCss(
      COURSE_PLAYER_CSS,
      bundledFontRelativeUrlCss(fonts, PLAYER_FONT_URL_PREFIX),
    )),
  )
  addFile(files, 'index.html', strToU8(packageIndex(payload, normalized.lang)))
  // OFL 1.1 only allows shipping the bytes together with their notices.
  const notices = bundledFontNoticeMarkdown(fonts, PLAYER_FONT_DIRECTORY)
  if (notices !== '') addFile(files, 'THIRD_PARTY_NOTICES.md', strToU8(notices))
  return { files, payload }
}

/** Builds a file://-compatible package without a Base64 round-trip for binary assets. */
export function buildPublishedCourseWebPackageFiles(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): Record<string, Uint8Array> {
  const normalized = options(playerBundleOrOptions)
  return buildPublishedCourseWebPackageBundle(sources, normalized).files
}

export function buildPublishedCourseWebPackage(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): Uint8Array {
  return zipSync(buildPublishedCourseWebPackageFiles(sources, playerBundleOrOptions), {
    level: 6,
    mtime: createTimezoneStableZipMtime('1980-01-01T00:00:00.000Z'),
  })
}

export function buildPublishedCourseWebPackageAsync(
  sources: CoursePublishSources,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): Promise<Uint8Array> {
  const files = buildPublishedCourseWebPackageFiles(sources, playerBundleOrOptions)
  return new Promise((resolve, reject) => {
    zip(files, {
      level: 6,
      mtime: createTimezoneStableZipMtime('1980-01-01T00:00:00.000Z'),
    }, (error, bytes) => {
      if (error) reject(error)
      else resolve(bytes)
    })
  })
}

function manifestFromFiles(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files).sort(compareStableStrings)
}

/** Unified V2 export entry returning a relative-path file manifest. */
export function buildCoursePackages(
  sources: CoursePublishSources,
  delivery: CoursePackageDelivery,
  playerBundleOrOptions: string | PublishedCoursePackageOptions,
): BuildCoursePackagesResult {
  const normalized = options(playerBundleOrOptions)
  if (delivery === 'standalone-html') {
    const payload = buildStandalonePayload(sources, normalized.singleHtmlMode)
    const html = buildPublishedCourseStandaloneHtml(sources, normalized)
    const files = { 'index.html': strToU8(html) }
    return {
      manifest: ['index.html'],
      files,
      payload,
    }
  }
  const bundle = buildPublishedCourseWebPackageBundle(sources, normalized)
  return {
    manifest: manifestFromFiles(bundle.files),
    files: bundle.files,
    payload: bundle.payload,
  }
}
