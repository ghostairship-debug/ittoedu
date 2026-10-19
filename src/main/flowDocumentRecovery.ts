import { promises as fs } from 'node:fs'
import path from 'node:path'
import { flowDocumentRecoverySchema, type FlowDocumentRecoveryRecord } from '../shared/flowDocumentRecovery'

/** Read-only ingress for the one-time migration. No independent Flow writer or session owner remains. */
export async function readLegacyFlowDocumentInputs(root: string): Promise<{ filename: string; record: FlowDocumentRecoveryRecord }[]> {
  const records: { filename: string; record: FlowDocumentRecoveryRecord }[] = []
  for (const directory of [root, path.join(root, 'retained')]) {
    let names: string[]
    try { names = await fs.readdir(directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    for (const name of names.filter(name => name.endsWith('.json'))) {
      const filename = path.join(directory, name)
      // Invalid input remains at its original locator; it never replaces a usable candidate.
      try {
        const parsed = flowDocumentRecoverySchema.safeParse(JSON.parse(await fs.readFile(filename, 'utf8')))
        if (parsed.success) records.push({ filename, record: parsed.data })
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    }
  }
  return records
}
