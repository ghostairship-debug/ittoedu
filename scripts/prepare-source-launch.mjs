import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export async function sourceLaunchFingerprint(root, entries) {
  const records = []
  const walk = async relative => {
    const filename = path.join(root, relative)
    let stat
    try { stat = await fs.stat(filename, { bigint: true }) }
    catch (error) { if (error.code === 'ENOENT') { records.push([relative, 'missing']); return }; throw error }
    if (stat.isDirectory()) for (const name of (await fs.readdir(filename)).sort()) await walk(path.join(relative, name))
    else records.push([relative, String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)])
  }
  for (const entry of entries) await walk(entry)
  return createHash('sha256').update(JSON.stringify(records)).digest('hex')
}
export async function prepareSourceLaunch(root = repository, run = runScript) {
  const filename = path.join(root, 'output/source-launch-state.json')
  const lock = createHash('sha256').update(await fs.readFile(path.join(root, 'package-lock.json'))).digest('hex')
  const installation = await sourceLaunchFingerprint(root, ['node_modules/.package-lock.json'])
  let previous = {}
  try { previous = JSON.parse(await fs.readFile(filename, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') console.warn('启动构建索引不可读，将重新核对构建') }
  if (previous.lock && previous.lock !== lock && previous.installation === installation)
    throw new Error('依赖锁已变更；请先执行 npm ci 后重试。安装完成会自动重建，无需删除启动索引。')
  const shared = ['src/shared', 'src/core', 'src/components', 'scripts/generate-component-builtin-sources.ts', 'package.json', 'package-lock.json', 'node_modules/.package-lock.json']
  const rendererHtml = (await fs.readdir(root)).filter(name => name.endsWith('.html')).sort()
  const groups = [
    { name: 'player', inputs: [...shared, 'src/player', 'vite.player.config.ts', 'scripts/htmlPreviewAgentPlugin.ts', 'resources/built-in-components'], outputs: ['dist-player'], scripts: ['check:built-in-components', 'build:player'] },
    { name: 'renderer', inputs: [...shared, ...rendererHtml, 'src/player', 'src/renderer', 'vite.renderer.config.ts', 'scripts/htmlPreviewAgentPlugin.ts', 'dist-player'], outputs: ['dist-renderer'], scripts: ['build:renderer'] },
    { name: 'electron', inputs: [...shared, 'src/main', 'src/preload', 'tsconfig.electron.json', 'scripts/build-electron.mjs'], outputs: ['dist-electron'], scripts: ['build:electron'] },
    { name: 'clipboard', inputs: ['resources/clipboard-file-list/Program.cs', 'scripts/build-clipboard-helper.ps1'], outputs: ['resources/clipboard-file-list/clipboard-file-list.exe'], scripts: ['build:clipboard-helper'] },
    { name: 'publish', inputs: ['resources/file-publish/Program.cs', 'scripts/build-file-publish-helper.ps1'], outputs: ['resources/file-publish/file-publish.exe'], scripts: ['build:file-publish-helper'] },
  ]
  const next = { lock, installation }, rebuilt = []
  for (const group of groups) {
    const identity = await sourceLaunchFingerprint(root, group.inputs)
    const outputIdentity = await sourceLaunchFingerprint(root, group.outputs)
    const present = await Promise.all(group.outputs.map(output => fs.stat(path.join(root, output)).then(() => true, () => false)))
    if (previous[group.name]?.identity !== identity || previous[group.name]?.outputIdentity !== outputIdentity || present.includes(false)) {
      for (const script of group.scripts) await run(script, root)
      rebuilt.push(group.name)
    }
    next[group.name] = { identity: await sourceLaunchFingerprint(root, group.inputs), outputIdentity: await sourceLaunchFingerprint(root, group.outputs) }
  }
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const temporary = filename + '.tmp'
  await fs.writeFile(temporary, JSON.stringify(next)); await fs.rename(temporary, filename)
  console.info(rebuilt.length ? `已更新：${rebuilt.join('、')}` : '构建与源码一致，直接启动。')
  return rebuilt
}
function runScript(script, root) {
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32'
    const child = spawn(windows ? process.env.ComSpec ?? 'cmd.exe' : 'npm', windows ? ['/d', '/s', '/c', `npm.cmd run ${script}`] : ['run', script], { cwd: root, stdio: 'inherit', windowsHide: true })
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} 构建失败；未启动旧构建`)))
  })
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareSourceLaunch().catch(error => { console.error(error.message); process.exitCode = 1 })
}
