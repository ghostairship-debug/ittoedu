// Test-only Main entry. A single exact model POST fails before native fetch.
// The fault cannot contact a provider and is never rearmed automatically.
const path = require('node:path')
const fs = require('node:fs')
const { app } = require('electron')
const root = path.resolve(__dirname, '../../..')
const route = process.env.G20_M12_RECOVERY_ROUTE
const mark = stage => { if (process.env.G20_M12_PREFLIGHT_STAGE_FILE) fs.writeFileSync(process.env.G20_M12_PREFLIGHT_STAGE_FILE, stage) }
mark('bootstrap-loaded')
const fault = require('./g20M12RealRecoveryFault.cjs').createRecoveryFault(route, globalThis.fetch.bind(globalThis))
globalThis.__G20_M12_RECOVERY_FAULT__ = fault
globalThis.fetch = fault.fetch.bind(fault)
app.getAppPath = () => root
require(path.join(root, 'dist-electron/main/index.js'))
mark('main-loaded')
globalThis.__G20_M12_OAUTH_PREFLIGHT__ = route === 'oauth' ? app.whenReady().then(async () => {
  mark('app-ready')
  const { executionSettingsStore } = require(path.join(root,
    'dist-electron/main/workbench/providers/executionSettingsService.js'))
  const store = await executionSettingsStore(); mark('settings-store-ready')
  const state = await store.read(); mark('settings-read')
  const selected = state.connections.find(item => item.connection.provider === 'openai'
    && item.connection.protocol === 'chatgpt-responses' && item.hasCredential && !item.revoked)
  if (!selected) return { ready: false, reason: 'oauth-connection-absent' }
  const record = await store.readOAuthCredential(selected.connection.auth.credentialRef)
  mark('oauth-credential-read')
  return { ready: !!record.credential && record.credential.expiresAt > Date.now(),
    expired: !record.credential || record.credential.expiresAt <= Date.now(),
    accountMatches: record.credential?.accountId === selected.connection.accountId,
    sourceIsIsolated: app.getPath('userData') !== path.join(process.env.APPDATA || '', 'Guoling-2.0-engineering-oauth') }
}) : Promise.resolve({ ready: true })
