import { z } from 'zod'
import type { ComponentEdit, CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform/project'
import { equalComponentValue } from '../../shared/componentValue'
import { documentTextStyleSchema } from '../../shared/document/content'
import { formulaComponentDataSchema, textAppearanceSchema, textComponentDataSchema, type FormulaComponentData, type TextComponentData, type TextAppearance } from '../../components/text/data'
import { componentDataEdits, componentDataPropertyFields, type ComponentDataField, type ComponentDataTarget } from './componentDataEdits'

/** Absolute whole-object size/color keep existing local fields, links and identities. */
export function wholeTextAppearanceFields(data: TextComponentData | FormulaComponentData,
  appearance: Partial<Pick<TextAppearance, 'fontSize' | 'color'>>): ComponentDataField[] {
  const fields: ComponentDataField[] = []
  for (const field of ['fontSize', 'color'] as const) {
    const value = appearance[field]
    if (value === undefined) continue
    if ('formula' in data) {
      fields.push({ path: data.formula.style?.[field] !== undefined ? ['formula', 'style', field] : ['appearance', field], value })
    } else {
      fields.push({ path: ['appearance', field], value })
      data.content.inlines.forEach((inline, index) => {
        if (Object.hasOwn(inline.style ?? {}, field)) fields.push({ path: ['content', 'inlines', String(index), 'style', field], value })
      })
    }
  }
  return fields
}

/** Professional appearance rules shared by insertion and existing-object edits. */
export function componentAppearanceEdits(project: CourseProjectV10, target: ComponentDataTarget,
  appearance: Record<string, JsonValue>): ComponentEdit[] {
  const instance = project.instances[target.instanceId]
  if (!instance) throw new Error('原对象已不存在')
  const builtin = componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
  const fields = { ...appearance }, edits: ComponentEdit[] = []
  if (builtin === 'guoling.text' || builtin === 'guoling.formula') {
    if (Object.hasOwn(fields, 'shadows')) {
      const shadows = z.array(z.object({ x: z.number().finite(), y: z.number().finite(),
        blur: z.number().finite().nonnegative(), color: documentTextStyleSchema.shape.color.unwrap() }).strict()).parse(fields.shadows)
      const value = shadows.length ? shadows.map(shadow => `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}`).join(', ') : 'none'
      if (!equalComponentValue(instance.style?.textShadow, value)) edits.push({ type: 'style.set', instanceId: instance.id, path: ['textShadow'], value })
      delete fields.shadows
    }
    if (Object.keys(fields).length) {
      const appearance = textAppearanceSchema.partial().parse(fields)
      const data = builtin === 'guoling.text' ? textComponentDataSchema.parse(instance.data) : formulaComponentDataSchema.parse(instance.data)
      const planned = wholeTextAppearanceFields(data, {
        fontSize: Object.hasOwn(fields, 'fontSize') ? appearance.fontSize : undefined,
        color: Object.hasOwn(fields, 'color') ? appearance.color : undefined,
      })
      const defaults = { ...fields }; delete defaults.fontSize; delete defaults.color
      for (const field of planned) if (field.path[0] === 'appearance') defaults[field.path[1]!] = field.value
      const defaultsFields = Object.keys(defaults).length ? componentDataPropertyFields(instance.data, { appearance: defaults }, builtin) : []
      const combinedFields = [...defaultsFields, ...planned.filter(field => field.path[0] !== 'appearance')]
      if (combinedFields.length) edits.push(...componentDataEdits(project, target, { kind: 'fields', fields: combinedFields }))
    }
  } else if (['guoling.table', 'guoling.chart', 'guoling.shape'].includes(builtin ?? '')) {
    edits.push(...componentDataEdits(project, target, { kind: 'patch', data: { style: fields } }))
  } else if (builtin === 'guoling.image') {
    const forbidden = ['assetId', 'originalAssetId', 'alt'].filter(key => Object.hasOwn(fields, key))
    if (forbidden.length) throw new Error(`外观不能替换资源或正文：${forbidden.join('、')}`)
    edits.push(...componentDataEdits(project, target, { kind: 'patch', data: fields }))
  } else throw new Error('当前对象不支持专业外观参数，请使用已观察的公开 data/style 属性')
  return edits
}
