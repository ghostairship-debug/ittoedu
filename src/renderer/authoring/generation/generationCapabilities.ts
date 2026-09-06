import { z } from 'zod'
import { componentManifestSchema } from '../../../shared/componentSchema'
import componentTypes from '../../../shared/contracts/component-v4/types.ts?raw'
import runtimeTypes from '../../../shared/contracts/runtime/types.ts?raw'
import surfaceRuntimeTypes from '../../../shared/contracts/runtime/surface.ts?raw'

/** Shipped contract sources, not a second hand-written API registry. */
export function generationDynamicCapabilities() {
  return {
    component: { manifest: z.toJSONSchema(componentManifestSchema, { io: 'input', reused: 'ref' }), types: componentTypes,
      registration: 'window.CoursewareComponent.define({id: manifest.id, runtimeApiVersion:4, create(ctx){...return {destroy(){...}}}})。files 包含 manifest.json 和该 manifest.entry 指定的 JS。文本文件优先直接给 {encoding:"utf8",text:"完整文件原文"}，不需要CLI编码；二进制文件用base64字符串。可见文字来自 props.content，更新通过 updateProps。先使用当前工程已有组件；新包必须提供 staticFallbackAssetId。' },
    runtime: { api2: runtimeTypes, api3: surfaceRuntimeTypes,
      registration: 'CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){...return {destroy(){...}}}})。优先 API3 DOM：Slide scene-local、Flow surface-local；Spatial Runtime 当前未支持，使用 Component。API2 只用于已支持的 Slide scene/global。source 是普通 JS 字符串，运行时只能调用当前协议提供的接口。后备图片必须是工程中已存在或前序 asset.media.import 新建的图片；不能伪造 assetId。' },
  }
}
