import { expect, it } from 'vitest'
import { executionInputMessages, isExecutionInputError } from '../../src/shared/workbench/executionInputMessages'

// contextBridge keeps only an Error's message: the page sees name "Error" and a rebuilt stack.
it('recognises a closed-document refusal by its fixed text after the context bridge, or by name in fixtures', () => {
  const [message, suggestion] = executionInputMessages['document-session-changed']
  const bridged = new Error(`消息尚未发送：${message}\n${suggestion} 输入、附件和已应用的文档修改已保留。`)
  expect(bridged.name).toBe('Error')
  expect(isExecutionInputError(bridged, 'document-session-changed')).toBe(true)
  expect(isExecutionInputError(bridged, 'document-range-changed')).toBe(false)
  const fixture = new Error('任意文字'); fixture.name = 'DesktopAPIError:execution-document-session-changed'
  expect(isExecutionInputError(fixture, 'document-session-changed')).toBe(true)
  expect(isExecutionInputError(new Error('桌面功能暂时不可用。请重新启动编辑器后重试。'), 'document-session-changed')).toBe(false)
  expect(isExecutionInputError({ message }, 'document-session-changed')).toBe(false)
})
