import { parse as parseJavaScript } from 'acorn'
import { isWebDocumentDeclaration } from '../../components/source/sourceDocumentDeclaration'
import { parse, serialize, type DefaultTreeAdapterTypes } from 'parse5'
import { publishedWebImportOptionsOperation, publishedWebInitializationBinding, publishedWebInitializationExport, publishedWebInitializationSource, publishedWebRuntimeImportBinding, publishedWebRuntimeImportPreparation, webModuleResolverSource, webModuleGraphForDocument, type PublishedWebRuntimeImportPreparation, type WebRuntimeData } from '../../../components/web/moduleGraph'
import { compiledLocalParentProperty, compiledNativeChildDiagnosticProperty, unsupportedJavascriptSubmitAttribute, type CompiledClassicProgramSource } from './compiledContract'
import { compiledPreparedImportOptionsProperty, compiledScopeActiveProperty, createPreparedJavaScriptImportOptionsValidator, preparedJavaScriptNativeImportBody } from '../../../shared/browser/validatePreparedJavaScriptImportOptions'

export interface CompiledScriptDiagnostic { code: string; message: string; blocking?: false }
export interface CompiledScriptFactory { factorySource: string; diagnostics: readonly CompiledScriptDiagnostic[]; nativeReasons: readonly string[] }
type Ast = { type: string; start: number; end: number; [key: string]: any }
type Scope = { parent?: Scope; function: boolean; strict: boolean; kind?: string; catchName?: string; thisBoundary?: boolean; names: Set<string>; imports: Map<string, string> }
type Edit = { start: number; end: number; value: string }
const memberName = (node: Ast): string | undefined => node.type !== 'MemberExpression' ? undefined
  : !node.computed ? node.property.name : node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : undefined

function children(node: Ast): Ast[] {
  return Object.values(node).flatMap(value => Array.isArray(value)
    ? value.filter(item => item && typeof item.type === 'string')
    : value && typeof value === 'object' && typeof value.type === 'string' ? [value] : [])
}
function apply(source: string, edits: Edit[]): string {
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end))
    source = source.slice(0, edit.start) + edit.value + source.slice(edit.end)
  return source
}
function preparedOptionsCall(node: Ast, operation?: string): boolean {
  const callee = node.callee
  return Boolean(operation && node.type === 'CallExpression' && node.arguments.length === 1
    && callee?.type === 'MemberExpression' && memberName(callee) === operation
    && callee.object.type === 'MetaProperty' && callee.object.meta.name === 'import' && callee.object.property.name === 'meta')
}
function preparedOptionsThen(node: Ast, operation?: string): boolean {
  return node.type === 'CallExpression' && memberName(node.callee) === 'then'
    && preparedOptionsCall(node.callee.object, operation)
}
/** Only the software load subtree: esbuild may defer its actual initializer in a nested then. */
function preparedContinuationGuards(callback: Ast, assertion: string): Edit[] {
  const edits: Edit[] = [], guarded = new Set<Ast>()
  const guard = (fn: Ast): void => {
    if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(fn.type) || guarded.has(fn)) return
    guarded.add(fn)
    if (fn.body.type === 'BlockStatement') edits.push({ start: fn.body.start + 1, end: fn.body.start + 1, value: `${assertion};` })
    else edits.push({ start: fn.body.start, end: fn.body.start, value: `(${assertion},` }, { start: fn.body.end, end: fn.body.end, value: ')' })
  }
  const visit = (node: Ast): void => {
    if (node.type === 'CallExpression' && memberName(node.callee) === 'then') node.arguments.forEach(guard)
    children(node).forEach(visit)
  }
  guard(callback); visit(callback)
  return edits
}
function declarationNames(pattern: Ast | undefined): string[] {
  if (!pattern) return []
  if (pattern.type === 'Identifier') return [pattern.name]
  if (pattern.type === 'RestElement') return declarationNames(pattern.argument)
  if (pattern.type === 'AssignmentPattern') return declarationNames(pattern.left)
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(declarationNames)
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap((item: Ast) => declarationNames(item.type === 'RestElement' ? item.argument : item.value))
  return []
}

/** Lexical bindings are collected before references, including hoisted var/function declarations. */
function lexicalScopes(tree: Ast) {
  const scopes = new WeakMap<Ast, Scope>(), bindings = new WeakSet<Ast>()
  const strictDirective = (node: Ast): boolean => {
    const statements = Array.isArray(node.body) ? node.body : node.body?.body ?? []
    for (const statement of statements) { if (typeof statement.directive !== 'string') break; if (statement.directive === 'use strict') return true }
    return false
  }
  const root: Scope = { function: true, strict: tree.sourceType === 'module' || strictDirective(tree), kind: 'Program', names: new Set(), imports: new Map() }
  const bind = (pattern: Ast | undefined, scope: Scope): void => {
    if (!pattern) return
    if (pattern.type === 'Identifier') { scope.names.add(pattern.name); bindings.add(pattern); return }
    if (pattern.type === 'AssignmentPattern') { bind(pattern.left, scope); return }
    if (pattern.type === 'RestElement') { bind(pattern.argument, scope); return }
    if (pattern.type === 'ArrayPattern') { pattern.elements.forEach((item: Ast) => bind(item, scope)); return }
    if (pattern.type === 'ObjectPattern') pattern.properties.forEach((item: Ast) => bind(item.type === 'RestElement' ? item.argument : item.value, scope))
  }
  const visit = (node: Ast, inherited: Scope, parent?: Ast): void => {
    let scope = inherited
    const fn = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    // Annex B's single-statement if function has the same local block binding as its native block form.
    if (node.type === 'FunctionDeclaration' && parent?.type === 'IfStatement' && !inherited.strict)
      scope = { parent: inherited, function: false, strict: false, kind: 'ImplicitFunctionBlock', names: new Set(), imports: new Map() }
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') bind(node.id, scope)
    if (fn || ['BlockStatement', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'ClassExpression', 'ClassDeclaration', 'StaticBlock'].includes(node.type))
      scope = { parent: scope, function: fn || node.type === 'StaticBlock', strict: inherited.strict || fn && strictDirective(node) || ['ClassExpression', 'ClassDeclaration', 'StaticBlock'].includes(node.type),
        kind: node.type, catchName: node.type === 'CatchClause' && node.param?.type === 'Identifier' ? node.param.name : undefined,
        thisBoundary: fn && node.type !== 'ArrowFunctionExpression' || ['ClassExpression', 'ClassDeclaration', 'StaticBlock'].includes(node.type), names: new Set(), imports: new Map() }
    scopes.set(node, scope)
    if (fn) { if (node.type === 'FunctionExpression') bind(node.id, scope); node.params.forEach((pattern: Ast) => bind(pattern, scope)); if (node.type !== 'ArrowFunctionExpression') scope.names.add('arguments') }
    if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') bind(node.id, scope)
    if (node.type === 'CatchClause') bind(node.param, scope)
    if (node.type === 'VariableDeclaration') {
      let owner = scope
      if (node.kind === 'var') while (!owner.function && owner.parent) owner = owner.parent
      node.declarations.forEach((item: Ast) => bind(item.id, owner))
    }
    if (node.type === 'ImportDeclaration') node.specifiers.forEach((item: Ast) => bind(item.local, scope))
    children(node).forEach(child => visit(child, scope, node))
  }
  visit(tree, root)
  return { scopes, bindings, root }
}

function isReference(node: Ast, parent: Ast | undefined, bindings: WeakSet<Ast>): boolean {
  if (bindings.has(node)) return false
  if (!parent) return true
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false
  if (['Property', 'PropertyDefinition', 'MethodDefinition'].includes(parent.type) && parent.key === node && !parent.computed) return false
  if (parent.type === 'ExportSpecifier' || parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier') return false
  if (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent.type)) return false
  if (parent.type === 'MetaProperty') return false
  return true
}

// A positive description of the existing local adapter, not a promise to emulate a browser.
const localLanguageGlobals = new Set(('undefined NaN Infinity Object Array String Number Boolean BigInt Symbol Date RegExp Math JSON Promise Map Set WeakMap WeakSet Error AggregateError EvalError RangeError ReferenceError SyntaxError TypeError URIError ArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array BigInt64Array BigUint64Array Intl parseInt parseFloat isNaN isFinite encodeURI decodeURI encodeURIComponent decodeURIComponent TextEncoder TextDecoder console performance CSS').split(' '))
const localTaskGlobals = new Set('setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask'.split(' '))
const localDocumentMembers = new Set(('querySelector querySelectorAll getElementById getElementsByClassName getElementsByTagName getElementsByName createElement createElementNS createTextNode createComment createDocumentFragment addEventListener removeEventListener dispatchEvent elementFromPoint elementsFromPoint documentElement body head currentScript readyState activeElement forms images scripts links title').split(' '))
const localWindowMembers = new Set([...localLanguageGlobals, ...localTaskGlobals, 'document', 'window', 'self', 'globalThis', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'getComputedStyle', '__eventProperty'])
export function stylesRequireNativeDocument(styles: string): boolean {
  return /\b\d*\.?\d+(?:[sld]?v[whib]|vmin|vmax)\b|position\s*:\s*fixed\b|@media[^{}]*(?:width|height|orientation|aspect-ratio)/i.test(styles)
}
type LocalRootKind = 'document' | 'window' | 'node' | 'context' | 'style'
interface LocalProgramCoverage { reasons: string[]; ambientNames: string[]; windowReads: string[]; windowWrites: string[]; declarations: string[] }

/** Use the same parsed tree and lexical bindings as the actual conversion. Unknown
 * environment access chooses a native carrier before any author code executes. */
function localProgramCoverage(tree: Ast, scopes: WeakMap<Ast, Scope>, bindings: WeakSet<Ast>, root: Scope, documentGlobals: boolean): LocalProgramCoverage {
  const reasons = new Set<string>(), ambientNames = new Set<string>(), windowReads = new Set<string>(), windowWrites = new Set<string>()
  const initializers = new Map<Scope, Map<string, Ast>>(), roots = new Map<Scope, Map<string, LocalRootKind>>()
  const receivers = new Map<Scope, LocalRootKind>()
  const owner = (scope: Scope | undefined, name: string): Scope | undefined => { while (scope) { if (scope.names.has(name)) return scope; scope = scope.parent } }
  const mark = (scope: Scope, name: string, kind: LocalRootKind) => { let map = roots.get(scope); if (!map) roots.set(scope, map = new Map()); map.set(name, kind) }
  const collect = (node: Ast, parent?: Ast): void => {
    const scope = scopes.get(node) ?? root
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
      const binding = owner(scope, node.id.name) ?? scope; let map = initializers.get(binding); if (!map) initializers.set(binding, map = new Map()); map.set(node.id.name, node.init)
    }
    if (node.type === 'FunctionDeclaration' && node.id) {
      const binding = owner(scope.parent, node.id.name) ?? root; let map = initializers.get(binding); if (!map) initializers.set(binding, map = new Map()); map.set(node.id.name, node)
    }
    const mount = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
      && (node.id?.name === 'mount' || parent?.type === 'Property' && (parent.key.name ?? parent.key.value) === 'mount')
    if (mount) {
      const parameter = node.params[0]
      if (parameter?.type === 'Identifier') mark(scope, parameter.name, 'context')
      if (parameter?.type === 'ObjectPattern') for (const property of parameter.properties) if (property.type === 'Property' && (property.key.name ?? property.key.value) === 'root' && property.value.type === 'Identifier') mark(scope, property.value.name, 'node')
    }
    if(node.type==='FunctionExpression'&&parent?.type==='CallExpression'&&memberName(parent.callee)==='__eventProperty'&&parent.arguments[2]===node)receivers.set(scope,'node')
    children(node).forEach(child => collect(child, node))
  }
  collect(tree)
  const kind = (node: Ast, seen = new Set<Ast>()): LocalRootKind | undefined => {
    if (seen.has(node)) return; seen.add(node)
    const scope = scopes.get(node) ?? root
    if(node.type==='ThisExpression'&&documentGlobals){let boundary=scope;while(!boundary.thisBoundary&&boundary.parent)boundary=boundary.parent;return receivers.get(boundary)??(!boundary.strict?'window':undefined)}
    if (node.type === 'ChainExpression') return kind(node.expression, seen)
    if (node.type === 'Identifier') {
      const binding = owner(scope, node.name)
      if (!binding) return documentGlobals && node.name === 'document' ? 'document' : documentGlobals && ['window', 'self', 'globalThis'].includes(node.name) ? 'window' : undefined
      const known = roots.get(binding)?.get(node.name), init = initializers.get(binding)?.get(node.name)
      return known ?? (init && kind(init, seen))
    }
    if (node.type === 'MemberExpression') {
      const base = kind(node.object, seen), member = memberName(node)
      if (base === 'context' && member === 'root') return 'node'
      if (base === 'node' && member === 'style') return 'style'
      if (base === 'node' && member === 'ownerDocument' || base === 'window' && member === 'document') return 'document'
      if (base === 'document' && ['body', 'head', 'documentElement', 'currentScript', 'activeElement'].includes(member ?? '')) return 'node'
      if (base === 'window' && ['window', 'self', 'globalThis'].includes(member ?? '')) return 'window'
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
      const base = kind(node.callee.object, seen), member = memberName(node.callee)
      if ((base === 'document' || base === 'node') && ['querySelector', 'getElementById', 'createElement', 'createElementNS', 'createTextNode', 'createComment', 'createDocumentFragment', 'closest'].includes(member ?? '')) return 'node'
    }
    return undefined
  }
  const fixedText = (node: Ast | undefined): string | undefined => node?.type === 'Literal' && typeof node.value === 'string' ? node.value
    : node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis.map((part: Ast) => part.value.cooked).join('') : undefined
  const callback = (node: Ast | undefined, seen = new Set<Ast>()): boolean => {
    if (!node || seen.has(node)) return false; seen.add(node)
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) return true
    if (node.type !== 'Identifier') return false
    const binding = owner(scopes.get(node) ?? root, node.name), init = binding && initializers.get(binding)?.get(node.name)
    return Boolean(init && callback(init, seen))
  }
  const styleElement = (node: Ast, seen = new Set<Ast>()): boolean => {
    if(seen.has(node))return false;seen.add(node)
    if(node.type==='Identifier'){const binding=owner(scopes.get(node)??root,node.name),init=binding&&initializers.get(binding)?.get(node.name);return Boolean(init&&styleElement(init,seen))}
    return node.type==='CallExpression'&&memberName(node.callee)==='createElement'&&fixedText(node.arguments[0])==='style'&&kind(node.callee.object)==='document'
  }
  const localMarkup = (source: string): boolean => {
    const visit = (node: DefaultTreeAdapterTypes.Node): boolean => !('tagName' in node && (['script', 'iframe', 'object', 'embed'].includes(node.tagName)
      || node.attrs.some(attribute => /^on[a-z]+$/i.test(attribute.name) || javascriptNavigationAttribute(node.tagName, attribute.name) && /^\s*javascript:/i.test(attribute.value)
        || attribute.name === 'style' && stylesRequireNativeDocument(attribute.value))
      || node.tagName === 'style' && stylesRequireNativeDocument(node.childNodes.map(child=>child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join(''))))
      && (!('childNodes' in node) || node.childNodes.every(visit)) && (!('content' in node) || visit(node.content))
    return visit(parse(source))
  }
  const visit = (node: Ast, parent?: Ast): void => {
    const scope = scopes.get(node) ?? root
    if(node.type==='FunctionExpression'&&parent?.type==='CallExpression'&&memberName(parent.callee)==='addEventListener'){
      const receiver=kind(parent.callee.object);if(receiver&&['document','window','node'].includes(receiver))receivers.set(scope,receiver)
    }
    if (node.type === 'Identifier' && isReference(node, parent, bindings) && !owner(scope, node.name)) {
      if (!localLanguageGlobals.has(node.name) && !localTaskGlobals.has(node.name) && !(documentGlobals && ['document', 'window', 'self', 'globalThis'].includes(node.name))
        && !(parent?.type === 'UnaryExpression' && parent.operator === 'typeof')) ambientNames.add(node.name)
    }
    if (!documentGlobals && isWebDocumentDeclaration(node)) reasons.add('source-web-document')
    const environment = kind(node)
    if ((node.type !== 'Identifier' || isReference(node,parent,bindings)) && ['document','window'].includes(environment ?? '') && !(parent?.type === 'MemberExpression' && parent.object === node)
      && !(parent?.type === 'VariableDeclarator' && parent.init === node)
      && !(environment === 'window' && parent?.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(parent.operator))) reasons.add('environment-value')
    if (node.type === 'MemberExpression') {
      const base = kind(node.object), member = memberName(node)
      if (base === 'document' && (!member || !localDocumentMembers.has(member) && !/^on[a-z]+$/.test(member))) reasons.add(`document-member:${member ?? 'computed'}`)
      if (base === 'window') {
        if (!member) reasons.add('window-member:computed')
        else if (!localWindowMembers.has(member) && !/^on[a-z]+$/.test(member)) {
          if (parent?.type === 'AssignmentExpression' && parent.left === node && parent.operator === '=') windowWrites.add(member)
          else windowReads.add(member)
        }
      }
      if (member === 'ownerDocument' && base !== 'node') reasons.add('unknown-owner-document')
      if (['contentWindow', 'contentDocument', 'getRootNode', 'parentNode', 'parentElement'].includes(member ?? '')) reasons.add(`document-boundary:${member}`)
      if (base && ['constructor', '__proto__', 'prototype'].includes(member ?? '')) reasons.add(`reflective-environment:${member}`)
    }
    if (node.type === 'AssignmentExpression' && ['innerHTML', 'outerHTML', 'srcdoc'].includes(memberName(node.left) ?? '')) {
      const value = fixedText(node.right)
      if (value === undefined || !localMarkup(value) || memberName(node.left) !== 'innerHTML') reasons.add('dynamic-markup')
    }
    if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression'){
      const member=memberName(node.left),css=kind(node.left.object)==='style'||member==='textContent'&&styleElement(node.left.object)
      if(css){const value=fixedText(node.right);if(value!==undefined?stylesRequireNativeDocument(value):['cssText','width','height','minWidth','maxWidth','minHeight','maxHeight','position','textContent'].includes(member??''))reasons.add('document-style')}
      if(['href','action','formAction','formaction','src'].includes(member??'')){
        const value=fixedText(node.right)
        if(value===undefined||/^javascript:/i.test(value.replace(/[\u0000-\u0020]/g,'')))reasons.add('dynamic-navigation-url')
      }
    }
    if (node.type === 'CallExpression') {
      const method = node.callee.type === 'Identifier' ? node.callee.name : memberName(node.callee)
      if (['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask'].includes(method ?? '')) {
        if (!callback(node.arguments[0])) reasons.add('unknown-task-callback')
      }
      if (method === 'insertAdjacentHTML') { const value = fixedText(node.arguments[1]); if (value === undefined || !localMarkup(value)) reasons.add('dynamic-markup') }
      if (method === 'setAttribute' && ['on', 'srcdoc'].some(prefix => fixedText(node.arguments[0])?.startsWith(prefix))) reasons.add('dynamic-program-attribute')
      if(method==='setAttribute'){
        const attribute=fixedText(node.arguments[0]),value=fixedText(node.arguments[1])
        if(attribute===undefined||['href','xlink:href','action','formaction','src'].includes(attribute.toLowerCase())&&(value===undefined||/^javascript:/i.test(value.replace(/[\u0000-\u0020]/g,''))))reasons.add('dynamic-navigation-url')
      }
    }
    children(node).forEach(child => visit(child, node))
  }
  visit(tree)
  return { reasons: [...reasons], ambientNames: [...ambientNames], windowReads: [...windowReads], windowWrites: [...windowWrites], declarations: documentGlobals && tree.sourceType !== 'module' ? [...root.names] : [] }
}

function transformProgram(source: string, module: boolean, globals: string, load: string,
  resolve?: (literal: Ast) => string | undefined, trustedBuiltin = false, documentGlobals = false, preparedOperation?: string, routing = false): { body: string; exports: string; asynchronous: boolean; diagnostics: CompiledScriptDiagnostic[]; coverage: LocalProgramCoverage } {
  const diagnostics: CompiledScriptDiagnostic[] = [], edits: Edit[] = []
  let asynchronous = false
  let tree: Ast
  try { tree = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: module ? 'module' : 'script' }) as unknown as Ast }
  catch (error) { return { body: '', exports: '', asynchronous, diagnostics: [{ code: 'script-syntax', message: String(error) }], coverage: {reasons:['script-syntax'],ambientNames:[],windowReads:[],windowWrites:[],declarations:[]} } }
  const { scopes, bindings, root } = lexicalScopes(tree), getters: string[] = [], imports: string[] = []
  const coverage = trustedBuiltin ? {reasons:[],ambientNames:[],windowReads:[],windowWrites:[],declarations:[]} : localProgramCoverage(tree, scopes, bindings, root, documentGlobals)
  // Native routing needs the source facts, not a quadratic rewrite of an unused
  // framework factory. The normal compile API still produces its existing guards.
  if (routing && (coverage.reasons.length || !documentGlobals && coverage.ambientNames.length)) return {body:'',exports:'',asynchronous,diagnostics,coverage}
  const imported = (literal: Ast): string => {
    const path = resolve?.(literal)
    if (!path) diagnostics.push({ code: 'module-import', message: `未准备同文档模块依赖：${String(literal.value)}` })
    return `${load}(${JSON.stringify(path ?? String(literal.value))})`
  }
  const namespace = (name: string, expression: string) => getters.push(`Object.defineProperty(${globals}.__exports,${JSON.stringify(name)},{enumerable:true,get:()=>(${expression})});`)
  for (const statement of tree.body as Ast[]) {
    if (statement.type === 'ImportDeclaration') {
      const expression = imported(statement.source); imports.push(`${expression};`)
      for (const specifier of statement.specifiers as Ast[]) root.imports.set(specifier.local.name,
        specifier.type === 'ImportNamespaceSpecifier' ? expression : `${expression}[${JSON.stringify(specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported.name ?? specifier.imported.value)}]`)
      edits.push({ start: statement.start, end: statement.end, value: '' })
    } else if (statement.type === 'ExportNamedDeclaration') {
      if (statement.declaration) {
        const declaration = statement.declaration
        const names = declaration.type === 'VariableDeclaration' ? declaration.declarations.flatMap((item: Ast) => declarationNames(item.id)) : declarationNames(declaration.id)
        names.forEach((name: string) => namespace(name, name))
        edits.push({ start: statement.start, end: declaration.start, value: '' })
      } else {
        for (const specifier of statement.specifiers as Ast[]) namespace(specifier.exported.name ?? specifier.exported.value,
          statement.source ? `${imported(statement.source)}[${JSON.stringify(specifier.local.name ?? specifier.local.value)}]` : root.imports.get(specifier.local.name) ?? specifier.local.name)
        if (statement.source) imports.push(`${imported(statement.source)};`)
        edits.push({ start: statement.start, end: statement.end, value: '' })
      }
    } else if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = statement.declaration
      const name = declaration.id?.name ?? `${globals}_default`
      namespace('default', name)
      edits.push({ start: statement.start, end: declaration.start, value: declaration.id ? '' : `const ${name}=` })
      if (!declaration.id && ['FunctionDeclaration', 'ClassDeclaration'].includes(declaration.type)) edits.push({ start: declaration.end, end: declaration.end, value: ';' })
    } else if (statement.type === 'ExportAllDeclaration') {
      const expression = imported(statement.source); imports.push(`${expression};`)
      if (statement.exported) namespace(statement.exported.name ?? statement.exported.value, expression)
      else getters.push(`for(const key of Object.keys(${expression}))if(key!=='default'&&!Object.hasOwn(${globals}.__exports,key))Object.defineProperty(${globals}.__exports,key,{enumerable:true,get:()=>${expression}[key]});`)
      edits.push({ start: statement.start, end: statement.end, value: '' })
    }
  }
  const owner = (scope: Scope | undefined, name: string): Scope | undefined => {
    while (scope) { if (scope.names.has(name)) return scope; scope = scope.parent }
    return undefined
  }
  const varOwner = (scope: Scope): Scope => { while (!scope.function && scope.parent) scope = scope.parent; return scope }
  const variables = new Set<string>(), functions: string[] = [], rootFunctions = new WeakSet<Ast>(), annexFunctions = new WeakSet<Ast>(), annexNames = new Set<string>()
  const lexicalNames = !module && documentGlobals ? (tree.body as Ast[]).flatMap(statement => statement.type === 'VariableDeclaration' && statement.kind !== 'var'
    ? statement.declarations.flatMap((item: Ast) => declarationNames(item.id)) : statement.type === 'ClassDeclaration' ? declarationNames(statement.id) : []) : []
  if (!module && documentGlobals) {
    const lexical = new Set<string>(lexicalNames)
    const collect = (node: Ast, parent?: Ast): void => {
      const scope = scopes.get(node) ?? root
      if (node.type === 'VariableDeclaration' && node.kind === 'var' && varOwner(scope) === root)
        node.declarations.forEach((declaration: Ast) => declarationNames(declaration.id).forEach(name => variables.add(name)))
      if (node.type === 'FunctionDeclaration') {
        const declaring = scope.parent!
        if (declaring === root && (parent === tree || parent?.type === 'LabeledStatement')) {
          rootFunctions.add(node); variables.add(node.id.name)
        } else if (!declaring.strict && varOwner(declaring) === root && !lexical.has(node.id.name)) {
          let outer = declaring.parent, eligible = true
          while (outer && outer !== root) {
            if (outer.names.has(node.id.name) && !(outer.kind === 'CatchClause' && outer.catchName === node.id.name)) eligible = false
            outer = outer.parent
          }
          if (eligible) { annexFunctions.add(node); annexNames.add(node.id.name) }
        }
      }
      children(node).forEach(child => collect(child, node))
    }
    collect(tree)
  }
  const skipped = (node: Ast) => edits.some(edit => edit.end > edit.start && edit.start <= node.start && edit.end >= node.end)
  const patternTarget = (node: Ast, scope: Scope): string => {
    if (node.type === 'Identifier') {
      const binding = owner(scope, node.name)
      return documentGlobals && !module && binding === root && variables.has(node.name) ? `${globals}.__classicWindow[${JSON.stringify(node.name)}]`
        : binding?.imports.get(node.name) ?? (!binding ? `${globals}[${JSON.stringify(node.name)}]` : node.name)
    }
    if (node.type === 'RestElement') return `...${patternTarget(node.argument, scope)}`
    if (node.type === 'AssignmentPattern') return `${patternTarget(node.left, scope)}=${transformExpression(node.right)}`
    if (node.type === 'ArrayPattern') return `[${node.elements.map((item: Ast | null) => item ? patternTarget(item, scope) : '').join(',')}${node.elements.at(-1) === null ? ',' : ''}]`
    if (node.type === 'ObjectPattern') return `{${node.properties.map((property: Ast) => property.type === 'RestElement' ? patternTarget(property, scope)
      : `${property.computed ? `[${transformExpression(property.key)}]` : source.slice(property.key.start, property.key.end)}:${patternTarget(property.value, scope)}`).join(',')}}`
    return transformExpression(node)
  }
  const visit = (node: Ast, parent?: Ast): void => {
    if (skipped(node)) return
    const scope = scopes.get(node) ?? root
    if (documentGlobals && !module && node.type === 'FunctionDeclaration' && parent && rootFunctions.has(node)) {
      functions.push(`${globals}.__setClassicFunction(${JSON.stringify(node.id.name)},(${transformExpression(node)}));`)
      edits.push({ start: node.start, end: node.end, value: parent === tree ? '' : ';' }); return
    }
    if (documentGlobals && !module && node.type === 'FunctionDeclaration' && parent
      && (annexFunctions.has(node) || scope.parent?.kind === 'ImplicitFunctionBlock')) {
      const declaration = transformExpression(node), assignment = annexFunctions.has(node)
        ? `;if(${globals}_annex.has(${JSON.stringify(node.id.name)}))${globals}.__classicWindow[${JSON.stringify(node.id.name)}]=${node.id.name};` : ''
      edits.push({ start: node.start, end: node.end, value: scope.parent?.kind === 'ImplicitFunctionBlock' ? `{${declaration}${assignment}}` : `${declaration}${assignment}` }); return
    }
    if (documentGlobals && !module && node.type === 'VariableDeclaration' && node.kind === 'var' && varOwner(scope) === root) {
      const target = (declaration: Ast): string => patternTarget(declaration.id, scope)
      const assignment = (declaration: Ast): string => {
        const text = `${target(declaration)}=(${transformExpression(declaration.init)})`
        return declaration.id.type === 'ObjectPattern' ? `(${text})` : text
      }
      let value: string
      if (parent?.type === 'ForInStatement' || parent?.type === 'ForOfStatement') {
        const declaration = node.declarations[0]
        value = target(declaration)
        // Sloppy for(var name=initial in object) evaluates its initializer before the RHS.
        if (declaration.init) edits.push({ start: parent.right.start, end: parent.right.end,
          value: `(${assignment(declaration)},(${transformExpression(parent.right)}))` })
      } else {
        value = node.declarations.filter((item: Ast) => item.init).map(assignment).join(',')
        if (parent?.type !== 'ForStatement') value += ';'
      }
      edits.push({ start: node.start, end: node.end, value }); return
    }
    if (documentGlobals && node.type === 'AssignmentExpression' && ['ArrayPattern', 'ObjectPattern'].includes(node.left.type)) {
      edits.push({ start: node.start, end: node.end, value: `(${patternTarget(node.left, scope)}${node.operator}(${transformExpression(node.right)}))` }); return
    }
    if (documentGlobals && ['ForInStatement', 'ForOfStatement'].includes(node.type) && ['ArrayPattern', 'ObjectPattern'].includes(node.left.type))
      edits.push({ start: node.left.start, end: node.left.end, value: patternTarget(node.left, scope) })
    if (documentGlobals && node.type === 'UnaryExpression' && node.argument.type === 'Identifier') {
      const binding = owner(scope, node.argument.name)
      if (node.operator === 'typeof' && !binding || node.operator === 'delete' && (!binding || binding === root && !module)) {
        edits.push({ start: node.start, end: node.end, value: `${globals}.${node.operator === 'typeof' ? '__classicTypeof' : '__classicDelete'}(${JSON.stringify(node.argument.name)})` }); return
      }
    }
    if (documentGlobals && preparedOptionsThen(node, preparedOperation)) {
      const operation = node.callee.object, helper = `${globals}[${JSON.stringify(compiledPreparedImportOptionsProperty)}]`
      edits.push({ start: operation.callee.start, end: operation.callee.end, value: `${helper}.validate` })
      operation.arguments.forEach((argument: Ast) => visit(argument, operation))
      node.arguments.forEach((callback: Ast) => {
        visit(callback, node)
        edits.push(...preparedContinuationGuards(callback, `${helper}.assertActive()`))
      })
      return
    }
    if (node.type === 'Identifier' && isReference(node, parent, bindings)) {
      const binding = owner(scope, node.name), expression = documentGlobals && !module && binding === root && variables.has(node.name)
        ? `${globals}.__classicWindow[${JSON.stringify(node.name)}]` : binding?.imports.get(node.name) ?? (!binding ? `${globals}[${JSON.stringify(node.name)}]` : undefined)
      const bareCall = parent?.type === 'CallExpression' && parent.callee === node || parent?.type === 'TaggedTemplateExpression' && parent.tag === node
      if (expression) edits.push({ start: node.start, end: node.end,
        value: parent?.type === 'Property' && parent.shorthand ? `${node.name}:${expression}` : bareCall ? `(0,${expression})` : expression })
      if (!binding && (['Worker', 'SharedWorker'].includes(node.name) || !trustedBuiltin && ['eval', 'Function'].includes(node.name))) diagnostics.push({ code: 'dynamic-program', message: `同文档发布尚不能保真 ${node.name} 动态程序；源码已保留`,
        ...(documentGlobals ? { blocking: false as const } : {}) })
    } else if (node.type === 'ThisExpression') {
      let current: Scope | undefined = scope
      while (current && current !== root && !current.thisBoundary) current = current.parent
      if (current === root) edits.push({ start: node.start, end: node.end, value: module ? 'undefined' : documentGlobals ? `${globals}.__classicWindow` : `${globals}.window` })
      else if (documentGlobals && current && !current.strict) edits.push({ start: node.start, end: node.end, value: `${globals}.__classicNormalizeThis(this)` })
    } else if (node.type === 'ImportExpression' && documentGlobals) {
      // Keep an untriggered request from disabling the rest of this Web bundle.
      // Arguments stay in their original await/yield context; no native outer-URL import remains.
      const args = [transformExpression(node.source), ...(node.options ? [transformExpression(node.options)] : [])]
      edits.push({ start: node.start, end: node.end, value: `${globals}.__unsupportedDynamicImport(${args.join(',')})` })
      diagnostics.push({ code: 'dynamic-module', message: '动态 import() 的运行时请求尚未闭合；调用时将明确拒绝，原源码保留', blocking: false })
      return
    } else if (node.type === 'ImportExpression' || node.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta') {
      diagnostics.push({ code: 'dynamic-module', message: `同文档发布尚不能保真 ${node.type === 'ImportExpression' ? '动态 import()' : 'import.meta'}；源码已保留` })
    } else if (node.type === 'AwaitExpression' || node.type === 'ForOfStatement' && node.await) {
      let current: Scope | undefined = scope
      while (current && current !== root && !current.function) current = current.parent
      if (current === root) asynchronous = true
    }
    if (!trustedBuiltin && node.type === 'CallExpression' && memberName(node.callee) === 'submit') {
      const optionalAccess = Boolean(node.callee.optional), optionalCall = Boolean(node.optional)
      edits.push({ start: node.start, end: node.end, value: `${globals}.__submitMethod(${transformExpression(node.callee.object)},${optionalAccess},${optionalCall})${optionalAccess || optionalCall ? '?.' : ''}(${node.arguments.map((argument: Ast) => transformExpression(argument)).join(',')})` })
      return
    }
    const member = memberName(node)
    if (member && (['Worker', 'SharedWorker'].includes(member) || !trustedBuiltin && ['eval', 'Function'].includes(member))
      && node.object.type === 'Identifier' && ['window', 'self', 'globalThis'].includes(node.object.name) && !owner(scope, node.object.name))
      diagnostics.push({ code: 'dynamic-program', message: `同文档发布尚不能保真 ${node.object.name}.${member} 动态程序；源码已保留`,
        ...(documentGlobals ? { blocking: false as const } : {}) })
    if (member && ['addEventListener', 'removeEventListener'].includes(member)) {
      const inner = transformExpression(node.object)
      edits.push({ start: node.start, end: node.end, value: `${globals}.__eventMethod(${inner},${JSON.stringify(member)})` })
      return
    }
    if (member === 'ownerDocument') {
      edits.push({ start: node.start, end: node.end, value: `${globals}.__ownerDocument(${transformExpression(node.object)})` })
      return
    }
    if (!trustedBuiltin && (member === 'contentWindow' || member === 'contentDocument')) {
      edits.push({ start: node.start, end: node.end, value: `${globals}.__nativeChild(${transformExpression(node.object)})${node.optional ? '?.' : '.'}${member}` })
      return
    }
    const eventName = node.type === 'AssignmentExpression' ? memberName(node.left) : undefined
    if (node.type === 'AssignmentExpression' && node.operator === '=' && eventName && /^on[a-z]+$/.test(eventName)) {
      edits.push({ start: node.start, end: node.end, value: `${globals}.__eventProperty(${transformExpression(node.left.object)},${JSON.stringify(eventName)},${transformExpression(node.right)})` })
      return
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed && ['write', 'writeln', 'open', 'close'].includes(node.callee.property.name)
      && node.callee.object.type === 'Identifier' && node.callee.object.name === 'document' && !owner(scope, 'document'))
      diagnostics.push({ code: 'document-parser', message: `同文档发布尚不能保真 document.${node.callee.property.name}() 的解析器行为；源码已保留`, ...(documentGlobals ? { blocking: false as const } : {}) })
    if (node.type === 'CallExpression' && node.arguments[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string'
      && (node.callee.type === 'Identifier' && ['setTimeout', 'setInterval'].includes(node.callee.name) && !owner(scope, node.callee.name)
        || node.callee.type === 'MemberExpression' && !node.callee.computed && ['setTimeout', 'setInterval'].includes(node.callee.property.name)
          && node.callee.object.type === 'Identifier' && ['window', 'self', 'globalThis'].includes(node.callee.object.name) && !owner(scope, node.callee.object.name)))
      diagnostics.push({ code: 'string-timer', message: '同文档发布尚不能保真字符串计时器的动态全局源码；源码已保留', ...(documentGlobals ? { blocking: false as const } : {}) })
    children(node).forEach(child => visit(child, node))
  }
  const transformExpression = (node: Ast): string => {
    const before = edits.length
    visit(node)
    const nested = edits.splice(before).map(edit => ({ ...edit, start: edit.start - node.start, end: edit.end - node.start }))
    return apply(source.slice(node.start, node.end), nested)
  }
  visit(tree)
  const classicGlobals: string[] = []
  if (!module && documentGlobals) {
    const functionNames = (tree.body as Ast[]).flatMap(statement => statement.type === 'FunctionDeclaration' ? [statement.id.name]
      : statement.type === 'LabeledStatement' ? (() => { let item = statement.body; while (item.type === 'LabeledStatement') item = item.body; return rootFunctions.has(item) ? [item.id.name] : [] })() : [])
    classicGlobals.push(`const ${globals}_annex=${globals}.__activateClassicDeclarations(${JSON.stringify([...variables])},[${lexicalNames.map(name => `[${JSON.stringify(name)},()=>${name},${globals}_value=>(${name}=${globals}_value)]`).join(',')}],${JSON.stringify(functionNames)},${JSON.stringify([...annexNames])});`)
    classicGlobals.push(...functions)
  }
  const transformed = apply(source, edits)
  let directiveEnd = 0
  for (const statement of tree.body as Ast[]) { if (statement.type === 'ExpressionStatement' && typeof statement.directive === 'string') directiveEnd = statement.end; else break }
  return { body: imports.join('') + transformed.slice(0, directiveEnd) + (directiveEnd ? ';\n' : '') + classicGlobals.join('') + transformed.slice(directiveEnd), exports: getters.join(''), asynchronous, diagnostics, coverage }
}

function identifiers(source: string): string {
  let name = '__guoling_compiled'
  // This is only choosing a private lexical name; source transformations use the AST.
  while (source.includes(name)) name += '_'
  return name
}

function javascriptNavigationAttribute(tag: string, attribute: string): boolean {
  return attribute === 'href' && ['a', 'area'].includes(tag)
    || attribute === 'action' && tag === 'form'
    || attribute === 'formaction' && ['button', 'input'].includes(tag)
    || attribute === 'src' && tag === 'iframe'
}

function inertJavascriptUrl(value: string): boolean {
  try {
    const tree = parseJavaScript(value.slice(value.indexOf(':') + 1), { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as Ast
    const expression = tree.body.length === 1 && tree.body[0].type === 'ExpressionStatement' ? tree.body[0].expression : undefined
    return expression?.type === 'UnaryExpression' && expression.operator === 'void' && expression.argument.type === 'Literal'
      && expression.argument.value === 0
  } catch { return false }
}

function scriptKind(attrs: Record<string, string>): { module: boolean; executable: boolean } {
  const type = (attrs.type ?? (attrs.language ? `text/${attrs.language}` : 'text/javascript')).trim().toLowerCase()
  const module = type === 'module'
  return { module, executable: (module || !Object.hasOwn(attrs, 'nomodule')) && (module || !type || /^(?:(?:application|text)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/.test(type)) }
}

function unsupportedNativeAncestor(source: string, globals: ReadonlySet<string>, handler = false, independent = false, module = false): boolean {
  let tree: Ast
  try { tree = parseJavaScript(handler ? `function handler(event){${source}\n}` : source, { ecmaVersion: 'latest', sourceType: module ? 'module' : 'script' }) as unknown as Ast }
  catch { return false }
  const { scopes, bindings, root } = lexicalScopes(tree)
  const free = (node: Ast, name: string): boolean => {
    let scope = scopes.get(node)
    while (scope) {
      if (scope.names.has(name) && !(scope === root && ['top', 'window'].includes(name))) return false
      scope = scope.parent
    }
    return !globals.has(name)
  }
  const globalMember = (node: Ast, name: string): boolean => memberName(node) === name && node.object.type === 'Identifier'
    && ['window', 'self', 'globalThis'].includes(node.object.name) && free(node, node.object.name)
  const frame = (node: Ast): boolean => node.type === 'Identifier' && node.name === 'frameElement' && free(node, node.name) || globalMember(node, 'frameElement')
  const visit = (node: Ast, parent?: Ast): boolean => independent && (node.type === 'Identifier' && ['parent','frameElement'].includes(node.name) && isReference(node,parent,bindings) && free(node,node.name) || globalMember(node,'parent') || frame(node))
    || node.type === 'Identifier' && node.name === 'top' && isReference(node, parent, bindings) && free(node, node.name)
    || globalMember(node, 'top') || memberName(node) === 'ownerDocument' && frame(node.object)
    || children(node).some(child => visit(child, node))
  return visit(tree)
}

/** Project only surviving, free ancestor accesses in the actual delivered ESM.
 * A throwing member remains a legal assignment/update/pattern target. It protects
 * unsupported access at evaluation; it does not promise that access's RHS effects.
 */
function protectNativeModuleAncestors(source: string, documentPath: string, operation?: string, helper?: string): { code: string; usesPreparedOptions: boolean } {
  const tree = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Ast
  const { scopes, bindings } = lexicalScopes(tree), edits: Edit[] = []
  const free = (node: Ast, name: string): boolean => {
    let scope = scopes.get(node)
    while (scope) { if (scope.names.has(name)) return false; scope = scope.parent }
    return true
  }
  const globalMember = (node: Ast, name: string): boolean => memberName(node) === name && node.object.type === 'Identifier'
    && ['window', 'self', 'globalThis'].includes(node.object.name) && free(node, node.object.name)
  const frame = (node: Ast): boolean => node.type === 'Identifier' && node.name === 'frameElement' && free(node, node.name) || globalMember(node, 'frameElement')
  const guard = `(function(){throw ${JSON.stringify(`child[${documentPath}] top／frameElement.ownerDocument 的外层访问尚未投影；原源码保留`)}})().value`
  let usesPreparedOptions = false
  const visit = (node: Ast, parent?: Ast, grandparent?: Ast): void => {
    if (helper && preparedOptionsThen(node, operation)) {
      usesPreparedOptions = true
      const call = node.callee.object
      edits.push({ start: call.callee.start, end: call.callee.end, value: `${helper}.validate` })
      call.arguments.forEach((argument: Ast) => visit(argument, call, node))
      node.arguments.forEach((callback: Ast) => {
        visit(callback, node, parent)
        edits.push(...preparedContinuationGuards(callback, `${helper}.assertActive()`))
      })
      return
    }
    if (node.type === 'Identifier' && node.name === 'top' && isReference(node, parent, bindings) && free(node, node.name)
      || globalMember(node, 'top') || memberName(node) === 'ownerDocument' && frame(node.object)) {
      const shorthand = parent?.type === 'Property' && parent.shorthand && parent.value === node ? parent
        : parent?.type === 'AssignmentPattern' && parent.left === node && grandparent?.type === 'Property' && grandparent.shorthand ? grandparent : undefined
      if (shorthand) edits.push({ start: shorthand.start, end: shorthand.start, value: `${source.slice(shorthand.key.start, shorthand.key.end)}:` })
      edits.push({ start: node.start, end: node.end, value: guard })
      return
    }
    children(node).forEach(child => visit(child, node, parent))
  }
  visit(tree)
  return { code: apply(source, edits), usesPreparedOptions }
}

/** An opaque published document keeps native globals; only the software-prepared
 * options operation and its real lazy initializer continuation need projection. */
export function projectPublishedNativeImportOptions(source: string, operation: string, helper: string): string {
  const tree = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Ast
  const edits: Edit[] = []
  const visit = (node: Ast): void => {
    if (preparedOptionsThen(node, operation)) {
      const call = node.callee.object
      edits.push({ start: call.callee.start, end: call.callee.end, value: `${helper}.validate` })
      call.arguments.forEach(visit)
      node.arguments.forEach((callback: Ast) => {
        visit(callback)
        edits.push(...preparedContinuationGuards(callback, `${helper}.assertActive()`))
      })
      return
    }
    children(node).forEach(visit)
  }
  visit(tree)
  return apply(source, edits)
}

/** Only closed, directly authored native srcdoc programs use this parent projection. */
function prepareNativeChild(node: DefaultTreeAdapterTypes.Element, bundle?: string, documentPath = '', operation?: string, runtimeImports?: PublishedWebRuntimeImportPreparation, independent = false): { html: string; protectedProgram: boolean } | undefined {
  const srcdoc = node.attrs.find(attribute => attribute.name === 'srcdoc')
  if (!srcdoc || node.attrs.some(attribute => attribute.name === 'sandbox')) return undefined
  const tree = parse(srcdoc.value), elements: DefaultTreeAdapterTypes.Element[] = [], inert = new WeakSet<DefaultTreeAdapterTypes.Element>()
  const collect = (current: DefaultTreeAdapterTypes.Node, insideTemplate = false): void => {
    if ('tagName' in current) { elements.push(current); if (insideTemplate) inert.add(current) }
    if ('childNodes' in current) current.childNodes.forEach(child => collect(child, insideTemplate))
    if ('content' in current) collect(current.content, true)
  }
  collect(tree)
  if (elements.some(element => {
    if (['iframe', 'object', 'embed'].includes(element.tagName)) return true
    if (element.tagName !== 'script') return false
    const kind = scriptKind(Object.fromEntries(element.attrs.map(attribute => [attribute.name, attribute.value])))
    if (!kind.executable) return false
    if (kind.module) return !bundle || inert.has(element)
    return element.attrs.some(attribute => ['src', 'data-cw-async', 'data-cw-defer', 'data-guoling-classic-source'].includes(attribute.name))
  })) return undefined
  const globals = new Set<string>()
  let protectedProgram = false, installedModule = false, usesPreparedOptions = false, usesRuntimeImports = false
  const optionsHelper = `${identifiers(srcdoc.value + (bundle ?? ''))}_prepared_options`
  for (const element of elements.filter(element => element.tagName === 'script')) {
    const kind = scriptKind(Object.fromEntries(element.attrs.map(attribute => [attribute.name, attribute.value])))
    if (bundle && element.attrs.some(attribute => attribute.name === 'type' && attribute.value.trim().toLowerCase() === 'importmap')) {
      element.attrs = element.attrs.filter(attribute => attribute.name !== 'type')
      element.attrs.push({ name: 'type', value: 'application/x-guoling-prepared-importmap' })
    }
    if (!kind.executable) continue
    if (kind.module) {
      if(independent&&unsupportedNativeAncestor(bundle!,globals,false,true,true))return undefined
      element.attrs = element.attrs.filter(attribute => !['src', 'type', 'async', 'defer'].includes(attribute.name))
      element.attrs.push({ name: 'type', value: installedModule ? 'application/x-guoling-compiled-module' : 'module' })
      if (!installedModule) {
        const projected = protectNativeModuleAncestors(bundle!, documentPath, operation, optionsHelper)
        const programBinding = publishedWebInitializationBinding(bundle!)
        usesRuntimeImports = Boolean(runtimeImports && publishedWebRuntimeImportBinding(bundle!))
        usesPreparedOptions = projected.usesPreparedOptions || Boolean(programBinding)
        const configure = usesRuntimeImports && programBinding ? `\n${programBinding}.configureRuntimeImport(${optionsHelper});` : ''
        const start = programBinding ? `${configure}\n${programBinding}.startAll(()=>{${optionsHelper}.assertActive();return true});` : ''
        element.childNodes = [{ nodeName: '#text', value: projected.code + start, parentNode: element }]
      }
      installedModule = true
      // Module-local bindings cannot exempt neighbouring classic scripts/handlers.
      continue
    }
    const source = element.childNodes.map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join('')
    if (unsupportedNativeAncestor(source, globals,false,independent)) {
      element.attrs = element.attrs.filter(attribute => attribute.name !== 'type')
      element.attrs.push({ name: 'type', value: 'application/x-guoling-uncompiled-script' }); protectedProgram = true
    } else if (!inert.has(element)) try {
      const syntax = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as Ast
      // Native Window.top/window cannot be replaced or become classic global lexical bindings.
      // A failed declaration must not exempt a later handler from ancestor protection.
      for (const name of lexicalScopes(syntax).root.names) if (!['top', 'window'].includes(name)) globals.add(name)
    } catch { /* A native syntax error remains local to this original child script. */ }
  }
  for (const element of elements) for (const attribute of [...element.attrs]) {
    if (/^on[a-z]+$/i.test(attribute.name) && unsupportedNativeAncestor(attribute.value, globals, true,independent)) {
      element.attrs.splice(element.attrs.indexOf(attribute), 1); protectedProgram = true
    } else if (javascriptNavigationAttribute(element.tagName, attribute.name) && /^javascript:/i.test(attribute.value.replace(/[\u0000-\u0020]/g, ''))
      && unsupportedNativeAncestor(attribute.value.slice(attribute.value.indexOf(':') + 1), globals,false,independent)) {
      // Retain an inert action rather than falling back to native form GET navigation.
      attribute.value = 'javascript:void(0)'; protectedProgram = true
    }
  }
  const head = elements.find(element => element.tagName === 'head')!
  const runtimePrefix = usesRuntimeImports ? `const resolver=(${webModuleResolverSource()})({URL:native.URL,decodeURI:native.decodeURI}),contexts=${JSON.stringify(runtimeImports!.contexts).replaceAll('<','\\u003c')},RuntimePromise=native.Promise,RuntimeTypeError=native.TypeError;validator.resolve=(specifier,key)=>{const context=contexts[key];return context?resolver(specifier,context.importer,false,context):undefined};validator.reject=()=>{const message=${JSON.stringify(`child[${documentPath}] 的动态 import() 运行时请求尚未闭合；原源码保留`)};if(report)report(${JSON.stringify(documentPath)},message);return RuntimePromise.reject(new RuntimeTypeError(message))};` : ''
  const optionsPrefix = usesPreparedOptions ? `const originalDocument=native.document,parentActive=local?.[${JSON.stringify(compiledScopeActiveProperty)}];let ended=false;const validator=(${createPreparedJavaScriptImportOptionsValidator.toString()})(native,()=>!ended&&native.document===originalDocument&&frame?.isConnected===true&&parentActive?.()===true,function(url,options){${preparedJavaScriptNativeImportBody}});${runtimePrefix}Object.defineProperty(native,${JSON.stringify(optionsHelper)},{value:validator,configurable:true});const end=()=>{ended=true;validator.dispose()};native.addEventListener('pagehide',end,{once:true});native.addEventListener('unload',end,{once:true});` : ''
  const prefix = parse(`<script data-guoling-native-parent-bridge>(function(){const native=window,frame=native.frameElement,host=frame&&frame.getRootNode().host,local=host?.[${JSON.stringify(compiledLocalParentProperty)}],report=host?.[${JSON.stringify(compiledNativeChildDiagnosticProperty)}];${optionsPrefix}if(local)Object.defineProperty(native,"parent",{value:local,writable:true,configurable:true});if(report){const relay=function(event){event.preventDefault();report(${JSON.stringify(documentPath)},event.error??event.reason??event.message??'子文档程序失败')};native.addEventListener('error',relay);native.addEventListener('unhandledrejection',relay)}})();</script>`)
  const prefixHtml = prefix.childNodes.find(child => 'tagName' in child && child.tagName === 'html') as DefaultTreeAdapterTypes.Element
  const prefixHead = prefixHtml.childNodes.find(child => 'tagName' in child && child.tagName === 'head') as DefaultTreeAdapterTypes.Element
  const script = prefixHead.childNodes[0]; script.parentNode = head; head.childNodes.unshift(script)
  return { html: serialize(tree), protectedProgram }
}

/** Future template execution is unsupported; don't leave native handlers that can write to the outer document. */
function protectTemplateProgram(node: DefaultTreeAdapterTypes.Node): boolean {
  let program = false
  if ('tagName' in node) {
    if (node.tagName === 'iframe') {
      const child = prepareNativeChild(node)
      if (child) {
        node.attrs.find(attribute => attribute.name === 'srcdoc')!.value = child.html
        program = child.protectedProgram
      }
    }
    for (const attribute of [...node.attrs]) {
      if (/^on[a-z]+$/i.test(attribute.name) || javascriptNavigationAttribute(node.tagName, attribute.name)
        && /^javascript:/i.test(attribute.value.replace(/[\u0000-\u0020]/g, '')) && !inertJavascriptUrl(attribute.value)) {
        program = true
        node.attrs.splice(node.attrs.indexOf(attribute), 1)
        if (['action', 'formaction'].includes(attribute.name)) node.attrs.push({ name: unsupportedJavascriptSubmitAttribute, value: '' })
      }
    }
    if (node.tagName === 'script' && scriptKind(Object.fromEntries(node.attrs.map(attribute => [attribute.name, attribute.value]))).executable) {
      program = true
      node.attrs = node.attrs.filter(attribute => !['src', 'type'].includes(attribute.name))
      node.attrs.push({ name: 'type', value: 'application/x-guoling-uncompiled-script' })
    }
  }
  if ('childNodes' in node) for (const child of node.childNodes) program = protectTemplateProgram(child) || program
  if ('content' in node) program = protectTemplateProgram(node.content) || program
  return program
}

/** The emitted function is prepared once by the publish consumer; each call owns one instance closure. */
export function compilePublishedScriptModule(code: string, options: { trustedBuiltin?: boolean; routing?: boolean } = {}): CompiledScriptFactory {
  const name = identifiers(code), output = transformProgram(code, true, name, `${name}_load`, undefined, options.trustedBuiltin, false, undefined, options.routing)
  const factorySource = output.diagnostics.length ? '' : `${output.asynchronous ? 'async ' : ''}function(${name}){"use strict";${name}=Object.create(${name});${name}.__exports={};${output.exports}${output.body};return ${name}.__exports;}`
  return { factorySource, diagnostics: output.diagnostics, nativeReasons: options.trustedBuiltin ? [] : [...new Set([...output.coverage.reasons, ...output.coverage.ambientNames.map(name=>`ambient:${name}`), ...output.diagnostics.map(issue=>issue.code)])] }
}

/** Parse HTML and existing compiler graph once; executable scripts share their original document scope. */
export function compilePublishedWebProgram(data: WebRuntimeData, options: {routing?:boolean} = {}): {
  html: string; css: string; classicPrograms: CompiledClassicProgramSource[]; handlerFactories: string[]; scriptFactories: string[]; diagnostics: readonly CompiledScriptDiagnostic[]; nativeReasons: readonly string[]
} {
  const tree = parse(data.html), diagnostics: CompiledScriptDiagnostic[] = [], classicPrograms: CompiledClassicProgramSource[] = [], handlerFactories: string[] = [], entries: Array<{index:number;kind:'defer'|'async';path:string}> = []
  const coverage: LocalProgramCoverage[] = []
  const bundledEntry = '__guoling_published_bundle.js'
  const name = identifiers(data.html + (data.publishedModuleBundle ?? '') + Object.values(data.moduleGraph?.modules ?? {}).map(module => module.code).join(''))
  let scriptIndex = 0, iframeIndex = 0, handlerIndex = 0, blocksModules = false
  const classic = (source: string, label: string): string => {
    if(options.routing&&coverage.some(facts=>facts.reasons.length))return ''
    const result = transformProgram(source, false, name, `${name}_load`, undefined, false, true, undefined, options.routing)
    coverage.push(result.coverage)
    diagnostics.push(...result.diagnostics.map(issue => ({ ...issue, message: `${label}: ${issue.message}` })))
    return result.diagnostics.some(issue => issue.blocking !== false) ? '' : `function(${name}){${result.body}\n}`
  }
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node) {
      if (['iframe', 'object', 'embed'].includes(node.tagName)) {
        const documentPath = node.tagName === 'iframe' ? String(iframeIndex++) : ''
        const child = node.tagName === 'iframe' ? prepareNativeChild(node, data.publishedDocumentBundles?.[documentPath], documentPath,
          data.publishedDocumentBundles?.[documentPath] ? publishedWebImportOptionsOperation(data, documentPath) : undefined,
          data.publishedDocumentBundles?.[documentPath] ? publishedWebRuntimeImportPreparation(data, documentPath) : undefined, options.routing) : undefined
        if (child) {
          node.attrs.find(attribute => attribute.name === 'srcdoc')!.value = child.html
          if (child.protectedProgram) diagnostics.push({ code: 'nested-ancestor', message: '子文档 top／frameElement.ownerDocument 的外层访问尚未投影；具体程序已停用、源码保留' })
        } else diagnostics.push({ code: 'nested-content', message: `同文档发布尚不能保真 <${node.tagName}> 的此独立文档输入；源码已保留` })
      }
      for (const attribute of [...node.attrs]) {
        if (/^on[a-z]+$/i.test(attribute.name)) {
          const key = String(handlerIndex++), marker = 'data-guoling-compiled-event'
          const existing = node.attrs.find(item => item.name === marker)
          if (!existing) node.attrs.push({ name: marker, value: key })
          node.attrs.splice(node.attrs.indexOf(attribute), 1)
          const factory = classic(`window.__eventProperty(document.querySelector(${JSON.stringify(`[${marker}="${existing?.value ?? key}"]`)}),${JSON.stringify(attribute.name)},function(event){${attribute.value}\n});`, `HTML handler[${key}]`)
          if (factory) handlerFactories.push(factory)
        } else if (javascriptNavigationAttribute(node.tagName, attribute.name) && /^javascript:/i.test(attribute.value.replace(/[\u0000-\u0020]/g, '')) && !inertJavascriptUrl(attribute.value)) {
          diagnostics.push({ code: 'javascript-url', message: `同文档发布尚不能保真 ${node.tagName}[${attribute.name}] 的 javascript: 导航；源码已保留` })
          // A native javascript: URL in a Shadow root still executes against the outer document.
          node.attrs.splice(node.attrs.indexOf(attribute), 1)
          if (['action', 'formaction'].includes(attribute.name)) node.attrs.push({ name: unsupportedJavascriptSubmitAttribute, value: '' })
        }
      }
      if (node.tagName === 'script') {
        const index = scriptIndex++, attrs = Object.fromEntries(node.attrs.map(attribute => [attribute.name, attribute.value]))
        const { module, executable } = scriptKind(attrs)
        if (executable) {
          const source = node.childNodes.map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join('')
          const entry = data.moduleGraph?.entries[String(index)]
          const moduleKind = Object.hasOwn(attrs, 'async') || Object.hasOwn(attrs, 'data-cw-async') ? 'async' : 'defer'
          if (module && data.publishedModuleBundle) entries.push({index,kind:moduleKind,path:bundledEntry})
          else if (module && entry) entries.push({index,kind:moduleKind,path:entry})
          else if (module) {
            const path = `__inline_${index}.js`
            if (data.moduleGraph) { blocksModules = true; diagnostics.push({ code: 'module-entry', message: `HTML script[${index}] 未准备模块入口；源码已保留` }) }
            else entries.push({index,kind:moduleKind,path})
            inlineModules[path] = source
          } else if (Object.hasOwn(attrs, 'src') && !Object.hasOwn(attrs, 'data-guoling-classic-source')) diagnostics.push({ code: 'script-source', message: `HTML script[${index}] 的 src 未物化：${attrs.src}` })
          else {
            let program = source
            let readable = true
            if (Object.hasOwn(attrs, 'data-guoling-classic-source')) try { program = JSON.parse(attrs['data-guoling-classic-source']); if (typeof program !== 'string') readable = false } catch { readable = false }
            if (!readable) diagnostics.push({ code: 'script-source', message: `HTML script[${index}] 的已物化源码不可读` })
            else {
              const external = ['src', 'data-guoling-classic-source', 'data-cw-async', 'data-cw-defer'].some(attribute => Object.hasOwn(attrs, attribute))
              const kind: CompiledClassicProgramSource['kind'] = external && (Object.hasOwn(attrs, 'async') || Object.hasOwn(attrs, 'data-cw-async')) ? 'async'
                : external && (Object.hasOwn(attrs, 'defer') || Object.hasOwn(attrs, 'data-cw-defer')) ? 'defer' : 'blocking'
              const factorySource = classic(program, `HTML script[${index}]`)
              if (factorySource) classicPrograms.push({ index, kind, factorySource })
            }
          }
          if (!module) {
            // Keep currentScript's real DOM location without letting native DOM execute the source again.
            node.attrs = node.attrs.filter(attribute => !['type', 'data-guoling-compiled-script'].includes(attribute.name))
            node.attrs.push({ name: 'type', value: 'application/x-guoling-compiled-script' }, { name: 'data-guoling-compiled-script', value: String(index) })
          } else {
            const parent = node.parentNode
            if (parent && 'childNodes' in parent) parent.childNodes.splice(parent.childNodes.indexOf(node), 1)
          }
          return
        }
      }
    }
    if ('childNodes' in node) [...node.childNodes].forEach(visit)
    if ('content' in node) {
      if (protectTemplateProgram(node.content)) diagnostics.push({ code: 'template-program', message: '同文档发布尚不能保真动态实例化模板中的程序；未将模板程序提前执行，源码已保留' })
    }
  }
  const inlineModules: Record<string, string> = {}
  visit(tree)
  const moduleFactories: string[] = []
  const modules = data.publishedModuleBundle ? { [bundledEntry]: { code: data.publishedModuleBundle, imports: [] } }
    : { ...Object.fromEntries(Object.entries(inlineModules).map(([path, code]) => [path, { code, imports: [] }])), ...webModuleGraphForDocument(data.moduleGraph)?.modules }
  for (const [path, module] of Object.entries(modules)) {
    if(options.routing&&coverage.some(facts=>facts.reasons.length))break
    const result = transformProgram(module.code, true, name, `${name}_load`, literal => module.imports.find(reference => reference.start === literal.start && reference.end === literal.end)?.path, false, true,
      data.publishedModuleBundle ? publishedWebImportOptionsOperation(data) : undefined, options.routing)
    coverage.push(result.coverage)
    diagnostics.push(...result.diagnostics.map(issue => ({ ...issue, message: `${path}: ${issue.message}` })))
    if (result.diagnostics.some(issue => issue.blocking !== false)) blocksModules = true
    if (result.asynchronous) { blocksModules = true; diagnostics.push({ code: 'module-not-bundled', message: `${path} 的异步模块依赖尚未由现编译服务准备；源码已保留` }) }
    moduleFactories.push(`${JSON.stringify(path)}:function(${name}_exports){"use strict";const ${name}=Object.create(${name}_globals);${name}.__exports=${name}_exports;${result.exports}${result.body}\n}`)
  }
  for (const entry of entries) if (!Object.hasOwn(modules, entry.path)) { blocksModules = true; diagnostics.push({ code: 'module-entry', message: `缺少已编译模块入口：${entry.path}` }) }
  const preparation = data.publishedModuleBundle
    ? `const ${name}_program=${name}_load(${JSON.stringify(bundledEntry)})[${JSON.stringify(publishedWebInitializationExport)}];`
    : `${publishedWebInitializationSource(entries.map(entry=>({index:entry.index,loadSource:`begin=>begin(()=>${name}_load(${JSON.stringify(entry.path)}))`})))}const ${name}_program=${publishedWebInitializationExport};`
  const kinds = JSON.stringify(Object.fromEntries(entries.map(entry=>[entry.index,entry.kind])))
  const runtimeImports = data.publishedModuleBundle && publishedWebRuntimeImportBinding(data.publishedModuleBundle) ? publishedWebRuntimeImportPreparation(data) : undefined
  const runtimeConfigure = runtimeImports ? `,configureRuntimeImport:port=>{const resolver=(${webModuleResolverSource()})(port.native),contexts=${JSON.stringify(runtimeImports.contexts)};${name}_program.configureRuntimeImport({...port,resolve:(specifier,key)=>{const context=contexts[key];return context?resolver(specifier,context.importer,false,context):undefined}})}` : ''
  const body = `const ${name}_globals=${name},${name}_modules={${moduleFactories.join(',')}},${name}_cache=Object.create(null);function ${name}_load(path){if(Object.hasOwn(${name}_cache,path))return ${name}_cache[path];const value=${name}_cache[path]={};if(!${name}_modules[path])throw new Error('未准备模块 '+path);${name}_modules[path](value);return value;}${preparation}const ${name}_kinds=${kinds};return{entries:${name}_program.entries.map(entry=>({index:entry.index,kind:${name}_kinds[entry.index],start:isActive=>entry.start(isActive)})),ready:${name}_program.ready,startAll:isActive=>${name}_program.startAll(isActive)${runtimeConfigure}};`
  // Diagnostics remain local: a rejected classic/handler never disables healthy sibling programs.
  const declarations = new Set(coverage.flatMap(facts=>facts.declarations)), writes = new Set(coverage.flatMap(facts=>facts.windowWrites))
  const nativeReasons = [...new Set([...coverage.flatMap(facts=>facts.reasons), ...coverage.flatMap(facts=>facts.ambientNames).filter(key=>!declarations.has(key)&&!writes.has(key)).map(key=>`ambient:${key}`),
    ...coverage.flatMap(facts=>facts.windowReads).filter(key=>!writes.has(key)&&!declarations.has(key)).map(key=>`window-member:${key}`), ...diagnostics.map(issue=>issue.code)])]
  return { html: serialize(tree), css: data.css ?? '', classicPrograms, handlerFactories, scriptFactories: blocksModules || !entries.length ? [] : [`function(${name}){${body}\n}`], diagnostics, nativeReasons }
}
