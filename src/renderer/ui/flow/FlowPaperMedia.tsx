import { useState } from 'react'
import type { FlowMediaBlock } from '../../../shared/contracts/course-project-v9/types'
import { flowMediaCropGeometry, type FlowImageSource } from '../../../shared/flowMediaCrop'
import { pendingImageUrl } from '../../../player/composition/compositionHostDocument'

/** The same crop projection can be consumed by authoring, Player and static export. */
export function FlowPaperMedia({ block, url, source }: { block: FlowMediaBlock; url?: string; source?: FlowImageSource }) {
  const [natural, setNatural] = useState<FlowImageSource | null>(null)
  if (!block.assetId) return <FlowPendingMedia block={block} />
  if (block.mediaKind === 'image') {
    if (!block.crop) return <img data-flow-asset-id={block.assetId} data-flow-media-kind="image" src={url} alt={block.altText ?? ''} style={{ maxWidth: '100%', display: 'block' }} />
    const geometry = flowMediaCropGeometry(source ?? natural ?? { width: 1, height: 1 }, block)
    return <div data-flow-asset-id={block.assetId} data-flow-media-kind="image" style={{ width: '100%', maxWidth: '100%', aspectRatio: geometry.dom.wrapperAspectRatio, overflow: 'hidden', position: 'relative' }}>
      <img src={url} alt={block.altText ?? ''} onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        style={{ position: 'absolute', display: 'block', maxWidth: 'none', width: geometry.dom.imageWidth, height: geometry.dom.imageHeight, left: geometry.dom.imageLeft, top: geometry.dom.imageTop }} />
    </div>
  }
  if (block.mediaKind === 'video') return <video data-flow-asset-id={block.assetId} data-flow-media-kind="video" src={url} aria-label={block.altText ?? ''} controls muted playsInline preload="metadata" style={{ maxWidth: '100%', display: 'block' }} />
  return <div className="flow-media-placeholder" data-flow-media-kind="audio">音频占位符</div>
}

/** A written asset slot that nothing fills yet: the same placeholder playback shows. */
export function FlowPendingMedia({ block }: { block: FlowMediaBlock }) {
  const label = block.altText || block.source || ''
  if (block.mediaKind === 'image') return <img data-flow-media-pending="true" data-flow-media-kind="image" src={pendingImageUrl(label)} alt={block.altText ?? ''}
    title={block.source} style={{ maxWidth: '100%', display: 'block' }} />
  return <div className="flow-media-placeholder" data-flow-media-pending="true" data-flow-media-kind={block.mediaKind} title={block.source}>
    {block.mediaKind === 'video' ? '待填视频' : '待填音频'}{label ? `：${label}` : ''}
  </div>
}
