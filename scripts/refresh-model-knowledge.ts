import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_KNOWLEDGE_URL, normalizeModelKnowledge } from '../src/main/workbench/providers/ModelKnowledgeService'

async function main() {
  const response = await fetch(MODEL_KNOWLEDGE_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Public model knowledge request returned HTTP ${response.status}`)
  const snapshot = normalizeModelKnowledge(await response.json(), new Date().toISOString())
  if (!snapshot.models.length) throw new Error('Public model knowledge directory contained no models')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const filename = path.join(root, 'src/shared/generated/modelKnowledge.json')
  await fs.mkdir(path.dirname(filename), { recursive: true })
  await fs.writeFile(filename, `${JSON.stringify(snapshot)}\n`, 'utf8')
  console.log(`Saved ${snapshot.models.length} normalized public model entries from ${snapshot.sourceUrl} at ${snapshot.updatedAt}`)
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
