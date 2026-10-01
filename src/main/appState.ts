import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '../shared/ipcTypes'
import type { BrowserWindow } from 'electron'
import { APP_NAME } from '../shared/constants'

export class AppState {
  private dirty = false
  private readonly openRequests: Array<{ id: string; path: string }> = []
  enqueueOpenFiles(files: readonly string[]): void {
    for (const path of files) if (!this.openRequests.some(request => request.path === path)) this.openRequests.push({ id: randomUUID(), path })
    if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(IPC_CHANNELS.launchFilesChanged)
  }
  pendingOpenFiles() { return structuredClone(this.openRequests) }
  acknowledgeOpenFile(id: string): void { const index = this.openRequests.findIndex(request => request.id === id); if (index >= 0) this.openRequests.splice(index, 1) }

  private mainWindow: BrowserWindow | null = null

  attachWindow(window: BrowserWindow): void {
    this.mainWindow = window
    this.updateWindowTitle()
  }

  detachWindow(window: BrowserWindow): void {
    if (this.mainWindow === window) this.mainWindow = null
  }

  isDirty(): boolean {
    return this.dirty
  }

  setDirty(dirty: boolean): void {
    this.dirty = dirty
  }

  private updateWindowTitle(): void {
    if (this.mainWindow === null || this.mainWindow.isDestroyed()) return
    this.mainWindow.setTitle(APP_NAME)
  }
}

