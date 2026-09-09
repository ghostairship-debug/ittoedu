/** Shared, read-only discovery semantics. The generator supplies every entry
 * and resource from product Owners; neither consumers nor queries add tools. */
export interface CourseAgentCapabilityEntry {
  id: string
  kind: 'tool' | 'recipe' | 'component' | 'protocol' | 'skill' | 'reference'
  label: string
  path: string
  scopes: string[]
  carriers: string[]
  summary: string
  keywords?: string
  dependencies?: string[]
  available?: boolean
}

export interface CourseAgentCapabilityData {
  version: 1
  semanticVersion: string
  entries: CourseAgentCapabilityEntry[]
  files: Record<string, string>
}

export interface CourseAgentCapabilityQuery {
  query?: string
  surface?: 'slide' | 'flow' | 'spatial-2d'
  owner?: 'global' | 'surface' | 'scene' | 'world'
  carrier?: 'native' | 'recipe' | 'existing-component' | 'generated-component' | 'runtime'
  kind?: CourseAgentCapabilityEntry['kind']
  task?: 'create' | 'edit' | 'repair' | 'design'
  ids?: string[]
  limit?: number
  semanticVersion?: string
}

export interface CourseAgentCapabilityCardOptions {
  operation?: string
  nativeType?: string
}

const surfaces = ['slide', 'flow', 'spatial-2d']
const owners = ['global', 'surface', 'scene', 'world']
const carriers = ['native', 'recipe', 'existing-component', 'generated-component', 'runtime']
const kinds = ['tool', 'recipe', 'component', 'protocol', 'skill', 'reference']
const tasks = ['create', 'edit', 'repair', 'design']

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('能力数据必须是对象')
  return value as Record<string, any>
}

function validateQuery(data: CourseAgentCapabilityData, input: CourseAgentCapabilityQuery): void {
  if (data.version !== 1 || !data.semanticVersion) throw new Error('不支持的能力发现数据版本')
  if (input.semanticVersion !== undefined && input.semanticVersion !== data.semanticVersion) throw new Error('能力语义版本已改变，请刷新发现入口')
  const keys = ['query', 'surface', 'owner', 'carrier', 'kind', 'task', 'ids', 'limit', 'semanticVersion']
  if (Object.keys(object(input)).some(key => !keys.includes(key))) throw new Error('未知能力查询字段')
  for (const [key, values] of [['surface', surfaces], ['owner', owners], ['carrier', carriers], ['kind', kinds], ['task', tasks]] as const) {
    if (input[key] !== undefined && !values.includes(input[key]!)) throw new Error(`不支持的能力查询 ${key}: ${input[key]}`)
  }
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 2000)) throw new Error('能力查询文字无效')
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) throw new Error('能力查询数量须在 1 到 100 之间')
  if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.length > 100 || input.ids.some(id => typeof id !== 'string' || !data.entries.some(entry => entry.id === id)))) throw new Error('未知能力 ID')
  if (input.surface && input.owner && ((input.owner === 'scene' && input.surface !== 'slide') || (input.owner === 'world' && input.surface !== 'spatial-2d'))) throw new Error('能力查询 Surface 与 owner 不匹配')
}

export function courseAgentCapabilityCacheKey(data: CourseAgentCapabilityData, query: CourseAgentCapabilityQuery = {}): string {
  validateQuery(data, query)
  return JSON.stringify([data.semanticVersion, Object.fromEntries(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)))])
}

export function queryCourseAgentCapabilities(data: CourseAgentCapabilityData, query: CourseAgentCapabilityQuery = {}) {
  validateQuery(data, query)
  const words = (query.query ?? '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matches = data.entries.flatMap(entry => {
    if (query.ids && !query.ids.includes(entry.id)) return []
    if (query.kind && entry.kind !== query.kind) return []
    if (query.carrier && !entry.carriers.includes(query.carrier)) return []
    if (query.surface && !entry.scopes.some(scope => scope.startsWith(`${query.surface}:`) && (!query.owner || scope === `${query.surface}:${query.owner}`))) return []
    if (!query.surface && query.owner && !entry.scopes.some(scope => scope.endsWith(`:${query.owner}`))) return []
    const text = `${entry.id} ${entry.label} ${entry.summary} ${entry.keywords ?? ''}`.toLocaleLowerCase()
    const score = words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0)
    if (words.length && score === 0) return []
    if (query.task === 'design' && !['recipe', 'component', 'reference', 'skill'].includes(entry.kind)) return []
    if (query.task === 'create' && entry.kind === 'tool' && /\.configure$|\.source$|\.package$/.test(entry.id)) return []
    if ((query.task === 'edit' || query.task === 'repair') && entry.kind === 'tool' && /\.insert$|\.import$|^recipe\.apply$/.test(entry.id)) return []
    return [{ entry, score }]
  }).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
  return {
    version: 1 as const, semanticVersion: data.semanticVersion,
    cacheKey: courseAgentCapabilityCacheKey(data, query), total: matches.length,
    entries: matches.slice(0, query.limit ?? 30).map(({ entry }) => {
      const { keywords: _keywords, ...summary } = entry
      return structuredClone(summary)
    }),
  }
}

function resolveLocalSchema(root: Record<string, any>, value: unknown): Record<string, any> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  let current = value as Record<string, any>
  const seen = new Set<string>()
  while (typeof current.$ref === 'string' && current.$ref.startsWith('#/')) {
    const reference = current.$ref
    if (seen.has(reference)) throw new Error('能力 Schema 判别器包含循环引用')
    seen.add(reference)
    const resolved = reference.slice(2).split('/').reduce((node: any, key: string) => node?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], root)
    if (!resolved || typeof resolved !== 'object') throw new Error(`能力 Schema 缺少依赖 ${reference}`)
    const { $ref: _reference, ...siblings } = current
    current = { ...resolved, ...siblings }
  }
  return current
}
function discriminator(root: Record<string, any>, branch: unknown, field: string): string | undefined {
  const value = resolveLocalSchema(root, resolveLocalSchema(root, branch)?.properties?.[field])?.const
  return typeof value === 'string' ? value : undefined
}
function schemaSelection(value: unknown, selectors: Record<string, string>, root: Record<string, any>): unknown {
  if (Array.isArray(value)) return value.map(child => schemaSelection(child, selectors, root))
  if (!value || typeof value !== 'object') return value
  const result = structuredClone(value) as Record<string, any>
  for (const union of ['anyOf', 'oneOf']) {
    if (!Array.isArray(result[union])) continue
    for (const [field, wanted] of Object.entries(selectors)) {
      if (!result[union].some((branch: any) => discriminator(root, branch, field) !== undefined)) continue
      const branches = result[union].filter((branch: any) => discriminator(root, branch, field) === wanted)
      if (branches.length === 0) throw new Error(`当前能力不支持 ${field}=${wanted}`)
      result[union] = branches
    }
  }
  for (const [key, nested] of Object.entries(result)) {
    if (key !== '$defs' && key !== 'definitions') result[key] = schemaSelection(nested, selectors, root)
  }
  return result
}

/** Keep the complete transitive local $ref closure after selecting a branch. */
function pruneDefinitions(schema: Record<string, any>): Record<string, any> {
  for (const definitionsKey of ['$defs', 'definitions']) {
    const definitions = schema[definitionsKey]
    if (!definitions || typeof definitions !== 'object') continue
    const required = new Set<string>()
    const collect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(collect); return }
      const node = value as Record<string, any>
      if (typeof node.$ref === 'string' && node.$ref.startsWith(`#/${definitionsKey}/`)) {
        const name = node.$ref.slice(definitionsKey.length + 3).split('/')[0]!.replaceAll('~1', '/').replaceAll('~0', '~')
        if (!Object.hasOwn(definitions, name)) throw new Error(`能力 Schema 缺少依赖 ${node.$ref}`)
        if (!required.has(name)) { required.add(name); collect(definitions[name]) }
      }
      Object.entries(node).forEach(([key, child]) => { if (key !== '$defs' && key !== 'definitions') collect(child) })
    }
    collect(schema)
    schema[definitionsKey] = Object.fromEntries([...required].sort().map(key => [key, definitions[key]]))
    if (required.size === 0) delete schema[definitionsKey]
  }
  return schema
}

export function readCourseAgentCapability(data: CourseAgentCapabilityData, id: string, options: CourseAgentCapabilityCardOptions = {}) {
  validateQuery(data, {})
  const entry = data.entries.find(value => value.id === id)
  if (!entry) throw new Error(`未知能力 ID: ${id}`)
  if (Object.keys(object(options)).some(key => !['operation', 'nativeType'].includes(key))) throw new Error('未知能力卡字段')
  for (const value of Object.values(options)) if (typeof value !== 'string' || !value.trim()) throw new Error('能力卡选择无效')
  const text = data.files[entry.path]
  if (text === undefined) throw new Error(`能力资源缺失: ${entry.path}`)
  for (const dependency of entry.dependencies ?? []) if (!data.entries.some(value => value.id === dependency)) throw new Error(`能力依赖缺失: ${dependency}`)
  if (!entry.path.endsWith('.json')) return { version: 1 as const, semanticVersion: data.semanticVersion, entry: structuredClone(entry), text }
  const content = JSON.parse(text)
  for (const [field, wanted] of Object.entries(options)) {
    const supported = new Set<string>()
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(visit); return }
      const node = value as Record<string, any>
      const selectedValue = discriminator(content.inputSchema, node, field)
      if (selectedValue !== undefined) supported.add(selectedValue)
      Object.values(node).forEach(visit)
    }
    visit(content.inputSchema)
    if (!supported.has(wanted)) throw new Error(`当前能力不支持 ${field}=${wanted}`)
  }
  if (entry.kind === 'tool' && (options.operation || options.nativeType)) {
    const selectors: Record<string, string> = {}
    if (options.operation) selectors.operation = options.operation
    if (options.nativeType) selectors.nativeType = options.nativeType
    content.inputSchema = pruneDefinitions(object(schemaSelection(content.inputSchema, selectors, content.inputSchema)))
    if (content.references) {
      content.references = options.nativeType && Object.hasOwn(content.references, options.nativeType)
        ? { [options.nativeType]: content.references[options.nativeType] }
        : options.operation && options.operation !== 'content' ? undefined : content.references
    }
  }
  return { version: 1 as const, semanticVersion: data.semanticVersion, entry: structuredClone(entry), content }
}
