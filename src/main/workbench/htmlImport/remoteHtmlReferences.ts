import type { ExtractHtmlResourcesResult, ImportDiagnostic, RemoteReference } from './types'

export function remoteHttpsOrigin(reference: RemoteReference): string | null {
  const value = reference.url.trim()
  try {
    const parsed = new URL(value.startsWith('//') ? `https:${value}` : value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) return null
    return parsed.origin
  } catch {
    return null
  }
}

export function remoteReferenceDiagnostic(reference: RemoteReference): ImportDiagnostic {
  const origin = remoteHttpsOrigin(reference)
  if (!origin) {
    const http = /^http:/i.test(reference.url.trim())
    return { level: 'error', code: http ? 'remote-https-required' : 'invalid-remote-url',
      message: http ? `远程资源需要 HTTPS: ${reference.url}` : `远程资源地址无效或不受支持: ${reference.url}`, reference: reference.url }
  }
  if (reference.usage === 'image' || reference.usage === 'media') {
    return { level: 'warning', code: 'remote-media-preserved',
      message: `已保留网络媒体 ${reference.url}；离线时可能无法使用`, reference: reference.url }
  }
  return { level: 'warning', code: reference.usage === 'script' ? 'remote-script'
    : reference.usage === 'stylesheet' ? 'remote-stylesheet'
      : reference.usage === 'font' ? 'remote-font' : 'remote-resource',
  message: `远程${reference.usage === 'stylesheet' ? '样式表' : reference.usage === 'font' ? '字体' : reference.usage === 'script' ? '脚本' : '资源'}已保留: ${reference.url}；预览与发布播放器的 CSP 阻止加载，请内联该库/样式、改用本地字体文件或普通链接`,
  reference: reference.url }
}

/** Only passive media sinks can grant a course an exact network origin. */
export function collectRemoteMediaOrigins(result: ExtractHtmlResourcesResult): string[] {
  return [...new Set(result.remoteReferences
    .filter(reference => reference.usage === 'image' || reference.usage === 'media')
    .map(remoteHttpsOrigin)
    .filter((origin): origin is string => origin !== null))].sort()
}
