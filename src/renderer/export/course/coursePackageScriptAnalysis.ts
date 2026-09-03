import { parse as parseJavaScript } from 'acorn'

/** Exact HTTPS origin for declared remote asset URLs. Rejects credentials, wildcards, and non-HTTPS. */
export function exactHttpsOrigin(url: string): string | null {
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

export function exactConnectOrigin(value: string): string | null {
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'wss:'
      ? parsed.origin
      : null
  } catch {
    return null
  }
}

export type ConnectApi = 'fetch' | 'WebSocket' | 'EventSource' | 'sendBeacon' | 'XMLHttpRequest.open'
type ConnectCertainty = 'exact' | 'ambiguous' | 'none'
type JavaScriptBindingKind = 'const' | 'let' | 'var' | 'function' | 'class' | 'import' | 'parameter' | 'catch'

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

export type ConnectArgumentFact =
  | { kind: 'literal'; value: string }
  | { kind: 'unresolved' }

export interface JavaScriptConnectSiteFact {
  api: ConnectApi
  start: number
  argument: ConnectArgumentFact
}

export interface JavaScriptConnectFacts {
  parseFailed: boolean
  hasDynamicExecution: boolean
  sites: JavaScriptConnectSiteFact[]
}

/** Pure JS/connect facts from explicit source text. Does not emit HTML/ZIP or read Store. */
export function analyzeJavaScriptConnect(source: string): JavaScriptConnectFacts {
  const scan = collectConnectCallSites(source)
  return {
    parseFailed: scan.parseFailed,
    hasDynamicExecution: scan.hasDynamicExecution,
    sites: scan.sites.map((site) => {
      const argument = literalConnectArgument(site)
      return {
        api: site.api,
        start: site.start,
        argument: argument.kind === 'literal' && argument.value
          ? { kind: 'literal', value: argument.value }
          : { kind: 'unresolved' },
      }
    }),
  }
}
