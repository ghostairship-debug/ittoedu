type Schema = Record<string, unknown>
const record = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value)

// A copied property keeps ordinary root JSON pointers valid because the original
// schema and $defs remain in place. URI scopes and dynamic references are not moved.
function relocatable(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(relocatable)
  if (!record(value)) return true
  return Object.entries(value).every(([key, child]) => !['$id', '$anchor', '$dynamicAnchor', '$dynamicRef', '$recursiveRef'].includes(key)
    && (key !== '$ref' || typeof child === 'string' && child.startsWith('#/')) && relocatable(child))
}

/** Present object-union fields to MCP clients that index only root properties.
 * The original union remains authoritative; added constraints are redundant.
 * Ordinary schemas and unfamiliar union shapes are returned without mutation.
 */
export function mcpObjectInputSchema(schema: Schema): Schema {
  if (schema.type !== 'object' || schema.properties !== undefined || schema.unevaluatedProperties !== undefined) return schema
  const variants = schema.oneOf ?? schema.anyOf
  if (!Array.isArray(variants) || !variants.length) return schema
  // The canonical object.insert catalog reuses whole branches through root $defs.
  // Resolve only this known pointer form; leave scoped or unfamiliar refs alone.
  const resolved = variants.map(branch => {
    if (!record(branch) || Object.keys(branch).length !== 1 || typeof branch.$ref !== 'string') return branch
    const match = /^#\/\$defs\/([^/]+)$/.exec(branch.$ref)
    const name = match?.[1].replace(/~1/g, '/').replace(/~0/g, '~')
    return name && record(schema.$defs) && Object.hasOwn(schema.$defs, name) ? schema.$defs[name] : branch
  })
  if (!resolved.every(branch => record(branch) && branch.type === 'object' && record(branch.properties))) return schema
  const branches = resolved as Array<Schema & { properties: Schema }>
  const keys = [...new Set(branches.flatMap(branch => Object.keys(branch.properties)))]
  const properties: Schema = {}
  for (const key of keys) {
    // An open branch can accept any value for an undeclared field. Applying a
    // restrictive projected schema would then change the original acceptance set.
    if (branches.some(branch => !Object.hasOwn(branch.properties, key)
      && (branch.additionalProperties !== false || branch.patternProperties !== undefined))
      || branches.some(branch => ['$id', '$anchor', '$dynamicAnchor'].some(name => name in branch))) {
      properties[key] = {}; continue
    }
    const values = branches.filter(branch => Object.hasOwn(branch.properties, key)).map(branch => branch.properties[key])
    if (!values.every(relocatable)) { properties[key] = {}; continue }
    const distinct = [...new Map(values.map(value => [JSON.stringify(value), value])).values()]
    properties[key] = distinct.length === 1 ? distinct[0] : { anyOf: distinct }
  }
  const common = (Array.isArray(branches[0].required) ? branches[0].required : [])
    .filter((key): key is string => typeof key === 'string' && branches.every(branch => Array.isArray(branch.required) && branch.required.includes(key)))
  const required = [...new Set([...(Array.isArray(schema.required) ? schema.required : []), ...common])]
  return { ...schema, properties, ...(required.length ? { required } : {}) }
}

