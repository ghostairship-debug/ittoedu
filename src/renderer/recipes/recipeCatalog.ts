/** The sole product catalog. UI, Builder and generated capabilities project this value. */
export const RECIPE_CATALOG = [
  { id: 'cover-v1', version: 1, label: '封面', fields: [
    { key: 'title', label: '标题', value: '一起探索新知识' },
    { key: 'subtitle', label: '副标题', value: '观察 · 思考 · 表达' },
    { key: 'author', label: '署名', value: '教师 / 班级' },
    { key: 'visual', label: '视觉槽位说明', value: '在这里放入主题图片' },
  ] },
  { id: 'concept-v1', version: 1, label: '概念讲解', fields: [
    { key: 'title', label: '概念', value: '什么是分数？' },
    { key: 'explanation', label: '解释', value: '把一个整体平均分成若干份，表示其中一份或几份的数叫作分数。' },
    { key: 'example', label: '例证', value: '把一个苹果平均分成四份，其中一份就是四分之一。' },
    { key: 'visual', label: '视觉槽位说明', value: '放入四等分示意图' },
  ] },
  { id: 'worked-example-v1', version: 1, label: '分步例题', fields: [
    { key: 'title', label: '题干', value: '怎样计算 24 × 15？' },
    { key: 'steps', label: '步骤（每行一步）', value: '把 15 拆成 10 + 5\n分别计算 24 × 10 和 24 × 5\n把 240 和 120 相加' },
    { key: 'conclusion', label: '结论', value: '24 × 15 = 360' },
    { key: 'hint', label: '提示', value: '运用乘法分配律，把复杂计算变简单。' },
  ] },
  { id: 'step-reveal-v1', version: 1, label: '逐步揭示', fields: [
    { key: 'title', label: '标题', value: '观察一粒种子的生长' },
    { key: 'steps', label: '步骤（每行一步）', value: '种子吸收水分\n胚根首先突破种皮\n胚芽生长，形成幼苗' },
    { key: 'initialStep', label: '初始显示步数', value: '0' },
  ] },
  { id: 'choice-feedback-v1', version: 1, label: '选择与反馈', fields: [
    { key: 'title', label: '题干', value: '下面哪个数是偶数？' },
    { key: 'options', label: '选项（每行一个）', value: '3\n8\n11' },
    { key: 'correct', label: '正确选项序号（从 1 开始）', value: '2' },
    { key: 'success', label: '正确反馈', value: '答对了！8 能被 2 整除。' },
    { key: 'failure', label: '错误反馈', value: '再想一想：偶数能被 2 整除。' },
  ] },
  { id: 'classify-sort-v1', version: 1, label: '分类 / 排序', fields: [
    { key: 'title', label: '标题', value: '把项目放进合适的组' },
    { key: 'mode', label: '模式（classify 或 sort）', value: 'classify' },
    { key: 'groups', label: '分类组（每行一个）', value: '动物\n植物' },
    { key: 'items', label: '项目（每行：稳定 ID | 文字 | 分类组名）', value: 'cat | 小猫 | 动物\ntree | 大树 | 植物\nbird | 小鸟 | 动物' },
    { key: 'correctOrder', label: '排序正确顺序（稳定 ID，用逗号分隔）', value: 'tree,cat,bird' },
    { key: 'success', label: '正确反馈', value: '全部正确！' },
    { key: 'failure', label: '错误反馈', value: '还需要调整，再试一次。' },
  ] },
] as const

export type RecipeId = typeof RECIPE_CATALOG[number]['id']
export interface RecipeInput {
  readonly recipeId: RecipeId
  readonly target: { readonly projectId: string; readonly revision: number; readonly locationId: string; readonly sessionGeneration?: number }
  readonly slots: Readonly<Record<string, string>>
  readonly accentTokenId?: string
}
export function recipeDefaults(id: RecipeId): Record<string, string> {
  return Object.fromEntries(RECIPE_CATALOG.find(entry => entry.id === id)!.fields.map(field => [field.key, field.value]))
}
