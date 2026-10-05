import type { ComponentRuntimeImplementation } from '../../shared/contracts/component-platform/runtime'
import type { VideoData } from '../media/data'
import { createVideoRuntimeImplementation } from '../media/runtime'

const implementation: ComponentRuntimeImplementation<VideoData> = {
  mount(context) {
    if (!context.media) throw new Error('视频源码需要文档媒体端口')
    return createVideoRuntimeImplementation({
      resolveAssetUrl: assetId => context.resources?.url(assetId),
      report: diagnostic => context.scope.events.emit('component.diagnostic', { instanceId: context.instance.id, ...diagnostic }),
    }).mount(context)
  },
}
export default implementation
