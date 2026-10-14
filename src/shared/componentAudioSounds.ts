import type { CourseProjectV10 } from './contracts/component-platform'
import type { SoundDefinition } from './contracts/media-v1/types'

/** A native audio instance already owns this sound identity; these are derived current target facts. */
export function componentAudioSounds(project: CourseProjectV10, instanceIds?: ReadonlySet<string>): Record<string, SoundDefinition> {
  const sounds = { ...(project.media?.audio.sounds ?? {}) }
  for (const instance of Object.values(project.instances)) {
    if (instanceIds && !instanceIds.has(instance.id)) continue
    const definition = project.definitions[instance.definitionId], implementation = instance.implementationOverride ?? definition?.implementation
    if (implementation?.kind !== 'builtin' || implementation.key !== 'guoling.audio') continue
    const data = instance.data
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.assetId !== 'string') continue
    const channel = data.channel === 'music' || data.channel === 'sfx' || data.channel === 'ui' ? data.channel : 'narration'
    sounds[instance.id] = { id: instance.id, name: instance.name ?? (typeof data.title === 'string' && data.title || definition?.title || instance.id),
      assetId: data.assetId, channel, defaultVolume: typeof data.volume === 'number' ? data.volume : 1, defaultLoop: data.loop === true }
  }
  return sounds
}
