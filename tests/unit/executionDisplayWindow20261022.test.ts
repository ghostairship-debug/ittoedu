// @vitest-environment node
import { expect, it } from 'vitest'
import { ExecutionPlainTextWindow, readableExecutionText } from '../../src/shared/workbench/executionDisplayText'

it('keeps every split of existing plain redaction rules equivalent to the complete ordered redactor', () => {
  const samples = [
    'Bearer \n\tABc_123+/== 下一段', 'bEaReR\u2003\n密文 下一段', 'Bearer ABC,下一段 ',
    'api_key \n = \t private-key 下一段', 'ACCESS-TOKEN\n: bearer-value 下一段',
    'refresh_token = secret-value;普通内容', 'password\n\t:\n秘密 下一段', 'secret=Bearer \nABCD 下一段',
    'sk-abcdefgh12345 下一段', 'C:\\Users\\someone\\secret.md 下一段', '/Users/person/private.md 下一段',
    '/home/user/a-b.txt 下一段', '普通😀字符，下一段\n继续内容。 ', 'api_key \n = \n Bearer \nTOKEN 下段',
    'secret=sk-api_key \n=foo 下一段', 'secret=C:/folder/api_key \n=foo 下一段', 'C:/private/secret \n=foo 下一段',
  ]
  for (const sample of samples) {
    for (let split = 0; split <= sample.length; split++) {
      const window = new ExecutionPlainTextWindow('说明 ', 12000)
      window.append(sample.slice(0, split))
      const first = readableExecutionText('说明 ' + sample.slice(0, split))
      expect(window.page(), `first ${JSON.stringify(sample)} @${split}`).toEqual({ text: first, total: first.length })
      window.append(sample.slice(split))
      const complete = readableExecutionText('说明 ' + sample)
      expect(window.page(), `complete ${JSON.stringify(sample)} @${split}`).toEqual({ text: complete, total: complete.length })
    }
    const window = new ExecutionPlainTextWindow('说明 ', 12)
    let current = '说明 '
    for (const unit of sample.split('')) {
      current += unit; window.append(unit)
      const complete = readableExecutionText(current)
      expect(window.page()).toEqual({ text: complete.slice(0, 12), total: complete.length })
    }
  }
})

it('only accepts a first character that cannot become valid JSON after an append', () => {
  for (const value of ['{"secret":', '[1,', '"text', '-1', '12', 'true', 'false', 'null', '   ']) expect(ExecutionPlainTextWindow.accepts(value)).toBe(false)
  expect(ExecutionPlainTextWindow.accepts('  中文思考')).toBe(true)
  expect(readableExecutionText('{"secret":"x","message":"Bearer ABCD"}')).toBe('{\n  "secret": "[已隐藏]",\n  "message": "Bearer [已隐藏]"\n}')
})

it('does not rescan the closed long reasoning prefix for each short append', () => {
  const first = '这是冻结长会话中的公开思考文字，每一轮继续分析当前方案。 '.repeat(8000), delta = '继续检查这一小段真实增量。 '
  const replace = String.prototype.replace
  let characters = 0, text = first
  String.prototype.replace = function (this: string, ...args: Parameters<typeof replace>) { characters += this.length; return Reflect.apply(replace, this, args) } as typeof replace
  let result: { text: string; total: number }
  try {
    const window = new ExecutionPlainTextWindow(first, 12000)
    for (let index = 0; index < 64; index++) { text += delta; window.append(delta); window.page() }
    result = window.page()
  } finally { String.prototype.replace = replace }
  expect(result!).toEqual({ text: text.slice(0, 12000), total: text.length })
  expect(characters).toBeLessThan(first.length * 6)
})
