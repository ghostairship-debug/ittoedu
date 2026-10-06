import { app } from 'electron'
import { editorEntryUrl } from './protocols'

/** Renderer resources also serve isolated workers; they do not belong to a window. */
export function resolveRendererEntryUrl(): string {
  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) return editorEntryUrl()
  const url = new URL(process.env.VITE_DEV_SERVER_URL)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('开发服务器只能使用本机 HTTP 地址。')
  return url.toString()
}
