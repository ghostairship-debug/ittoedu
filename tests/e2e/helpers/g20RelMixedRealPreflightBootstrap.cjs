// Legacy REL continuation only. Its existing private profile owns a frozen GPT OAuth
// image role; a new TeamoRouter Images run uses the normal Electron entry instead.
const path = require('node:path')
const fs = require('node:fs')
const { app } = require('electron')
const root = path.resolve(__dirname, '../../..')
const mark = value => { if (process.env.G20_PREFLIGHT_STAGE_FILE) fs.writeFileSync(process.env.G20_PREFLIGHT_STAGE_FILE, value) }
mark('bootstrap-loaded')
app.getAppPath = () => root
require(path.join(root, 'dist-electron/main/index.js'))
mark('main-loaded')

globalThis.__G20_REL_REAL_PREFLIGHT__ = {
  ready: app.whenReady().then(async () => {
    mark('app-ready')
    const { executionSettingsStore } = require(path.join(root,
      'dist-electron/main/workbench/providers/executionSettingsService.js'))
    const store = await executionSettingsStore()
    const state = await store.read()
    mark('settings-read')
    const imageRole = state.profile.roles.imageGenerate
    if (!imageRole) throw new Error('Legacy image role is not bound')
    const selected = await store.snapshot('imageGenerate')
    mark('image-role-resolved')
    const record = await store.readOAuthCredential(selected.connection.auth.credentialRef)
    mark('oauth-credential-read')
    return { imageRole, imageEditRole: state.profile.roles.imageEdit,
      provider: selected.connection.provider, protocol: selected.connection.protocol,
      billing: selected.connection.billing.kind, credentialReadable: !!record.credential,
      expired: !record.credential || record.credential.expiresAt <= Date.now(),
      secureStorageAvailable: state.secureStorageAvailable,
      sourceIsIsolated: app.getPath('userData') !== path.join(process.env.APPDATA || '', 'Guoling-2.0-engineering-oauth') }
  }),
}
