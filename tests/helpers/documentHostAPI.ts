import type { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

/** Real Main document and recovery ports; native dialogs are outside mounted unit fixtures. */
export function documentHostAPI(host: DocumentHostService): DocumentHostAPI {
  const dialog = async (): Promise<never> => { throw new Error('Native dialog is outside this fixture') }
  return {
    ...host.internalAPI,
    bootstrapCourse: () => host.bootstrapCourse(),
    readAuthoringDrafts: id => host.readAuthoringDrafts(id),
    writeAuthoringDrafts: (id, drafts) => host.writeAuthoringDrafts(id, drafts),
    clearAuthoringDrafts: id => host.clearAuthoringDrafts(id),
    saveWithDialog: dialog,
    closeWithDialog: dialog,
    close: async (documentId, discardDirty) => { await host.operate({ type: 'close', documentId, discardDirty }) },
    discardRecovery: async documentId => { await host.operate({ type: 'discard-recovery', documentId }) },
    subscribe: listener => host.subscribeEvents(listener),
  }
}
