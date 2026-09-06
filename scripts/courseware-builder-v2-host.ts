import path from 'node:path'
import { createServer } from 'vite'
import { chromium, type Page } from 'playwright'
import type { CoursewareBuilderV2, CoursewareBuilderV2Options } from '../src/renderer/course/coursewareBuilderV2'
import type { CoursewareCaseBuildOutput } from '../src/renderer/course/coursewareCaseBuilderApi'

type AsyncMethod<T> = T extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never
export type RemoteCoursewareBuilderV2 = { readonly tools: readonly string[] } & { [K in 'snapshot' | 'activate' | 'createScope' | 'execute' | 'finish']: AsyncMethod<CoursewareBuilderV2[K]> }
export interface CoursewareCaseBuilderApiV2 {
  createCourseProject(options: CoursewareBuilderV2Options): Promise<RemoteCoursewareBuilderV2>
}

/** Product-owned browser worker keeps CLI dynamic admission on the actual Published hosts. */
export async function createCoursewareBuilderV2Host(editorRoot: string) {
  const server = await createServer({ root: editorRoot, configFile: path.join(editorRoot, 'vite.renderer.config.ts'),
    server: { host: '127.0.0.1', port: 19800, strictPort: false }, logLevel: 'error' })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Builder 浏览器端口不可用')
    const pages: Page[] = []
    const outputs = new WeakMap<object, CoursewareCaseBuildOutput>()
    const api: CoursewareCaseBuilderApiV2 = Object.freeze({
      async createCourseProject(options: CoursewareBuilderV2Options): Promise<RemoteCoursewareBuilderV2> {
        const page = await browser!.newPage()
        pages.push(page)
        await page.goto(`http://127.0.0.1:${address.port}`)
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
          activate: input => call('activate', [input]),
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
      resolveOutput(value: unknown): CoursewareCaseBuildOutput {
        const output = typeof value === 'object' && value !== null ? outputs.get(value) : undefined
        if (!output) throw new Error('Builder V2 必须直接返回工作会话 finish() 的结果')
        return structuredClone(output)
      },
      async close() { try { await browser!.close() } finally { await server.close() } },
    }
  } catch (error) {
    try { await browser?.close() } finally { await server.close() }
    throw error
  }
}

export interface CoursewareCaseBuilderContextV2 {
  apiVersion: 2
  caseDir: string
  documents: { teachingPlan: { path: string; content: string }; presentationScript: { path: string; content: string } }
  capabilityIndex: unknown
  api: CoursewareCaseBuilderApiV2
}
export type CoursewareCaseBuilderV2 = (context: CoursewareCaseBuilderContextV2) => Promise<CoursewareCaseBuildOutput>
