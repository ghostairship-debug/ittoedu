import { z } from 'zod'

import type { AssetMeta, ProjectMediaSettings } from './types'

const finiteNumber = z.number().finite()
const unitInterval = finiteNumber.min(0).max(1)

const audioChannelVolumesSchema = z.object({
  music: unitInterval,
  narration: unitInterval,
  sfx: unitInterval,
  ui: unitInterval,
  video: unitInterval,
}).strict()

const soundDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  assetId: z.string().min(1),
  channel: z.enum(['music', 'narration', 'sfx', 'ui']),
  defaultVolume: unitInterval,
  defaultLoop: z.boolean(),
}).strict()

const narrationDuckingSchema = z.object({
  enabled: z.boolean(),
  musicVolume: unitInterval,
  fadeMs: finiteNumber.min(0).max(10_000),
}).strict()

export const projectMediaSettingsSchema: z.ZodType<ProjectMediaSettings> = z.object({
  audio: z.object({
    defaultMuted: z.boolean(),
    masterVolume: unitInterval,
    channelVolumes: audioChannelVolumesSchema,
    sounds: z.record(z.string(), soundDefinitionSchema),
    narrationDucking: narrationDuckingSchema,
  }).strict(),
}).strict()

export const assetMetaSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  path: z.string().min(1).refine((assetPath) => !/^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(assetPath), {
    message: '素材路径必须是相对路径',
  }),
  byteLength: z.number().int().nonnegative(),
  width: finiteNumber.positive().optional(),
  height: finiteNumber.positive().optional(),
  kind: z.enum(['image', 'audio', 'video']),
  duration: finiteNumber.nonnegative().optional(),
}).strict()

const courseProjectStableIdSchema = z.string().trim().min(1).max(240)
const courseProjectPortablePathSchema = z.string().min(1).refine(
  (value) => !/^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(value),
  'Path must be project-relative',
)
const courseProjectAssetRemoteDeliveryUrlSchema = z.string().trim().min(1).max(2_000).refine(
  (value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && url.username === '' && url.password === ''
    } catch {
      return false
    }
  },
  'Remote asset delivery URL must be an https URL without credentials',
)

type CourseProjectAssetMeta = AssetMeta & {
  remote?: { url: string }
}

/** Exact Course Project V9 asset metadata profile. */
export const courseProjectAssetMetaSchema: z.ZodType<CourseProjectAssetMeta> = z.object({
  id: courseProjectStableIdSchema,
  filename: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().min(1).max(200),
  kind: z.enum(['image', 'audio', 'video']),
  path: courseProjectPortablePathSchema,
  byteLength: z.number().int().nonnegative(),
  width: finiteNumber.positive().optional(),
  height: finiteNumber.positive().optional(),
  duration: finiteNumber.nonnegative().optional(),
  remote: z.object({
    url: courseProjectAssetRemoteDeliveryUrlSchema,
  }).strict().optional(),
}).strict()

const courseProjectAudioChannelVolumesSchema = z.object({
  music: unitInterval,
  narration: unitInterval,
  sfx: unitInterval,
  ui: unitInterval,
  video: unitInterval,
}).strict()

const courseProjectSoundDefinitionSchema = z.object({
  id: courseProjectStableIdSchema,
  name: z.string().trim().min(1).max(200),
  assetId: courseProjectStableIdSchema,
  channel: z.enum(['music', 'narration', 'sfx', 'ui']),
  defaultVolume: unitInterval,
  defaultLoop: z.boolean(),
}).strict()

const courseProjectNarrationDuckingSchema = z.object({
  enabled: z.boolean(),
  musicVolume: unitInterval,
  fadeMs: finiteNumber.nonnegative().max(10_000),
}).strict()

/** Exact Course Project V9 media settings profile. */
export const courseProjectMediaSettingsSchema: z.ZodType<ProjectMediaSettings> = z.object({
  audio: z.object({
    defaultMuted: z.boolean(),
    masterVolume: unitInterval,
    channelVolumes: courseProjectAudioChannelVolumesSchema,
    sounds: z.record(z.string(), courseProjectSoundDefinitionSchema),
    narrationDucking: courseProjectNarrationDuckingSchema,
  }).strict(),
}).strict()
