import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createComponentPlatformMixedDeliveryFixture } from '../fixtures/componentPlatformMixedDeliveryFixture'
import { buildComponentDelivery, type ComponentOutputCapture } from '../../src/renderer/export/componentPlatform/delivery'
import { buildComponentPublished } from '../../src/renderer/export/componentPlatform/buildHtml'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { PdfPrintImage } from '../../src/renderer/export/course/pdfPrintHtml'
const { JSDOM } = require('jsdom') as { JSDOM: new (source: string) => {
  window: { document: Document; DOMParser: typeof DOMParser; Image: typeof Image; close(): void }
} }

/** CLI generation is local; real images may only come from the formal observation capture. */
async function generate() {
  const [directory, manifestPath] = process.argv.slice(2)
  if (!directory) throw new Error('缺少本地产物目录')
  const output = resolve(directory); await mkdir(output, { recursive: true })
  const sample = createComponentPlatformMixedDeliveryFixture()
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser, Image: dom.window.Image })
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const compile = compilation.compile.bind(compilation)
  await writeFile(resolve(output, 'mixed.h5lesson'), sample.archive())
  const published = await buildComponentPublished(sample.snapshot, compile)
  await writeFile(resolve(output, 'mixed-published.json'), JSON.stringify(published.payload, null, 2))
  const reports: Record<string, unknown> = { published: published.diagnostics }
  for (const mode of ['offline-portable', 'online-lightweight'] as const) {
    const result = await buildComponentDelivery(sample.delivery, 'single-html', { compile, singleHtmlMode: mode })
    await writeFile(resolve(output, `${mode}.html`), result.artifacts[0]!.html!)
    reports[mode] = result.report
  }
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
      const result = await buildComponentDelivery(sample.delivery, format, { compile, createCapture })
      for (const artifact of result.artifacts) await writeFile(resolve(output, artifact.extension === 'pdf' ? 'mixed-print.html' : artifact.suggestedName), artifact.html ?? artifact.bytes!)
      reports[format] = result.report
    }
  }
  await writeFile(resolve(output, 'delivery-reports.json'), JSON.stringify(reports, null, 2))
  dom.window.close()
  console.log(JSON.stringify({ output, capturedFormats: !!manifestPath, publishedDiagnostics: published.diagnostics }))
}
void generate().catch(error => { console.error(error); process.exitCode = 1 })
