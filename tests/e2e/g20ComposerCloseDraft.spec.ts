import { expect, test, type ElectronApplication } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConversationStoreState } from '../../src/shared/workbench/conversations'
import { m23Fixture } from './helpers/g20M23Fixtures'
import { chooseM23Workspace, closeM23, launchM23 } from './helpers/g20M23Harness'

test('main assistant keeps its focused unsent draft through normal window close and restart', async ({}, info) => {
  test.setTimeout(90_000)
  const fixture = m23Fixture('composer-close-draft')
  const draft = '主助手仍在输入：关闭窗口并重启后，应完整恢复这段尚未发送的草稿。'
  const storePath = join(fixture.profile, 'workbench-v2/conversations/conversations-v2.json')
  const apps: Array<{ app: ElectronApplication; process: ReturnType<ElectronApplication['process']> }> = []
  const facts: Record<string, unknown> = { workspace: fixture.workspace, profile: fixture.profile, draft,
    closeMethod: 'BrowserWindow.close()', isolatedBackgroundWindow: true }
  const storedConversation = (conversationId: string) => {
    const state = JSON.parse(readFileSync(storePath, 'utf8')) as ConversationStoreState
    const conversation = state.conversations[conversationId]
    return conversation ? { conversationId, inputDraft: conversation.inputDraft, revision: conversation.revision } : null
  }
  try {
    const first = await launchM23(fixture)
    apps.push({ app: first.app, process: first.app.process() })
    facts.firstRuntime = first.capture
    await chooseM23Workspace(first.app, first.page, fixture.workspace)
    const composer = first.page.getByLabel('给创作助手发消息', { exact: true })
    await expect(composer).toBeEnabled()
    const conversationId = await first.page.evaluate(async workspace => {
      const opened = await window.desktopAPI.execution!.workspace(workspace)
      return opened.conversations.find(conversation => !conversation.element)?.conversationId
    }, fixture.workspace)
    expect(conversationId).toBeTruthy()
    facts.conversationId = conversationId

    await composer.fill(draft)
    await expect(composer).toBeFocused()
    facts.beforeClose = await composer.evaluate(element => ({
      value: (element as HTMLTextAreaElement).value,
      activeElementIsComposer: document.activeElement === element,
    }))
    facts.storedBeforeClose = storedConversation(conversationId!)

    // Do not blur the composer or call the draft API: close must preserve its current local state.
    const process = first.app.process()
    await first.app.evaluate(({ BrowserWindow }) => {
      setTimeout(() => BrowserWindow.getAllWindows()[0]?.close(), 0)
    })
    await expect.poll(() => process.exitCode !== null || process.signalCode !== null,
      { message: 'normal window close must finish the Electron process before restart', timeout: 20_000 }).toBe(true)
    facts.processAfterClose = { exitCode: process.exitCode, signalCode: process.signalCode }
    expect(process.exitCode).toBe(0)
    facts.storedAfterClose = storedConversation(conversationId!)

    const reopened = await launchM23(fixture)
    apps.push({ app: reopened.app, process: reopened.app.process() })
    facts.reopenedRuntime = reopened.capture
    await chooseM23Workspace(reopened.app, reopened.page, fixture.workspace)
    const restoredComposer = reopened.page.getByLabel('给创作助手发消息', { exact: true })
    await expect(restoredComposer).toBeEnabled()
    facts.restoredValue = await restoredComposer.inputValue()
    facts.storedAfterRestart = storedConversation(conversationId!)
    await expect(restoredComposer).toHaveValue(draft)
    expect(storedConversation(conversationId!)?.inputDraft).toBe(draft)
  } catch (error) {
    facts.failure = error instanceof Error ? error.stack ?? error.message : String(error)
    throw error
  } finally {
    const evidencePath = join(fixture.directory, 'evidence.json')
    writeFileSync(evidencePath, JSON.stringify(facts, null, 2) + '\n', 'utf8')
    await info.attach('normal close and composer draft recovery', { path: evidencePath, contentType: 'application/json' })
    // Forced teardown is cleanup only, after the measured normal close/restart has finished or failed.
    for (const { app, process } of apps.reverse()) {
      if (process.exitCode === null && process.signalCode === null) await closeM23(app)
    }
  }
})
