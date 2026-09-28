import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { parseComponentPackageFiles } from '../../../core/drivers/codecs/importComponentPackage'
import { buildPublishedCourseV2Payload } from '../../export/course/buildPublishedCourse'
import { createPublishedCourseSession } from '../../../player/surfaces/publishedDynamicHosts'
import { waitForPublishedObservationReady } from '../../../player/surfaces/publishedCapture'
import { installBundledFontFaces } from '../../../shared/fonts/installBundledFontFaces'
import { ensureBundledFonts } from '../../../shared/fonts/ensureBundledFonts'

export interface ObservationWorkerInput {
  project: CourseProjectDocument
  locationId: string
  assets: Record<string, string>
  assetResources: Record<string, { url: string; byteLength: number }>
  components: Record<string, Record<string, string>>
}
export interface ObservationWorkerResult { locationId: string; structure: string[]; diagnostics: string[] }

function decode(value: string): Uint8Array { return Uint8Array.from(atob(value), character => character.charCodeAt(0)) }

/** Fixed product entrypoint. Main captures pixels outside this renderer after readiness. */
export async function renderObservationSnapshot(input: ObservationWorkerInput): Promise<ObservationWorkerResult> {
  if (!input.project.locations.some(location => location.id === input.locationId)) throw new Error('观察目标页不存在')
  installBundledFontFaces()
  await ensureBundledFonts()
  const assetFiles = Object.fromEntries(Object.entries(input.assets).map(([key, bytes]) => [key, decode(bytes)]))
  const components = Object.fromEntries(Object.entries(input.components).map(([key, files]) =>
    [key, parseComponentPackageFiles(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, decode(bytes)])))]))
  const payload = buildPublishedCourseV2Payload({ project: input.project, assetFiles, assetResources: input.assetResources, components })
  const root = document.createElement('div')
  root.id = 'observation-root'
  Object.assign(root.style, { width: '1280px', height: '720px', overflow: 'hidden', position: 'fixed', inset: '0' })
  document.body.replaceChildren(root)
  const session = createPublishedCourseSession(payload, { initialLocationId: input.locationId })
  try {
    await session.mount(root)
    // This read-only route bypasses teaching navigation guards in the isolated host.
    await session.goToObservationTarget(input.locationId)
    await waitForPublishedObservationReady(root)
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const actual = session.navigator.current?.locationId
    if (actual !== input.locationId) throw new Error('播放器未停留在请求的目标页')
    const location = input.project.locations.find(item => item.id === input.locationId)!
    return { locationId: actual, structure: [location.label, location.kind], diagnostics: [] }
  } catch (error) {
    await session.destroy()
    throw error
  }
}

Object.defineProperty(window, '__COURSEWARE_OBSERVATION_RUN__', {
  configurable: false, writable: false, value: (encoded: string) => renderObservationSnapshot(
    JSON.parse(new TextDecoder().decode(decode(encoded))) as ObservationWorkerInput),
})
