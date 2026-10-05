import type { ComponentRuntimeImplementation } from '../../shared/contracts/component-platform/runtime'
import type { AudioData } from '../media/data'
import { createAudioRuntimeImplementation } from '../media/runtime'

const implementation: ComponentRuntimeImplementation<AudioData> = {
  mount(context) {
    if (!context.media) throw new Error('音频源码需要文档媒体端口')
    return createAudioRuntimeImplementation({
      resolveAssetUrl: assetId => context.resources?.url(assetId),
      report: diagnostic => context.scope.events.emit('component.diagnostic', { instanceId: context.instance.id, ...diagnostic }),
    }).mount(context)
  },
}
export default implementation
