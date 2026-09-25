import { DesktopOperationError } from '../../errors'
import { AttachmentError } from './AttachmentService'

const reasons: Record<string, readonly [string, string]> = {
  'invalid-image': ['这份附件没有可解码的图片内容。', '请重新导出为 PNG、JPEG、WebP 或 GIF 后添加；仅修改文件扩展名不能修复图片。'],
  'media-type-mismatch': ['附件声明的图片类型与实际内容不一致。', '请用图片软件重新另存为支持的格式后添加。'],
  'source-too-large': ['附件原件超过当前接收大小限制。', '请压缩图片或拆分文档后重新添加。'],
  'source-changed': ['原文件在读取期间发生了变化，本次未完成添加。', '请等原文件保存完成后重新添加。'],
  'not-a-file': ['所选项目不是普通文件。', '请选择具体文件；云端文件请先下载到本机。'],
  'unsupported-representation': ['这个文件还没有可发送的文字或图片表示。', '请转换为 UTF-8 文本、Markdown 或支持的图片格式后添加。'],
  'representation-unavailable': ['所选附件表示已不可用，或原件尚未提取。', '请在附件卡提取需要的内容，或移除此引用后重新添加；其他附件不受影响。'],
  'corrupt-snapshot': ['这份附件的快照记录已损坏，不能继续使用。', '请重新添加原件并替换此附件引用；不会删除其他快照。'],
  'corrupt-blob': ['这份附件保存的内容校验失败，不能继续使用。', '请重新添加原件并替换此附件引用；不会删除其他快照。'],
  'attachment-missing': ['所需附件文件已不存在，当前无法读取。', '请重新选择原件并添加；其他已有附件和草稿仍保留。'],
  'path-not-authorized': ['本次附件文件读取授权已失效。', '请重新选择文件或从资源树重新引用；应用不会扩大文件访问范围。'],
  'extraction-unavailable': ['附件提取服务当前不可用。', '请重新打开应用后重试，或先提供需要的文字和图片。'],
  'extraction-too-large': ['提取出的文字或图片超过容量限制。', '请选择更少的页重新提取，或拆分原文件后添加。'],
  'invalid-extraction': ['提取结果未通过内容与来源校验，本次结果未添加。', '请缩小页范围或重新导出原文件后重试；已保存的原件快照仍保留。'],
  'extraction-failed': ['文件内容未能完成提取。', '请检查文件是否可正常打开或需要密码，也可选择更少页重试；原件快照仍保留。'],
  'extraction-timeout': ['提取耗时超过限制，工作进程已关闭。', '请选择更少的页重试；已保存的原件快照仍保留。'],
  'extraction-exited': ['提取工作进程提前退出，本次未完成。', '请重试或减少页数；已保存的原件快照仍保留。'],
  'extraction-start-failed': ['附件提取窗口未能启动。', '请重新打开应用后重试；已保存的原件快照仍保留。'],
  'operation-cancelled': ['本次附件处理已取消。', '如需继续，请点击重试或重新提取；取消不会删除原件及已保存快照。'],
  'request-running': ['这个附件仍在处理中。', '请等待处理结束，或先取消再重试。'],
  'too-many-pending': ['待处理附件过多。', '请先完成或移除部分待处理附件，再重新选择文件。'],
  'clipboard-not-focused': ['当前窗口未获得焦点，尚未读取剪贴板文件。', '请点击聊天输入框，再按粘贴快捷键。'],
}
/** Only classified domain failures receive product text. Unknown exceptions remain diagnostic-only. */
export function attachmentOperationError(error: unknown): unknown {
  if (error instanceof DesktopOperationError) return error
  const code = error instanceof AttachmentError ? error.code
    : (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? 'attachment-missing' : undefined
  const detail = code && reasons[code]
  return detail ? new DesktopOperationError(`attachment-${code}`, '附件操作未完成', detail[0], `${detail[1]} 已有草稿与其他附件保持不变。`, { cause: error }) : error
}
