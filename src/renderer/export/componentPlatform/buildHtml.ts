import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ComponentCompilationInput } from '../../../core/components/compilation/types'
import { buildPublishedCourseV3 } from '../../../core/publish/componentPlatform'
import { buildComponentSingleHtml } from '../../../core/publish/componentPlatform/buildSingleHtml'
import { loadPlayerBundle } from '../loadPlayerBundle'
import { zipSync, strToU8 } from 'fflate'
import type { SingleHtmlExportMode } from '../course/coursePackagePreflight'

export type ComponentCompilePort = (input: ComponentCompilationInput, signal?: AbortSignal, onProgress?: () => void) => ReturnType<import('../../../core/components/compilation/InMemoryComponentCompilation').InMemoryComponentCompilation['compile']>

/** Export from the captured Session snapshot; rendering never reads the live author store. */
export async function buildComponentPublished(snapshot: DocumentSnapshot, compile: ComponentCompilePort, assetUrl?: import('../../../core/publish/componentPlatform').ComponentPublishOptions['assetUrl'], singleHtmlMode: SingleHtmlExportMode = 'offline-portable', signal?: AbortSignal, onProgress?: () => void) {
  signal?.throwIfAborted()
  if (snapshot.model.kind !== 'course-v10') throw new Error('此导出入口只支持 Project V10')
  const model = snapshot.model
  const result = await buildPublishedCourseV3({ project: model.project, assetBytes: model.resources.assets, componentFiles: model.resources.components }, {
    compilation: { compile }, assetUrl, singleHtmlMode, signal, onProgress,
  })
  return result
}

export async function buildComponentHtml(snapshot: DocumentSnapshot, compile: ComponentCompilePort, mode: SingleHtmlExportMode = 'offline-portable', signal?: AbortSignal, onProgress?: () => void) {
  const result = await buildComponentPublished(snapshot, compile, undefined, mode, signal, onProgress)
  signal?.throwIfAborted()
  return { html: buildComponentSingleHtml(result.payload, loadPlayerBundle()), payload: result.payload,
    diagnostics: result.diagnostics, warnings: result.diagnostics.map(value => value.message), offlinePrepared: result.offlineComplete }
}

/** Save the same P0 into a package; actual resource bytes are separate ZIP entries. */
export async function buildComponentWebPackage(snapshot: DocumentSnapshot, compile: ComponentCompilePort, signal?: AbortSignal, onProgress?: () => void) {
  const files: Record<string, Uint8Array> = {}
  const result = await buildComponentPublished(snapshot, compile, (asset, bytes) => {
    signal?.throwIfAborted()
    const filename = `assets/${encodeURIComponent(asset.id)}.bin`
    files[filename] = bytes
    return filename
  }, undefined, signal, onProgress)
  signal?.throwIfAborted()
  files['index.html'] = strToU8(buildComponentSingleHtml(result.payload, loadPlayerBundle()))
  return { bytes: zipSync(files), diagnostics: result.diagnostics, warnings: result.diagnostics.map(value => value.message), offlinePrepared: result.offlineComplete }
}
