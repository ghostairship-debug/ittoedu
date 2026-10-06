const { app, BrowserWindow } = require('electron')
const path = require('node:path')
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 800, height: 600, show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  await window.loadFile(path.join(process.env.GUOLING_THEME_CANVAS_DIRECTORY, 'index.html'))
})
app.on('window-all-closed', () => app.quit())
