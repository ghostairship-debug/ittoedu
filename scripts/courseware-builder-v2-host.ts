import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'vite'
import { chromium, type Page } from 'playwright'
import type { CoursewareBuilderV2, CoursewareBuilderV2Options } from '../src/renderer/course/coursewareBuilderV2'
import type { CoursewareCaseBuildOutput } from '../src/renderer/course/coursewareCaseBuilderApi'
import generatedCapabilities from '../src/shared/generated/courseAgentCapabilities.json'
import { queryCourseAgentCapabilities, readCourseAgentCapability, type CourseAgentCapabilityData,
  type CourseAgentCapabilityQuery, type CourseAgentCapabilityCardOptions } from '../src/shared/courseAgentCapabilities'
import { scanComponentCatalogDirectory, readCatalogComponentPackage, type ScannedComponentCatalogSource } from '../src/main/componentCatalogScanner'
import { defaultComponentCatalogSources } from '../src/main/componentCatalogSources'
import type { ComponentCatalogSnapshot } from '../src/shared/componentCatalog'

type AsyncMethod<T> = T extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never
export type RemoteCoursewareBuilderV2 = { readonly tools: readonly string[] } & { [K in 'snapshot' | 'activate' | 'observe' | 'activateScope' | 'readReceipts' | 'discover' | 'readCapability' | 'createScope' | 'execute' | 'finish']: AsyncMethod<CoursewareBuilderV2[K]> }
export interface CoursewareCaseBuilderApiV2 {
  createCourseProject(options: CoursewareBuilderV2Options): Promise<RemoteCoursewareBuilderV2>
  discover(query?: CourseAgentCapabilityQuery): ReturnType<typeof queryCourseAgentCapabilities>
  readCapability(id: string, options?: CourseAgentCapabilityCardOptions): ReturnType<typeof readCourseAgentCapability>
  componentCatalog(): Promise<ComponentCatalogSnapshot>
}

/** Read-only use of the product's catalog scanner and managed digest trust. */
export function createCoursewareBuilderCatalogPort(editorRoot: string) {
  const sources = new Map<string, ScannedComponentCatalogSource>()
  const load = async (): Promise<ComponentCatalogSnapshot> => {
    sources.clear()
    const snapshot: ComponentCatalogSnapshot = { sources: [], packages: [], issues: [] }
    for (const entry of await defaultComponentCatalogSources(editorRoot)) {
      try {
        const source = await scanComponentCatalogDirectory(entry.path, entry.trust)
        sources.set(source.source.sourceId, source)
        snapshot.sources.push(source.source)
        snapshot.packages.push(...source.packages.map(({ thumbnailDataUrl: _thumbnail, ...pkg }) => pkg))
        snapshot.issues.push(...source.issues)
      } catch (error) {
        snapshot.issues.push({ sourceLabel: path.basename(entry.path), code: 'catalog-unreadable', message: error instanceof Error ? error.message : String(error) })
      }
    }
    return snapshot
  }
  const read = async (input: { sourceId: string; packageId: string; version: string }) => {
    await load()
    const source = sources.get(input.sourceId)
    if (!source || source.source.trust === 'prompt') throw new Error('当前 Builder 没有相同受信组件目录，请刷新发现')
    return readCatalogComponentPackage(source, input.packageId, input.version)
  }
  return Object.freeze({ load, read })
}

/** Product-owned browser worker keeps CLI dynamic admission on the actual Published hosts. */
export async function createCoursewareBuilderV2Host(editorRoot: string) {
  const catalog = createCoursewareBuilderCatalogPort(editorRoot)
  const outputs = new WeakMap<object, CoursewareCaseBuildOutput>()
  // The Published browser worker starts only when a builder actually asks for a
  // project session: builders that never touch the browser (pure path/asset
  // checks) no longer pay for a cold Vite dev server and a Chromium launch.
  const startWorker = async () => {
    const cacheRoot = path.resolve(tmpdir())
    const cacheDir = await mkdtemp(path.join(cacheRoot, 'courseware-builder-v2-cache-'))
    const removeCache = async () => {
      if (path.dirname(cacheDir) !== cacheRoot || !path.basename(cacheDir).startsWith('courseware-builder-v2-cache-')) {
        throw new Error('Builder 缓存目录不属于本次临时工作区')
      }
      // Vite closes its optimizer before resolving server.close(), but on Windows
      // the final rename from deps_temp_* can still briefly race cache removal.
      // Node retries only the documented transient recursive-removal errors and
      // still rejects every other cleanup failure.
      await rm(cacheDir, {
        recursive: true,
        force: true,
        ...(process.platform === 'win32' ? { maxRetries: 8, retryDelay: 100 } : {}),
      })
    }
    const server = await createServer({ root: editorRoot, configFile: path.join(editorRoot, 'vite.renderer.config.ts'),
      cacheDir,
      // One build owns an immutable worker; watching the whole repository or
      // sharing renderer optimization cache adds no authoring capability.
      server: { host: '127.0.0.1', port: 19800, strictPort: false, hmr: false, watch: null }, logLevel: 'error',
      plugins: [{ name: 'courseware-private-builder-page', configureServer(server) {
        // Install before Vite's SPA fallback. The worker loads the real Published
        // modules without also starting the editor UI and its export bundle.
        server.middlewares.use('/__courseware_builder_v2', (_request, response) => {
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
        })
      } }],
    }).catch(async error => { await removeCache(); throw error })
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    try {
      await server.listen()
      browser = await chromium.launch({ headless: true })
      const address = server.httpServer!.address()
      if (!address || typeof address === 'string') throw new Error('Builder 浏览器端口不可用')
      const pages: Page[] = []
      const api: CoursewareCaseBuilderApiV2 = Object.freeze({
        discover: (query: CourseAgentCapabilityQuery = {}) => queryCourseAgentCapabilities(generatedCapabilities as CourseAgentCapabilityData, query),
        readCapability: (id: string, options: CourseAgentCapabilityCardOptions = {}) => readCourseAgentCapability(generatedCapabilities as CourseAgentCapabilityData, id, options),
        componentCatalog: catalog.load,
        async createCourseProject(options: CoursewareBuilderV2Options): Promise<RemoteCoursewareBuilderV2> {
          const page = await browser!.newPage()
          page.on('pageerror', error => process.stderr.write(`Builder worker page: ${error.message}\n`))
          page.on('requestfailed', request => process.stderr.write(`Builder worker request: ${request.url()} ${request.failure()?.errorText}\n`))
          pages.push(page)
          await page.goto(`http://127.0.0.1:${address.port}/__courseware_builder_v2`)
          await page.exposeFunction('__coursewareBuilderCatalog', catalog.load)
          await page.exposeFunction('__coursewareBuilderCatalogFile', async (input: { sourceId: string; packageId: string; version: string }) => {
            const file = await catalog.read(input)
            return { ...file, bytes: Array.from(file.bytes) }
          })
          // A static browser script avoids tsx keepNames helpers escaping the
          // serialized evaluation closure through nested function expressions.
          await page.evaluate(`window.desktopAPI = {
          ...window.desktopAPI,
          loadComponentCatalog() { return window.__coursewareBuilderCatalog(); },
          async readComponentCatalogPackage(request) {
            const file = await window.__coursewareBuilderCatalogFile(request);
            return { ...file, bytes: new Uint8Array(file.bytes) };
          }
        };`)
          await page.evaluate(async input => {
            const modulePath = '/src/renderer/course/coursewareBuilderV2.ts'
            const { createCoursewareBuilderV2 } = await import(modulePath)
            Reflect.set(window, '__coursewareBuilderV2', createCoursewareBuilderV2(input))
          }, options)
          const call = <T>(method: string, args: unknown[]): Promise<T> => page.evaluate(async ({ method, args }) => {
            const builder = Reflect.get(window, '__coursewareBuilderV2')
            return builder[method](...args)
          }, { method, args })
          const remote: RemoteCoursewareBuilderV2 = {
            tools: Object.freeze(await page.evaluate(() => Reflect.get(window, '__coursewareBuilderV2').tools as string[])),
            snapshot: () => call('snapshot', []),
            discover: query => call('discover', [query]),
            readCapability: (id, options) => call('readCapability', [id, options]),
            observe: input => call('observe', [input]),
            readReceipts: input => call('readReceipts', [input]),
            activate: input => call('activate', [input]),
            activateScope: input => call('activateScope', [input]),
            createScope: input => call('createScope', [input]),
            execute: (tool, input, destination) => call('execute', [tool, input, destination]),
            async finish() {
              const result = await page.evaluate(async () => {
                const modulePath = '/src/renderer/course/coursewareBuilderV2.ts'
                const { encodeCoursewareBuilderV2Output } = await import(modulePath)
                const output = Reflect.get(window, '__coursewareBuilderV2').finish()
                return encodeCoursewareBuilderV2Output(output) as ReturnType<typeof import('../src/renderer/course/coursewareBuilderV2').encodeCoursewareBuilderV2Output>
              })
              const output = { ...result, assetFiles: Object.fromEntries(Object.entries(result.assetFiles).map(([id, data]) => [id, new Uint8Array(Buffer.from(data, 'base64'))])),
                componentFiles: Object.fromEntries(Object.entries(result.componentFiles).map(([id, files]) => [id,
                  Object.fromEntries(Object.entries(files).map(([name, data]) => [name, new Uint8Array(Buffer.from(data, 'base64'))]))])) }
              outputs.set(output, structuredClone(output))
              return output
            },
          }
          return Object.freeze(remote)
        },
      })
      return { api,
        async close() { try { await browser!.close() } finally { try { await server.close() } finally { await removeCache() } } },
      }
    } catch (error) {
      try { await browser?.close() } finally { try { await server.close() } finally { await removeCache() } }
      throw error
    }
  }
  let started: ReturnType<typeof startWorker> | undefined
  const api: CoursewareCaseBuilderApiV2 = Object.freeze({
    discover: (query: CourseAgentCapabilityQuery = {}) => queryCourseAgentCapabilities(generatedCapabilities as CourseAgentCapabilityData, query),
    readCapability: (id: string, options: CourseAgentCapabilityCardOptions = {}) => readCourseAgentCapability(generatedCapabilities as CourseAgentCapabilityData, id, options),
    componentCatalog: catalog.load,
    createCourseProject: async (options: CoursewareBuilderV2Options) => (await (started ??= startWorker())).api.createCourseProject(options),
  })
  return { api,
    resolveOutput(value: unknown): CoursewareCaseBuildOutput {
      const output = typeof value === 'object' && value !== null ? outputs.get(value) : undefined
      if (!output) throw new Error('Builder V2 必须直接返回工作会话 finish() 的结果')
      return structuredClone(output)
    },
    async close() { if (!started) return; const worker = await started.catch(() => undefined); await worker?.close() },
  }
}

export interface CoursewareCaseBuilderContextV2 {
  apiVersion: 2
  caseDir: string
  encodeBase64(value: Uint8Array | string): string
  readAsset(relativePath: string): Promise<Uint8Array>
  documents: { teachingPlan: { path: string; content: string }; presentationScript: { path: string; content: string } }
  capabilityIndex: unknown
  capabilityDiscovery?: unknown
  api: CoursewareCaseBuilderApiV2
}
export type CoursewareCaseBuilderV2 = (context: CoursewareCaseBuilderContextV2) => Promise<CoursewareCaseBuildOutput>
