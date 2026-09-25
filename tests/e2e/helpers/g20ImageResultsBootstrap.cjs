// Test-only entry point. Uses the real compiled app and provider protocol; only transport is loopback.
// Fake, isolated OAuth credentials exercise secure-store resolution. This is NOT a login/model test.
const path = require('node:path')
const { app } = require('electron')
const root = path.resolve(__dirname, '../../..')
const endpoint = new URL(process.env.G20_IMAGE_HTTP_FIXTURE || '')
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new Error('Image fixture must be loopback HTTP')
// Electron started this helper rather than package.json; keep the actual built app resource root.
app.getAppPath = () => root
const providerModule = require(path.join(root, 'dist-electron/main/workbench/images/ChatGPTImageProvider.js'))
const RealProvider = providerModule.ChatGPTImageProvider
const realFetch = globalThis.fetch
const fixture = globalThis.__G20_IMAGE_RESULTS_FIXTURE__ = { lateReady: false, releaseLate: undefined, ready: undefined }
providerModule.ChatGPTImageProvider = class FixtureTransportProvider extends RealProvider {
  constructor(options) {
    super({ ...options, fetch: (url, init) => {
      const pathname = new URL(String(url)).pathname
      if (!['/backend-api/codex/images/generations', '/backend-api/codex/images/edits'].includes(pathname)) throw new Error('Unexpected image endpoint')
      return realFetch(new URL(pathname, endpoint), init)
    } })
  }
  async generate(request, references, options) {
    const result = await super.generate(request, references, options)
    // Delay delivery of a genuinely completed HTTP/provider result. Stop cannot un-generate it.
    if (request.prompt.includes('hold-late') && result.status === 'completed') {
      fixture.lateReady = true
      await new Promise(resolve => { fixture.releaseLate = resolve })
    }
    return result
  }
}
require(path.join(root, 'dist-electron/main/index.js'))
fixture.ready = app.whenReady().then(async () => {
  const { executionSettingsStore } = require(path.join(root, 'dist-electron/main/workbench/providers/executionSettingsService.js'))
  const store = await executionSettingsStore()
  const capabilities = { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' }
  const text = await store.saveConnection({ apiKey: 'fixture-text-only', connection: { provider: 'image-ui-fixture', protocol: 'openai-chat', baseURL: new URL('/v1', endpoint).href,
    accountId: 'fixture-text-account', authKind: 'api-key', billing: { kind: 'unknown' }, capabilities } })
  const image = await store.saveConnection({ connection: { provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
    accountId: 'fixture-image-account', authKind: 'oauth', billing: { kind: 'subscription' }, capabilities } })
  const reservation = await store.reserveOAuthLogin(image.connection.id, image.connection.revision)
  if (!await store.compareAndSetOAuthCredential(reservation.credentialRef, 0, { connectionId: reservation.connectionId, revision: reservation.revision, accountId: 'fixture-image-account',
    accessToken: 'fixture-image-access', refreshToken: 'fixture-image-refresh-unused', expiresAt: Date.now() + 3_600_000 })) throw new Error('Fixture OAuth record was not committed')
  const profile = (await store.read()).profile
  await store.saveProfile({ expectedRevision: profile.revision, roles: {
    conversation: { connectionId: text.connection.id, model: 'fixture-text-model' }, vision: null,
    imageGenerate: { connectionId: image.connection.id, model: 'fixture-image-model' },
    imageEdit: { connectionId: image.connection.id, model: 'fixture-image-edit-model' },
  } })
})
fixture.ready.catch(error => { console.error('Image UI fixture setup failed', error); app.exit(1) })
