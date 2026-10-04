import { request, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { openProxyTunnel, systemProxyRoute } from './systemProxy'

type Answer = { name?: unknown; type?: unknown; data?: unknown }
type DnsJson = { Status?: unknown; TC?: unknown; Question?: unknown; Answer?: unknown }

async function query(hostname: string, type: 'A' | 'AAAA', signal?: AbortSignal): Promise<readonly { address: string; family: 4 | 6 }[]> {
  const url = new URL('https://cloudflare-dns.com/dns-query')
  url.searchParams.set('name', hostname)
  url.searchParams.set('type', type)
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(() => controller.abort(), 4000)
  timer.unref()
  const options: RequestOptions = { method: 'GET', signal: controller.signal,
    headers: { Accept: 'application/dns-json', 'User-Agent': 'GuolingResearch/2.0' } }
  try {
    // The resolver itself follows the system proxy; the proxy reaches cloudflare-dns.com by name.
    const route = await systemProxyRoute(url.href)
    if (route.kind !== 'direct') {
      const tunnel = await openProxyTunnel(route, { host: url.hostname, port: 443 }, { signal: controller.signal })
      Object.assign(options, { defaultPort: 443,
        createConnection: () => tlsConnect({ socket: tunnel, host: url.hostname, servername: url.hostname, ALPNProtocols: ['http/1.1'] }) })
    }
  } catch (cause) { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); throw cause }
  return new Promise((resolve, reject) => {
    const done = (cause?: unknown) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); if (cause) reject(cause) }
    const req = request(url, options, response => {
      if (response.statusCode !== 200 || !String(response.headers['content-type'] ?? '').toLowerCase().startsWith('application/dns-json')) {
        response.resume(); done(new Error('公共 DNS 查询失败')); return
      }
      const announced = Number(response.headers['content-length'] ?? 0)
      if (announced > 32 * 1024) { response.destroy(new Error('公共 DNS 响应过大')); return }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.byteLength
        if (size > 32 * 1024) response.destroy(new Error('公共 DNS 响应过大'))
        else chunks.push(chunk)
      })
      response.on('error', done)
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as DnsJson
          const expectedType = type === 'A' ? 1 : 28
          const questions = Array.isArray(value.Question) ? value.Question as Answer[] : []
          if (value.Status !== 0 || value.TC !== false || questions.length !== 1
            || String(questions[0]?.name ?? '').replace(/\.$/, '').toLowerCase() !== hostname.toLowerCase()
            || questions[0]?.type !== expectedType || value.Answer !== undefined && !Array.isArray(value.Answer)) throw new Error('公共 DNS 响应不匹配')
          const addresses = ((value.Answer ?? []) as Answer[]).flatMap(answer =>
            answer.type === expectedType && typeof answer.data === 'string' && isIP(answer.data) === (type === 'A' ? 4 : 6)
              ? [{ address: answer.data, family: (type === 'A' ? 4 : 6) as 4 | 6 }] : [])
          done(); resolve(addresses)
        } catch (cause) { done(cause) }
      })
    })
    req.on('error', done)
    req.end()
  })
}

/** Used only when the host resolver returns a synthetic 198.18/15 proxy address. */
export async function resolvePublicDnsOverHttps(hostname: string, signal?: AbortSignal): Promise<readonly { address: string; family: 4 | 6 }[]> {
  const [v4, v6] = await Promise.all([query(hostname, 'A', signal), query(hostname, 'AAAA', signal)])
  const addresses = [...v4, ...v6]
  if (!addresses.length) throw new Error('公共 DNS 未返回地址')
  return addresses
}
