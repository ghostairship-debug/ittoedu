import { z } from 'zod'
import { componentInstanceSchema } from '../../../shared/contracts/component-platform/schema'
import type { ContentObjectDraft, ContentObjectInput, ContentApplySource } from './types'
import { prepareProfessionalElement, professionalElementKind } from '../../course/professionalElementDefaults'

/** Public admission of the existing identity-free draft. No instance IDs or childIds. */
const fields = componentInstanceSchema.pick({
  definitionId: true, name: true, data: true, authoring: true, style: true, frame: true,
  flowLayout: true, viewportPinned: true, implementationOverride: true,
})
const children = z.lazy(() => z.array(draft)).optional()
const draft: z.ZodType<ContentObjectInput> = z.union([
  fields.extend({ children }).strict(),
  fields.omit({ definitionId: true }).extend({ builtinKey: z.string().min(1), data: fields.shape.data.optional(), children }).strict(),
])

const source = z.object({ kind: z.literal('objects'), objects: z.array(draft).min(1) }).strict()

/** Keep the required internal draft and formal schema unchanged after admission. */
export function normalizeContentObjectSource(value: {
  kind: 'objects'; objects: readonly ContentObjectInput[]
  definitions?: Extract<ContentApplySource, { kind: 'objects' }>['definitions']
  componentFiles?: Extract<ContentApplySource, { kind: 'objects' }>['componentFiles']
}): Extract<ContentApplySource, { kind: 'objects' }> {
  const definitions = [...value.definitions ?? []]
  const visit = (input: ContentObjectInput): ContentObjectDraft => {
    const nested = input.children?.map(visit)
    if ('builtinKey' in input) {
      const kind = professionalElementKind(input.builtinKey)
      if (!kind) throw new Error(`当前内置对象没有可用的专业默认数据：${input.builtinKey}；也可使用已有 definitionId 和 data。`)
      const prepared = prepareProfessionalElement(kind)
      if (!definitions.some(definition => definition.id === prepared.definition.id)) definitions.push(structuredClone(prepared.definition))
      const { builtinKey: _key, children: _children, ...fields } = input
      return { ...fields, definitionId: prepared.definition.id, data: input.data === undefined ? prepared.data : input.data,
        frame: input.frame ?? { width: prepared.width, height: prepared.height, transform: [1, 0, 0, 1, 0, 0] },
        ...(nested ? { children: nested } : {}) }
    }
    const { children: _children, ...fields } = input
    return { ...fields, ...(nested ? { children: nested } : {}) }
  }
  const objects = value.objects.map(visit)
  return { ...value, objects, ...(definitions.length ? { definitions } : {}) }
}

export function parseContentObjectSource(value: unknown): Extract<ContentApplySource, { kind: 'objects' }> {
  return normalizeContentObjectSource(source.parse(value))
}
