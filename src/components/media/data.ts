import { z } from 'zod'

const playback = {
  assetId: z.string().min(1), title: z.string().default(''),
  autoplay: z.boolean().default(false), loop: z.boolean().default(false),
  muted: z.boolean().default(false), volume: z.number().finite().min(0).max(1).default(1),
  playbackRate: z.number().finite().positive().default(1),
  showControls: z.boolean().default(true), clickToToggle: z.boolean().default(false),
  startTime: z.number().finite().nonnegative().default(0),
  endTime: z.number().finite().nonnegative().nullable().default(null),
}
const validRange = (data: { startTime: number; endTime: number | null }, context: z.RefinementCtx) => {
  if (data.endTime !== null && data.endTime < data.startTime) {
    context.addIssue({ code: 'custom', path: ['endTime'], message: '结束时间不能早于开始时间' })
  }
}

export const audioDataSchema = z.object({ ...playback,
  channel: z.enum(['music', 'narration', 'sfx', 'ui']).default('narration'),
}).strict().superRefine(validRange)
export const videoDataSchema = z.object({ ...playback,
  fit: z.enum(['contain', 'cover', 'stretch']).default('contain'),
  poster: z.object({ mode: z.enum(['video-frame', 'image']).default('video-frame'),
    time: z.number().finite().nonnegative().default(0), assetId: z.string().min(1).optional(),
  }).strict().default({ mode: 'video-frame', time: 0 }),
  backgroundAudioMode: z.enum(['none', 'duck', 'pause', 'stop']).default('none'),
}).strict().superRefine(validRange)
export type AudioData = z.infer<typeof audioDataSchema>
export type VideoData = z.infer<typeof videoDataSchema>
export type MediaData = AudioData | VideoData
export type MediaKind = 'audio' | 'video'

export function createAudioData(assetId: string, title = ''): AudioData { return audioDataSchema.parse({ assetId, title }) }
export function createVideoData(assetId: string, title = ''): VideoData { return videoDataSchema.parse({ assetId, title }) }
export function replaceAudioSource(data: AudioData, assetId: string): AudioData { return audioDataSchema.parse({ ...data, assetId }) }
export function replaceVideoSource(data: VideoData, assetId: string): VideoData { return videoDataSchema.parse({ ...data, assetId }) }
export function mediaAssetReferences(data: MediaData): string[] {
  return [...new Set([data.assetId, ...('poster' in data && data.poster.mode === 'image' && data.poster.assetId ? [data.poster.assetId] : [])])]
}
