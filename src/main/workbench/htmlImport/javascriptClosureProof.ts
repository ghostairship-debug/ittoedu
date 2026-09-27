import { children, propertyName, recognizeReact1927, type JsNode } from './frameworks/react1927'

type Scope = { parent?: Scope; functionScope: boolean; bindings: Map<string, Binding> }
type Binding = { declaration: JsNode; initial?: JsNode; scope: Scope; duplicate: boolean }
type Value = { kind: 'string'; node: JsNode } | { kind: 'object'; fields: Map<string, Value> } | { kind: 'union'; values: Value[] } | { kind: 'unknown' }
export type ClosureProof = { kind: 'proven-state' } | { kind: 'proven-resource'; literals: JsNode[] } | { kind: 'unknown' }
export interface JavaScriptClosureProof {
  internalSink(node: JsNode): ClosureProof
  resourceInputs: Array<{ value: JsNode; name: string; proof: ClosureProof }>
  frameworkError: boolean
}
const UNKNOWN: Value = { kind: 'unknown' }
const UNKNOWN_PROOF: ClosureProof = { kind: 'unknown' }
const RESOURCE_FIELDS = new Set(['src', 'srcSet', 'srcset', 'href', 'poster', 'data', 'action', 'formAction'])
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const keyOf = (node: JsNode): string | undefined => node.type === 'Identifier' ? String(node.name)
  : node.type === 'Literal' && (typeof node.value === 'string' || typeof node.value === 'number') ? String(node.value) : undefined
const unwrap = (node: JsNode): JsNode => node.type === 'SequenceExpression' ? (node.expressions as JsNode[]).at(-1)! : node

export function analyzeJavaScriptClosure(root: JsNode, inertCalls: Set<JsNode> = new Set()): JavaScriptClosureProof {
  const program: Scope = { functionScope: true, bindings: new Map() }
  const scopes = new Map<JsNode, Scope>(), parents = new Map<JsNode, JsNode>()
  const bind = (id: JsNode, declaration: JsNode, scope: Scope, initial?: JsNode) => {
    if (id.type !== 'Identifier') {
      for (const child of children(id)) bind(child, declaration, scope)
      return
    }
    const name = String(id.name), previous = scope.bindings.get(name)
    if (previous) previous.duplicate = true
    else scope.bindings.set(name, { declaration, initial, scope, duplicate: false })
  }
  const index = (node: JsNode, scope: Scope, parent?: JsNode) => {
    if (parent) parents.set(node, parent)
    if (node.type === 'FunctionDeclaration' && node.id) bind(node.id as JsNode, node, scope)
    if (FUNCTIONS.has(node.type)) {
      scope = { parent: scope, functionScope: true, bindings: new Map() }
      for (const param of node.params as JsNode[]) bind(param, param, scope)
      if (node.type === 'FunctionExpression' && node.id) bind(node.id as JsNode, node, scope)
    } else if (node.type === 'BlockStatement') scope = { parent: scope, functionScope: false, bindings: new Map() }
    scopes.set(node, scope)
    if (node.type === 'VariableDeclarator') {
      let owner = scope
      if (parent?.kind === 'var') while (!owner.functionScope && owner.parent) owner = owner.parent
      bind(node.id as JsNode, node, owner, node.init as JsNode | undefined)
    }
    for (const child of children(node)) index(child, scope, node)
  }
  index(root, program)
  const bindingOf = (node: JsNode): Binding | undefined => {
    if (node.type !== 'Identifier') return undefined
    let scope = scopes.get(node)
    while (scope) { const binding = scope.bindings.get(String(node.name)); if (binding) return binding; scope = scope.parent }
    return undefined
  }
  const topStatement = (node: JsNode): JsNode => {
    let current = node
    while (parents.get(current) && parents.get(current) !== root) current = parents.get(current)!
    return current
  }
  const isReference = (node: JsNode): boolean => {
    if (node.type !== 'Identifier') return false
    const parent = parents.get(node)
    if (!parent) return false
    if ((parent.type === 'MemberExpression' && parent.property === node && !parent.computed)
      || (parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand)
      || (parent.type === 'VariableDeclarator' && parent.id === node)
      || (FUNCTIONS.has(parent.type) && (parent.id === node || (parent.params as JsNode[]).includes(node)))) return false
    return true
  }
  const allNodes: JsNode[] = []
  const collect = (node: JsNode) => { allNodes.push(node); for (const child of children(node)) collect(child) }
  collect(root)
  const audited = recognizeReact1927(root)
  const libraryBindings = new Set<Binding>()
  if (audited) for (const declaration of audited.declarations.values()) {
    const binding = bindingOf(declaration.id as JsNode)
    if (binding) libraryBindings.add(binding)
  }
  const inLibrary = (node: JsNode) => !!audited?.contains(node)
  const callForMember = (node: JsNode): JsNode | undefined => {
    let parent = parents.get(node)
    if (parent?.type === 'SequenceExpression' && (parent.expressions as JsNode[]).at(-1) === node) parent = parents.get(parent)
    return parent?.type === 'CallExpression' && unwrap(parent.callee as JsNode) === node ? parent : undefined
  }
  const isReactEntry = (call: JsNode): boolean => {
    if (call.type !== 'CallExpression') return false
    const callee = unwrap(call.callee as JsNode)
    return callee.type === 'MemberExpression' && ['jsx', 'jsxs', 'createElement', 'cloneElement'].includes(propertyName(callee) ?? '')
      && libraryBindings.has(bindingOf(callee.object as JsNode)!)
  }
  let frameworkError = false
  if (audited) {
    const globals = new Set(allNodes.filter(node => inLibrary(node) && isReference(node) && !bindingOf(node)).map(node => String(node.name)))
    const globalRoot = (node: JsNode): string | undefined => node.type === 'MemberExpression' ? globalRoot(node.object as JsNode)
      : node.type === 'Identifier' && !bindingOf(node) && globals.has(String(node.name)) ? String(node.name) : undefined
    for (const binding of libraryBindings) if (binding.duplicate) frameworkError = true
    for (const node of allNodes) {
      if (!inLibrary(node)) {
        if ((node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') && globalRoot((node.left ?? node.argument) as JsNode)) frameworkError = true
        if (node.type === 'MemberExpression' && propertyName(node) === 'prototype' && globalRoot(node)) frameworkError = true
      }
      if (!isReference(node)) continue
      const resolved = bindingOf(node)
      if (inLibrary(node)) {
        if (resolved?.scope === program && !libraryBindings.has(resolved)) frameworkError = true
        continue
      }
      if (!libraryBindings.has(resolved!)) continue
      const parent = parents.get(node)!
      if (parent.type === 'MemberExpression' && parent.object === node) {
        const name = propertyName(parent), call = callForMember(parent)
        if (call && name && (['jsx', 'jsxs', 'createElement', 'cloneElement', 'createRoot'].includes(name) || /^use[A-Z]/.test(name))) continue
        const use = parents.get(parent)
        if (name === 'StrictMode' && use?.type === 'CallExpression' && isReactEntry(use) && (use.arguments as JsNode[])[0] === parent) continue
      }
      if (parent.type === 'CallExpression' && isReactEntry(parent) && (parent.arguments as JsNode[])[0] === node) continue
      frameworkError = true
    }
  }
  const assignments = new Map<Binding, JsNode[]>(), mutations = new Set<Binding>(), escaped = new Set<Binding>()
  const objectAssigns = new Map<Binding, JsNode[]>()
  const rootBinding = (node: JsNode): Binding | undefined => node.type === 'MemberExpression' ? rootBinding(node.object as JsNode) : bindingOf(node)
  const isObjectAssign = (node: JsNode): boolean => {
    const callee = node.callee as JsNode | undefined
    return node.type === 'CallExpression' && callee?.type === 'MemberExpression' && propertyName(callee) === 'assign'
      && (callee.object as JsNode).type === 'Identifier' && (callee.object as JsNode).name === 'Object' && !bindingOf(callee.object as JsNode)
  }
  for (const node of allNodes) {
    if (inLibrary(node)) continue
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const left = (node.left ?? node.argument) as JsNode, binding = rootBinding(left)
      if (!binding) continue
      if (left.type === 'Identifier' && node.type === 'AssignmentExpression' && node.operator === '=')
        assignments.set(binding, [...(assignments.get(binding) ?? []), node])
      else mutations.add(binding)
    }
    if (node.type === 'CallExpression') {
      const args = node.arguments as JsNode[]
      const callee = unwrap(node.callee as JsNode)
      if (callee.type === 'MemberExpression') {
        const receiver = rootBinding(callee.object as JsNode)
        if (receiver && !libraryBindings.has(receiver)) escaped.add(receiver)
      }
      for (const argument of args) {
        const binding = rootBinding(argument)
        if (!binding) continue
        if (isObjectAssign(node) && args[0] === argument) objectAssigns.set(binding, [...(objectAssigns.get(binding) ?? []), node])
        else escaped.add(binding)
      }
    }
    if (isReference(node)) {
      const binding = bindingOf(node), parent = parents.get(node)!
      const readProperty = parent.type === 'MemberExpression' && parent.object === node
      const directWrite = parent.type === 'AssignmentExpression' && parent.left === node
      const controlledAssign = isObjectAssign(parent) && (parent.arguments as JsNode[])[0] === node
      if (binding && !readProperty && !directWrite && !controlledAssign) escaped.add(binding)
    }
  }
  // Overwriting a table is only ordered when the entire application bootstrap is
  // declarative and ends in its one render call. Otherwise all writes are unknown.
  const inertInitializer = (node: JsNode): boolean => {
    if (['Literal', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) return true
    if (node.type === 'TemplateLiteral') return (node.expressions as JsNode[]).length === 0
    if (node.type === 'ArrayExpression') return (node.elements as Array<JsNode | null>).every(item => !item || inertInitializer(item))
    if (node.type === 'ObjectExpression') return (node.properties as JsNode[]).every(item => item.type === 'Property' && !item.computed && item.kind === 'init' && inertInitializer(item.value as JsNode))
    return false
  }
  const statements = root.body as JsNode[], last = statements.at(-1)
  const render = last?.type === 'ExpressionStatement' ? last.expression as JsNode : undefined
  const renderCallee = render?.type === 'CallExpression' ? render.callee as JsNode : undefined
  const createRoot = renderCallee?.type === 'MemberExpression' && propertyName(renderCallee) === 'render' ? renderCallee.object as JsNode : undefined
  const rootFactory = createRoot?.type === 'CallExpression' ? unwrap(createRoot.callee as JsNode) : undefined
  const mountedEntry = render?.type === 'CallExpression' ? (render.arguments as JsNode[])[0] : undefined
  let orderedBootstrap = !!audited && !!rootFactory && propertyName(rootFactory) === 'createRoot'
    && libraryBindings.has(bindingOf(rootFactory.object as JsNode)!) && !!mountedEntry && isReactEntry(mountedEntry)
  for (const statement of statements.slice(0, -1)) {
    if (statement.type === 'FunctionDeclaration') continue
    if (statement.type === 'VariableDeclaration' && (statement.declarations as JsNode[]).every(node => inLibrary(node) || (!!node.init && inertInitializer(node.init as JsNode)))) continue
    const expression = statement.type === 'ExpressionStatement' ? statement.expression as JsNode : undefined
    if (expression?.type === 'AssignmentExpression' && expression.operator === '=' && (expression.left as JsNode).type === 'Identifier' && inertInitializer(expression.right as JsNode)) continue
    if (expression && isObjectAssign(expression) && (expression.arguments as JsNode[]).slice(1).every(inertInitializer)) continue
    // The already audited modulepreload IIFE performs no application calls.
    if (expression && inertCalls.has(expression)) continue
    orderedBootstrap = false
  }
  const evaluate = (node: JsNode, seen = new Set<Binding>(), budget = 64): Value => {
    if (budget <= 0) return UNKNOWN
    if (node.type === 'Literal' && typeof node.value === 'string') return { kind: 'string', node }
    if (node.type === 'TemplateLiteral' && (node.expressions as JsNode[]).length === 0) return { kind: 'string', node }
    if (node.type === 'ConditionalExpression') return { kind: 'union', values: [evaluate(node.consequent as JsNode, seen, budget - 1), evaluate(node.alternate as JsNode, seen, budget - 1)] }
    if (node.type === 'ObjectExpression') {
      const fields = new Map<string, Value>()
      for (const property of node.properties as JsNode[]) {
        const key = property.type === 'Property' && !property.computed && property.kind === 'init' ? keyOf(property.key as JsNode) : undefined
        if (key === undefined) return UNKNOWN
        fields.set(key, evaluate(property.value as JsNode, seen, budget - 1))
      }
      return { kind: 'object', fields }
    }
    if (node.type === 'Identifier') {
      const binding = bindingOf(node)
      if (!binding || binding.duplicate || !binding.initial || seen.has(binding) || mutations.has(binding)) return UNKNOWN
      const next = new Set(seen).add(binding)
      let result = evaluate(binding.initial, next, budget - 1)
      const writes = [...(assignments.get(binding) ?? []), ...(objectAssigns.get(binding) ?? [])].sort((a, b) => a.start - b.start)
      if (writes.length) {
        if (!orderedBootstrap || binding.scope !== program || writes.some(write => topStatement(write).type !== 'ExpressionStatement' || (topStatement(write).expression as JsNode) !== write || write.start >= last!.start)) return UNKNOWN
        for (const write of writes) {
          if (write.type === 'AssignmentExpression') result = evaluate(write.right as JsNode, next, budget - 1)
          else {
            if (result.kind !== 'object') return UNKNOWN
            for (const source of (write.arguments as JsNode[]).slice(1)) {
              const value = evaluate(source, next, budget - 1)
              if (value.kind !== 'object') return UNKNOWN
              result = { kind: 'object', fields: new Map([...result.fields, ...value.fields]) }
            }
          }
        }
      }
      if (result.kind === 'object' && escaped.has(binding)) return UNKNOWN
      return result
    }
    if (node.type === 'MemberExpression') {
      const object = evaluate(node.object as JsNode, seen, budget - 1)
      if (object.kind !== 'object') return UNKNOWN
      const key = propertyName(node)
      if (key === undefined && node.computed) {
        const computed = evaluate(node.property as JsNode, seen, budget - 1)
        if (computed.kind === 'string') {
          const literal = computed.node
          const value = literal.type === 'Literal' ? String(literal.value) : ((literal.quasis as Array<{ value: { cooked: string } }>)[0]).value.cooked
          return object.fields.get(value) ?? UNKNOWN
        }
      }
      return key === undefined ? { kind: 'union', values: [...object.fields.values()] } : object.fields.get(key) ?? UNKNOWN
    }
    return UNKNOWN
  }
  const resourceProof = (value: Value): ClosureProof => {
    if (value.kind === 'string') return { kind: 'proven-resource', literals: [value.node] }
    if (value.kind === 'union' && value.values.length) {
      const proofs = value.values.map(resourceProof)
      if (proofs.every(proof => proof.kind === 'proven-resource')) return { kind: 'proven-resource', literals: proofs.flatMap(proof => proof.literals) }
    }
    return UNKNOWN_PROOF
  }
  const resourceInputs: JavaScriptClosureProof['resourceInputs'] = []
  if (audited) for (const node of allNodes) {
    if (inLibrary(node)) continue
    if (node.type === 'Property') {
      const name = !node.computed ? keyOf(node.key as JsNode) : undefined
      if (name && RESOURCE_FIELDS.has(name)) resourceInputs.push({ value: node.value as JsNode, name: name === 'srcSet' ? 'srcset' : name, proof: resourceProof(evaluate(node.value as JsNode)) })
      if (name === '$$typeof') frameworkError = true
    }
    if (isReactEntry(node)) {
      const args = node.arguments as JsNode[], props = args[1]
      // Plain props retain every field, including spreads/accessors. Unknown props
      // can hide a resource and must not acquire a vendor propagation proof.
      if (!props || props.type !== 'ObjectExpression' || (props.properties as JsNode[]).some(property => property.type !== 'Property' || property.computed || property.kind !== 'init')) frameworkError = true
      const tag = args[0]
      if (!tag || !['Literal', 'TemplateLiteral', 'Identifier', 'MemberExpression'].includes(tag.type)) frameworkError = true
    }
  }
  return {
    frameworkError,
    resourceInputs,
    internalSink(node) {
      if (!audited || frameworkError) return UNKNOWN_PROOF
      const kind = audited.internalSinks.get(node)
      return kind === 'proven-state' ? { kind } : kind === 'proven-resource' ? { kind, literals: [] } : UNKNOWN_PROOF
    },
  }
}
