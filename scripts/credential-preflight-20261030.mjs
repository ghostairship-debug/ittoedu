/** Isolated safeStorage / formal store check. No model, resolver refresh, login or credential copying. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = process.cwd(), originalProfile = path.resolve(process.argv[2] ?? ''), out = path.resolve(process.argv[3] ?? '')
const originalContext = process.argv[4] === 'original-context'
assert(process.argv[4] === undefined || originalContext, 'Only explicit original-context is supported')
assert(process.argv[2] && process.argv[3] && originalProfile !== out, 'Pass original profile and a new isolated output directory')
await fs.mkdir(out, { recursive: false })
const profile = path.join(out, 'isolated-profile'), helper = path.join(out, 'credential-node.cjs'), entry = path.join(out, 'credential-main.cjs')
await fs.mkdir(profile)
const sessionData = path.join(out, 'isolated-session-data'); await fs.mkdir(sessionData)
const startupProfile = originalContext ? originalProfile : profile
await build({ entryPoints: [path.join(root, 'tests/e2e/delegationDirectoryConsumer20261030.node.ts')], outfile: helper,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'formal-main-modules', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/\.\.\/src\// }, async input => {
      const stem = path.join(root, 'dist-electron', input.path.slice('../../src/'.length)).replace(/\.js$/, '')
      const filename = await fs.access(stem + '.js').then(() => stem + '.js', async () => { await fs.access(path.join(stem, 'index.js')); return path.join(stem, 'index.js') })
      return { path: input.kind === 'dynamic-import' ? pathToFileURL(filename).href : filename, external: true }
    })
  } }] })
// On Windows Electron initializes OSCrypt against Local State before the app JS entry.
// The owner path must therefore be a process switch; a later app.setPath alone is not this control.
// Preserve the original sessionData until the first formal store decrypt has completed.
await fs.writeFile(entry, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(startupProfile)});${originalContext ? '' : `app.setPath('sessionData',${JSON.stringify(sessionData)});`}require(${JSON.stringify(helper)}).probeDirectoryConsumerCredentials(${JSON.stringify({ out, originalProfile, ...(originalContext ? { domainProfile: profile, domainSessionData: sessionData, requireOriginalStartupContext: true } : {}) })}).then(()=>app.exit(0),error=>{require('node:fs').writeFileSync(${JSON.stringify(path.join(out, 'bootstrap-failure.json'))},JSON.stringify({name:typeof error?.name==='string'?error.name:'Error',phase:'bootstrap'}));app.exit(1)});`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [`--user-data-dir=${startupProfile}`, entry], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
let stderrBytes = 0; child.stderr.on('data', value => { stderrBytes += value.length })
const timer = setTimeout(() => child.kill(), 30000)
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)) }).finally(() => clearTimeout(timer))
const result = JSON.parse(await fs.readFile(path.join(out, 'credential-preflight.json'), 'utf8'))
await fs.writeFile(path.join(out, 'process-result.json'), JSON.stringify({ code, stderrBytes }, null, 2))
console.log(JSON.stringify(result, null, 2))
if (code !== 0 || result.status !== 'decryption-readable-token-validity-unprobed') process.exitCode = 1
