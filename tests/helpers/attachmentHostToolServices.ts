import type { HostToolServices } from '../../src/core/tools/HostToolServices'
import { materialListSchema } from '../../src/core/tools/MaterialTools'
import type { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { dispatchMaterialTool, readMaterialImageSource } from '../../src/main/workbench/execution/MaterialReadTools'
import type { ToolRunGrant } from '../../src/shared/workbench/tools'

/** Main's material ports with the real attachment owner and task-frozen grants. */
export function attachmentHostToolServices(attachments: AttachmentService, host: DocumentHostService): HostToolServices {
  const grants = new Map<string, ToolRunGrant>(), admitted = new Map<string, Set<string>>()
  const controllers = new Map<string, AbortController>()
  const sources = (runId: string) => {
    const ids = admitted.get(runId)
    if (!ids) throw new Error('Material task has stopped')
    return ids
  }
  return {
    beginRun: async grant => {
      grants.set(grant.runId, structuredClone(grant))
      admitted.set(grant.runId, new Set(grant.materialIds))
      controllers.set(grant.runId, new AbortController())
    },
    stopRun: runId => { controllers.get(runId)?.abort(); controllers.delete(runId); grants.delete(runId); admitted.delete(runId) },
    materials: {
      admit: async (runId, ids) => {
        for (const id of ids) { await attachments.readSnapshot(id); sources(runId).add(id) }
      },
      read: async (runId, name, raw) => {
        const ids = sources(runId)
        let input = raw
        if (name === 'material.list') {
          const requested = materialListSchema.parse(raw)
          if (requested.path) {
            const access = grants.get(runId)?.fileAccess
            if (!access?.workspaceRoot) throw Object.assign(new Error('Task has no workspace file grant'), { code: 'not-authorized' })
            const file = await host.agentFiles.readAuthorizedFile({ runId, workspaceRoot: access.workspaceRoot,
              permission: access.permission, conversationHome: access.conversationHome,
              conversationHomeRoot: access.conversationHomeRoot, boundPaths: Object.values(access.boundPaths ?? {}) }, requested.path)
            const snapshot = await attachments.receiveBytes({ name: file.name, bytes: file.bytes,
              source: { kind: 'workspace', authorizationId: runId, pathHint: file.path } }, { signal: controllers.get(runId)?.signal })
            ids.add(snapshot.id)
            input = { attachmentId: snapshot.id, offset: requested.offset, limit: requested.limit }
          }
        }
        const result = await dispatchMaterialTool(attachments, ids, name, input, controllers.get(runId)?.signal)
        if ('admittedSourceIds' in result) for (const id of result.admittedSourceIds ?? []) ids.add(id)
        return { kind: 'read', data: result.data }
      },
      readResource: async ({ runId, resourceId }) => readMaterialImageSource(attachments, sources(runId), resourceId, controllers.get(runId)?.signal),
    },
  }
}
