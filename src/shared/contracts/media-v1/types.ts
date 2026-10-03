export type AssetKind = 'image' | 'audio' | 'video' | 'font'
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

export const ASSET_SOURCE_KINDS = ['user-material', 'model-svg', 'open-library', 'image-model', 'asset-library'] as const
/** Where a managed asset came from: user material, a model-drawn SVG, an open image library, an image model or the asset library. */
export type AssetSourceKind = typeof ASSET_SOURCE_KINDS[number]

export const ASSET_SOURCE_KIND_LABELS: Readonly<Record<AssetSourceKind, string>> = {
  'user-material': '用户材料', 'model-svg': '模型绘制', 'open-library': '开放图库', 'image-model': '图像模型生成', 'asset-library': '资产库',
}

/** One line for lists: kind, licence and author. */
export function assetSourceSummary(source: AssetSource): string {
  return [`来源：${ASSET_SOURCE_KIND_LABELS[source.kind]}`, source.license?.id, source.author].filter(Boolean).join(' · ')
}

/** Every recorded fact, one per line. */
export function assetSourceDetail(source: AssetSource): string {
  return [
    `来源：${ASSET_SOURCE_KIND_LABELS[source.kind]}`,
    source.title && `标题：${source.title}`,
    source.author && `作者：${source.author}`,
    source.license && `授权：${source.license.id}${source.license.url ? `（${source.license.url}）` : ''}`,
    source.url && `出处：${source.url}`,
    source.attribution && `署名：${source.attribution}`,
  ].filter(Boolean).join('\n')
}

/** Provenance kept with an asset; `attribution` is the credit text shown with the course. */
export interface AssetSource {
  kind: AssetSourceKind
  title?: string
  /** Page the asset was taken from. */
  url?: string
  author?: string
  license?: { id: string; url?: string }
  attribution?: string
}

export interface RuntimeAsset {
  meta: AssetMeta
  bytes: Uint8Array
  url: string
}

export type RuntimeAssetMap = Record<string, RuntimeAsset>
