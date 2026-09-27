import type { RuntimeLayerItem } from '../../shared/courseProjectTypes'
import type { PublishedRuntimeLayerItem } from '../../shared/publishedCourseTypes'
import type { DeepReadonly } from '../course/flowEditorView'
import { bytesToBase64 } from '../export/base64'

/** The authoring host executes the same V9 source and managed bindings as publication. */
export function projectFlowRuntimeForAuthoring(
  item: DeepReadonly<RuntimeLayerItem>,
): PublishedRuntimeLayerItem['runtime'] {
  const source = item.runtime.source
  const bytes = new Uint8Array(source.length * 2)
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index)
    bytes[index * 2] = unit & 0xff
    bytes[index * 2 + 1] = unit >>> 8
  }
  return {
    protocol: item.runtime.protocol,
    runtimeApiVersion: item.runtime.runtimeApiVersion,
    enabled: item.runtime.enabled,
    renderMode: item.runtime.renderMode,
    code: { encoding: 'base64-utf16le', data: bytesToBase64(bytes) },
    // This is a disposable execution snapshot. Host light edits must never mutate V9.
    content: {
      values: { ...item.runtime.content.values },
      ...(item.runtime.content.metadata ? { metadata: Object.fromEntries(
        Object.entries(item.runtime.content.metadata).map(([key, value]) => [key, { ...value }]),
      ) } : {}),
      ...(item.runtime.content.overrides ? { overrides: item.runtime.content.overrides.map(rule => ({ ...rule })) } : {}),
    },
    assets: Object.fromEntries(
      Object.entries(item.runtime.assets).map(([key, binding]) => [key, { assetId: binding.assetId }]),
    ),
    ...(item.runtime.nodeBindings ? { nodeBindings: { ...item.runtime.nodeBindings } } : {}),
    ...(item.runtime.staticFallback ? { staticFallback: { ...item.runtime.staticFallback } } : {}),
  }
}
