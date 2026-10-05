// Run with Electron, using a bundled src/main/pdfExport.ts and an X1-produced print HTML.
const { app } = require('electron')
const { readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { PDFDocument } = require('pdf-lib')

app.whenReady().then(async () => {
  const [bundlePath, htmlPath, pdfPath] = process.argv.slice(2)
  const { renderPdfFromHtml } = require(path.resolve(bundlePath))
  const bytes = await renderPdfFromHtml(await readFile(htmlPath, 'utf8'))
  await writeFile(pdfPath, bytes)
  const pdf = await PDFDocument.load(bytes)
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
    views.push({ imagePath: path.resolve(imagePath), text: (await page.getTextContent()).items.map(item => item.str ?? '').join(' ') })
  }
  console.log(JSON.stringify({ path: path.resolve(pdfPath), pages: pdf.getPages().map(page => page.getSize()), views }))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
