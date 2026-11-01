import { promises as fs } from 'node:fs'
import path from 'node:path'
import { restoreSerializedResourcePool } from '../../src/shared/serializedResourcePool'
import { compilePublishedScriptModule } from '../../src/core/publish/componentPlatform/compiledScript'

async function main() {
  const file = process.argv[2] ?? 'output/creation-execution-20261031/greenhouse-shared-repair-02/workspace/社区温室-教师接手-离线.html'
  const html = await fs.readFile(file, 'utf8')
  const json = (id: string) => new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`).exec(html)?.[1]
  const raw = json('course-data')
  if (!raw) throw new Error('No formal course-data payload')
  const pool = json('course-resource-pool')
  const payload = restoreSerializedResourcePool(JSON.parse(raw), pool ? JSON.parse(pool) : undefined) as any
  const sources = Object.entries(payload.nativeSources ?? {}).map(([id, entry]) => {
    const code = (entry as any).code as string
    const maps = [...code.matchAll(/^\/\/# sourceMappingURL=data:application\/json[^,]*,([^\r\n]*)/gm)]
    const sourceMapBytes = maps.reduce((sum, match) => sum + Buffer.byteLength(match[0]), 0)
    const started = performance.now()
    const coverage = compilePublishedScriptModule(code, { routing: true })
    return { id, codeBytes: Buffer.byteLength(code), sourceMapBytes, nativeReasons: coverage.nativeReasons,
      analysisMs: performance.now() - started }
  })
  const result = { observedAt: new Date().toISOString(), file, htmlBytes: Buffer.byteLength(html),
    courseDataBytes: Buffer.byteLength(raw), sources }
  const out = path.resolve('output/comprehensive-execution-20261101/source-delivery')
  await fs.mkdir(out, { recursive: true })
  await fs.writeFile(path.join(out, 'baseline.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
