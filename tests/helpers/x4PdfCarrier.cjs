// Run with Electron, using a bundled src/main/pdfExport.ts and an X1-produced print HTML.
const { app } = require('electron')
const { appendFileSync } = require('node:fs')
const { readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { PDFDocument } = require('pdf-lib')

const [bundlePath, htmlPath, pdfPath] = process.argv.slice(2)
let lastStage = 'starting'
function recordStage(stage, details = {}) {
  lastStage = stage
  const record = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, stage, ...details })
  try { appendFileSync(`${pdfPath}.stages.jsonl`, `${record}\n`) }
  catch (error) { console.error('PDF carrier stage log could not be written', error) }
}

// The producer destroys its hidden print window before our file/report awaits finish.
// This standalone carrier owns app lifetime until its explicit success/error exit.
app.on('window-all-closed', () => recordStage('window-all-closed', { previousStage: lastStage }))
app.on('browser-window-created', (_event, window) => {
  const windowId = window.id
  recordStage('print-window-created', { windowId })
  window.once('closed', () => recordStage('print-window-closed', { windowId }))
})
app.on('quit', (_event, code) => recordStage('app-quit', { code, previousStage: lastStage }))
process.once('exit', code => recordStage('process-exit', { code, previousStage: lastStage }))
recordStage('starting', { bundlePath, htmlPath, pdfPath })

app.whenReady().then(async () => {
  const { renderPdfFromHtml } = require(path.resolve(bundlePath))
  const html = await readFile(htmlPath, 'utf8')
  recordStage('render-start', { htmlBytes: Buffer.byteLength(html) })
  const bytes = await renderPdfFromHtml(html)
  recordStage('render-returned', { byteLength: bytes.byteLength })
  recordStage('pdf-write-start', { byteLength: bytes.byteLength })
  await writeFile(pdfPath, bytes)
  recordStage('pdf-written', { byteLength: bytes.byteLength })
  const pdf = await PDFDocument.load(bytes)
  recordStage('pdf-parsed', { pageCount: pdf.getPageCount() })
  const { createCanvas, DOMMatrix, ImageData, Path2D } = require('@napi-rs/canvas')
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D })
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const reading = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const views = []
  for (let number = 1; number <= reading.numPages; number++) {
    const page = await reading.getPage(number)
    const viewport = page.getViewport({ scale: 1.4 })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    const imagePath = `${pdfPath}-page-${String(number).padStart(2, '0')}.png`
    await writeFile(imagePath, canvas.toBuffer('image/png'))
    recordStage('page-image-written', { page: number, imagePath })
    views.push({ imagePath: path.resolve(imagePath), text: (await page.getTextContent()).items.map(item => item.str ?? '').join(' ') })
  }
  const report = { path: path.resolve(pdfPath), pages: pdf.getPages().map(page => page.getSize()), views }
  await writeFile(`${pdfPath}.json`, JSON.stringify(report, null, 2))
  recordStage('report-written', { reportPath: `${pdfPath}.json`, pageCount: report.pages.length })
  console.log(JSON.stringify({ path: report.path, pages: report.pages, reportPath: `${pdfPath}.json`, images: views.map(view => view.imagePath) }))
  recordStage('exit-requested', { code: 0 })
  app.exit(0)
}).catch(error => {
  const details = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) }
  recordStage('error', { failedStage: lastStage, ...details })
  console.error(error)
  recordStage('exit-requested', { code: 1 })
  app.exit(1)
})
