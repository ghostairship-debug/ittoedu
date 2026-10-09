// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { readComponentSourceClosure } from '../../src/main/workbench/projectFiles/componentSourceClosure'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

const encode = (text: string) => new TextEncoder().encode(text)
const runNode = promisify(execFile)

it.each(['progress100%.js', 'foo%20.js'])('keeps the physical entry filename %s literal while compiling', async entry => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-ni04-literal-entry-'))
  try {
    const source = 'export default 42;'
    await fs.writeFile(path.join(root, entry), source)
    const closure = await readComponentSourceClosure({ filename: path.join(root, entry), rootDir: root, text: source, bytes: encode(source) })
    expect(closure.entry).toBe(entry)
    expect([...closure.files.keys()]).toEqual([entry])
    const result = await createEsbuildComponentCompiler().compile({ entry: closure.entry, files: { [entry]: source } })
    expect(result).toMatchObject({ status: 'ready', artifact: { diagnostics: [] } })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('captures and compiles an import whose physical filename has a literal percent sign', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-ni04-literal-import-'))
  try {
    const source = `import value from './progress100%.js'; export default value;`
    await fs.writeFile(path.join(root, 'main.js'), source)
    await fs.writeFile(path.join(root, 'progress100%.js'), 'export default 42;')
    const closure = await readComponentSourceClosure({ filename: path.join(root, 'main.js'), rootDir: root, text: source, bytes: encode(source) })
    expect([...closure.files.keys()]).toEqual(['main.js', 'progress100%.js'])
    const result = await createEsbuildComponentCompiler().compile({ entry: closure.entry,
      files: Object.fromEntries([...closure.files].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)])) })
    expect(result).toMatchObject({ status: 'ready', artifact: { diagnostics: [] } })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('captures URL pathnames from the current source owner and executes distinct query/fragment module identities', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-ni04-source-'))
  try {
    const source = `import { value, token as plain } from './helper.js';
      import { token as version } from './helper.js?v=1';
      import { token as sameVersion } from './helper.js?v=1';
      import { token as fragment } from './helper.js#section';
      import { extra } from './encoded%20helper.js?cache=ready#part';
      export default { mount(context) { context.root.textContent = String(value + extra);
        return { distinct: plain !== version && version !== fragment,
          same: version === sameVersion, update() {}, dispose() {} }; } };`
    await fs.writeFile(path.join(root, 'main.js'), source)
    await fs.writeFile(path.join(root, 'helper.js'), 'export const value=1; export const token={};')
    await fs.writeFile(path.join(root, 'encoded helper.js'), 'export const extra=2;')
    const closure = await readComponentSourceClosure({ filename: path.join(root, 'main.js'), rootDir: root,
      text: source, bytes: encode(source), currentSource: async filename => filename === await fs.realpath(path.join(root, 'helper.js'))
        ? 'export const value=40; export const token={};' : undefined })
    expect([...closure.files.keys()].sort()).toEqual(['encoded helper.js', 'helper.js', 'main.js'])
    expect(new TextDecoder().decode(closure.files.get('helper.js'))).toContain('value=40')
    const result = await createEsbuildComponentCompiler().compile({ entry: closure.entry,
      files: Object.fromEntries([...closure.files].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)])) })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error(JSON.stringify(result.diagnostics))
    expect(result.artifact.diagnostics).toEqual([])
    const artifact = path.join(root, 'component.mjs')
    await fs.writeFile(artifact, result.artifact.code)
    // Native ESM evaluates the real production artifact and calls the component mount contract.
    const executed = await runNode(process.execPath, ['--input-type=module', '-e',
      `const component = (await import(process.argv[1])).default;
       const root = { textContent: '' }; const mounted = component.mount({ root });
       console.log(JSON.stringify({ distinct: mounted.distinct, same: mounted.same, text: root.textContent }));`,
      pathToFileURL(artifact).href])
    expect(JSON.parse(executed.stdout)).toEqual({ distinct: true, same: true, text: '42' })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it.each(['raw', 'url', 'worker', 'sharedworker', 'inline'])('retains source but diagnoses unsupported ?%s loading rather than compiling ordinary JS', async flag => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-ni04-loader-'))
  try {
    const source = `import value from './helper.js?${flag}'; export default value;`
    await fs.writeFile(path.join(root, 'main.js'), source)
    await fs.writeFile(path.join(root, 'helper.js'), 'export default 42;')
    const closure = await readComponentSourceClosure({ filename: path.join(root, 'main.js'), rootDir: root, text: source, bytes: encode(source) })
    expect([...closure.files.keys()]).toEqual(['main.js', 'helper.js'])
    const result = await createEsbuildComponentCompiler().compile({ entry: closure.entry,
      files: Object.fromEntries([...closure.files].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)])) })
    expect(result).toMatchObject({ status: 'failed', diagnostics: expect.arrayContaining([
      expect.objectContaining({ severity: 'error', message: expect.stringContaining(`?${flag} 尚未支持`) }),
    ]) })
    expect(new TextDecoder().decode(closure.files.get('main.js'))).toBe(source)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('keeps realpath confinement for an encoded URL traversal and a junction outside the authorized root', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-ni04-root-'))
  const root = path.join(workspace, 'allowed'), outside = path.join(workspace, 'outside')
  try {
    await fs.mkdir(root); await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'helper.js'), 'export const secret=42;')
    await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const source = `import './escape/helper.js?v=1'; import './%2e%2e/outside/helper.js#secret'; export default {};`
    await fs.writeFile(path.join(root, 'main.js'), source)
    const currentReads: string[] = []
    const closure = await readComponentSourceClosure({ filename: path.join(root, 'main.js'), rootDir: root, text: source, bytes: encode(source),
      currentSource: async filename => { currentReads.push(filename); return undefined } })
    expect([...closure.files.keys()]).toEqual(['main.js'])
    expect(currentReads).toEqual([])
    const result = await createEsbuildComponentCompiler().compile({ entry: 'main.js', files: { 'main.js': source } })
    expect(result).toMatchObject({ status: 'failed', diagnostics: expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('无法解析组件依赖') }),
    ]) })
  } finally { await fs.rm(workspace, { recursive: true, force: true }) }
})
