import { expect, type Locator } from '@playwright/test'

/**
 * 「本轮引用」下拉框嵌在两层默认收起的 <details> 内：外层「任务设置」
 * （CourseChatPanel.tsx:436 `details.chat-task-settings`）与内层「其它目标」
 * （同文件 :445 `details.chat-target-more`）。收起态下 select 在 DOM 中可解析但不可见，
 * 而 Playwright 的 selectOption 要求元素可见，直接取用会超时。
 *
 * 两层都按需展开（已展开则不动，避免把调用方刚展开的层误收起），返回可直接操作的 select。
 * 取代各 spec 里零散的 `chat.getByLabel('本轮引用')`，保证控件位置变化只需改这一处。
 */
export async function openReferenceSelect(chat: Locator): Promise<Locator> {
  for (const selector of ['details.chat-task-settings', 'details.chat-target-more']) {
    const details = chat.locator(selector)
    const open = await details
      .evaluate((element) => (element as HTMLDetailsElement).open)
      .catch(() => false)
    if (!open) await details.locator(':scope > summary').click()
    await expect(details).toHaveJSProperty('open', true)
  }
  return chat.getByLabel('本轮引用', { exact: true })
}

/**
 * 展开两层 details 后按 scope 选择本轮引用。
 * 不附加值断言：各调用点对选中后的状态有各自的期望（wholeCourse 下 select 会被禁用、
 * 引用可能被产品重新解析），保留原有断言即可，这里只负责"让控件可操作并选中"。
 */
export async function selectReferenceScope(chat: Locator, scope: string): Promise<void> {
  const select = await openReferenceSelect(chat)
  await select.selectOption(scope)
}
