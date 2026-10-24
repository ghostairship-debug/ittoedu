import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export async function sourceLaunchFingerprint(root, entries) {
  return sourceLaunchFacts(root).fingerprint(entries)
}
function sourceLaunchFacts(root) {
  const facts = new Map()
  const read = relative => {
    let pending = facts.get(relative)
    if (!pending) { pending = scan(relative); facts.set(relative, pending) }
    return pending
  }
  const scan = async relative => {
    const filename = path.join(root, relative)
    let stat
    try { stat = await fs.stat(filename, { bigint: true }) }
    catch (error) { if (error.code === 'ENOENT') return { present: false, records: [[relative, 'missing']] }; throw error }
    if (stat.isDirectory()) {
      const children = []
      for (const name of (await fs.readdir(filename)).sort()) children.push(await read(path.join(relative, name)))
      return { present: true, records: children.flatMap(child => child.records) }
    }
    return { present: true, records: [[relative, String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)]] }
  }
  return {
    async fingerprint(entries, excluded = []) {
      const snapshots = await Promise.all(entries.map(entry => read(path.normalize(entry))))
      const omitted = excluded.map(entry => path.normalize(entry))
      const records = snapshots.flatMap(item => item.records).filter(([entry]) => !omitted.some(root => entry === root || entry.startsWith(root + path.sep)))
      return createHash('sha256').update(JSON.stringify(records)).digest('hex')
    },
    async present(entries) { return (await Promise.all(entries.map(entry => read(path.normalize(entry))))).every(item => item.present) },
    invalidate(entries) {
      const roots = entries.map(entry => path.normalize(entry))
      for (const key of facts.keys()) if (roots.some(root => key === root || key.startsWith(root + path.sep) || root.startsWith(key + path.sep))) facts.delete(key)
    },
  }
}
export async function prepareSourceLaunch(root = repository, run = runScript, targets = ['player', 'renderer', 'electron', 'clipboard', 'publish']) {
  const filename = path.join(root, 'output/source-launch-state.json')
  const lock = createHash('sha256').update(await fs.readFile(path.join(root, 'package-lock.json'))).digest('hex')
  const facts = sourceLaunchFacts(root)
  const installation = await facts.fingerprint(['node_modules/.package-lock.json'])
  let previous = {}
  try { previous = JSON.parse(await fs.readFile(filename, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') console.warn('启动构建索引不可读，将重新核对构建') }
  if (previous.lock && previous.lock !== lock && previous.installation === installation)
    throw new Error('依赖锁已变更；请先执行 npm ci 后重试。安装完成会自动重建，无需删除启动索引。')
  const shared = ['src/shared', 'src/core', 'src/components', 'scripts/prepare-source-launch.mjs', 'scripts/generate-component-builtin-sources.ts', 'package.json', 'package-lock.json', 'node_modules/.package-lock.json']
  const generated = ['src/shared/generated/componentBuiltinSources', 'src/shared/generated/componentBuiltinSourceLoaders.ts']
  const rendererHtml = (await fs.readdir(root)).filter(name => name.endsWith('.html')).sort()
  const groups = [
    // Builtin source entries also bundle renderer interaction and Player state rules.
    { name: 'sources', inputs: [...shared, 'src/renderer', 'src/player'], excluded: generated, outputs: generated, scripts: ['generate:component-sources'] },
    { name: 'player', dependencies: ['sources'], inputs: [...shared, 'src/player', 'vite.player.config.ts', 'scripts/build-compiled-player.mjs', 'scripts/htmlPreviewAgentPlugin.ts', 'resources/built-in-components'], outputs: ['dist-player'], scripts: ['check:built-in-components', 'build:player:raw'] },
    { name: 'renderer', dependencies: ['player', 'sources'], inputs: [...shared, ...rendererHtml, 'src/player', 'src/renderer', 'vite.renderer.config.ts', 'scripts/htmlPreviewAgentPlugin.ts', 'dist-player'], outputs: ['dist-renderer'], scripts: ['build:renderer:raw'] },
    { name: 'electron', dependencies: ['sources'], inputs: [...shared, 'src/main', 'src/preload', 'tsconfig.electron.json', 'scripts/build-electron.mjs'], outputs: ['dist-electron'], scripts: ['build:electron:raw'] },
    { name: 'clipboard', inputs: ['resources/clipboard-file-list/Program.cs', 'scripts/build-clipboard-helper.ps1'], outputs: ['resources/clipboard-file-list/clipboard-file-list.exe'], scripts: ['build:clipboard-helper'] },
    { name: 'publish', inputs: ['resources/file-publish/Program.cs', 'scripts/build-file-publish-helper.ps1'], outputs: ['resources/file-publish/file-publish.exe'], scripts: ['build:file-publish-helper'] },
  ]
  const selected = new Set()
  const include = name => {
    const group = groups.find(value => value.name === name)
    if (!group) throw new Error(`未知构建目标：${name}`)
    if (selected.has(name)) return
    for (const dependency of group.dependencies ?? []) include(dependency)
    selected.add(name)
  }
  targets.forEach(include)
  const sameInstallation = previous.lock === lock && previous.installation === installation
  const next = { ...(sameInstallation ? previous : {}), lock, installation }, rebuilt = []
  for (const group of groups) {
    if (!selected.has(group.name)) continue
    let identity = await facts.fingerprint(group.inputs, group.excluded)
    let outputIdentity = await facts.fingerprint(group.outputs)
    if (previous[group.name]?.identity !== identity || previous[group.name]?.outputIdentity !== outputIdentity || !await facts.present(group.outputs)) {
      for (const script of group.scripts) await run(script, root)
      rebuilt.push(group.name)
      // A build can update generated inputs as well as its outputs. Refresh this
      // group's facts after it completes; later groups share the refreshed view.
      facts.invalidate([...group.inputs, ...group.outputs])
      identity = await facts.fingerprint(group.inputs, group.excluded)
      outputIdentity = await facts.fingerprint(group.outputs)
    }
    next[group.name] = { identity, outputIdentity }
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
  prepareSourceLaunch(repository, runScript, process.argv.length > 2 ? process.argv.slice(2) : undefined)
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
