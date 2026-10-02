import { children, propertyName, recognizeReact1927, type JsNode } from './frameworks/react1927'
import type { RemoteReference } from './types'

type Usage = RemoteReference['usage']
type Scope = { parent?: Scope; functionScope: boolean; bindings: Map<string, Binding> }
type Binding = { declaration: JsNode; initial?: JsNode; scope: Scope; duplicate: boolean }
type Value = { kind: 'string'; node: JsNode } | { kind: 'object'; fields: Map<string, Value> } | { kind: 'union'; values: Value[] } | { kind: 'non-resource' } | { kind: 'unknown' }
export type ClosureProof = { kind: 'proven-state' } | { kind: 'proven-resource'; literals: JsNode[] } | { kind: 'unknown' }
export interface JavaScriptClosureProof {
  internalSink(node: JsNode): ClosureProof
  auditedNode(node: JsNode): boolean
  styleReceiver(node: JsNode): boolean
  dataReceiver(node: JsNode): boolean
  memberName(node: JsNode): string | undefined
  capabilityErrors: JsNode[]
  /** fetch/Worker/... 等"做网络副作用而不是闭包破坏"的调用点;以 warning 报告而非否决导入。 */
  networkCalls: JsNode[]
  embeddedInputs: Array<{ value: JsNode; path: string[]; name: string; kind: 'css' | 'html'; proof: ClosureProof }>
  resourceInputs: Array<{ value: JsNode; name: string; usage: Usage; proof: ClosureProof }>
  exclusiveDefinitions: Array<{ value: JsNode; name: string; usage: Usage }>
  deadDefinitions: JsNode[]
  definitionBackedUses: Set<JsNode>
  frameworkError: boolean
}
const UNKNOWN: Value = { kind: 'unknown' }
const UNKNOWN_PROOF: ClosureProof = { kind: 'unknown' }
const RESOURCE_FIELDS = new Set(['src', 'srcSet', 'srcset', 'href', 'xlinkHref', 'poster', 'data', 'action', 'formAction'])
export const CSS_RESOURCE_PROPERTIES = new Set(['fill', 'stroke', 'filter', 'clipPath', 'clip-path', 'mask', 'cursor', 'markerStart', 'marker-start', 'markerMid', 'marker-mid', 'markerEnd', 'marker-end'])
/** These declarations cannot load a URL, even when their value is computed. */
const NON_RESOURCE_STYLES = new Set(('opacity transform transformOrigin translate rotate scale display visibility position top right bottom left inset width height minWidth minHeight maxWidth maxHeight margin marginTop marginRight marginBottom marginLeft padding paddingTop paddingRight paddingBottom paddingLeft gap rowGap columnGap zIndex color backgroundColor fontSize fontFamily fontWeight fontStyle lineHeight letterSpacing wordSpacing textAlign whiteSpace overflow overflowX overflowY borderWidth borderStyle borderColor borderRadius flex flexGrow flexShrink flexBasis flexDirection flexWrap alignItems alignSelf justifyContent gridTemplateColumns gridTemplateRows order pointerEvents transition transitionProperty transitionDuration transitionDelay animation animationName animationDuration animationDelay').split(' '))
export const nonResourceStyle = (name: string | null | undefined): boolean => !!name && NON_RESOURCE_STYLES.has(name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()))
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const keyOf = (node: JsNode): string | undefined => node.type === 'Identifier' ? String(node.name)
  : node.type === 'Literal' && (typeof node.value === 'string' || typeof node.value === 'number') ? String(node.value) : undefined
const unwrap = (node: JsNode): JsNode => node.type === 'SequenceExpression' ? (node.expressions as JsNode[]).at(-1)! : node

export function analyzeJavaScriptClosure(root: JsNode, inertCalls: Set<JsNode> = new Set()): JavaScriptClosureProof {
  const program: Scope = { functionScope: true, bindings: new Map() }
  const scopes = new Map<JsNode, Scope>(), parents = new Map<JsNode, JsNode>()
  const bind = (id: JsNode, declaration: JsNode, scope: Scope, initial?: JsNode) => {
    if (id.type !== 'Identifier') {
      if (id.type === 'ArrayPattern') for (const child of id.elements as Array<JsNode | null>) { if (child) bind(child, declaration, scope) }
      if (id.type === 'ObjectPattern') for (const prop of id.properties as JsNode[]) bind((prop.type === 'RestElement' ? prop.argument : prop.value) as JsNode, declaration, scope)
      if (id.type === 'AssignmentPattern') bind(id.left as JsNode, declaration, scope)
      if (id.type === 'RestElement') bind(id.argument as JsNode, declaration, scope)
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
    let pattern = node, owner = parent
    while (['ArrayPattern', 'ObjectPattern', 'RestElement', 'AssignmentPattern', 'Property'].includes(owner.type)) {
      if (owner.type === 'Property' && parents.get(owner)?.type !== 'ObjectPattern') break
      if (owner.type === 'AssignmentPattern' && owner.right === pattern) break
      pattern = owner
      const next = parents.get(pattern)
      if (!next) break
      owner = next
    }
    if ((owner.type === 'VariableDeclarator' && owner.id === pattern) || (FUNCTIONS.has(owner.type) && (owner.params as JsNode[]).includes(pattern)) || (owner.type === 'CatchClause' && owner.param === pattern)) return false
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
      const container = parents.get(parent), call = container ? parents.get(container) : undefined
      const readOnlyProp = parent.type === 'Property' && parent.value === node && ['style', 'dangerouslySetInnerHTML'].includes(keyOf(parent.key as JsNode) ?? '')
        && container?.type === 'ObjectExpression' && !!call && isReactEntry(call) && (call.arguments as JsNode[])[1] === container
      if (binding && !readProperty && !directWrite && !controlledAssign && !readOnlyProp) escaped.add(binding)
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
  const numeric = (node: JsNode): boolean => {
    if (node.type === 'Literal') return typeof node.value === 'number'
    if (node.type === 'UnaryExpression') return ['+', '-', '~'].includes(String(node.operator))
    if (node.type === 'BinaryExpression') return ['-', '*', '/', '%', '**', '|', '&', '^', '<<', '>>', '>>>'].includes(String(node.operator))
      || (node.operator === '+' && numeric(node.left as JsNode) && numeric(node.right as JsNode))
    return false
  }
  const evaluate = (node: JsNode, seen = new Set<Binding>(), budget = 64): Value => {
    if (budget <= 0) return UNKNOWN
    if (numeric(node) || (node.type === 'Literal' && (node.value === null || typeof node.value === 'boolean'))) return { kind: 'non-resource' }
    if (node.type === 'TemplateLiteral' && (node.expressions as JsNode[]).length > 0
      && (node.expressions as JsNode[]).every(numeric)
      && (node.quasis as Array<{ value: { cooked: string | null } }>).every(part => part.value.cooked !== null && /^[\s\d.%+a-zA-Z-]*$/.test(part.value.cooked))) return { kind: 'non-resource' }
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
  const embeddedInputs: JavaScriptClosureProof['embeddedInputs'] = []
  const cssProof = (value: Value): ClosureProof => {
    if (value.kind === 'non-resource') return { kind: 'proven-resource', literals: [] }
    if (value.kind === 'union') {
      const proofs = value.values.map(cssProof)
      return proofs.every(proof => proof.kind === 'proven-resource') ? { kind: 'proven-resource', literals: proofs.flatMap(proof => proof.literals) } : UNKNOWN_PROOF
    }
    return resourceProof(value)
  }
  const styleInputs = (source: JsNode, value: Value) => {
    if (value.kind === 'union') { for (const item of value.values) styleInputs(source, item); return }
    if (value.kind !== 'object') { embeddedInputs.push({ value: source, path: [], name: 'style', kind: 'css', proof: UNKNOWN_PROOF }); return }
    for (const [name, field] of value.fields) embeddedInputs.push({ value: source, path: [name], name: `style.${name}`, kind: 'css', proof: cssProof(field) })
  }
  const htmlInput = (source: JsNode, value: Value) => {
    if (value.kind === 'union') { for (const item of value.values) htmlInput(source, item); return }
    embeddedInputs.push({ value: source, path: ['__html'], name: 'dangerouslySetInnerHTML.__html', kind: 'html', proof: value.kind === 'object' && value.fields.has('__html') ? resourceProof(value.fields.get('__html')!) : UNKNOWN_PROOF })
  }
  if (audited) for (const node of allNodes) {
    if (inLibrary(node)) continue
    if (node.type === 'Property') {
      const name = !node.computed ? keyOf(node.key as JsNode) : undefined
      const props = parents.get(node), call = props ? parents.get(props) : undefined
      const jsxProp = props?.type === 'ObjectExpression' && !!call && isReactEntry(call) && (call.arguments as JsNode[])[1] === props
      const tag = jsxProp ? (call.arguments as JsNode[])[0] : undefined
      const hostTag = tag?.type === 'Literal' && typeof tag.value === 'string' || tag?.type === 'TemplateLiteral' && (tag.expressions as JsNode[]).length === 0
      if (jsxProp && !hostTag && !libraryBindings.has(bindingOf(tag!)!) && name && (RESOURCE_FIELDS.has(name) || CSS_RESOURCE_PROPERTIES.has(name) || ['style', 'srcDoc', 'dangerouslySetInnerHTML'].includes(name))) frameworkError = true
      if (jsxProp && name && RESOURCE_FIELDS.has(name)) {
        const tagName = tag?.type === 'Literal' && typeof tag.value === 'string' ? tag.value.toLowerCase() : ''
        const usage: Usage = name === 'poster' && tagName === 'video' ? 'image'
          : ['src', 'srcSet', 'srcset'].includes(name) && tagName === 'img' ? 'image'
            : name === 'href' && tagName === 'image' ? 'image'
              : name === 'src' && (tagName === 'audio' || tagName === 'video') ? 'media'
                : name === 'src' && tagName === 'script' ? 'script' : 'unknown'
        resourceInputs.push({ value: node.value as JsNode, name: name === 'srcSet' ? 'srcset' : name, usage, proof: resourceProof(evaluate(node.value as JsNode)) })
      }
      if (jsxProp && name === 'style') styleInputs(node.value as JsNode, evaluate(node.value as JsNode))
      if (jsxProp && name && CSS_RESOURCE_PROPERTIES.has(name)) embeddedInputs.push({ value: node.value as JsNode, path: [], name, kind: 'css', proof: cssProof(evaluate(node.value as JsNode)) })
      if (jsxProp && name === 'srcDoc') embeddedInputs.push({ value: node.value as JsNode, path: [], name, kind: 'html', proof: resourceProof(evaluate(node.value as JsNode)) })
      if (jsxProp && name === 'dangerouslySetInnerHTML') htmlInput(node.value as JsNode, evaluate(node.value as JsNode))
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
  // A producer is rewritable only if every lexical reference is an approved
  // resource read or a proven, ordered bootstrap write. Aliases and text reads
  // disqualify the whole binding. This proof covers initial and overwritten values.
  const exclusiveDefinitions: JavaScriptClosureProof['exclusiveDefinitions'] = []
  const deadDefinitions: JsNode[] = [], definitionBackedUses = new Set<JsNode>()
  const stringLeaves = (node: JsNode): JsNode[] => {
    if (node.type === 'Literal' && typeof node.value === 'string') return [node]
    if (node.type === 'TemplateLiteral' && (node.expressions as JsNode[]).length === 0) return [node]
    if (node.type === 'ObjectExpression') return (node.properties as JsNode[]).flatMap(prop => prop.type === 'Property' && !prop.computed && prop.kind === 'init' ? stringLeaves(prop.value as JsNode) : [])
    return []
  }
  const producerBindings = new Set(resourceInputs.map(input => rootBinding(input.value)).filter((binding): binding is Binding => !!binding))
  for (const binding of producerBindings) {
    if (binding.scope !== program || binding.duplicate || !binding.initial || mutations.has(binding)) continue
    const uses = resourceInputs.filter(input => rootBinding(input.value) === binding)
    if (!uses.length || uses.some(input => input.proof.kind !== 'proven-resource')) continue
    const writes = [...(assignments.get(binding) ?? []), ...(objectAssigns.get(binding) ?? [])]
    if (writes.length && (!orderedBootstrap || writes.some(write => topStatement(write).type !== 'ExpressionStatement' || topStatement(write).expression !== write || write.start >= last!.start))) continue
    const producers = [binding.initial, ...writes.flatMap(write => write.type === 'AssignmentExpression' ? [write.right as JsNode] : (write.arguments as JsNode[]).slice(1))]
    const ownedLiterals = new Set(producers.flatMap(stringLeaves))
    // Following an alias proves a value, but never gives ownership of its source.
    if (uses.some(input => input.proof.kind === 'proven-resource' && input.proof.literals.some(literal => !ownedLiterals.has(literal)))) continue
    const references = allNodes.filter(node => isReference(node) && bindingOf(node) === binding)
    const allowed = references.every(reference => {
      const parent = parents.get(reference)!
      if (writes.includes(parent) && ((parent.type === 'AssignmentExpression' && parent.left === reference) || (isObjectAssign(parent) && (parent.arguments as JsNode[])[0] === reference))) return true
      let value = reference
      while (parents.get(value)?.type === 'MemberExpression' && parents.get(value)!.object === value) value = parents.get(value)!
      return uses.some(input => input.value === value)
    })
    if (!allowed) continue
    const live = new Set<JsNode>()
    for (const input of uses) if (input.proof.kind === 'proven-resource') {
      definitionBackedUses.add(input.value)
      for (const literal of input.proof.literals) { live.add(literal); exclusiveDefinitions.push({ value: literal, name: input.name, usage: input.usage }) }
    }
    for (const literal of ownedLiterals) if (!live.has(literal)) deadDefinitions.push(literal)
  }
  const staticKey = (node: JsNode, seen = new Set<Binding>()): string | undefined => {
    const value = evaluate(node)
    if (value.kind === 'string') return value.node.type === 'Literal' ? String(value.node.value) : (value.node.quasis as Array<{ value: { cooked: string } }>)[0].value.cooked
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      const left = staticKey(node.left as JsNode, seen), right = staticKey(node.right as JsNode, seen)
      return left !== undefined && right !== undefined ? left + right : undefined
    }
    if (node.type === 'Identifier') {
      const binding = bindingOf(node)
      if (binding?.initial && !binding.duplicate && !mutations.has(binding) && !assignments.has(binding) && !seen.has(binding)) return staticKey(binding.initial, new Set(seen).add(binding))
    }
    return undefined
  }
  const memberName = (node: JsNode): string | undefined => propertyName(node)
    ?? (node.type === 'MemberExpression' && node.computed ? staticKey(node.property as JsNode) : undefined)
  const styleBindings = new Set<Binding>()
  const styleReceiver = (node: JsNode): boolean => (node.type === 'MemberExpression' && memberName(node) === 'style')
    || (node.type === 'Identifier' && styleBindings.has(bindingOf(node)!))
  let changed = true
  while (changed) {
    changed = false
    for (const node of allNodes) {
      if (inLibrary(node)) continue
      const source = node.type === 'VariableDeclarator' ? node.init : node.type === 'AssignmentExpression' && node.operator === '=' ? node.right : undefined
      const target = node.type === 'VariableDeclarator' ? node.id : node.left
      if (source && target && styleReceiver(source as JsNode)) {
        const binding = bindingOf(target as JsNode)
        if (binding && !styleBindings.has(binding)) { styleBindings.add(binding); changed = true }
      }
    }
  }
  // Capability references are allowed only at an analyzed operation or tracked alias.
  // Unknown calls, returns, containers, destructuring and bound methods fail closed.
  const capabilityErrors: JsNode[] = []
  const networkCalls: JsNode[] = []
  /** fetch 等网络调用以 warning 形式由 extractHtmlResources 报告,不再纳入"资源闭合"责任。 */
  const networks = new Set(['fetch', 'importScripts', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'XMLHttpRequest', 'sendBeacon'])
  const setters = new Set(['setAttribute', 'setProperty', 'insertRule', 'insertAdjacentHTML'])
  // Unknown bindings (especially parameters) are not local data. The finite
  // data proof recognizes literal containers and audited React state/memo results.
  // A state proof covers every setter reference and every updater result.
  const dataBindings = new Set<Binding>()
  const taintedDataBindings = new Set(mutations)
  const dataMethods = new Set(['map', 'flatMap', 'filter', 'find', 'findIndex', 'some', 'every', 'includes', 'indexOf'])
  const functionValue = (node: JsNode): JsNode | undefined => {
    if (FUNCTIONS.has(node.type)) return node
    const binding = bindingOf(node)
    if (!binding || binding.duplicate || assignments.has(binding) || mutations.has(binding)) return undefined
    return binding.declaration.type === 'FunctionDeclaration' ? binding.declaration : binding.initial && FUNCTIONS.has(binding.initial.type) ? binding.initial : undefined
  }
  const passiveStateSetters = new Set<Binding>()
  for (const declaration of allNodes) {
    if (inLibrary(declaration) || declaration.type !== 'VariableDeclarator' || (declaration.id as JsNode).type !== 'ArrayPattern') continue
    const init = declaration.init as JsNode | undefined, callee = init?.type === 'CallExpression' ? unwrap(init.callee as JsNode) : undefined
    if (!callee || memberName(callee) !== 'useState' || !libraryBindings.has(bindingOf(callee.object as JsNode)!)) continue
    const setter = ((declaration.id as JsNode).elements as Array<JsNode | null>)[1], binding = setter && bindingOf(setter)
    if (!binding) continue
    const passive = allNodes.filter(ref => isReference(ref) && bindingOf(ref) === binding).every(ref => {
      const call = parents.get(ref)
      if (call?.type !== 'CallExpression' || call.callee !== ref) return false
      return (call.arguments as JsNode[]).every(arg => !FUNCTIONS.has(arg.type) || !allNodes.some(child => arg.start <= child.start && child.end <= arg.end && ['CallExpression', 'NewExpression', 'AssignmentExpression', 'UpdateExpression'].includes(child.type)))
    })
    if (passive) passiveStateSetters.add(binding)
  }
  const literalProjection = (node: JsNode, seen = new Set<Binding>()): JsNode | undefined => {
    if (node.type === 'Identifier') {
      const binding = bindingOf(node)
      return binding?.initial && !binding.duplicate && !assignments.has(binding) && !mutations.has(binding) && !seen.has(binding) ? literalProjection(binding.initial, new Set(seen).add(binding)) : undefined
    }
    if (node.type !== 'MemberExpression') return node
    const object = literalProjection(node.object as JsNode, seen), key = memberName(node) ?? ((node.property as JsNode).type === 'Literal' && typeof (node.property as JsNode).value === 'number' ? String((node.property as JsNode).value) : undefined)
    if (object?.type === 'ArrayExpression' && key !== undefined && /^\d+$/.test(key)) return ((object.elements as Array<JsNode | null>)[Number(key)]) ?? undefined
    if (object?.type === 'ObjectExpression' && key !== undefined) {
      const prop = (object.properties as JsNode[]).find(item => item.type === 'Property' && !item.computed && keyOf(item.key as JsNode) === key)
      return prop?.kind === 'init' ? prop.value as JsNode : undefined
    }
    return undefined
  }
  const argumentBindings = (node: JsNode): Binding[] => {
    const projected = literalProjection(node)
    if (projected?.type === 'Literal' && (projected.value === null || typeof projected.value !== 'object') || projected?.type === 'TemplateLiteral' && (projected.expressions as JsNode[]).length === 0) return []
    const direct = rootBinding(node)
    if (direct) return [direct]
    if (node.type === 'ObjectExpression') return (node.properties as JsNode[]).flatMap(prop => argumentBindings((prop.type === 'SpreadElement' ? prop.argument : prop.value) as JsNode))
    if (node.type === 'ArrayExpression') return (node.elements as Array<JsNode | null>).flatMap(value => value ? argumentBindings(value) : [])
    return []
  }
  let taintChanged = true
  while (taintChanged) {
    taintChanged = false
    const taint = (binding: Binding) => { if (!taintedDataBindings.has(binding)) { taintedDataBindings.add(binding); taintChanged = true } }
    for (const binding of [...taintedDataBindings]) {
      if (binding.initial) for (const source of argumentBindings(binding.initial)) taint(source)
      if (binding.initial?.type === 'CallExpression') for (const argument of binding.initial.arguments as JsNode[]) for (const source of argumentBindings(argument)) taint(source)
    }
    for (const call of allNodes) {
      if (inLibrary(call) || call.type !== 'CallExpression') continue
      const callee = unwrap(call.callee as JsNode), target = functionValue(callee), args = call.arguments as JsNode[]
      if (isReactEntry(call)) {
        const component = args[0] && functionValue(args[0]), pattern = component && (component.params as JsNode[])[0]
        if (pattern?.type === 'ObjectPattern' && args[1]?.type === 'ObjectExpression') {
          for (const prop of args[1].properties as JsNode[]) {
            const key = prop.type === 'Property' && !prop.computed ? keyOf(prop.key as JsNode) : undefined
            const slot = (pattern.properties as JsNode[]).find(item => item.type === 'Property' && !item.computed && keyOf(item.key as JsNode) === key)
            const parameter = slot && bindingOf(slot.value as JsNode)
            if (!parameter || taintedDataBindings.has(parameter)) for (const binding of argumentBindings(prop.value as JsNode)) taint(binding)
          }
        } else if (!libraryBindings.has(bindingOf(args[0])!) && args[1]) for (const binding of argumentBindings(args[1])) taint(binding)
        continue
      }
      for (let index = 0; index < args.length; index++) {
        if (passiveStateSetters.has(bindingOf(callee)!)) continue
        const param = target ? (target.params as JsNode[])[index] : undefined
        if (param?.type === 'Identifier' && !taintedDataBindings.has(bindingOf(param)!)) continue
        for (const binding of argumentBindings(args[index])) taint(binding)
      }
      if (callee.type === 'MemberExpression' && !dataMethods.has(memberName(callee) ?? '')) {
        const receiver = rootBinding(callee.object as JsNode)
        if (receiver) taint(receiver)
      }
    }
  }
  const expressionBody = (fn: JsNode): JsNode | undefined => {
    const body = fn.body as JsNode
    if (body.type !== 'BlockStatement') return body
    const statements = body.body as JsNode[]
    return statements.length === 1 && statements[0].type === 'ReturnStatement' ? statements[0].argument as JsNode : undefined
  }
  const dataSources = (node: JsNode, locals: Map<Binding, JsNode[]>, seen = new Set<Binding>()): JsNode[] => {
    if (node.type === 'Identifier') {
      const binding = bindingOf(node)
      if (!binding || seen.has(binding)) return []
      if (locals.has(binding)) return locals.get(binding)!
      return binding.initial ? dataSources(binding.initial, locals, new Set(seen).add(binding)) : []
    }
    if (node.type === 'MemberExpression') {
      const key = memberName(node) ?? ((node.property as JsNode).type === 'Literal' && typeof (node.property as JsNode).value === 'number' ? String((node.property as JsNode).value) : undefined)
      if (key === undefined) return []
      const objects = dataSources(node.object as JsNode, locals, seen)
      const values = objects.map(object => {
        if (object.type === 'ArrayExpression' && /^\d+$/.test(key)) return (object.elements as Array<JsNode | null>)[Number(key)] ?? undefined
        if (object.type !== 'ObjectExpression') return undefined
        const properties = object.properties as JsNode[]
        if (properties.some(item => item.type !== 'Property' || item.computed || item.kind !== 'init')) return undefined
        const prop = properties.filter(item => keyOf(item.key as JsNode) === key).at(-1)
        return prop?.value as JsNode | undefined
      })
      return values.length && values.every((value): value is JsNode => !!value) ? values : []
    }
    return [node]
  }
  const dataValue = (node: JsNode, locals = new Map<Binding, JsNode[]>(), seen = new Set<Binding>(), budget = 64): boolean => {
    if (budget <= 0) return false
    const data = (value: JsNode, env = locals) => dataValue(value, env, seen, budget - 1)
    if (node.type === 'Literal' || node.type === 'TemplateLiteral') return true
    if (node.type === 'UnaryExpression' || node.type === 'BinaryExpression') return true
    if (node.type === 'LogicalExpression') return data(node.left as JsNode) && data(node.right as JsNode)
    if (node.type === 'ConditionalExpression') return data(node.consequent as JsNode) && data(node.alternate as JsNode)
    if (node.type === 'ChainExpression') return data(node.expression as JsNode)
    if (node.type === 'ArrayExpression') return (node.elements as Array<JsNode | null>).every(value => !value || data(value.type === 'SpreadElement' ? value.argument as JsNode : value))
    if (node.type === 'ObjectExpression') return (node.properties as JsNode[]).every(prop => prop.type === 'SpreadElement' ? data(prop.argument as JsNode) : prop.type === 'Property' && prop.kind === 'init' && !prop.method && data(prop.value as JsNode))
    if (node.type === 'Identifier') {
      const binding = bindingOf(node)
      if (!binding || binding.duplicate || taintedDataBindings.has(binding) || assignments.has(binding)) return false
      if (locals.has(binding) || dataBindings.has(binding)) return true
      if (!binding.initial || seen.has(binding) || objectAssigns.has(binding)) return false
      return dataValue(binding.initial, locals, new Set(seen).add(binding), budget - 1)
    }
    if (node.type === 'MemberExpression') {
      if (!data(node.object as JsNode)) return false
      // Indexed reads can yield prototype methods. They are not fresh data
      // provenance for another receiver unless consumed structurally.
      const own = dataSources(node, locals)
      if (own.length && own.every(value => value !== node && data(value))) return true
      let use = parents.get(node)
      if (use?.type === 'ChainExpression') use = parents.get(use)
      while (use?.type === 'MemberExpression') { use = parents.get(use); if (use?.type === 'ChainExpression') use = parents.get(use) }
      return use?.type === 'UnaryExpression' || use?.type === 'BinaryExpression' || use?.type === 'SpreadElement'
    }
    if (node.type !== 'CallExpression') return false
    const callee = unwrap(node.callee as JsNode), args = node.arguments as JsNode[]
    if (callee.type === 'MemberExpression') {
      const name = memberName(callee)
      if (name === 'useMemo' && libraryBindings.has(bindingOf(callee.object as JsNode)!) && args[0]) {
        const fn = functionValue(args[0]), body = fn && (fn.params as JsNode[]).length === 0 ? expressionBody(fn) : undefined
        return !!body && data(body)
      }
      if (!name || !dataMethods.has(name) || !data(callee.object as JsNode)) return false
      if (['includes', 'indexOf'].includes(name)) return true
      const fn = args[0] && functionValue(args[0]), body = fn && expressionBody(fn)
      if (!fn || !body || (fn.params as JsNode[]).some(param => param.type !== 'Identifier')) return false
      const env = new Map(locals)
      const elements = dataSources(callee.object as JsNode, locals).flatMap(source => source.type === 'ArrayExpression' ? (source.elements as Array<JsNode | null>).filter((value): value is JsNode => !!value) : [])
      for (const [index, param] of (fn.params as JsNode[]).entries()) { const binding = bindingOf(param); if (binding) env.set(binding, index === 0 ? elements : []) }
      return data(body, env)
    }
    return false
  }
  for (const node of allNodes) {
    if (inLibrary(node) || node.type !== 'VariableDeclarator' || (node.id as JsNode).type !== 'ArrayPattern') continue
    const init = node.init as JsNode | undefined, callee = init?.type === 'CallExpression' ? unwrap(init.callee as JsNode) : undefined
    if (!callee || callee.type !== 'MemberExpression' || memberName(callee) !== 'useState' || !libraryBindings.has(bindingOf(callee.object as JsNode)!)) continue
    const [state, setter] = (node.id as JsNode).elements as Array<JsNode | null>, initial = (init!.arguments as JsNode[])[0]
    if (!state || !setter || state.type !== 'Identifier' || setter.type !== 'Identifier' || !initial || !dataValue(initial)) continue
    const stateBinding = bindingOf(state), setterBinding = bindingOf(setter)
    if (!stateBinding || !setterBinding || stateBinding.duplicate || setterBinding.duplicate || mutations.has(stateBinding) || assignments.has(stateBinding) || mutations.has(setterBinding) || assignments.has(setterBinding)) continue
    const updaterParams = new Set<Binding>()
    const valid = allNodes.filter(ref => isReference(ref) && bindingOf(ref) === setterBinding).every(ref => {
      const call = parents.get(ref)
      if (call?.type !== 'CallExpression' || call.callee !== ref || (call.arguments as JsNode[]).length !== 1) return false
      const value = (call.arguments as JsNode[])[0]
      if (!FUNCTIONS.has(value.type)) return dataValue(value)
      const params = value.params as JsNode[], body = expressionBody(value)
      if (params.length !== 1 || params[0].type !== 'Identifier' || !body) return false
      const parameter = bindingOf(params[0])
      if (!parameter || !dataValue(body, new Map([[parameter, [initial]]]))) return false
      updaterParams.add(parameter)
      return true
    })
    if (valid) { dataBindings.add(stateBinding); for (const parameter of updaterParams) dataBindings.add(parameter) }
  }
  // A DOM collection is not plain JSON, but reading one of its elements is not a URL capability.
  // Permit only element use through known DOM members; calls/aliases/computed sinks stay audited below.
  const domMembers = new Set(['classList', 'textContent', 'innerText', 'style', 'querySelector', 'querySelectorAll',
    'focus', 'blur', 'scrollIntoView', 'getAttribute', 'setAttribute', 'addEventListener', 'removeEventListener',
    'src', 'href', 'poster', 'srcset', 'value', 'checked', 'disabled', 'hidden'])
  const indexedDomUse = (node: JsNode): boolean => {
    const use = parents.get(node)
    return use?.type === 'MemberExpression' && use.object === node && domMembers.has(memberName(use) ?? '')
  }
  const domCollection = (node: JsNode, seen = new Set<Binding>()): boolean => {
    if (node.type === 'Identifier') {
      const binding = bindingOf(node)
      if (!binding?.initial || binding.duplicate || seen.has(binding) || assignments.has(binding) || objectAssigns.has(binding)) return false
      // Do not infer collection provenance after replacement, mutation or escape to an unknown function.
      const stable = allNodes.filter(ref => isReference(ref) && bindingOf(ref) === binding).every(ref => {
        const use = parents.get(ref)
        if (use?.type !== 'MemberExpression' || use.object !== ref) return false
        if (memberName(use) === 'length') return parents.get(use)?.type !== 'AssignmentExpression'
        return use.computed === true && indexedDomUse(use)
      })
      return stable && domCollection(binding.initial, new Set(seen).add(binding))
    }
    if (node.type === 'ArrayExpression') {
      const items = node.elements as JsNode[]
      return items.length === 1 && items[0]?.type === 'SpreadElement' && domCollection(items[0].argument as JsNode, seen)
    }
    if (node.type !== 'CallExpression') return false
    const callee = node.callee as JsNode, args = node.arguments as JsNode[]
    if (callee.type !== 'MemberExpression') return false
    const receiver = callee.object as JsNode
    if (receiver.type !== 'Identifier' || bindingOf(receiver)) return false
    if (receiver.name === 'Array' && memberName(callee) === 'from') return args.length === 1 && domCollection(args[0], seen)
    return receiver.name === 'document' && memberName(callee) === 'querySelectorAll' && args.length === 1
  }
  // A local container remains a data receiver when it stores a runtime answer.
  // Its contents need not be statically known: assigning input.value or a function
  // parameter does not turn the container itself into a DOM/style resource sink.
  // This fact does not propagate through indexed reads to the stored value.
  const localContainer = (node: JsNode, seen = new Set<Binding>()): Binding | undefined => {
    if (node.type !== 'Identifier') return undefined
    const binding = bindingOf(node)
    if (!binding?.initial || binding.duplicate || seen.has(binding) || assignments.has(binding)) return undefined
    if (['ArrayExpression', 'ObjectExpression'].includes(binding.initial.type)) return binding
    return localContainer(binding.initial, new Set(seen).add(binding))
  }
  const dataReceiver = (node: JsNode): boolean => !!localContainer(node)
  const inInert = (node: JsNode): boolean => { let current: JsNode | undefined = node; while (current) { if (inertCalls.has(current)) return true; current = parents.get(current) } return false }
  for (const node of allNodes) {
    if (inLibrary(node) || inInert(node)) continue
    const parent = parents.get(node)
    if (!parent) continue
    const name = node.type === 'MemberExpression' ? memberName(node) : node.type === 'Identifier' && isReference(node) && !bindingOf(node) ? String(node.name) : undefined
    if (node.type === 'MemberExpression' && node.computed && name === undefined
      && !dataReceiver(node.object as JsNode)
      && ((parent.type === 'CallExpression' && parent.callee === node) || !dataValue(node.object as JsNode))
      && !(indexedDomUse(node) && domCollection(node.object as JsNode))
      && !resourceInputs.some(input => input.value === node && input.proof.kind === 'proven-resource')
      && !((node.property as JsNode).type === 'Literal' && typeof (node.property as JsNode).value === 'number')) capabilityErrors.push(node)
    if (name && networks.has(name)) networkCalls.push(node)
    else if (name && ['eval', 'Function', 'Reflect', 'constructor', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', '__lookupGetter__', '__lookupSetter__'].includes(name)) capabilityErrors.push(node)
    if (node.type === 'MemberExpression' && setters.has(name ?? '') && !(parent.type === 'CallExpression' && parent.callee === node)) capabilityErrors.push(node)
    if (node.type === 'ObjectPattern' && (node.properties as JsNode[]).some(prop => prop.type === 'Property' && (prop.computed || keyOf(prop.key as JsNode) === 'style' || setters.has(keyOf(prop.key as JsNode) ?? '') || networks.has(keyOf(prop.key as JsNode) ?? '')))) capabilityErrors.push(node)
    if (!styleReceiver(node) || (node.type === 'Identifier' && !isReference(node))) continue
    const alias = (parent.type === 'VariableDeclarator' && parent.init === node && (parent.id as JsNode).type === 'Identifier')
      || (parent.type === 'AssignmentExpression' && parent.operator === '=' && parent.right === node && (parent.left as JsNode).type === 'Identifier')
    const member = parent.type === 'MemberExpression' && parent.object === node && memberName(parent) !== undefined
    if (!alias && !member) capabilityErrors.push(node)
  }
  return {
    frameworkError,
    resourceInputs,
    exclusiveDefinitions,
    deadDefinitions,
    definitionBackedUses,
    embeddedInputs,
    capabilityErrors,
    networkCalls,
    styleReceiver,
    dataReceiver,
    memberName,
    auditedNode: node => !!audited && !frameworkError && inLibrary(node),
    internalSink(node) {
      if (!audited || frameworkError) return UNKNOWN_PROOF
      const kind = audited.internalSinks.get(node)
      return kind === 'proven-state' ? { kind } : kind === 'proven-resource' ? { kind, literals: [] } : UNKNOWN_PROOF
    },
  }
}
