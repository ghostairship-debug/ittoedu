import { createAuthoringToolFacade } from '../authoring/tools/authoringToolFacade'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CourseAuthoringOwner } from '../authoring/courseAuthoringScope'

export function createAuthoringToolActions(ports: {
  kernel: Pick<EditorStoreKernel, 'readDocument' | 'readAuthoringSession' | 'persistTransaction' | 'readResources'>
  readScope(): { owner: CourseAuthoringOwner; stateId: string | null }
  hasContentDraft(): boolean
}) {
  const facade = createAuthoringToolFacade({
    readDocument: () => ports.kernel.readDocument(),
    readResources: () => {
      const resources = ports.kernel.readResources()
      return { assetFiles: resources.courseAssetSidecar?.files ?? {}, componentPackages: resources.componentPackages }
    },
    validateDestination(destination) {
      const target = destination.kind === 'update' ? destination.target : destination.scope
      const session = ports.kernel.readAuthoringSession()
      if (!session || session.token.generation !== target.sessionGeneration ||
        session.token.locationId !== target.locationId || session.token.surfaceType !== target.surfaceType) {
        return { code: 'session-stale', message: '当前作者会话与目标不一致', path: ['destination', 'sessionGeneration'] }
      }
      const scope = ports.readScope()
      if (scope.owner !== target.owner || scope.stateId !== target.stateId) {
        return { code: 'owner-mismatch', message: '当前 owner / 呈现状态与目标不一致', path: ['destination', 'owner'] }
      }
      if (ports.hasContentDraft()) return { code: 'active-content-draft', message: '请先完成当前文字或调色编辑', path: ['destination'] }
      return null
    },
    commit: (step) => ports.kernel.persistTransaction(step, '已应用创作工具修改'),
  })
  return {
    async runAuthoringTool(request: unknown) {
      return facade.execute(request)
    },
  }
}
