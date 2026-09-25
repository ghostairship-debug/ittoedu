import { nanoid } from 'nanoid'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { AudioChannel, AssetMeta, ProjectAudioSettings, SoundDefinition } from '../../shared/contracts/media-v1'
import { commitCourseProjectMutation } from './courseProjectMutation'
import { collectCourseProjectReferences, type CourseProjectReference } from '../../shared/contracts/course-project-v9/references'

const AUDIO_CHANNELS: readonly AudioChannel[] = [
  'music',
  'narration',
  'sfx',
  'ui',
  'video',
]

export interface CourseAudioSettingsPatch {
  defaultMuted?: boolean
  masterVolume?: number
  channelVolumes?: Partial<Record<AudioChannel, number>>
  narrationDucking?: Partial<ProjectAudioSettings['narrationDucking']>
}

function clampVolume(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
}

export function listCourseSoundReferences(project: CourseProjectDocument, soundId: string): CourseProjectReference[] {
  return collectCourseProjectReferences(project).filter(reference => reference.kind === 'sound' && reference.id === soundId)
}

export function createCourseSoundDefinition(meta: AssetMeta, sound?: Partial<Omit<SoundDefinition, 'id' | 'assetId'>>): SoundDefinition {
  if (meta.kind !== 'audio') throw new Error(`声音导入失败：${meta.filename} 不是音频素材`)
  return {
    id: `sound_${nanoid()}`,
    name: sound?.name?.trim() || meta.filename.replace(/\.[^.]+$/, ''),
    assetId: meta.id,
    channel: sound?.channel || 'sfx',
    defaultVolume: sound?.defaultVolume !== undefined ? sound.defaultVolume : 1,
    defaultLoop: sound?.defaultLoop !== undefined ? sound.defaultLoop : false,
  }
}

export function planCreateCourseSound(document: CourseProjectDocument, assetId: string, options?: Partial<Omit<SoundDefinition, 'id' | 'assetId'>>) {
  const asset = document.assets[assetId]
  if (!asset) throw new Error(`找不到声音素材：${assetId}`)
  const sound = createCourseSoundDefinition(asset, options)
  const project = commitCourseProjectMutation(document, draft => { draft.media.audio.sounds[sound.id] = sound })
  return { project, soundId: sound.id }
}

export function planDeleteCourseSound(document: CourseProjectDocument, soundId: string, now?: string): CourseProjectDocument {
  if (!document.media.audio.sounds[soundId]) throw new Error(`找不到声音：${soundId}`)
  if (listCourseSoundReferences(document, soundId).length > 0) throw new Error('该声音仍被交互规则引用。请先删除或改写相关声音动作。')
  return commitCourseProjectMutation(document, draft => { delete draft.media.audio.sounds[soundId] }, now)
}

export function planUpdateCourseSound(document: CourseProjectDocument, soundId: string, patch: Partial<Omit<SoundDefinition, 'id'>>, now?: string): CourseProjectDocument {
  if (!document.media.audio.sounds[soundId]) throw new Error(`找不到声音：${soundId}`)
  let changed = false
  const project = commitCourseProjectMutation(document, (draft) => {
    const sound = draft.media.audio.sounds[soundId]
    if (!sound) return
    if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== sound.name) {
      sound.name = patch.name.trim()
      changed = true
    }
    if (patch.assetId !== undefined && patch.assetId !== sound.assetId) {
      if (!draft.assets[patch.assetId] || draft.assets[patch.assetId]?.kind !== 'audio') {
        throw new Error(`找不到声音素材：${patch.assetId}`)
      }
      sound.assetId = patch.assetId
      changed = true
    }
    if (patch.channel !== undefined && patch.channel !== sound.channel) {
      sound.channel = patch.channel
      changed = true
    }
    if (patch.defaultVolume !== undefined) {
      const next = clampVolume(patch.defaultVolume, sound.defaultVolume)
      if (next !== sound.defaultVolume) {
        sound.defaultVolume = next
        changed = true
      }
    }
    if (patch.defaultLoop !== undefined && patch.defaultLoop !== sound.defaultLoop) {
      sound.defaultLoop = patch.defaultLoop
      changed = true
    }
  }, now)
  return changed ? project : document
}

export function planUpdateCourseAudioSettings(document: CourseProjectDocument, patch: CourseAudioSettingsPatch, now?: string): CourseProjectDocument {
  let changed = false
  const project = commitCourseProjectMutation(document, (draft) => {
    const audio = draft.media.audio
    if (patch.defaultMuted !== undefined && patch.defaultMuted !== audio.defaultMuted) {
      audio.defaultMuted = patch.defaultMuted
      changed = true
    }
    if (patch.masterVolume !== undefined) {
      const next = clampVolume(patch.masterVolume, audio.masterVolume)
      if (next !== audio.masterVolume) {
        audio.masterVolume = next
        changed = true
      }
    }
    if (patch.channelVolumes) {
      for (const channel of AUDIO_CHANNELS) {
        const value = patch.channelVolumes[channel]
        if (value === undefined) continue
        const next = clampVolume(value, audio.channelVolumes[channel])
        if (next !== audio.channelVolumes[channel]) {
          audio.channelVolumes[channel] = next
          changed = true
        }
      }
    }
    if (patch.narrationDucking?.enabled !== undefined
      && patch.narrationDucking.enabled !== audio.narrationDucking.enabled) {
      audio.narrationDucking.enabled = patch.narrationDucking.enabled
      changed = true
    }
    if (patch.narrationDucking?.musicVolume !== undefined) {
      const next = clampVolume(
        patch.narrationDucking.musicVolume,
        audio.narrationDucking.musicVolume,
      )
      if (next !== audio.narrationDucking.musicVolume) {
        audio.narrationDucking.musicVolume = next
        changed = true
      }
    }
    if (
      patch.narrationDucking?.fadeMs !== undefined
      && Number.isFinite(patch.narrationDucking.fadeMs)
    ) {
      const next = Math.max(0, Math.round(patch.narrationDucking.fadeMs))
      if (next !== audio.narrationDucking.fadeMs) {
        audio.narrationDucking.fadeMs = next
        changed = true
      }
    }
  }, now)
  return changed ? project : document
}
