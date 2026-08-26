/**
 * Refuse to launch Electron in an environment that cannot run it as an app.
 *
 * `ELECTRON_RUN_AS_NODE` turns `electron.exe` into a plain Node binary. Under it
 * `require('electron')` no longer resolves to the internal module — it resolves
 * to the npm package, whose export is the *path string* of the binary. So
 * `src/main/index.ts` reads `app.commandLine` off a string, throws
 * `TypeError: Cannot read properties of undefined`, and the main process dies
 * before printing the `DevTools listening on ws://…` line that
 * `electron.launch()` waits for. Playwright reports only `Process failed to
 * launch!`, with the real error nowhere in the output — the failure looks like a
 * product defect and takes a manual `spawn` of the binary to explain.
 *
 * Agent sandboxes and editor-spawned shells set the variable for their own Node
 * tooling, so it arrives inherited rather than typed. It is never compatible
 * with what the callers here want, which is Electron behaving as Electron.
 *
 * Called from the Electron entry points rather than a shared test setup on
 * purpose: a check in `tests/setup.ts` would fail all ~1900 Vitest tests over a
 * variable only a handful of them care about.
 */

/** Variables that stop `electron.exe` from starting as a desktop application. */
const BLOCKING_VARIABLES = ['ELECTRON_RUN_AS_NODE'] as const

export function assertElectronCanLaunchAsApp(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const blocking = BLOCKING_VARIABLES.filter((name) => {
    const value = environment[name]
    return value !== undefined && value !== '' && value !== '0'
  })
  if (blocking.length === 0) return

  throw new Error([
    `无法以桌面应用方式启动 Electron：环境变量 ${blocking.join('、')} 已设置。`,
    '它会让 electron.exe 退化成普通 Node，主进程在读取 app 对象时崩溃，',
    'Playwright 只会报 “Process failed to launch!”，看不到真实原因。',
    `请在运行命令前取消该变量，例如：unset ${blocking[0]}（bash）`,
    `或 $env:${blocking[0]}=$null（PowerShell）。`,
  ].join('\n'))
}
