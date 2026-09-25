import { DesktopOperationError } from '../../errors'
import { executionInputMessages, type ExecutionInputErrorCode } from '../../../shared/workbench/executionInputMessages'

/** Only fixed product text crosses IPC. File paths, provider payloads and arbitrary exception messages never do. */
export function executionInputError(code: ExecutionInputErrorCode, cause?: unknown): DesktopOperationError {
  const [message, suggestion] = executionInputMessages[code]
  return new DesktopOperationError(`execution-${code}`, '消息尚未发送', message, `${suggestion} 输入、附件和已应用的文档修改已保留。`, { cause })
}
