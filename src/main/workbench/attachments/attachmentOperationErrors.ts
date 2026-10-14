import { DesktopOperationError } from '../../errors'
import { AttachmentError } from './AttachmentService'

import { ATTACHMENT_FAILURE_REASONS as reasons } from './attachmentFailureReasons'
/** Only classified domain failures receive product text. Unknown exceptions remain diagnostic-only. */
export function attachmentOperationError(error: unknown): unknown {
  if (error instanceof DesktopOperationError) return error
  const code = error instanceof AttachmentError ? error.code
    : (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? 'attachment-missing' : undefined
  const detail = code && reasons[code]
  return detail ? new DesktopOperationError(`attachment-${code}`, '附件操作未完成', detail[0], `${detail[1]} 已有草稿与其他附件保持不变。`, { cause: error }) : error
}
