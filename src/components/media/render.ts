import type { MediaData, MediaKind, VideoData } from './data'

export type ResolveMediaAssetUrl = (assetId: string) => string | undefined

/** Browser media is the live projection; the original bytes stay with the host asset service. */
export function renderMedia(document: Document, kind: MediaKind): HTMLMediaElement {
  const element = document.createElement(kind)
  element.preload = 'metadata'
  element.style.width = '100%'
  element.style.height = kind === 'video' ? '100%' : 'auto'
  if (kind === 'video') (element as HTMLVideoElement).playsInline = true
  return element
}

export function applyMediaPresentation(element: HTMLMediaElement, data: MediaData, resolveAssetUrl: ResolveMediaAssetUrl): void {
  element.setAttribute('aria-label', data.title)
  element.controls = data.showControls
  if (element.tagName === 'AUDIO') {
    // Native audio controls have no reliable intrinsic height in the content
    // iframe. Give the visible control strip its own size inside the saved frame.
    element.style.height = data.showControls ? '54px' : 'auto'
    element.style.display = data.showControls ? 'block' : ''
  }
  // Clip looping is handled at the authored endpoint; native looping is for the whole source.
  element.loop = data.loop && data.endTime === null && data.startTime === 0
  element.autoplay = data.autoplay
  element.defaultMuted = data.muted
  if ('fit' in data) {
    const video = element as HTMLVideoElement
    video.style.objectFit = data.fit === 'stretch' ? 'fill' : data.fit
    const poster = data.poster.mode === 'image' && data.poster.assetId ? resolveAssetUrl(data.poster.assetId) : undefined
    if (poster) video.poster = poster
    else video.removeAttribute('poster')
  }
}

/** Native HTML controls and clip; the semantic output data carries host-managed volume/rate/mixing. */
export function outputMediaHtml(kind: MediaKind, data: MediaData, resolveAssetUrl: ResolveMediaAssetUrl): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
  const url = resolveAssetUrl(data.assetId)
  const clipped = url ? `${url.split('#')[0]}#t=${data.startTime}${data.endTime === null ? '' : `,${data.endTime}`}` : ''
  const video = data as VideoData
  const poster = kind === 'video' && video.poster.mode === 'image' && video.poster.assetId ? resolveAssetUrl(video.poster.assetId) : undefined
  return `<${kind}${url ? ` src="${escape(clipped)}"` : ''} aria-label="${escape(data.title)}" preload="metadata"${data.showControls ? ' controls' : ''}${data.autoplay ? ' autoplay' : ''}${data.loop ? ' loop' : ''}${data.muted ? ' muted' : ''}${kind === 'video' ? ' playsinline' : ''}${poster ? ` poster="${escape(poster)}"` : ''} data-volume="${data.volume}" data-playback-rate="${data.playbackRate}"></${kind}>`
}
