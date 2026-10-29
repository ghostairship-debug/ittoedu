import type { AvailableComponentCatalogPackage, AvailableHtmlComponent } from './componentCatalog'
import type { ComponentLibraryEntry, ComponentLibraryUsage } from './contracts/component-platform/library'
import type { CourseProjectV10 } from './contracts/component-platform/project'

export const COMPONENT_LIBRARY_CATEGORIES = [
  { id: 'content', label: '内容与展示' },
  { id: 'layout', label: '布局与容器' },
  { id: 'interaction', label: '互动与导航' },
  { id: 'effects', label: '背景与效果' },
  { id: 'templates', label: '页面与组合模板' },
] as const
export type ComponentLibraryCategory = typeof COMPONENT_LIBRARY_CATEGORIES[number]['id']
export type ComponentLibraryItemType = 'component' | 'container' | 'example-page' | 'template' | 'transition'
export type ComponentLibraryEditable = 'parameters' | 'structure' | 'source'
export interface ComponentLibraryDiscoveryMetadata {
  category: ComponentLibraryCategory
  itemType: ComponentLibraryItemType
  /** Empty means unlabelled. Builtin general-purpose content explicitly uses 通用. */
  subjects: readonly string[]
  schoolStages: readonly string[]
  editable: readonly ComponentLibraryEditable[]
  version?: string
}

/** Read facts only. Insertion, applicability and authorization remain with their existing owners. */
export interface ComponentDiscoveryEntry {
  id: string
  /** Gateway-supplied project locator when more than one readable document may provide a source. */
  project?: string
  title: string
  aliases: readonly string[]
  description: string
  source: { kind: 'builtin' | 'recipe' | 'catalog' | 'work-asset' | 'project' | 'html'; reference: string }
  action: { kind: 'create' | 'template' | 'copy' | 'apply' | 'unavailable'; label: string; tool?: string; input?: Readonly<Record<string, unknown>>; requires?: readonly string[] }
  availability: { available: boolean; reason?: string }
  /** Applicability remains a fact from the library owner, interpreted by library/usage at insertion. */
  usage?: ComponentLibraryUsage
  library?: ComponentLibraryDiscoveryMetadata
  sources?: readonly { instanceId: string; title: string }[]
  preview?: string
}

const ALIASES: Readonly<Record<string, readonly string[]>> = {
  text: ['文本', '文字', '正文', 'paragraph', 'text'], formula: ['公式', '数学', 'formula'],
  image: ['图片', '图像', 'image', 'picture'], video: ['视频', 'video'], audio: ['声音', '音频', 'audio'],
  shape: ['形状', '图形', 'shape'], table: ['表格', 'table', '比较数据', '数据表'],
  chart: ['图表', 'chart', '比较数据', '数据可视化'],
  'chart:bar': ['柱状图', '柱形图', '柱图', '条形图', 'bar', '比较数据'],
  'chart:line': ['折线图', '线图', '趋势图', 'line', '趋势'], 'chart:area': ['面积图', '区域图', 'area'],
  'chart:pie': ['饼图', '饼状图', '占比图', '比例图', 'pie'], 'chart:donut': ['环形图', '甜甜圈图', '环状图', 'donut'],
  input: ['填空题', '输入', '答案', 'input'], navigation: ['全局控制台', '目录', '顶部导航','侧边导航','进度导航','教师控制器', '教师控制台', '控制台', '翻页', '导航', 'navigation'],
  heading: ['标题', 'heading'], quote: ['引用', 'quote'], list: ['列表', 'list'], code: ['代码', 'code'],
  divider: ['分隔线', 'divider'], callout: ['提示框', 'callout'], section: ['折叠节', '章节', 'section'],
  layout_group: ['两列', '双列', '分栏', '图文并排', '并排', 'columns', 'two columns'],
  'concept-v1': ['图文讲解', '概念', '讲解'], 'worked-example-v1': ['分步', '例题'],
  'choice-feedback-v1': ['选择题', '单选', '多选', '反馈', 'quiz'], 'classify-sort-v1': ['分类', '匹配', '排序', '拖拽'],
  'continuous-variable-v1': ['滑杆', '变量', '联动', '参数'], 'step-reveal-v1': ['揭示', '分步', '逐步'],
  'guoling.work.template.mixed-program': ['图文', '混排', '程序', '互动模板'],
  'guoling.work.program': ['程序', '互动', '参数', '速度', '可调程序', 'canvas'],
  'guoling.work.spatial': ['空间', '探索', '无限画布', 'spatial'],
  'guoling.work.flow': ['阅读', '讲义', '正文', 'flow'],
  'guoling.work.presentation': ['状态切换', '状态切换示例页', '局部状态与原生触发', '概览', '细节', '原生触发'],
  'guoling.work.camera': ['镜头导航', '镜头导航示例页', '镜头聚焦与返回', '停靠点', '路径', '空间'],
  'guoling.work.transition.source-control': ['带转场的导航按钮', '源码编排转场控件', '转场', '导航', '按钮'],
}

export function discoveryAliases(id: string): readonly string[] {
  return ALIASES[id] ?? ALIASES[id.replace(/^guoling\./, '')] ?? []
}
const facts = (id: string, title: string, description: string, action: ComponentDiscoveryEntry['action']): ComponentDiscoveryEntry => ({
  id, title, description, aliases: discoveryAliases(id), source: { kind: 'builtin', reference: id }, action,
  availability: { available: true },
})

export const BUILTIN_DISCOVERY_ENTRIES: readonly ComponentDiscoveryEntry[] = [
  ...([['text', '文本'], ['formula', '公式'], ['shape', '形状'], ['table', '表格'], ['chart', '图表'], ['input', '填空输入']] as const)
    .map(([kind, title]) => facts(kind, title, `新建可编辑${title}，使用正式插入服务。`, { kind: 'create', label: `新建${title}`, tool: 'object.insert', input: { kind } })),
  ...(['bar', 'line', 'area', 'pie', 'donut'] as const).map(chartType => facts(`chart:${chartType}`, discoveryAliases(`chart:${chartType}`)[0]!, '使用可编辑图表比较数据、显示趋势或占比。',
    { kind: 'create', label: '新建图表', tool: 'object.insert', input: { kind: 'chart', chartType } })),
  ...(['image', 'video', 'audio'] as const).map(kind => facts(kind, discoveryAliases(kind)[0]!, '选择工程已有素材；图片也可通过 image.search/fetch 获取。',
    { kind: 'create', label: '插入媒体', tool: 'media.insert', requires: ['source：所需媒体的已有素材或来源引用', 'target 或 path：已观察页面'] })),
  { ...facts('navigation', '全局控制台与导航', '整课控制台或内容内目录/顶部/侧边/进度导航；共用正式导航状态与动作。已有全局控制台复用，不占用内容导航实例。', { kind: 'create', label: '添加导航', tool: 'teacher.ensure' }),
    library: { category: 'interaction', itemType: 'component', subjects: ['通用'], schoolStages: ['通用'], editable: ['parameters', 'structure'], version: '1.0.0' } },
  ...([
    ['heading', '<h2>标题</h2>', '标题层级由 h1 至 h6 表达。'],
    ['quote', '<blockquote><p>引用内容</p></blockquote>', '引用可带 footer 出处。'],
    ['list', '<ul><li>项目</li></ul>', '支持 ul/ol 平面列表；嵌套列表会按顺序展平。'],
    ['code', '<pre><code>示例代码</code></pre>', '代码展示块；可用 code 的 language-* class 声明语言。'],
    ['divider', '<hr>', '分隔正文内容。'],
    ['callout', '<aside data-tone="note"><p>提示正文</p></aside>', '提示框使用 aside，tone 可为 note/example/warning/conclusion，可带 header 标题。'],
    ['section', '<details open><summary>章节标题</summary><p>章节正文</p></details>', '折叠节使用 details/summary；open 表示默认展开，HTML section 仅展开内容。'],
  ] as const).map(([blockKind, html, description]) => facts(blockKind, discoveryAliases(blockKind)[0]!, `通过当前 Flow 正文源文新建可编辑块。${description}`,
    { kind: 'create', label: '在当前 Flow 正文新建', tool: 'project.apply',
      input: { intent: 'content', edits: [{ old: '</body>', new: `${html}\n</body>` }] },
      requires: ['path：先 project.list 取得并 project.read 读取当前 Flow 实际 .body.html 路径。',
        'edits：默认在已读正文的唯一 </body> 前新增；可替换片段文字，或改用已读唯一 HTML 边界定位并保留原边界。保留其余正文和正式对象引用。',
        '这是正文源文修改，不能使用 intent:insert；若改用 content，须保留已读完整正文，不能只传新片段覆盖。'] })),
  facts('layout_group', '分栏布局', '把同一正文父级内的内容组成可继续编辑的分栏，支持图文并排和列宽调整。',
    { kind: 'apply', label: '将所选内容分栏', tool: 'object.layout', input: { intent: { kind: 'columns' } },
      requires: ['targets：同一 Flow 正文父级内的已观察整对象句柄；可用 intent.columns 按这些句柄分列，ratios 设置列宽，gap 设置间距'] }),
]

/** One matcher for panels, menus, directory search and AI. Multiple terms rank partial matches. */
export function searchDiscoveryEntries<T extends Pick<ComponentDiscoveryEntry, 'id' | 'title' | 'aliases' | 'description'>>(
  entries: readonly T[], query: string, limit = Number.MAX_SAFE_INTEGER,
): T[] {
  const terms = [...new Set(query.trim().toLocaleLowerCase().split(/[\s,，、;；/]+/).filter(Boolean))]
  return entries.flatMap((entry, index) => {
    const fields: [readonly string[], number][] = [[[entry.title], 6], [entry.aliases, 3], [[entry.description], 2], [[entry.id], 1]]
    let matched = 0, score = 0
    for (const term of terms) {
      const weight = Math.max(0, ...fields.map(([values, value]) => values.some(text => text.toLocaleLowerCase().includes(term)) ? value : 0))
      if (weight) { matched++; score += weight }
    }
    return matched || !terms.length ? [{ entry, matched, score, index }] : []
  }).sort((a, b) => b.matched - a.matched || b.score - a.score || a.index - b.index).slice(0, limit).map(value => value.entry)
}

export function createCatalogDiscoveryEntry(entry: AvailableComponentCatalogPackage): ComponentDiscoveryEntry {
  return { id: entry.packageId, title: entry.name, description: entry.description,
    aliases: [...discoveryAliases(entry.packageId), ...entry.tags, ...entry.subject, ...entry.schoolStage, entry.category ?? ''],
    source: { kind: 'catalog', reference: `${entry.sourceId}:${entry.packageId}@${entry.version}` },
    action: { kind: 'template', label: '从库条目新建', tool: 'asset.use', input: { packageId: entry.packageId, version: entry.version, sourceId: entry.sourceId } },
    library: { ...catalogLibraryKind(entry.category), subjects: entry.subject, schoolStages: entry.schoolStage,
      editable: ['parameters', 'source'], version: entry.version },
    availability: { available: entry.quality !== 'deprecated' && entry.sourceTrust !== 'prompt',
      ...(entry.quality === 'deprecated' ? { reason: '此版本已弃用。' } : entry.sourceTrust === 'prompt' ? { reason: '请在组件库面板确认此目录的信任。' } : {}) },
    ...(entry.thumbnailDataUrl ? { preview: entry.thumbnailDataUrl } : {}) }
}

/** Catalog categories remain open text; unknown categories stay usable as ordinary content. */
function catalogLibraryKind(category = ''): Pick<ComponentLibraryDiscoveryMetadata, 'category' | 'itemType'> {
  if (/模板|template/i.test(category)) return { category: 'templates', itemType: 'template' }
  if (/转场|transition/i.test(category)) return { category: 'effects', itemType: 'transition' }
  if (/背景|效果|background|effect/i.test(category)) return { category: 'effects', itemType: 'component' }
  if (/互动|交互|导航|控制台|interaction|navigation/i.test(category)) return { category: 'interaction', itemType: 'component' }
  if (/布局|布局容器|layout/i.test(category)) return { category: 'layout', itemType: 'container' }
  return { category: 'content', itemType: 'component' }
}

export function createHtmlDiscoveryEntry(entry: AvailableHtmlComponent): ComponentDiscoveryEntry {
  return { id: entry.packageId, title: entry.name, description: entry.description,
    aliases: [...entry.tags, ...entry.subject, ...entry.schoolStage, entry.sourceCourse ?? ''],
    source: { kind: 'html', reference: `${entry.sourceId}:${entry.entry}` }, action: { kind: 'unavailable', label: '查看旧 HTML 条目' },
    availability: { available: false, reason: '旧 HTML 条目当前只支持查看与删除，尚无对应插入入口；原文件保留。' } }
}

export function createWorkAssetDiscoveryEntry(entry: Pick<ComponentLibraryEntry, 'id' | 'title' | 'kind' | 'usage'>): ComponentDiscoveryEntry {
  const usage = entry.usage?.kind
  const category: ComponentLibraryCategory = usage === 'container' ? 'layout'
    : usage === 'program' || usage === 'presentation' || usage === 'camera' || entry.id === 'guoling.work.transition.source-control' ? 'interaction'
    : usage === 'background' || usage === 'transition' ? 'effects'
    : usage === 'template' ? 'templates' : 'content'
  const itemType: ComponentLibraryItemType = usage === 'container' ? 'container'
    : usage === 'transition' ? 'transition' : usage === 'template' || entry.kind === 'structure' ? 'template'
    : entry.kind === 'page' ? 'example-page' : 'component'
  return { id: entry.id, title: entry.title, aliases: discoveryAliases(entry.id), description: entry.usage?.description ?? '',
    source: { kind: 'work-asset', reference: entry.id },
    library: { category, itemType, subjects: ['通用'], schoolStages: ['通用'], editable: entry.usage?.editable ?? [], version: '1.0.0' },
    action: { kind: entry.usage?.kind === 'transition' ? 'apply' : entry.usage?.kind === 'template' || entry.kind === 'page' || entry.kind === 'structure' ? 'template' : 'create',
      label: entry.usage?.kind === 'transition' ? '应用到所选导航' : entry.usage?.kind === 'template' ? '插入模板' : '新建',
      tool: 'asset.use', input: { packageId: entry.id } }, availability: { available: true }, ...(entry.usage ? { usage: entry.usage } : {}) }
}

export function createRecipeDiscoveryEntries(entries: readonly { id: string; label: string; fields: readonly { key: string; label: string; value: string }[] }[]): ComponentDiscoveryEntry[] {
  return entries.map(entry => ({ id: entry.id, title: entry.label, aliases: discoveryAliases(entry.id),
    description: entry.fields.map(field => field.label).join('、'), source: { kind: 'recipe', reference: entry.id },
    action: { kind: 'template', label: '应用预置', tool: 'surface.recipe', input: { recipeId: entry.id, slots: Object.fromEntries(entry.fields.map(field => [field.key, field.value])) } },
    availability: { available: true } }))
}

/** A project definition is an existing example, never an invented default factory. */
export function createProjectDefinitionDiscoveryEntries(project: Pick<CourseProjectV10, 'definitions' | 'instances'>,
  scope: { definitionIds: readonly string[]; instanceIds: readonly string[] },
  catalog: readonly AvailableComponentCatalogPackage[] = []): ComponentDiscoveryEntry[] {
  const definitionIds = new Set(scope.definitionIds), instanceIds = new Set(scope.instanceIds)
  return Object.values(project.definitions).filter(definition => definitionIds.has(definition.id)).map(definition => {
    const instances = Object.values(project.instances).filter(instance => instanceIds.has(instance.id) && instance.definitionId === definition.id)
    const sources = instances.map(instance => ({ instanceId: instance.id, title: instance.name ?? instance.id }))
    const library = definition.library?.packageId ? catalog.find(entry => entry.packageId === definition.library!.packageId
      && entry.sourceTrust !== 'prompt' && entry.quality !== 'deprecated') : undefined
    if (library) return { ...createCatalogDiscoveryEntry(library), id: definition.id, sources }
    return { id: definition.id, title: definition.title ?? definition.id, aliases: discoveryAliases(definition.id),
      description: `${instances.length} 个可读现有实例；先选择来源，再复制其当前内容。`, source: { kind: 'project', reference: definition.id },
      action: { kind: 'copy', label: '复制现有实例', tool: 'object.structure', input: { action: 'duplicate' }, requires: ['target：用 project 定位来源工程，从 sources 选择实例并读取其对象句柄；可选 destination：已观察目标容器'] },
      sources,
      availability: { available: instances.length > 0,
        ...(instances.length ? {} : { reason: '当前可读范围没有可复制的实例；请从真实库条目插入。' }) } }
  })
}
