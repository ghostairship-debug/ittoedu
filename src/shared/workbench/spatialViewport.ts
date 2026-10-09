import { z } from 'zod'
import { componentSpatialPoseSchema } from '../contracts/component-platform'

export const spatialViewportRequestSchema = z.object({ documentId: z.string().min(1), epoch: z.string().min(1), surfaceId: z.string().min(1) }).strict()
export type SpatialViewportRequest = z.infer<typeof spatialViewportRequestSchema>
/** Transient facts read from the original Spatial view owner; never author state or a new write grant. */
export const spatialViewportCaptureSchema = spatialViewportRequestSchema.extend({ revision: z.number().int().nonnegative(),
  pose: componentSpatialPoseSchema, viewport: z.object({ width: z.number().finite().positive(), height: z.number().finite().positive() }).strict(),
  source: z.literal('spatial-view-state'),
}).strict()
export type SpatialViewportCapture = z.infer<typeof spatialViewportCaptureSchema>
