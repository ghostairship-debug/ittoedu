import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createComponentPlatformMixedDeliveryFixture } from '../fixtures/componentPlatformMixedDeliveryFixture'
import { buildComponentDelivery, type ComponentOutputCapture } from '../../src/renderer/export/componentPlatform/delivery'
import { buildComponentPublished } from '../../src/renderer/export/componentPlatform/buildHtml'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { PdfPrintImage } from '../../src/renderer/export/course/pdfPrintHtml'
import { createCanvas, Image as CanvasImage } from '@napi-rs/canvas'
const { JSDOM } = require('jsdom') as { JSDOM: new (source: string) => {
  window: { document: Document; DOMParser: typeof DOMParser; XMLSerializer: typeof XMLSerializer; close(): void }
} }
// Match @napi-rs/canvas's loadImage data-URI path: SVG goes to the native decoder as actual bytes.
class PixelImage extends CanvasImage {
  get src(): string | Uint8Array { return super.src }
  set src(value: string | Uint8Array) {
    if (typeof value === 'string' && value.startsWith('data:')) {
      const comma = value.indexOf(','), header = value.slice(0, comma), payload = value.slice(comma + 1)
      super.src = header.includes(';base64') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
    } else super.src = value
  }
}
let completed = false, stage = 'initial'
process.once('beforeExit', () => {
  if (!completed) { console.error(`混合交付未完成，等待未结算：${stage}`); process.exitCode = 1 }
})

/** CLI generation is local; real images may only come from the formal observation capture. */
async function generate() {
  const [directory, manifestPath] = process.argv.slice(2)
  if (!directory) throw new Error('缺少本地产物目录')
  const output = resolve(directory); await mkdir(output, { recursive: true })
  const sample = createComponentPlatformMixedDeliveryFixture()
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const createElement = dom.window.document.createElement.bind(dom.window.document)
  dom.window.document.createElement = ((name: string, options?: ElementCreationOptions) => name.toLowerCase() === 'canvas'
    ? createCanvas(300, 150) as unknown as HTMLCanvasElement : createElement(name, options)) as Document['createElement']
  Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer, Image: PixelImage })
  try {
    stage = 'project/published'
    const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
    const compile = compilation.compile.bind(compilation)
    await writeFile(resolve(output, 'mixed.h5lesson'), sample.archive())
    const published = await buildComponentPublished(sample.snapshot, compile)
    await writeFile(resolve(output, 'mixed-published.json'), JSON.stringify(published.payload, null, 2))
    const reports: Record<string, unknown> = { published: published.diagnostics }
    for (const mode of ['offline-portable', 'online-lightweight'] as const) {
      stage = mode
      const result = await buildComponentDelivery(sample.delivery, 'single-html', { compile, singleHtmlMode: mode })
      await writeFile(resolve(output, `${mode}.html`), result.artifacts[0]!.html!)
      reports[mode] = result.report
    }
    stage = 'web-package'
    const web = await buildComponentDelivery(sample.delivery, 'web-package', { compile })
    await writeFile(resolve(output, 'mixed-web.zip'), web.artifacts[0]!.bytes!); reports.web = web.report
    if (manifestPath) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        surfaces: Record<string, PdfPrintImage>; instances: Record<string, PdfPrintImage>
      }
      const createCapture = async (): Promise<ComponentOutputCapture> => ({
        async captureSurface(surfaceId, frameId) {
          const key = frameId ? `${surfaceId}/${frameId}` : surfaceId
          const image = manifest.surfaces[key]
          if (!image) throw new Error(`缺少正式表面捕获：${key}`)
          return image
        },
        async captureInstance(surfaceId, instanceId) {
          const image = manifest.instances[`${surfaceId}/${instanceId}`]
          if (!image) throw new Error(`缺少正式组件捕获：${surfaceId}/${instanceId}`)
          return image
        }, dispose() {},
      })
      for (const format of ['pptx', 'docx', 'pdf'] as const) {
        stage = format
        const result = await buildComponentDelivery(sample.delivery, format, { compile, createCapture })
        for (const artifact of result.artifacts) await writeFile(resolve(output, artifact.extension === 'pdf' ? 'mixed-print.html' : artifact.suggestedName), artifact.html ?? artifact.bytes!)
        reports[format] = result.report
      }
    }
    stage = 'delivery-reports'
    await writeFile(resolve(output, 'delivery-reports.json'), JSON.stringify(reports, null, 2))
    console.log(JSON.stringify({ output, capturedFormats: !!manifestPath, publishedDiagnostics: published.diagnostics }))
  } finally { dom.window.close() }
}
void generate().then(() => { completed = true }, error => { completed = true; console.error(error); process.exitCode = 1 })
