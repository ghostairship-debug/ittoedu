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
        pageCount: document.querySelectorAll('.page').length,
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
): Promise<{ path: string } | null> {
  const temporaryPath = path.join(
    app.getPath('temp'),
    `${APP_PDF_TEMP_FILE_PREFIX}${crypto.randomUUID()}.html`,
  )
  let window: BrowserWindow | null = null
  try {
    await fs.writeFile(temporaryPath, html, 'utf8')
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
    await window.loadFile(temporaryPath)
    await waitForPrintableDocument(window)
    const bytes = await window.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    return writeBinaryExportFile(parent, suggestedName, 'pdf', new Uint8Array(bytes))
  } finally {
    if (window && !window.isDestroyed()) window.destroy()
    await fs.unlink(temporaryPath).catch(() => undefined)
  }
}
