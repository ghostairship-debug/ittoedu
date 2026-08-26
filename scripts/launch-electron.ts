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

prepareElectronLaunchEnvironment()

// Outside an Electron process the `electron` package exports the binary's path.
// The cast is that documented behaviour; its published types describe the API
// surface a main process sees instead.
const electronBinary = createRequire(import.meta.url)('electron') as unknown as string

const child = spawn(electronBinary, process.argv.slice(2), {
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
