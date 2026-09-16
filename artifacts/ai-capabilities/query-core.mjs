/** Shared, read-only discovery semantics. The generator supplies every entry
 * and resource from product Owners; neither consumers nor queries add tools. */





























/** On disk, resources already exist as readable files. Do not embed another
 * escaped copy (including bundled JS) in one oversized search record. */
export function courseAgentCapabilityDiskIndex(data                           )         {
  return JSON.stringify({ version: data.version, semanticVersion: data.semanticVersion,
    entries: data.entries, resourcePaths: Object.keys(data.files).sort() }, null, 2) + '\n'
}


























const surfaces = ['slide', 'flow', 'spatial-2d']
const owners = ['global', 'surface', 'scene', 'world']
const carriers = ['native', 'recipe', 'existing-component', 'generated-component', 'runtime']
const kinds = ['tool', 'recipe', 'component', 'protocol', 'skill', 'reference']
const tasks = ['create', 'edit', 'repair', 'design']

function object(value         )                      {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('能力数据必须是对象')
  return value
}

function validateQuery(data                           , input                            )       {
  if (data.version !== 1 || !data.semanticVersion) throw new Error('不支持的能力发现数据版本')
  if (input.semanticVersion !== undefined && input.semanticVersion !== data.semanticVersion) throw new Error('能力语义版本已改变，请刷新发现入口')
  const keys = ['query', 'surface', 'owner', 'carrier', 'kind', 'task', 'ids', 'limit', 'semanticVersion', 'operation', 'mode', 'nativeType', 'detail']
  if (Object.keys(object(input)).some(key => !keys.includes(key))) throw new Error('未知能力查询字段')
  for (const [key, values] of [['surface', surfaces], ['owner', owners], ['carrier', carriers], ['kind', kinds], ['task', tasks]]         ) {
    if (input[key] !== undefined && !values.includes(input[key] )) throw new Error(`不支持的能力查询 ${key}: ${input[key]}`)
  }
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 2000)) throw new Error('能力查询文字无效')
  for (const key of ['operation', 'mode', 'nativeType']         ) if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key] .trim())) throw new Error('能力卡选择无效')
  if (input.detail !== undefined && !['summary', 'full'].includes(input.detail)) throw new Error('未知能力查询 detail')
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) throw new Error('能力查询数量须在 1 到 100 之间')
  if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.length > 100 || input.ids.some(id => typeof id !== 'string' || !data.entries.some(entry => entry.id === id)))) throw new Error('未知能力 ID')
  if (input.surface && input.owner && ((input.owner === 'scene' && input.surface !== 'slide') || (input.owner === 'world' && input.surface !== 'spatial-2d'))) throw new Error('能力查询 Surface 与 owner 不匹配')
}

function matchingVariants(entry                            , query                                  ) {
  const scopesMatch = (scopes          ) => scopes.some(scope => (!query.surface || scope.startsWith(`${query.surface}:`)) && (!query.owner || scope.endsWith(`:${query.owner}`)))
  return (entry.variants ?? [{ scopes: entry.scopes }]).filter(variant =>
    (!query.operation || variant.operation === query.operation) && (!query.mode || variant.mode === query.mode)
    && (!query.carrier || (variant.carriers ?? entry.carriers).includes(query.carrier)) && scopesMatch(variant.scopes))
}

export function courseAgentCapabilityCacheKey(data                           , query                             = {})         {
  validateQuery(data, query)
  return JSON.stringify([data.semanticVersion, Object.fromEntries(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)))])
}

export function queryCourseAgentCapabilities(data                           , query                             = {}) {
  validateQuery(data, query)
  const words = (query.query ?? '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matches = data.entries.flatMap(entry => {
    if (query.ids && !query.ids.includes(entry.id)) return []
    if (query.kind && entry.kind !== query.kind) return []
    if (query.carrier && !entry.carriers.includes(query.carrier)) return []
    if (query.surface && !entry.scopes.some(scope => scope.startsWith(`${query.surface}:`) && (!query.owner || scope === `${query.surface}:${query.owner}`))) return []
    if (!query.surface && query.owner && !entry.scopes.some(scope => scope.endsWith(`:${query.owner}`))) return []
    const variants = matchingVariants(entry, query)
    if (!variants.length) return []
    const text = `${entry.id} ${entry.label} ${entry.summary} ${entry.keywords ?? ''}`.toLocaleLowerCase()
    const score = words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0)
    if (words.length && score === 0) return []
    if (query.task === 'design' && !['recipe', 'component', 'reference', 'skill'].includes(entry.kind)) return []
    if (query.task === 'create' && entry.kind === 'tool' && /\.configure$|\.source$|\.package$/.test(entry.id)) return []
    if ((query.task === 'edit' || query.task === 'repair') && entry.kind === 'tool' && /\.insert$|\.import$|^recipe\.apply$/.test(entry.id)) return []
    return [{ entry: entry.variants ? { ...entry, scopes: [...new Set(variants.flatMap(variant => variant.scopes))],
      carriers: [...new Set(variants.flatMap(variant => variant.carriers ?? entry.carriers))], variants } : entry, score }]
  }).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
  return {
    version: 1         , semanticVersion: data.semanticVersion,
    cacheKey: courseAgentCapabilityCacheKey(data, query), total: matches.length,
    entries: matches.slice(0, query.limit ?? 30).map(({ entry }) => {
      const { keywords: _keywords, ...summary } = entry
      return structuredClone(summary)
    }),
    ...(query.detail === 'full' ? { cards: matches.slice(0, query.limit ?? 30).map(({ entry }) => readCourseAgentCapability(data, entry.id,
      Object.fromEntries(Object.entries({ operation: query.operation, mode: query.mode, nativeType: query.nativeType, surface: query.surface, owner: query.owner, carrier: query.carrier }).filter(([, value]) => value !== undefined)))) } : {}),
  }
}

function resolveLocalSchema(root                     , value         )                                  {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  let current = value
  const seen = new Set        ()
  while (typeof current.$ref === 'string' && current.$ref.startsWith('#/')) {
    const reference = current.$ref
    if (seen.has(reference)) throw new Error('能力 Schema 判别器包含循环引用')
    seen.add(reference)
    const resolved = reference.slice(2).split('/').reduce((node     , key        ) => node?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], root)
    if (!resolved || typeof resolved !== 'object') throw new Error(`能力 Schema 缺少依赖 ${reference}`)
    const { $ref: _reference, ...siblings } = current
    current = { ...resolved, ...siblings }
  }
  return current
}
function discriminator(root                     , branch         , field        )                       {
  const value = resolveLocalSchema(root, resolveLocalSchema(root, branch)?.properties?.[field])
  if (typeof value?.const === 'string') return [value.const]
  return Array.isArray(value?.enum) && value.enum.every((item         ) => typeof item === 'string') ? value.enum : undefined
}
function schemaSelection(value         , selectors                        , root                     )          {
  if (Array.isArray(value)) return value.map(child => schemaSelection(child, selectors, root))
  if (!value || typeof value !== 'object') return value
  const result = structuredClone(value)
  for (const union of ['anyOf', 'oneOf']) {
    if (!Array.isArray(result[union])) continue
    for (const [field, wanted] of Object.entries(selectors)) {
      if (!result[union].some((branch     ) => discriminator(root, branch, field) !== undefined)) continue
      const branches = result[union].filter((branch     ) => discriminator(root, branch, field)?.includes(wanted))
      if (branches.length === 0) throw new Error(`当前能力不支持 ${field}=${wanted}`)
      result[union] = branches
    }
  }
  for (const [field, wanted] of Object.entries(selectors)) {
    const values = discriminator(root, result, field)
    if (values && !values.includes(wanted)) throw new Error(`当前能力不支持 ${field}=${wanted}`)
    if (values) result.properties[field] = { ...resolveLocalSchema(root, result.properties[field]), const: wanted }
    if (values) delete result.properties[field].enum
  }
  for (const [key, nested] of Object.entries(result)) {
    if (key !== '$defs' && key !== 'definitions') result[key] = schemaSelection(nested, selectors, root)
  }
  return result
}

/** Keep the complete transitive local $ref closure after selecting a branch. */
function pruneDefinitions(schema                     )                      {
  for (const definitionsKey of ['$defs', 'definitions']) {
    const definitions = schema[definitionsKey]
    if (!definitions || typeof definitions !== 'object') continue
    const required = new Set        ()
    const collect = (value         )       => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(collect); return }
      const node = value
      if (typeof node.$ref === 'string' && node.$ref.startsWith(`#/${definitionsKey}/`)) {
        const name = node.$ref.slice(definitionsKey.length + 3).split('/')[0] .replaceAll('~1', '/').replaceAll('~0', '~')
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

export function readCourseAgentCapability(data                           , id        , options                                   = {}) {
  validateQuery(data, {})
  const entry = data.entries.find(value => value.id === id)
  if (!entry) throw new Error(`未知能力 ID: ${id}`)
  if (Object.keys(object(options)).some(key => !['operation', 'mode', 'nativeType', 'surface', 'owner', 'carrier'].includes(key))) throw new Error('未知能力卡字段')
  for (const value of Object.values(options)) if (typeof value !== 'string' || !value.trim()) throw new Error('能力卡选择无效')
  validateQuery(data, options)
  const variants = matchingVariants(entry, options)
  if ((entry.variants || options.surface || options.owner || options.carrier) && !variants.length) throw new Error('当前能力不支持此 operation/mode/Surface/owner/carrier 组合')
  const text = data.files[entry.path]
  if (text === undefined) throw new Error(`能力资源缺失: ${entry.path}`)
  for (const dependency of entry.dependencies ?? []) if (!data.entries.some(value => value.id === dependency)) throw new Error(`能力依赖缺失: ${dependency}`)
  if (!entry.path.endsWith('.json')) return { version: 1         , semanticVersion: data.semanticVersion, entry: structuredClone(entry), text }
  const content = JSON.parse(text)
  const selectors = Object.fromEntries(Object.entries(options).filter(([key]) => ['operation', 'mode', 'nativeType'].includes(key)))
  // A scoped query may identify a unique operation/mode without naming it.
  // Its schema must describe the same domain as the matched variant metadata.
  if (Object.keys(options).length) for (const field of ['operation', 'mode']         ) {
    const value = variants[0]?.[field]
    if (!selectors[field] && value && variants.every(variant => variant[field] === value)) selectors[field] = value
  }
  if (entry.kind === 'tool' && Object.keys(selectors).length) {
    content.inputSchema = pruneDefinitions(object(schemaSelection(content.inputSchema, selectors, content.inputSchema)))
  }
  for (const [field, wanted] of Object.entries(selectors)) {
    const supported = new Set        ()
    const visit = (value         )       => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(visit); return }
      const node = value
      const selectedValue = discriminator(content.inputSchema, node, field)
      selectedValue?.forEach(value => supported.add(value))
      Object.values(node).forEach(visit)
    }
    visit(content.inputSchema)
    if (!supported.has(wanted)) throw new Error(`当前能力不支持 ${field}=${wanted}`)
  }
  if (entry.kind === 'tool' && Object.keys(selectors).length) {
    if (content.references) {
      content.references = options.operation && options.operation !== 'content' ? undefined
        : options.nativeType && Object.hasOwn(content.references, options.nativeType) ? { [options.nativeType]: content.references[options.nativeType] } : content.references
    }
  }
  if (content.conditions && options.operation) content.conditions = content.conditions.filter((condition                           ) => !condition.operations || condition.operations.includes(options.operation ))
  if (content.variants) content.variants = content.variants.filter((variant                              ) => variants.some(match => match.operation === variant.operation && match.mode === variant.mode))
  if (content.variants) content.supportedScopes = [...new Set(variants.flatMap(variant => variant.scopes))]
  if (content.examples && Object.keys(selectors).length) {
    content.examples = content.examples.filter((example     ) => Object.entries(selectors).every(([field, wanted]) => example[field] === undefined || example[field] === wanted))
    if (options.nativeType && content.examples.some((example     ) => example.nativeType === options.nativeType)) content.examples = content.examples.filter((example     ) => example.nativeType === options.nativeType)
  }
  return { version: 1         , semanticVersion: data.semanticVersion, entry: structuredClone(entry.variants ? { ...entry, scopes: content.supportedScopes,
    carriers: [...new Set(variants.flatMap(variant => variant.carriers ?? entry.carriers))], variants } : entry), content }
}

export const courseAgentCapabilityQueryHelp = '保持原生工作目录；node "<query.mjs绝对路径>" [--help] [--id <能力ID> | --query <关键词>] [--operation <操作>] [--mode <模式>] [--nativeType <类型>] [--surface <slide|flow|spatial-2d>] [--owner <global|surface|scene|world>] [--carrier <载体>] [--kind <种类>] [--task <create|edit|repair|design>] [--limit <1..100>] [--semanticVersion <当前版本>] [--summary]。无参数返回精简发现入口；定向查询默认返回完整卡片，--summary 只返回索引。'

/** The generated CLI and app/Builder share parsing-independent query semantics. */
export function runCourseAgentCapabilityQuery(data                           , args                   ) {
  if (!args.length) return JSON.parse(data.files['discovery.json'] )
  if (args.length === 1 && ['--help', '-h'].includes(args[0] )) return courseAgentCapabilityQueryHelp
  const query                             = { detail: 'full' }
  let id
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (key === '--summary') { query.detail = 'summary'; continue }
    if (!['--id', '--query', '--operation', '--mode', '--nativeType', '--surface', '--owner', '--carrier', '--kind', '--task', '--limit', '--semanticVersion'].includes(key)) throw new Error(`未知查询参数 ${key}；使用 --help 查看帮助`)
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error(`缺少查询参数值 ${key}`)
    if (key === '--id') id = value
    else Object.assign(query, { [key.slice(2)]: key === '--limit' ? Number(value) : value })
  }
  if (id) query.ids = [id]
  const result = queryCourseAgentCapabilities(data, query)
  if (id && result.total === 0) throw new Error('当前能力不支持此 operation/mode/Surface/owner 组合')
  return id && query.detail === 'full' ? result.cards [0] : result
}
