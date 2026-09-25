import type { ConversationMessage } from '../../shared/workbench/conversations'

export const USER_MESSAGE_WINDOW_SIZE = 20

export interface UserMessageWindow {
  messages: ConversationMessage[]
  total: number
  offsetFromLatest: number
  windowNumber: number
  windowCount: number
  canShowOlder: boolean
  canShowNewer: boolean
}

export function userMessageWindow(
  messages: readonly ConversationMessage[],
  requestedOffsetFromLatest: number,
  windowSize = USER_MESSAGE_WINDOW_SIZE,
): UserMessageWindow {
  const userMessages = messages.filter(message => message.role === 'user')
  const safeWindowSize = Math.max(1, Math.floor(windowSize))
  const windowCount = userMessages.length === 0 ? 0 : Math.ceil(userMessages.length / safeWindowSize)
  const maxOffset = Math.max(0, windowCount - 1)
  const offsetFromLatest = Math.min(maxOffset, Math.max(0, Math.floor(requestedOffsetFromLatest)))
  const end = userMessages.length - offsetFromLatest * safeWindowSize
  const start = Math.max(0, end - safeWindowSize)

  return {
    messages: userMessages.slice(start, end),
    total: userMessages.length,
    offsetFromLatest,
    windowNumber: windowCount === 0 ? 0 : windowCount - offsetFromLatest,
    windowCount,
    canShowOlder: offsetFromLatest < maxOffset,
    canShowNewer: offsetFromLatest > 0,
  }
}
