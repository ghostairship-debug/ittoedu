export type AssetKind = 'image' | 'audio' | 'video'
export type AudioChannel = 'music' | 'narration' | 'sfx' | 'ui' | 'video'

export interface SoundDefinition {
  id: string
  name: string
  assetId: string
  channel: Exclude<AudioChannel, 'video'>
  defaultVolume: number
  defaultLoop: boolean
}

export interface ProjectAudioSettings {
  defaultMuted: boolean
  masterVolume: number
  channelVolumes: Record<AudioChannel, number>
  sounds: Record<string, SoundDefinition>
  narrationDucking: {
    enabled: boolean
    musicVolume: number
    fadeMs: number
  }
}

export interface ProjectMediaSettings {
  audio: ProjectAudioSettings
}

export interface AssetMeta {
  id: string
  filename: string
  mimeType: string
  kind: AssetKind
  path: string
  byteLength: number
  width?: number
  height?: number
  duration?: number
}

export interface RuntimeAsset {
  meta: AssetMeta
  bytes: Uint8Array
  url: string
}

export type RuntimeAssetMap = Record<string, RuntimeAsset>
