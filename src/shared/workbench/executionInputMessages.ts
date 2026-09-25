/** Fixed product text for sends Main refuses before any model request: [message, suggestion]. */
export const executionInputMessages = {
  'empty-input': ['还没有可发送的内容。', '请输入要求，或添加并准备好附件后再发送。'],
  'document-session-changed': ['目标文档已关闭或重新打开，原来的引用已失效。', '重新打开目标文档并更新本条消息的文档引用后再发送。'],
  'document-range-changed': ['已选局部内容在输入期间发生了变化。', '在正文中重新选择需要修改的范围，并更新本条消息的引用后再发送。'],
  'home-file-missing': ['会话所属文件已不存在，本条消息没有发送。', '请重新引用可用文件，或从工作空间新建会话后发送。'],
  'history-attachment-missing': ['当前会话的历史附件请求记录不完整，无法保留原有输入。', '新建会话，并重新添加这次需要的附件后再发送。'],
  'vision-unverified': ['当前或历史输入包含图片，但配置的视觉角色尚未确认支持图片。', '打开模型设置，选择已确认支持图片的视觉模型后重试；本次未请求模型。'],
  'vision-unsupported': ['当前或历史输入包含图片，但所选模型已确认不支持图片输入。', '在输入框选择支持图片的模型后重试；本次未请求模型。'],
  'vision-unconfigured': ['当前或历史输入包含图片，但尚未配置可用的视觉角色。', '打开模型设置并配置视觉角色后重试；本次未请求模型。'],
  'conversation-unconfigured': ['尚未配置可用的对话与规划模型。', '打开模型设置，配置对话与规划角色后再发送。'],
  'model-connection-unavailable': ['本次模型角色的连接尚未接通或已撤销。', '打开模型设置，检查相应连接并重新登录或配置凭据后重试。'],
  'disclosed-settings-changed': ['模型或服务配置在发送时已变化，本次未请求模型。', '核对输入框下方当前显示的服务与模型后再次发送。'],
  'attachment-unavailable': ['有附件尚无可发送的表示，或其快照已不可读取。', '在附件卡中完成提取；若仍失败，移除该卡并重新添加附件后重试。'],
  'conversation-draft-changed': ['本条消息的草稿已在另一处更新。', '重新打开当前会话，核对保留的草稿和附件后再发送。'],
  'submission-conflict': ['同一提交编号已用于不同消息，本次未重复发送。', '保留当前输入，核对消息列表后重新发送。'],
} as const satisfies Record<string, readonly [string, string]>

export type ExecutionInputErrorCode = keyof typeof executionInputMessages

/**
 * Whether a failed desktop send is this refusal. contextBridge keeps only an Error's message (its name and
 * stack are rebuilt in the page), so the page recognises the fixed text; unit fixtures may still set the name.
 */
export function isExecutionInputError(error: unknown, code: ExecutionInputErrorCode): boolean {
  return error instanceof Error && (error.name === `DesktopAPIError:execution-${code}` || error.message.includes(executionInputMessages[code][0]))
}
