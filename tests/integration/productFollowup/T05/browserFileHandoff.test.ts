// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ManagedBrowserMcpService } from '../../../../src/main/workbench/externalTools/ManagedBrowserMcpService'

it.each([true, false])('upload honors File owner authorization for a selected file outside the task workspace (authorized: %s)', async authorized => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T05-upload-'))
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
  const filename = path.join(directory, 'selected.pdf')
  await fs.writeFile(filename, '%PDF-1.7 selected teacher document')
  let uploads = 0, reads = 0
  const service = new ManagedBrowserMcpService({ scratchRoot: path.join(workspace, 'browser'), approveExternalAction: async () => true,
    readUpload: async input => {
      reads++; expect(input).toEqual({ runId: 'run', path: filename })
      if (!authorized) throw new Error('File owner did not authorize this selected input')
      return { name: 'selected.pdf', bytes: await fs.readFile(filename) }
    },
    embeddedBackend: async options => {
      options.onPageChanged('https://example.com/upload-fixture')
      return {
        discover: async () => ({ status: 'available', tools: [] }),
        invoke: async input => {
          if (input.name.endsWith('browser_file_upload')) {
            uploads++
            const paths = input.arguments.paths as string[]
            expect(paths).toHaveLength(1)
            expect(paths[0]).not.toBe(filename)
            expect(await fs.readFile(paths[0], 'utf8')).toBe('%PDF-1.7 selected teacher document')
            return { status: 'returned', service: 'browser', tool: input.name, operationId: input.operationId, content: [], truncated: false }
          }
          return { status: 'returned', service: 'browser', tool: input.name, operationId: input.operationId,
            content: [{ type: 'text', text: '- Page URL: https://example.com/upload-fixture', truncated: false }], truncated: false }
        },
        control: async () => {}, viewport: () => ({ embedded: true, visible: false }),
        readResource: async () => { throw new Error('No resource') }, stop: async () => {},
      }
    },
  })
  try {
    await service.beginRun('run', { permission: 'workspace-write', allowPublicNavigation: true })
    const observation = await service.invoke({ runId: 'run', operationId: 'observe', name: 'browser_snapshot', arguments: {} })
    const input = { runId: 'run', operationId: 'upload', name: 'browser_file_upload', arguments: { paths: [filename] }, snapshotId: observation.snapshotId }
    const result = await service.invoke(input)
    expect(result.status).toBe(authorized ? 'returned' : 'rejected')
    expect(uploads).toBe(authorized ? 1 : 0)
    expect(await service.invoke(input)).toEqual(result)
    expect(reads).toBe(1)
    expect(uploads).toBe(authorized ? 1 : 0)
    expect(await fs.readFile(filename, 'utf8')).toBe('%PDF-1.7 selected teacher document')
  } finally {
    await service.endRun('run')
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
