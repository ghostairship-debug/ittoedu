import { z } from 'zod'
import type { ComponentEdit, CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform/project'
import { equalComponentValue } from '../../shared/componentValue'
import { documentTextStyleSchema } from '../../shared/document/content'
import { textAppearanceSchema } from '../../components/text/data'
import { componentDataEdits, type ComponentDataTarget } from './componentDataEdits'

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
      textAppearanceSchema.partial().parse(fields)
      edits.push(...componentDataEdits(project, target, { kind: 'patch', data: { appearance: fields } }))
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
