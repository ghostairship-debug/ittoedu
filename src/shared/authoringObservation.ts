import { z } from 'zod'

const revision = z.number().int().nonnegative()
const identity = z.string().min(1).max(500)
const relativePath = z.string().min(1).max(1000).refine(value =>
  !value.includes('\\') && !value.includes(':') && !value.includes('\0') && !value.startsWith('/')
  && !value.split('/').some(part => !part || part === '.' || part === '..'), '需要观察根内的相对文件路径')

export const authoringObservationFileSchema = z.object({
  fileId: identity,
  relativePath,
  mediaType: z.string().min(1).max(100),
  byteLength: revision,
  role: z.enum(['structure', 'image', 'runtime-evidence']),
}).strict()

/** A captured current view, never a saved camera frame or camera.home. */
export const authoringObservationSpatialViewSchema = z.object({
  camera: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().positive() }).strict(),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() }).strict(),
  coordinateSpace: z.literal('world'),
  cameraAnchor: z.literal('viewport-center'),
  globalCoordinateSpace: z.literal('viewport'),
}).strict()
export type AuthoringObservationSpatialView = z.infer<typeof authoringObservationSpatialViewSchema>

/** Renderer facts only. Main binds the task, workspace epoch and observation ID. */
export const authoringObservationInputSchema = z.object({
  documentRevision: revision,
  sessionGeneration: revision,
  draftEpoch: revision,
  viewEpoch: revision,
  runtime: z.object({ sessionId: identity, stateVersion: revision }).strict().nullable(),
  surfaceId: identity,
  locationId: identity,
  stateId: identity.nullable(),
  source: z.enum(['authoring', 'trial', 'preview']),
  spatialView: authoringObservationSpatialViewSchema.optional(),
  capturedAt: revision,
  files: z.array(authoringObservationFileSchema).min(1).max(10000),
}).strict().superRefine((observation, context) => {
  for (const key of ['fileId', 'relativePath'] as const) {
    if (new Set(observation.files.map(file => file[key])).size !== observation.files.length) {
      context.addIssue({ code: 'custom', message: `重复观察文件 ${key}` })
    }
  }
  if (!observation.files.some(file => file.role === 'image')) {
    context.addIssue({ code: 'custom', message: '当前画面观察必须包含真实截图' })
  }
  if (observation.source !== 'authoring' && observation.runtime === null) {
    context.addIssue({ code: 'custom', message: '运行观察必须属于实际宿主会话' })
  }
})

export type AuthoringObservationInput = z.infer<typeof authoringObservationInputSchema>
export type AuthoringObservationFile = z.infer<typeof authoringObservationFileSchema>
export type AuthoringObservationSource = AuthoringObservationInput['source']

export interface AuthoringObservationResourceFile {
  path: string
  encoding: 'utf8' | 'base64'
  content: string
  mediaType: string
  role: AuthoringObservationFile['role']
}

export interface AuthoringObservationCaptureRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AuthoringObservationCaptureImage {
  dataUrl: string
  capturedAt: number
  width: number
  height: number
}
