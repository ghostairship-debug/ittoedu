import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, type BrowserWindow as BrowserWindowType } from 'electron'
import { APP_PDF_TEMP_FILE_PREFIX } from '../shared/constants'
import { writeBinaryExportFile } from './fileDialogs'

interface PrintableDocumentState {
  imageCount: number
  loadedImageCount: number
  pageCount: number
}

async function waitForPrintableDocument(
  window: BrowserWindow,
): Promise<void> {
  const state = await window.webContents.executeJavaScript(`
    (async () => {
      const images = Array.from(document.images);
      await Promise.all(images.map((image) => {
        if (image.complete) {
          return image.naturalWidth > 0
            ? Promise.resolve()
            : Promise.reject(new Error('PDF 页面图片解码失败'));
        }
        return new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', () => reject(
            new Error('PDF 页面图片载入失败')
          ), { once: true });
        });
      }));
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        imageCount: images.length,
        loadedImageCount: images.filter((image) => image.naturalWidth > 0).length,
        // Fixed captures are explicit pages; Flow is a semantic reading body
        // whose physical page count is determined by Chromium pagination.
        pageCount: document.querySelectorAll('.page, [data-component-print-surface]').length,
      };
    })()
  `, true) as PrintableDocumentState
  if (
    state.pageCount < 1 ||
    state.loadedImageCount !== state.imageCount
  ) {
    throw new Error(
      `PDF 打印页面未就绪：${state.loadedImageCount}/${state.imageCount} 张图片，${state.pageCount} 页`,
    )
  }
}

export async function exportPdfFromHtml(
  parent: BrowserWindowType,
  suggestedName: string,
  html: string,
  projectPath?: string,
  options: { signal?: AbortSignal; onPrepared?(): void } = {},
): Promise<{ path: string } | null> {
  try {
    const bytes = await renderPdfFromHtml(html, parent, options.signal)
    options.signal?.throwIfAborted()
    options.onPrepared?.()
    return await writeBinaryExportFile(parent, suggestedName, 'pdf', bytes, projectPath, options.signal)
  } catch (error) {
    // A late abort cannot change an actual writer failure into cancellation.
    // throwIfAborted and the print wait return this request's exact reason.
    if (options.signal?.aborted && error === options.signal.reason) return null
    throw error
  }
}

function cancellable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('PDF 导出已取消'))
    signal.addEventListener('abort', abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

/** The same Chromium carrier is used by interactive export and direct output verification. */
export async function renderPdfFromHtml(html: string, parent?: BrowserWindowType, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted()
  const temporaryPath = path.join(
    app.getPath('temp'),
    `${APP_PDF_TEMP_FILE_PREFIX}${crypto.randomUUID()}.html`,
  )
  let window: BrowserWindow | null = null
  const abort = () => { if (window && !window.isDestroyed()) window.destroy() }
  try {
    await fs.writeFile(temporaryPath, html, 'utf8')
    signal?.throwIfAborted()
    window = new BrowserWindow({
      parent,
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        // The document contains only host-generated markup and data URLs.
        // JavaScript is enabled solely so the main process can await image
        // decoding and fonts before asking Chromium to print.
        javascript: true,
      },
    })
    signal?.addEventListener('abort', abort, { once: true })
    signal?.throwIfAborted()
    await cancellable(window.loadFile(temporaryPath), signal)
    await cancellable(waitForPrintableDocument(window), signal)
    signal?.throwIfAborted()
    const bytes = await cancellable(window.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }), signal)
    return new Uint8Array(bytes)
  } finally {
    signal?.removeEventListener('abort', abort)
    if (window && !window.isDestroyed()) window.destroy()
    await fs.unlink(temporaryPath).catch(() => undefined)
  }
}
