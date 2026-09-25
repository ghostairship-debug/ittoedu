import { z } from 'zod'
import { courseProjectAudioSettingsSchema, courseProjectSoundDefinitionSchema } from '../../shared/contracts/media-v1'

/** Derived directly from V9; identity, sound map, and asset authority stay host-owned. */
export const audioSettingsPatchSchema = courseProjectAudioSettingsSchema.omit({ sounds: true }).partial().extend({
  channelVolumes: courseProjectAudioSettingsSchema.shape.channelVolumes.partial().optional(),
  narrationDucking: courseProjectAudioSettingsSchema.shape.narrationDucking.partial().optional(),
})
export const soundPropertiesSchema = courseProjectSoundDefinitionSchema.omit({ id: true, assetId: true }).partial()
