import { nanoid } from 'nanoid'
import type { AudioChannel, ProjectAudioSettings, SoundDefinition } from '../../shared/contracts/media-v1'
import type { ComponentEdit, CourseProjectV10 } from '../../shared/contracts/component-platform'

export interface ProjectAudioSettingsPatch {
  defaultMuted?: boolean
  masterVolume?: number
  channelVolumes?: Partial<Record<AudioChannel, number>>
  narrationDucking?: Partial<ProjectAudioSettings['narrationDucking']>
}
export function courseAudioSettings(project: CourseProjectV10 | null): ProjectAudioSettings {
  return project?.media?.audio ?? { defaultMuted: false, masterVolume: 1,
    channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 }, sounds: {},
    narrationDucking: { enabled: false, musicVolume: .25, fadeMs: 300 } }
}
export function courseAudioSettingsEdits(project: CourseProjectV10, patch: ProjectAudioSettingsPatch): ComponentEdit[] {
  const audio = courseAudioSettings(project)
  const next = { ...audio, ...patch, channelVolumes: { ...audio.channelVolumes, ...patch.channelVolumes },
    narrationDucking: { ...audio.narrationDucking, ...patch.narrationDucking } }
  return [{ type: 'project.media.set', media: { audio: next } }]
}
export function courseSoundEdits(project: CourseProjectV10, soundId: string, patch: Partial<Omit<SoundDefinition, 'id'>> | null): ComponentEdit[] {
  const audio = courseAudioSettings(project)
  if (!audio.sounds[soundId]) throw new Error('原声音已不存在')
  const sounds = { ...audio.sounds }
  if (patch === null) delete sounds[soundId]
  else sounds[soundId] = { ...sounds[soundId], ...patch }
  return [{ type: 'project.media.set', media: { audio: { ...audio, sounds } } }]
}
/** Asset bytes stay with the existing resource transaction; this owns sound semantics. */
export function courseSoundImportEdits(project: CourseProjectV10,
  assets: readonly { id: string; kind?: string; filename?: string }[]): ComponentEdit[] {
  const audio = courseAudioSettings(project), sounds = { ...audio.sounds }
  for (const asset of assets) {
    if (asset.kind !== 'audio') throw new Error('声音库只接受音频素材')
    const id = `sound_${nanoid()}`
    sounds[id] = { id, name: (asset.filename ?? asset.id).replace(/\.[^.]+$/, ''), assetId: asset.id,
      channel: 'sfx', defaultVolume: 1, defaultLoop: false }
  }
  return [{ type: 'project.media.set', media: { audio: { ...audio, sounds } } }]
}
