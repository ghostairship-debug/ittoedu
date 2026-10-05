import type { ComponentDefinition, ComponentEdit, JsonValue } from '../../shared/contracts/component-platform'
import { audioDataSchema, videoDataSchema, mediaAssetReferences, type AudioData, type VideoData, type MediaData, type MediaKind } from './data'
import { outputMediaHtml, type ResolveMediaAssetUrl } from './render'

const playbackProperties = {
  assetId: { type: 'string', title: '媒体资源' }, title: { type: 'string', title: '标题' },
  autoplay: { type: 'boolean', title: '自动播放' }, loop: { type: 'boolean', title: '循环播放' },
  muted: { type: 'boolean', title: '静音' }, volume: { type: 'number', title: '音量', minimum: 0, maximum: 1, multipleOf: 0.01 },
  playbackRate: { type: 'number', title: '播放速度' }, showControls: { type: 'boolean', title: '显示播放控件' },
  clickToToggle: { type: 'boolean', title: '点击切换播放' }, startTime: { type: 'number', title: '开始时间（秒）', minimum: 0 },
  endTime: { title: '结束时间（秒）', description: '留空值表示播放到结尾。' },
}
export const AUDIO_DEFINITION: ComponentDefinition = { id: 'guoling.audio', title: '音频', role: 'content', implementation: { kind: 'builtin', key: 'guoling.audio' },
  dataSchema: { type: 'object', properties: { ...playbackProperties,
    channel: { type: 'string', title: '声音用途', oneOf: [
      { const: 'music', title: '背景音乐' }, { const: 'narration', title: '旁白' },
      { const: 'sfx', title: '音效' }, { const: 'ui', title: '界面提示' },
    ] },
  } },
}
export const VIDEO_DEFINITION: ComponentDefinition = { id: 'guoling.video', title: '视频', role: 'content', implementation: { kind: 'builtin', key: 'guoling.video' },
  dataSchema: { type: 'object', properties: { ...playbackProperties,
    fit: { type: 'string', title: '显示方式', oneOf: [
      { const: 'contain', title: '适应（完整显示）' }, { const: 'cover', title: '填充（允许裁剪）' }, { const: 'stretch', title: '拉伸' },
    ] },
    backgroundAudioMode: { type: 'string', title: '播放时背景音乐', oneOf: [
      { const: 'none', title: '不处理' }, { const: 'duck', title: '自动降低' },
      { const: 'pause', title: '暂停并恢复' }, { const: 'stop', title: '停止' },
    ] },
    poster: { type: 'object', title: '封面', properties: {
      mode: { type: 'string', title: '封面来源', oneOf: [{ const: 'video-frame', title: '视频画面' }, { const: 'image', title: '图片' }] },
      time: { type: 'number', title: '画面时间（秒）', minimum: 0 }, assetId: { type: 'string', title: '封面图片' },
    } },
  } },
}

export function mediaDataEdit(instanceId: string, data: MediaData): Extract<ComponentEdit, { type: 'data.set' }> {
  const parsed = 'channel' in data ? audioDataSchema.parse(data) : videoDataSchema.parse(data)
  return { type: 'data.set', instanceId, path: [], value: JSON.parse(JSON.stringify(parsed)) as JsonValue }
}
export const audioDataEdit = (instanceId: string, data: AudioData) => mediaDataEdit(instanceId, data)
export const videoDataEdit = (instanceId: string, data: VideoData) => mediaDataEdit(instanceId, data)
export const mediaOutputAdapter = {
  data: (kind: MediaKind, data: MediaData) => kind === 'audio' ? audioDataSchema.parse(data) : videoDataSchema.parse(data),
  resources: mediaAssetReferences,
  html: (kind: MediaKind, data: MediaData, resolveAssetUrl: ResolveMediaAssetUrl) => outputMediaHtml(kind, kind === 'audio' ? audioDataSchema.parse(data) : videoDataSchema.parse(data), resolveAssetUrl),
}
