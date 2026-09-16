import { documentTextSlots, plainDocumentText } from '../document/content'
import { parseDocumentMath } from '../document/math'
import type { CourseProjectDocument } from '../courseProjectTypes'
import type { NativeChartContent } from '../contracts/native-v1/types'
import { parseFormulaLinear, formulaAstContainsSlot } from '../formulaLinear'
import { analyzeFormulaNodeLayout } from '../formulaRenderer'
import { evaluateAssessment } from '../assessmentEvaluators'
import { isSingleChoiceStateKey } from '../singleChoiceRuleFamily'
import { allLayerVisits, slideScenes, visitCourseFlowBlocks } from './internal'
import type { CourseProjectHealthFindingDraft } from './types'

export type ContentQaCode = 'content-math-parse' | 'content-math-render' | 'content-answer-mismatch' | 'content-chart-mismatch' | 'content-source-missing'
export interface ContentQaFinding extends Omit<CourseProjectHealthFindingDraft, 'code'> {
  code: ContentQaCode
  evidence: string
  suggestion: string
}
interface TextEntry { text: string; path: Array<string | number>; scope: string }
interface ChartEntry { data: NativeChartContent; scope: string }

/** Read-only deterministic checks. Explicit claims are ordinary portable text,
 * not project metadata: 公式：linear; 答案：option; 图表：title / series / category = number.
 * Unmarked prose and opaque extension evaluators are outside this collector.
 */
export function collectCourseProjectContentHealth(project: CourseProjectDocument): ContentQaFinding[] {
  const findings: ContentQaFinding[] = []
  const texts: TextEntry[] = []
  const charts: ChartEntry[] = []
  const add = (code: ContentQaCode, path: Array<string | number>, message: string, evidence: string, suggestion: string) => {
    findings.push({ code, severity: 'warning', path, message, evidence, suggestion })
  }
  for (const { item, path, owner } of allLayerVisits(project)) {
    if (item.kind !== 'native') continue
    const scope = owner.kind === 'scene' ? owner.sceneId : owner.kind === 'global' ? 'global' : owner.surfaceId
    if (item.content.nativeType === 'text') texts.push({ text: item.content.data.text, path: [...path, 'content', 'data', 'text'], scope })
    if (item.content.nativeType === 'chart') charts.push({ data: item.content.data, scope })
    if (item.content.nativeType === 'formula') {
      const data = item.content.data
      if (formulaAstContainsSlot(data.ast)) add('content-math-parse', path, `公式“${item.label}”仍有未填写的结构槽位。`, '语义公式 AST 包含 slot', '补全公式槽位后重新检查。')
      const layout = analyzeFormulaNodeLayout({ ...data, ...item.frame, id: item.layerItemId, name: item.label, type: 'formula', rotation: item.rotation, opacity: item.opacity, visible: item.visible, locked: item.locked, playbackInitialVisibility: item.playbackInitialVisibility })
      if (layout.overflowsWidth || layout.overflowsHeight) add('content-math-render', path, `公式“${item.label}”排版超出文本框。`, `需要 ${Math.ceil(layout.requiredWidth)} × ${Math.ceil(layout.requiredHeight)}，当前 ${item.frame.width} × ${item.frame.height}（${layout.measurementMode}）`, '扩大公式框或减小字号，并在实际页面复核。')
    }
  }
  visitCourseFlowBlocks(project, ({ block, path, surfaceId }) => {
    for (const slot of documentTextSlots(block)) texts.push({ text: plainDocumentText(slot.content), path: [...path, slot.key], scope: surfaceId })
    if (block.type === 'chart') charts.push({ data: block.chart, scope: surfaceId })
    const formulas = block.type === 'formula' ? [block] : documentTextSlots(block).flatMap(slot => slot.content.inlines.filter(inline => inline.type === 'math'))
    for (const formula of formulas) try { parseDocumentMath(formula.latex) } catch (error) { add('content-math-parse', path, '流式公式语法无效。', error instanceof Error ? error.message : '公式解析失败', '在公式编辑器中修正当前公式。') }
    if (block.type === 'quote' && (!block.citation || !plainDocumentText(block.citation).trim() || /^(待补|待补充|未知|TODO)$/i.test(plainDocumentText(block.citation).trim()))) add('content-source-missing', [...path, 'citation'], '引用段落缺少来源定位。', `引用：${plainDocumentText(block.content).slice(0, 120)}`, '填写可识别的材料标题与页码、章节或 URL。')
  })
  for (const entry of texts) for (const line of entry.text.split(/\r?\n/)) {
    const formula = /^\s*公式[：:]\s*(.*)$/.exec(line)
    if (formula) {
      try {
        if (!formula[1]!.trim() || formulaAstContainsSlot(parseFormulaLinear(formula[1]!))) throw new Error('公式为空或仍含槽位')
      } catch (error) { add('content-math-parse', entry.path, '标记公式无法按编辑器的线性公式语法解析。', `${line}；${error instanceof Error ? error.message : '解析失败'}`, '使用公式编辑器修正表达式；普通叙述不要使用“公式：”检查标记。') }
    }
    const source = /^\s*来源[：:]\s*(.*)$/.exec(line)
    if (source && (!source[1]!.trim() || /^(待补|待补充|未知|TODO)$/i.test(source[1]!.trim()) || /[（(]\s*[）)]\s*$/.test(source[1]!))) add('content-source-missing', entry.path, '可见来源行缺少来源或定位。', line, '补全材料名称及页码、章节、原文件位置或 URL。')
    const claim = /^\s*图表[：:]\s*(.+?)\s*\/\s*(.+?)\s*\/\s*(.+?)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*$/i.exec(line)
    if (claim) {
      const matches = charts.filter(c => c.scope === entry.scope && c.data.title === claim[1])
      const series = matches.length === 1 ? matches[0]!.data.series.filter(s => s.name === claim[2]) : []
      const categories = matches.length === 1 ? matches[0]!.data.categories.filter(c => c.label === claim[3]) : []
      const points = series.length === 1 && categories.length === 1 ? series[0]!.points.filter(p => p.categoryId === categories[0]!.id) : []
      if (points.length !== 1) add('content-chart-mismatch', entry.path, '图表正文主张无法唯一定位到数据点。', line, '检查同一页面或流式文档内的图表标题、系列名和分类名。')
      else if (points[0]!.value !== Number(claim[4])) add('content-chart-mismatch', entry.path, '图表正文数值与图表数据不一致。', `${line}；图表数据 = ${points[0]!.value}`, '核对原始材料后修正图表或正文；检查不会自动选定正确值。')
    }
  }
  for (const { scene } of slideScenes(project)) {
    const claims = texts.filter(t => t.scope === scene.id).flatMap(t => t.text.split(/\r?\n/).flatMap(line => { const m = /^\s*答案[：:]\s*(.+?)\s*$/.exec(line); return m ? [{ entry: t, answer: m[1]! }] : [] }))
    if (!claims.length) continue
    const families = project.courseState.filter(d => d.valueType === 'boolean' && isSingleChoiceStateKey(d.key)).map(d => ({ key: d.key, rules: scene.interactions.filter(rule => rule.enabled && rule.trigger.type === 'node.click' && rule.actions.some(s => s.action.type === 'node.enter') && rule.actions.some(s => s.action.type === 'course-state.set' && s.action.key === d.key)) })).filter(f => f.rules.length)
    // A single explicit family is required; no guessing across multiple questions.
    if (families.length !== 1 || families[0]!.rules.some(r => r.conditions.length)) continue
    const acceptedValues: string[] = []
    let readable = true
    for (const rule of families[0]!.rules) {
      if (rule.trigger.type !== 'node.click') continue
      const nodeId = rule.trigger.nodeId
      const item = scene.layerItems.find(i => i.layerItemId === nodeId)
      if (!item || item.kind !== 'native' || item.content.nativeType !== 'text') { readable = false; break }
      if (rule.actions.some(s => s.action.type === 'course-state.set' && s.action.key === families[0]!.key && s.action.value === true)) acceptedValues.push(item.content.data.text)
    }
    if (!readable || acceptedValues.length !== 1) continue
    for (const claim of claims) if (evaluateAssessment({ evaluatorId: 'EVAL-finite-choice-v1', input: claim.answer, acceptedValues }).status !== 'pass') add('content-answer-mismatch', claim.entry.path, '正文答案与当前单选判定结果不一致。', `正文答案：${claim.answer}；当前选项判定接受：${acceptedValues.join('、')}`, '核对题目与选项，再修改正文答案或单选规则。')
  }
  return findings
}
