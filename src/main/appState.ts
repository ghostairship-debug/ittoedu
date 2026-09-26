import type { BrowserWindow } from 'electron'
import { APP_NAME } from '../shared/constants'

export class AppState {
  private dirty = false
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

