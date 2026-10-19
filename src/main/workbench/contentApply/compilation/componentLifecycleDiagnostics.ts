import { parse, type ObjectExpression, type Property } from 'acorn'
import type { ComponentCompilationDiagnostic } from '../../../../core/components/compilation/types'

/** Only literal, statically named objects are known here. Delegation and dynamic
 * lifecycle construction stay with the actual runtime contract check. */
function literalProperties(object: ObjectExpression): Map<string, Property> | undefined {
  const properties = new Map<string, Property>()
  for (const property of object.properties) {
    if (property.type !== 'Property' || property.computed || property.kind !== 'init') return undefined
    const key = property.key.type === 'Identifier' ? property.key.name
      : property.key.type === 'Literal' && typeof property.key.value === 'string' ? property.key.value : undefined
    if (key === undefined || key === '__proto__' || properties.has(key)) return undefined
    // Do not infer the effects of getters, factories, shared objects or values
    // evaluated while constructing this object.
    if (!['FunctionExpression', 'ArrowFunctionExpression', 'Literal'].includes(property.value.type)) return undefined
    properties.set(key, property)
  }
  return properties
}

/** Advise on an undeclared lifecycle before observation, without executing
 * Source or claiming its actual inherited/runtime methods are known. */
export function componentLifecycleDiagnostics(source: string, file: string): ComponentCompilationDiagnostic[] {
  let tree: ReturnType<typeof parse>
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true }) }
  catch { return [] } // JSX/unknown syntax remains the compiler/runtime's responsibility.
  const exported = tree.body.find(node => node.type === 'ExportDefaultDeclaration')
  if (exported?.type !== 'ExportDefaultDeclaration' || exported.declaration.type !== 'ObjectExpression') return []
  const mount = literalProperties(exported.declaration)?.get('mount')?.value
  if (!mount || mount.type !== 'FunctionExpression' && mount.type !== 'ArrowFunctionExpression' || mount.generator) return []
  let returned = mount.body
  if (returned.type === 'BlockStatement') {
    // Ordinary DOM/listener preparation may precede this direct return. Branches
    // and try/finally can choose a different result, so leave them to the runtime.
    if (returned.body.slice(0, -1).some(statement => !['ExpressionStatement', 'VariableDeclaration', 'FunctionDeclaration', 'EmptyStatement'].includes(statement.type))) return []
    const statement = returned.body.at(-1)
    if (!statement) return []
    if (statement.type !== 'ReturnStatement' || !statement.argument) return []
    returned = statement.argument
  }
  if (returned.type !== 'ObjectExpression') return []
  const properties = literalProperties(returned)
  // Runtime awaits mount(), so a thenable may resolve to a different object.
  if (!properties || properties.has('then')) return []
  const missing = ['update', 'dispose'].filter(name => !properties.has(name))
  if (!missing.length) return []
  const location = returned.loc!.start
  return [{ stage: 'compile', severity: 'warning', file, line: location.line, column: location.column,
    lineText: source.split(/\r?\n/)[location.line - 1],
    message: `Component API 5 实例需提供 update() / dispose() 生命周期；当前 mount() 直接返回对象未声明 ${missing.map(name => `${name}()`).join(' / ')}，如未由原型或其他实际实现提供会无法挂载。update() 接收当前实例修改，dispose() 释放本次挂载；实际函数由运行时检查。原源码已保留；普通 HTML 内容可沿原 content.html 修改并复用宿主实现。` }]
}
