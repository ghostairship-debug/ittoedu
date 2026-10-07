// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { runValidateProjectCli } from '../../../../scripts/validate-project'

it('public validator accepts a Main-saved V10 file and reports retired V9 incompatible while preserving the supplied original', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T11-validator-'))
  try {
    const host = new DocumentHostService(path.join(directory, 'recovery'))
    const created = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Current teacher lesson'), resources: { assets: {}, components: {} } }, 'current.h5lesson')
    const filename = path.join(directory, 'current.h5lesson')
    await host.saveToPath(created.documentId, filename)
    let stdout = '', stderr = ''
    const io = { read: (value: string) => fs.readFile(value), stdout: (value: string) => { stdout += value }, stderr: (value: string) => { stderr += value } }
    expect(await runValidateProjectCli([filename], io)).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ status: 'valid', schema: { valid: true, schemaVersion: 10 }, project: { title: 'Current teacher lesson' } })
    expect(stderr).toBe('')
    const original = path.join(directory, 'retired.h5lesson')
    const retiredSource = JSON.stringify({ schemaVersion: 9, id: 'old', title: 'Preserve original', locations: [], surfaces: [], globalLayerItems: [], startLocationId: 'old' })
    await fs.writeFile(original, zipSync({ 'project.json': strToU8(retiredSource) }))
    stdout = ''; stderr = ''
    expect(await runValidateProjectCli([original], io)).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ status: 'unreadable', schema: { schemaVersion: 9 }, fatal: { code: 'unsupported-version' } })
    const { unzipSync, strFromU8 } = await import('fflate')
    expect(strFromU8(unzipSync(await fs.readFile(original))['project.json']!)).toBe(retiredSource)
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
