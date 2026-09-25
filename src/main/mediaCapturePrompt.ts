import { BrowserWindow, dialog } from 'electron'
import type { MediaCaptureKind, MediaCaptureRequest } from './security'

export function mediaCaptureLabel(kinds: readonly MediaCaptureKind[]): string {
  const audio = kinds.includes('audio'), video = kinds.includes('video')
  return audio && video ? '摄像头和麦克风' : video ? '摄像头' : '麦克风'
}

/**
 * Per-request consent for course content (Runtime/Component getUserMedia). Nothing is
 * remembered: the next request asks again, and any failure or dismissal denies.
 */
export async function askMediaCapture(request: MediaCaptureRequest): Promise<boolean> {
  const owner = BrowserWindow.fromWebContents(request.contents)
  if (!owner || owner.isDestroyed()) return false
  const device = mediaCaptureLabel(request.mediaTypes)
  const { response } = await dialog.showMessageBox(owner, {
    type: 'question',
    title: '课件请求使用设备',
    message: `当前课件请求使用${device}。`,
    detail: '只对本次请求生效；选择“拒绝”后，课件会收到“未获授权”。',
    buttons: ['拒绝', `允许本次使用${device}`],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return response === 1
}
