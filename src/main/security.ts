import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  IpcMainInvokeEvent,
  Session,
  WebContents,
} from 'electron'
import type { BrowserWindow } from 'electron'
import { DesktopOperationError } from './errors'

const configuredSessions = new WeakSet<Session>()

function canonicalFilePath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

function networkOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    return null
  }
}

export function isAllowedDocumentUrl(candidate: string, entryUrl: string): boolean {
  try {
    const candidateUrl = new URL(candidate)
    const entry = new URL(entryUrl)

    if (entry.protocol === 'file:') {
      if (candidateUrl.protocol !== 'file:') return false
      return (
        canonicalFilePath(fileURLToPath(candidateUrl)) ===
        canonicalFilePath(fileURLToPath(entry))
      )
    }

    return (
      candidateUrl.protocol === entry.protocol &&
      candidateUrl.origin === entry.origin &&
      candidateUrl.pathname === entry.pathname
    )
  } catch {
    return false
  }
}

/**
 * Allows only Blob documents created by the editor's own origin. This is used
 * for the sandboxed in-canvas Player and deliberately excludes normal URLs,
 * file URLs, opaque Blob origins and Blobs created by another origin.
 */
export function isAllowedEditorPreviewFrameUrl(
  candidate: string,
  entryUrl: string,
): boolean {
  try {
    const candidateUrl = new URL(candidate)
    const entry = new URL(entryUrl)
    if (candidateUrl.protocol !== 'blob:') return false
    if (!['http:', 'https:', 'courseware-editor:'].includes(entry.protocol)) {
      return false
    }

    const blobOrigin = new URL(candidateUrl.pathname)
    if (entry.origin !== 'null' && blobOrigin.origin !== 'null') {
      return blobOrigin.origin === entry.origin
    }
    return blobOrigin.protocol === entry.protocol &&
      blobOrigin.hostname === entry.hostname &&
      blobOrigin.port === entry.port
  } catch {
    return false
  }
}

export function hardenWebContents(
  contents: WebContents,
  isAllowedNavigation: (url: string) => boolean,
  isAllowedSubframeNavigation: (url: string) => boolean = () => false,
): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  contents.on('will-navigate', (event) => {
    if (!isAllowedNavigation(event.url)) event.preventDefault()
  })

  contents.on('will-frame-navigate', (event) => {
    const allowed = event.isMainFrame
      ? isAllowedNavigation(event.url)
      : isAllowedSubframeNavigation(event.url)
    if (!allowed) {
      event.preventDefault()
    }
  })

  contents.on('will-redirect', (event) => {
    if (!isAllowedNavigation(event.url)) event.preventDefault()
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

export function configureRestrictedSession(
  electronSession: Session,
  allowedNetworkOrigins: ReadonlySet<string> | ((url: string) => boolean),
): void {
  if (configuredSessions.has(electronSession)) return
  configuredSessions.add(electronSession)

  electronSession.setPermissionCheckHandler(() => false)
  electronSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  electronSession.setDevicePermissionHandler(() => false)
  electronSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({})
  })

  electronSession.on('will-download', (event) => {
    event.preventDefault()
  })

  electronSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const allowed = typeof allowedNetworkOrigins === 'function'
        ? allowedNetworkOrigins(details.url)
        : (() => {
            const origin = networkOrigin(details.url)
            return origin !== null && allowedNetworkOrigins.has(origin)
          })()
      callback({ cancel: !allowed })
    },
  )
}

export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null,
  rendererEntryUrl: string | null,
): void {
  const senderFrame = event.senderFrame
  const mainFrame = event.sender.mainFrame
  const isMainFrame =
    senderFrame !== null &&
    !senderFrame.detached &&
    senderFrame.processId === mainFrame.processId &&
    senderFrame.frameToken === mainFrame.frameToken

  if (
    mainWindow === null ||
    mainWindow.isDestroyed() ||
    rendererEntryUrl === null ||
    event.sender !== mainWindow.webContents ||
    senderFrame === null ||
    !isMainFrame ||
    !isAllowedDocumentUrl(senderFrame.url, rendererEntryUrl)
  ) {
    throw new DesktopOperationError(
      'UNTRUSTED_IPC_SOURCE',
      '操作被阻止',
      '桌面请求不是由编辑器主页面发起的。',
      '请关闭异常窗口并重新启动编辑器。',
    )
  }
}
