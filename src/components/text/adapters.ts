import type { ComponentDefinition, ComponentEdit, ComponentInstance, JsonValue } from '../../shared/contracts/component-platform'
import { plainDocumentText } from '../../shared/document/content'
import { documentMathOmml } from '../../shared/document/omml'
import { formulaComponentDataSchema, textComponentDataSchema, type FormulaComponentData, type TextComponentData } from './data'
import { formulaComponentHtml, styledTextContent, textComponentHtml, type TextLayoutResult } from './render'

export const TEXT_DEFINITION: ComponentDefinition = { id: 'guoling.text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' }, title: '文字' }
export const FORMULA_DEFINITION: ComponentDefinition = { id: 'guoling.formula', role: 'content', implementation: { kind: 'builtin', key: 'guoling.formula' }, title: '公式' }
/** Schemas parse first; the operation boundary serializes actual JSON, without imposing an index signature on professional types. */
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
export function textDataEdit(instanceId: string, data: TextComponentData): Extract<ComponentEdit, { type: 'data.set' }> {
  return { type: 'data.set', instanceId, path: [], value: json(textComponentDataSchema.parse(data)) }
}
export function formulaDataEdit(instanceId: string, data: FormulaComponentData): Extract<ComponentEdit, { type: 'data.set' }> {
  return { type: 'data.set', instanceId, path: [], value: json(formulaComponentDataSchema.parse(data)) }
}
/** Host submits this alongside the content edit, or after an accepted local measurement. */
export function textHeightEdit(instance: ComponentInstance, layout: TextLayoutResult): ComponentEdit | null {
  if (!instance.frame || Math.abs(instance.frame.height - layout.height) <= 0.5) return null
  return { type: 'frame.set', instanceId: instance.id, frame: { ...instance.frame, transform: [...instance.frame.transform], height: layout.height } }
}
export const textOutputAdapter = {
  html: textComponentHtml,
  text: (data: TextComponentData) => plainDocumentText(data.content),
  inlines: (data: TextComponentData) => structuredClone(styledTextContent(data).inlines),
  /** Professional exporters retain box/paragraph semantics alongside semantic inlines. */
  appearance: (data: TextComponentData) => structuredClone(data.appearance),
}
export const formulaOutputAdapter = {
  html: formulaComponentHtml,
  text: (data: FormulaComponentData) => data.formula.accessibleText,
  omml: (data: FormulaComponentData) => documentMathOmml(data.formula.latex, true),
  appearance: (data: FormulaComponentData) => structuredClone(data.appearance),
}
