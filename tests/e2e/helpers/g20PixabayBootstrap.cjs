// Test-only transport fixture. The real installed image.search service, IPC and safeStorage stay intact.
const path = require('node:path')
const { app } = require('electron')
const root = path.resolve(__dirname, '../../..')
app.getAppPath = () => root
let expectedKey, keyMatched = false, sequence = 0
const http = {
  async getJson(raw) {
    const url = new URL(raw)
    if (url.origin === 'https://pixabay.com') {
      keyMatched = expectedKey ? url.searchParams.get('key') === expectedKey : Boolean(url.searchParams.get('key'))
      return { totalHits: 1, hits: [{ id: 1, tags: 'fixture flower', pageURL: 'https://pixabay.com/photos/flower-1/',
        largeImageURL: 'https://cdn.pixabay.com/flower.jpg', imageWidth: 1280, imageHeight: 800 }] }
    }
    if (url.origin === 'https://commons.wikimedia.org') return { query: { pages: [] } }
    if (url.origin === 'https://api.openverse.org') return { results: [], next: null }
    throw new Error('Unexpected endpoint')
  },
  async getBytes() { throw new Error('unused') },
}
require(path.join(root, 'dist-electron/main/workbench/assetSources/publicAssetHttp.js')).publicAssetHttp = () => http
require(path.join(root, 'dist-electron/main/index.js'))
globalThis.__G20_PIXABAY_FIXTURE__ = {
  async search(expected) {
    expectedKey = expected; keyMatched = false
    const runId = `pixabay-native-${++sequence}`
    const { tools } = require(path.join(root, 'dist-electron/main/workbench/documentHost.js')).documentHost()
    await tools.beginRun({ runId, actor: 'agent', documents: [], fileAccess: { permission: 'read-only', workspaceRoot: app.getPath('userData') } })
    try {
      const result = await tools.execute(runId, 'search', { name: 'image.search', input: { query: `flower ${sequence}` } })
      if (result.kind !== 'read') throw new Error(`Expected search read, received ${result.kind}`)
      return { result: result.data, keyMatched }
    } finally { await tools.stop(runId) }
  },
}
