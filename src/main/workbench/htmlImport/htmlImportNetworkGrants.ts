import { courseConnectOriginSchema } from '../../../shared/contracts/course-project-v9/schema'
import type { DocumentSnapshot } from '../../../shared/workbench/document'

interface Grant {
  documentId: string
  epoch: string
  revision: number
  origins: readonly string[]
}

/** Main-only, one-run grant for origins proved by the mechanical HTML importer. */
export class HtmlImportNetworkGrants {
  private readonly grants = new Map<string, Grant>()

  register(runId: string, grant: Grant): void {
    if (this.grants.has(runId)) throw new Error('HTML 导入网络声明已冻结')
    const origins = [...new Set(grant.origins.map(origin => courseConnectOriginSchema.parse(origin)))].sort()
    this.grants.set(runId, { documentId: grant.documentId, epoch: grant.epoch, revision: grant.revision, origins })
  }

  policy(runId: string, documentId: string, read: () => DocumentSnapshot): { allowedOrigins: readonly string[] } | undefined {
    const grant = this.grants.get(runId)
    if (!grant) return undefined
    if (grant.documentId !== documentId) throw new Error('HTML 导入网络声明不属于当前文档')
    const snapshot = read()
    if (snapshot.documentId !== grant.documentId || snapshot.epoch !== grant.epoch || snapshot.revision !== grant.revision
      || snapshot.model.kind !== 'course-v9') throw new Error('HTML 导入网络声明的冻结文档已变化')
    return { allowedOrigins: [...new Set([...(snapshot.model.project.network?.connectOrigins ?? []), ...grant.origins])].sort() }
  }

  clear(runId: string): void { this.grants.delete(runId) }
}

export const htmlImportNetworkGrants = new HtmlImportNetworkGrants()
