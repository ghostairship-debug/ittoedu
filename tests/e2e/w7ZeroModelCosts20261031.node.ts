/** Explicit Node/tsx entry. Reads an optional archive and writes measurements, never author content. */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { collectZeroModelPayloadCosts } from '../helpers/w7PayloadCost'

export async function writeW7ZeroModelCosts(input: { out: string; archive?: string; instanceId?: string; modulePath?: string; oldText?: string; newText?: string }) {
  if (!path.isAbsolute(input.out)) throw new Error('Zero-model report output must be an explicit absolute path')
  let model
  if (input.archive) {
    model = new CourseV10Driver().load(new Uint8Array(await fs.readFile(input.archive)))
    if (model.kind !== 'course-v10') throw new Error('Expected a formal course archive')
  }
  const report = await collectZeroModelPayloadCosts(model ? { model, instanceId: input.instanceId, modulePath: input.modulePath,
    oldText: input.oldText, newText: input.newText } : undefined)
  await fs.mkdir(path.dirname(input.out), { recursive: true })
  await fs.writeFile(input.out, JSON.stringify(report, null, 2))
  return report
}
