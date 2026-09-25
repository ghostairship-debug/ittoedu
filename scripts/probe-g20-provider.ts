import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Development-only, read-only catalog probe. Credentials exist only in process memory. */
async function main() {
  const output = path.resolve(process.argv[2] ?? 'output/g20/providers/catalog.json')
  const routes = [
    { provider: 'teamorouter', endpoint: 'https://api.teamorouter.com/v1', environment: 'TEAMOROUTER_API_KEY' },
    { provider: 'deepseek', endpoint: 'https://api.deepseek.com', environment: 'DEEPSEEK_API_KEY' },
  ]
  const results = await Promise.all(routes.map(async route => {
    const credential = process.env[route.environment]
    const metadata = { provider: route.provider, endpoint: route.endpoint, checkedAt: new Date().toISOString(), billing: 'unknown', operation: 'GET /models', generationRequests: 0 }
    if (!credential) return { ...metadata, status: 'credential-missing', models: [] }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(`${route.endpoint}/models`, { headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' }, signal: controller.signal, redirect: 'error' })
      if (!response.ok) return { ...metadata, status: 'http-failure', httpStatus: response.status, models: [] }
      const bytes = await response.text()
      if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) return { ...metadata, status: 'catalog-too-large', models: [] }
      const payload = JSON.parse(bytes) as { data?: unknown[] }
      if (!Array.isArray(payload.data)) return { ...metadata, status: 'invalid-catalog', models: [] }
      const models = payload.data.flatMap(item => item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
        && item.id.length < 512 && !item.id.includes(credential) ? [item.id] : []).sort()
      const candidates = models.filter(id => /deepseek/i.test(id))
      const preferred = candidates.find(id => /v?4[.\-_]?1.*flash|flash.*v?4[.\-_]?1/i.test(id))
      return { ...metadata, status: 'catalog-read', models, candidates, preferred: preferred ?? null, capabilities: 'not-probed' }
    } catch { return { ...metadata, status: controller.signal.aborted ? 'timeout' : 'transport-failure', models: [] } }
    finally { clearTimeout(timer) }
  }))
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, JSON.stringify({ routes: results }, null, 2))
  for (const result of results) console.log(JSON.stringify({ provider: result.provider, status: result.status, models: result.models.length,
    candidates: 'candidates' in result ? result.candidates : undefined, preferred: 'preferred' in result ? result.preferred : undefined, billing: result.billing }))
}
void main().catch(() => { console.error('Provider catalog probe failed without exposing credentials.'); process.exitCode = 1 })
