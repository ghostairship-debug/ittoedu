// @vitest-environment node
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'

it('preserves real foreign and string observation rejections through the Gateway while retaining native and unknown defaults', async () => {
  let sequence = 0, rejection: unknown
  const driver = new TextDriver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `identity-${++sequence}`,
    bindingKey: binding => binding.path,
    persistence: { append: async () => {}, save: async () => { throw new Error('no save in observation test') } },
  })
  const session = await registry.open({ kind: 'file', path: 'D:\\fixture\\module.html', version: 'version-one', bindingVersion: 1 },
    async () => driver.load(new TextEncoder().encode('<!doctype html><button>检查</button>')))
  const execute = vi.fn(async () => { throw rejection })
  const gateway = new DocumentToolGateway(registry, [driver], () => `call-${++sequence}`, { services: {
    htmlActions: { execute, readResource: async () => { throw new Error('no capture was returned') } },
  } })
  await gateway.beginRun({ runId: 'observe', actor: 'agent', documents: [{ documentId: session.documentId, writable: [] }] })
  const original = session.read()
  const observe = async (error: unknown) => {
    rejection = error
    return gateway.execute('observe', `observe-${++sequence}`, { name: 'html.observe', input: { purpose: 'required' } })
  }
  try {
    const foreign = runInNewContext("Object.assign(new Error('HTML 运行内容尚未就绪'), { code: 'html-readiness-failed' })") as unknown
    expect(foreign instanceof Error).toBe(false)
    expect(await observe(foreign)).toEqual({ kind: 'error', code: 'html-readiness-failed', message: 'HTML 运行内容尚未就绪' })
    expect(await observe('HTML 任务预览无响应')).toEqual({ kind: 'error', code: 'invalid-operation', message: 'HTML 任务预览无响应' })
    expect(await observe(Object.assign(new Error('本 realm 原错误'), { code: 'native-error' })))
      .toEqual({ kind: 'error', code: 'native-error', message: '本 realm 原错误' })
    expect(await observe(new Error(''))).toEqual({ kind: 'error', code: 'invalid-operation', message: '' })
    expect(await observe({ detail: '未知原件', code: 17 })).toEqual({ kind: 'error', code: 'invalid-operation', message: '工具操作失败' })
    expect(await observe('   ')).toEqual({ kind: 'error', code: 'invalid-operation', message: '工具操作失败' })
    expect(execute).toHaveBeenCalledTimes(6)
    expect(execute.mock.calls[0]).toMatchObject(['observe', {
      documentId: original.documentId, epoch: original.epoch, revision: original.revision,
    }, { name: 'html.observe', input: { purpose: 'required' } }])
    expect(session.read()).toEqual(original)
  } finally { await gateway.stop('observe') }
})
