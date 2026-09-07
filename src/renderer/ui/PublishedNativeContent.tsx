import { useLayoutEffect, useRef } from 'react'
import {
  nativeRenderInputFromLayerItem,
  paintPublishedNativeRenderInput,
  type NativeLayerRenderSource,
} from '../../player/surfaces/native/publishedNativeRendering'

/** Content only. The Surface owns frame, rotation, opacity, selection and history. */
export function PublishedNativeContent({ item, assetUrls, size }: {
  readonly item: NativeLayerRenderSource
  readonly assetUrls: Readonly<Record<string, string>>
  readonly size?: { readonly width: number; readonly height: number }
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const container = ref.current
    if (!container) return
    // A new content root also isolates pending image/formula paints from stale input.
    const content = container.ownerDocument.createElement('div')
    Object.assign(content.style, { width: '100%', height: '100%', pointerEvents: 'none' })
    content.inert = true
    container.replaceChildren(content)
    const input = nativeRenderInputFromLayerItem(size ? { ...item, frame: { ...item.frame, ...size } } : item)
    paintPublishedNativeRenderInput(content, input, { resolveAsset: id => assetUrls[id] })
    const video = content.querySelector('video')
    if (video) {
      video.controls = false
      video.muted = true
      if (input.type === 'video' && input.poster.assetId) video.poster = assetUrls[input.poster.assetId] ?? ''
    }
    return () => {
      if (video && !video.paused) video.pause()
      content.remove()
    }
  }, [item, assetUrls, size?.width, size?.height])
  return <div ref={ref} data-native-authoring-content={item.content.nativeType}
    style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
}
