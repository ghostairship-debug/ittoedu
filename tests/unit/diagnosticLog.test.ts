// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { DiagnosticLog, exportDiagnosticReport } from '../../src/main/diagnosticLog'
import { APP_NAME } from '../../src/shared/constants'
import { diagnosticFailureDetails, privateDiagnostic, privateDiagnosticLog } from '../../src/main/diagnosticPrivacy'
import { DesktopOperationError } from '../../src/main/errors'
import { ZodError } from 'zod'
const directories: string[] = []
const native = vi.hoisted(() => ({ directory: '', showMessageBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }))
vi.mock('electron', () => ({ app: { isReady: () => true, getVersion: () => '2.0-fixture', getPath: () => native.directory }, dialog: native }))
afterEach(async () => { for (const directory of directories.splice(0)) {
  if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe diagnostic fixture')
  await fs.rm(directory, { recursive: true, force: true })
} })

describe('DiagnosticLog', () => {
  it('identifies a closed reference and plain Error without storing arbitrary document names', async () => {
    const documentId = 'ad9eebee-7695-4ce4-9e5e-1d0c292b6240'
    const failure = new Error(`文档未打开：${documentId}`)
    const record = privateDiagnostic({ source: 'main', message: failure.message, stack: failure.stack,
      details: { ...diagnosticFailureDetails(failure), operation: 'DOCUMENT_OPERATION_FAILED' } })
    expect(record.category).toBe('Error')
    expect(record.details).toMatchObject({ documentId, code: 'DOCUMENT_NOT_OPEN', errorClass: 'Error' })
    expect(record.message).toContain('引用文档已关闭或重开')
    expect(JSON.parse(privateDiagnosticLog(JSON.stringify(record)))).toEqual(record)
    const privateFailure = new Error('文档未打开：我的私有教案 sk-secret')
    expect(JSON.stringify(privateDiagnostic({ message: privateFailure.message, stack: privateFailure.stack,
      details: diagnosticFailureDetails(privateFailure) }))).not.toMatch(/我的私有教案|sk-secret/)
  })
  it('retains build, original operation and application causes on export without trusting business error prose', async () => {
    const root = process.cwd().replace(/\\/g, '/')
    const cause = Object.assign(new Error('私有教案 Bearer sk-secret'), { code: 'extraction-exited' })
    cause.stack = `Error: 私有教案\n    at extract (${root}/src/main/workbench/attachments/SandboxedAttachmentExtraction.ts:80:4)\n    at privateUser (C:/Users/private-name/assets/secret.js:1:3)`
    const failure = new DesktopOperationError('attachment-extraction-failed', '提取失败', '私有教案 Bearer sk-secret', '重试', { cause })
    const record = privateDiagnostic({ source: 'main', message: failure.message, stack: failure.stack,
      details: { ...diagnosticFailureDetails(failure), operation: 'attachment-extraction', phase: 'extract', buildId: '2026-10-11T02-11-21-000Z-123456789abc', documentId: 'ad9eebee-7695-4ce4-9e5e-1d0c292b6240', epoch: 'fa101e8c-2e07-462e-ad2f-5260b22347be', revision: 7 } })
    const twice = JSON.parse(privateDiagnosticLog(JSON.stringify(record)))
    expect(twice).toEqual(record)
    expect(twice.details).toMatchObject({ buildId: '2026-10-11T02-11-21-000Z-123456789abc', operation: 'attachment-extraction', phase: 'extract', code: 'attachment-extraction-failed', causeCode: 'extraction-exited', revision: 7 })
    expect(twice.details.causeFrames[0]).toMatchObject({ file: 'src/main/workbench/attachments/SandboxedAttachmentExtraction.ts', function: 'extract', line: 80 })
    expect(twice.details.causeFrames[1]).toEqual({ file: '[external]', line: 1, column: 3 })
    const packaged = privateDiagnostic({ source: 'renderer', message: 'error', stack: `Error\n at run (file://${root}/dist-renderer/assets/index-Xyz.js:15:19)` })
    expect(packaged.frames?.[0]).toMatchObject({ file: 'assets/index-Xyz.js', function: 'run', line: 15, column: 19 })
    expect(JSON.stringify(twice)).not.toMatch(/私有教案|sk-secret|private-name|secret.js|privateUser/)
    expect(privateDiagnosticLog(JSON.stringify({ message: 'old private prose', details: { name: 'Private lesson prose', documentId: 'C:/Users/private-owner/My-Private-Lesson.glx', operation: 'My personal teaching notes' } }))).not.toMatch(/Private lesson|private-owner|My personal/);
    const invalid = new ZodError([{ code: 'custom', message: '私有教案 sk-secret', path: ['token'] }])
    expect(JSON.stringify(privateDiagnostic({ source: 'main', message: invalid.message, stack: invalid.stack, details: diagnosticFailureDetails(invalid) }))).not.toMatch(/私有教案|sk-secret|token/)
  })
  it('M12 removes user prose and credentials from new storage and old report entries while retaining useful diagnostics', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'courseware-log-'))
    directories.push(directory)
    const log = new DiagnosticLog(directory)

    await Promise.all([
      log.append({ source: 'renderer', message: 'EPERM: 用户私有正文 Bearer sk-private-key', details: { code: 'EPERM', token: 'secret-token', httpStatus: 403 } }),
      log.append({ source: 'component', message: 'second private prose', stack: 'TypeError: private text\n    at run (C:/Users/private-name/project.js:15:20)' }),
    ])
    const persisted = await fs.readFile(path.join(directory, 'editor-diagnostics.jsonl'), 'utf8')
    expect(persisted).not.toMatch(/用户私有正文|private text|private-name|secret-token|sk-private-key|second private prose/)
    await fs.writeFile(path.join(directory, 'editor-diagnostics.previous.jsonl'), JSON.stringify({ source: 'main', message: '旧文档正文', details: { prompt: '隐私教案', apiKey: 'old-api-key' } }) + '\nraw malformed password\n')
    const report = await log.report()

    expect(report).toContain(`${APP_NAME}诊断报告`)
    expect(report).toContain('"source":"component"')
    expect(report).toContain('"category":"TypeError"')
    expect(report).toContain('"code":"EPERM"')
    expect(report).toContain('"httpStatus":403')
    expect(report).toContain('"line":15,"column":20')
    expect(report).toContain('"fingerprint":')
    expect(report).toContain('应用版本：2.0-fixture')
    expect(report).not.toMatch(/旧文档正文|隐私教案|old-api-key|raw malformed password|用户私有正文|private-name/)
  })
  it('keeps only fixed tool fragment shape categories in persisted and exported diagnostics', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'courseware-tool-shape-'))
    directories.push(directory)
    const log = new DiagnosticLog(directory)
    await log.append({ source: 'main', message: 'OpenAI Chat tool fragment protocol', details: {
      chatToolCode: 'unsupported-tool-type', chatToolType: 'custom', chatToolIndex: 0, chatToolHasFunction: true,
      arguments: '{"body":"private user prose"}', body: 'private user prose', token: 'private-token', apiKey: 'private-api-key',
    } })
    await log.append({ source: 'main', message: 'OpenAI Chat tool fragment protocol', details: {
      chatToolCode: 'unsupported-tool-type', chatToolType: 'private-raw-provider-type', chatToolIndex: 999999999, chatToolHasFunction: true,
    } })
    const persisted = await fs.readFile(path.join(directory, 'editor-diagnostics.jsonl'), 'utf8')
    const report = await log.report()
    for (const output of [persisted, report]) {
      expect(output).toContain('"chatToolCode":"unsupported-tool-type"')
      expect(output).toContain('"chatToolType":"custom"')
      expect(output).toContain('"chatToolIndex":0')
      expect(output).toContain('"chatToolHasFunction":true')
      expect(output).not.toMatch(/private user prose|private-token|private-api-key|private-raw-provider-type|999999999|arguments/)
    }
  })
  it('keeps transport phase and allowlisted error code without storing request content', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'courseware-transport-shape-'))
    directories.push(directory)
    const log = new DiagnosticLog(directory)
    await log.append({ source: 'main', message: 'OpenAI Chat transport failure', details: {
      chatTransportPhase: 'fetch-before-headers', chatTransportClass: 'TypeError', chatHttpResponseReceived: false,
      code: 'UND_ERR_SOCKET', url: 'https://private-host', token: 'private-token', body: 'private prompt',
    } })
    await log.append({ source: 'main', message: 'OpenAI Chat transport failure', details: {
      chatTransportPhase: 'private-phase', chatTransportClass: 'private-class', chatHttpResponseReceived: true,
      code: 'private-code', httpStatus: 200, body: 'private prompt',
    } })
    const outputs = [await fs.readFile(path.join(directory, 'editor-diagnostics.jsonl'), 'utf8'), await log.report()]
    for (const output of outputs) {
      expect(output).toContain('"chatTransportPhase":"fetch-before-headers"')
      expect(output).toContain('"chatTransportClass":"TypeError"')
      expect(output).toContain('"chatHttpResponseReceived":false')
      expect(output).toContain('"code":"UND_ERR_SOCKET"')
      expect(output).toContain('"httpStatus":200')
      expect(output).not.toMatch(/private-host|private-token|private prompt|private-phase|private-class|private-code/)
    }
  })
  it('M12 attaches actual document bytes only after explicit checkbox and native file selection, otherwise exports text only', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'courseware-diagnostic-export-')); directories.push(directory); native.directory = directory
    const document = path.join(directory, '主动选择.md'); await fs.writeFile(document, '用户主动附加的文档正文')
    const plain = path.join(directory, 'report.txt')
    native.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    native.showSaveDialog.mockResolvedValue({ canceled: false, filePath: plain })
    await exportDiagnosticReport({} as never)
    expect(native.showMessageBox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ checkboxChecked: false }))
    expect(native.showOpenDialog).not.toHaveBeenCalled()
    expect(await fs.readFile(plain, 'utf8')).not.toContain('用户主动附加的文档正文')
    const archive = path.join(directory, 'report.zip')
    native.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: true })
    native.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [document] })
    native.showSaveDialog.mockResolvedValue({ canceled: false, filePath: archive })
    await exportDiagnosticReport({} as never)
    const contents = unzipSync(await fs.readFile(archive))
    expect(strFromU8(contents['documents/1-主动选择.md']!)).toBe('用户主动附加的文档正文')
    expect(strFromU8(contents['diagnostics.txt']!)).not.toContain('用户主动附加的文档正文')
    native.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] }); native.showSaveDialog.mockClear()
    expect(await exportDiagnosticReport({} as never)).toBeNull()
    expect(native.showSaveDialog).not.toHaveBeenCalled()
  })
})
