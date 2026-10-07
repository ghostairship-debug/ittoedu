import { app, shell } from 'electron'
import path from 'node:path'
import { DocumentHostService } from './DocumentHostService'

let host: DocumentHostService | undefined
export function documentHost(): DocumentHostService {
  return host ??= new DocumentHostService(path.join(app.getPath('userData'), 'workbench-v2', 'documents'), {
    trashItem: filename => shell.trashItem(filename), showItemInFolder: filename => shell.showItemInFolder(filename),
  }, { artifactDeliveryDirectory: path.join(app.getPath('userData'), 'workbench-v2', 'artifact-deliveries') })
}
