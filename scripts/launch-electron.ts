/**
 * Start the built app with a launch environment Electron can actually use.
 *
 * `npm start` and `npm run dev:electron` used to run `electron .` straight from
 * the npm script, which leaves no place to drop an inherited
 * `ELECTRON_RUN_AS_NODE` — and `cross-env VAR=` cannot help, because an empty
 * value degrades the binary exactly like `1` does. In an agent sandbox or an
 * editor-spawned shell that made the product refuse to start at all, with the
 * misleading `Cannot read properties of undefined (reading 'commandLine')` as
 * the only clue.
 *
 * Everything else is passed through: arguments reach Electron unchanged, stdio
 * is inherited so the app logs where it always did, and the exit code and
 * terminating signal are reproduced so `npm start` still fails when the app
 * does.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { prepareElectronLaunchEnvironment } from './electronLaunchEnvironment'
import { resolveEngineeringProfileLaunch } from './engineeringProfileLaunch'

prepareElectronLaunchEnvironment()

// Outside an Electron process the `electron` package exports the binary's path.
// The cast is that documented behaviour; its published types describe the API
// surface a main process sees instead.
const electronBinary = createRequire(import.meta.url)('electron') as unknown as string

let launch: ReturnType<typeof resolveEngineeringProfileLaunch>
try {
  launch = resolveEngineeringProfileLaunch(process.argv.slice(2))
} catch (error) {
  console.error('启动 Electron 失败：', error instanceof Error ? error.message : String(error))
  process.exit(1)
}
if (launch.profile) {
  console.info(`使用已配置的工程 OAuth 档：${launch.profile}；模型及计费连接沿用该档已有设置。`)
}

const child = spawn(electronBinary, launch.args, {
  stdio: 'inherit',
  env: process.env,
})

child.on('error', (error) => {
  console.error('启动 Electron 失败', error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  // A signalled exit has no code; report it the way a shell would.
  if (signal !== null) process.exit(1)
  process.exit(code ?? 0)
})
