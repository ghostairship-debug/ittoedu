import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createTextData, TEXT_DEFINITION } from '../../src/components/text'
import { ComponentAuthoringPanel } from '../../src/renderer/components/ComponentAuthoringPanel'
import type { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { TextComponentEditorOwner } from '../../src/components/text/editor'
let editor: TextComponentEditorOwner<ReturnType<typeof createTextData>>
vi.mock('../../src/components/text/editor', () => ({
  TextComponentEditor: (props: typeof editor) => {editor=props;return null}, FormulaComponentEditor:()=>null,
}))
vi.mock('../../src/renderer/components/ComponentSourceEditor',()=>({ComponentSourceEditor:()=>null}))
afterEach(cleanup)
it('P0 professional panel waits for canonical ACK and returns false on rejection',async()=>{
  const data=createTextData('原文'),report=vi.fn()
  let reject!: (error:Error)=>void
  const submit=vi.fn(()=>new Promise<void>((_,fail)=>{reject=fail}))
  render(<ComponentAuthoringPanel instance={{id:'text',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(data))}}
    definitionKey="guoling.text" implementation={TEXT_DEFINITION.implementation} revision={1}
    bridge={{} as CourseV10DocumentBridge} submit={submit} report={report} documentId="doc-a"/>)
  const pending=Promise.resolve(editor.onChange(createTextData('保留草稿'),{historyGroup:'test'} as Parameters<typeof editor.onChange>[1]))
  let settled=false; void pending.then(()=>{settled=true})
  await Promise.resolve();expect(settled).toBe(false)
  reject(new Error('正式提交失败'))
  expect(await pending).toBe(false);expect(report).toHaveBeenCalledWith('正式提交失败')
  expect(submit).toHaveBeenCalledOnce()
})
