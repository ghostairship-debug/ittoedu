import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../../../src/main/windowVisibility'

const root = resolve(__dirname, '../../../..')
test('T08 actual hidden export entry reports progress, captures a running source component for PPTX and PDF, and cancels its next build', async () => {
  test.setTimeout(180_000)
  const base = join(root, 'output/productFollowup/T08'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'headless-export-'))
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '1' } })
    await app.firstWindow()
    const facts = await app.evaluate(async ({ BrowserWindow, ipcMain }, input) => {
      const path = await import('node:path'), fs = await import('node:fs/promises'), { pathToFileURL } = await import('node:url')
      const load = (file: string) => import(pathToFileURL(path.join(input.root, 'dist-electron', file)).href)
      const [{ HeadlessDocumentExportWorker }, { documentHost }, { createBlankCourseProjectV10 }, { renderPdfFromHtml }, { IPC_CHANNELS }] = await Promise.all([
        load('main/workbench/delivery/HeadlessDocumentExportWorker.js'), load('main/workbench/documentHost.js'),
        load('core/course/createCourseProjectV10.js'), load('main/pdfExport.js'), load('shared/ipcTypes.js'),
      ])
      const host = documentHost(), project = createBlankCourseProjectV10('Real running capture')
      project.definitions.program = { id: 'program', role: 'content', implementation: { kind: 'source', language: 'javascript',
        source: "export default { mount({root}) { root.style.background='#0077cc';root.style.color='white';root.style.fontSize='24px';root.textContent='Actual captured program';return {update(){},dispose(){root.replaceChildren()}} } }" } }
      project.instances.program = { id: 'program', definitionId: 'program', data: {}, frame: { width: 400, height: 200, transform: [1, 0, 0, 1, 60, 70] } }
      project.surfaces[0].childIds = ['program']
      const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'capture.h5lesson')
      const identity = { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, projectId: project.id }
      const entry = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('courseware-editor://'))?.webContents.getURL()
      if (!entry) throw new Error('Actual editor protocol entry was not ready')
      const producer = new HeadlessDocumentExportWorker(entry, host.compilation)
      const progress: any[] = [], wrongIdentityProgress: any[] = []
      const cancel = new AbortController()
      const receive = (_event: unknown, value: any) => {
        if (!String(value?.requestId).startsWith('T08-')) return
        if (value.identity.documentId !== identity.documentId || value.identity.epoch !== identity.epoch || value.identity.revision !== identity.revision) wrongIdentityProgress.push(value)
        progress.push(value)
        if (value.requestId === 'T08-cancel' && !cancel.signal.aborted) cancel.abort(new Error('User cancelled the real worker build'))
      }
      ipcMain.on('document-export:build-progress', receive)
      try {
        const pptx = await producer.build({ requestId: 'T08-pptx', identity, format: 'pptx', snapshot })
        if (pptx.status !== 'generated' || !pptx.files?.length) throw new Error(`Actual PPTX failed: ${JSON.stringify(pptx)}`)
        const pptxFile = path.join(input.directory, 'capture.pptx'); await fs.writeFile(pptxFile, pptx.files[0].bytes)
        const pdf = await producer.build({ requestId: 'T08-pdf', identity, format: 'pdf', snapshot })
        if (pdf.status !== 'generated' || !pdf.printHtml) throw new Error(`Actual PDF preparation failed: ${JSON.stringify(pdf)}`)
        const pdfBytes = await renderPdfFromHtml(pdf.printHtml), pdfFile = path.join(input.directory, 'capture.pdf'); await fs.writeFile(pdfFile, pdfBytes)
        let cancelled: any
        try { cancelled = await producer.build({ requestId: 'T08-cancel', identity, format: 'pptx', snapshot }, cancel.signal) }
        catch (error) { cancelled = { rejected: true, message: String(error) } }
        const after = await host.internalAPI.read(snapshot.documentId)
        return { progress, wrongIdentityProgress, cancelled, pptx: { status: pptx.status, byteLength: pptx.files[0].bytes.byteLength, warnings: pptx.warnings },
          pdf: { status: pdf.status, byteLength: pdfBytes.byteLength, header: Buffer.from(pdfBytes).subarray(0, 5).toString() },
          after: { revision: after.revision, undoDepth: after.undoDepth, model: after.model }, original: snapshot.model,
          workerUrls: BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).map(window => window.webContents.getURL()) }
      } finally { ipcMain.removeListener('document-export:build-progress', receive); producer.dispose() }
    }, { root, directory })
    expect(facts.wrongIdentityProgress).toEqual([])
    for (const id of ['T08-pptx', 'T08-pdf']) {
      const messages = facts.progress.filter((value: any) => value.requestId === id)
      expect(messages.map((value: any) => value.stage)).toEqual(expect.arrayContaining(['preparing', 'building', 'compiling', 'complete']))
      expect(messages.every((value: any, index: number) => index === 0 || value.sequence > messages[index - 1].sequence)).toBe(true)
    }
    const { unzipSync } = await import('fflate'), { readFileSync } = await import('node:fs')
    const pptx = unzipSync(new Uint8Array(readFileSync(join(directory, 'capture.pptx'))))
    const media = Object.entries(pptx).filter(([name]) => /^ppt\/media\//.test(name))
    expect(media.length).toBeGreaterThan(0)
    const sharp = (await import('sharp')).default
    let bluePixels = 0
    for (const [, bytes] of media) {
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      for (let i = 0; i < data.length; i += info.channels) if (data[i] < 20 && data[i + 1] > 90 && data[i + 1] < 160 && data[i + 2] > 180) bluePixels++
    }
    expect(bluePixels).toBeGreaterThan(100)
    expect(facts.pdf).toMatchObject({ status: 'generated', header: '%PDF-' })
    expect(facts.pdf.byteLength).toBeGreaterThan(1000)
    expect(facts.cancelled.rejected === true || facts.cancelled.status === 'cancelled', JSON.stringify(facts.cancelled)).toBe(true)
    expect(facts.progress.some((value: any) => value.requestId === 'T08-cancel' && value.stage === 'complete')).toBe(false)
    expect(facts.after).toMatchObject({ revision: 0, undoDepth: 0, model: facts.original })
    expect(facts.workerUrls.some((url: string) => url.endsWith('document-export.html'))).toBe(false)
    writeFileSync(join(directory, 'facts.json'), JSON.stringify({ ...facts, bluePixels, paidCalls: 0 }, null, 2))
  } finally { await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app?.close().catch(() => undefined) }
})
