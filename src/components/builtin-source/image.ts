import type { ComponentRuntimeImplementation } from '../../shared/contracts/component-platform/runtime'
import { createImageRuntimeImplementation } from '../image/runtime'
import type { ImageData } from '../image/data'

/** The same host resource URLs and diagnostics used by the shared image runtime. */
const implementation: ComponentRuntimeImplementation<ImageData> = {
  mount(context) {
    return createImageRuntimeImplementation(assetId => {
      const url = context.resources?.url(assetId)
      // Unknown animation metadata remains unknown, matching the shared builtin.
      return url ? { url } : undefined
    }, diagnostic => context.scope.events.emit('component.diagnostic', {
      instanceId: context.instance.id, ...diagnostic,
    })).mount(context)
  },
}
export default implementation
