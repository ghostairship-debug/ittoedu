import { z } from 'zod'
import { componentInstanceSchema } from '../../../shared/contracts/component-platform/schema'
import type { ContentObjectDraft, ContentApplySource } from './types'

/** Public admission of the existing identity-free draft. No instance IDs or childIds. */
const draft: z.ZodType<ContentObjectDraft> = componentInstanceSchema.pick({
  definitionId: true, name: true, data: true, authoring: true, style: true, frame: true,
  flowLayout: true, viewportPinned: true, implementationOverride: true,
}).extend({ children: z.lazy(() => z.array(draft)).optional() }).strict()

const source = z.object({ kind: z.literal('objects'), objects: z.array(draft).min(1) }).strict()
export function parseContentObjectSource(value: unknown): Extract<ContentApplySource, { kind: 'objects' }> {
  return source.parse(value)
}
