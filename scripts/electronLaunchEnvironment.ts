/**
 * Clear the variables that stop `electron.exe` from starting as an app.
 *
 * `ELECTRON_RUN_AS_NODE` turns the binary into a plain Node. Under it
 * `require('electron')` no longer resolves to the internal module — it resolves
 * to the npm package, whose export is the *path string* of the binary — so
 * `src/main/index.ts` reads `app.commandLine` off a string, throws, and the main
 * process dies before printing the `DevTools listening on ws://…` line that
 * `electron.launch()` waits for. Playwright then reports only `Process failed to
 * launch!`, with the real error nowhere in the output.
 *
 * Presence is what matters, not the value. Measured against the pinned Electron
 * 43.1.1 with `electron.exe --version`:
 *
 * | `ELECTRON_RUN_AS_NODE` | reported version    |
 * |------------------------|---------------------|
 * | unset                  | `v43.1.1`           |
 * | `''`                   | `v24.18.0` (Node)   |
 * | `'0'`                  | `v24.18.0` (Node)   |
 * | `'1'`                  | `v24.18.0` (Node)   |
 * | `'false'`              | `v24.18.0` (Node)   |
 *
 * So the shell conventions for "off" — empty and `0` — degrade Electron just as
 * thoroughly as `1`. An earlier version of this module let both through and had
 * a test asserting that, which is a false negative in the only check standing
 * between a sandboxed shell and a launch failure nobody can read.
 *
 * Removing beats reporting. Agent sandboxes and editor-spawned shells set the
 * variable for their own Node tooling, so it arrives inherited rather than
 * typed, and it is never compatible with launching Electron as an app — the two
 * are contradictory by definition. Deleting it from `process.env` makes the
 * launch work instead of explaining why it cannot: Playwright inherits
 * `process.env` when a launcher passes no `env`, and the launchers that build
 * one all spread `...process.env` into it.
 */

/** Variables whose mere presence stops Electron from being Electron. */
const BLOCKING_VARIABLES = ['ELECTRON_RUN_AS_NODE'] as const

/** Present at any value, empty included — `process.env` omits what is unset. */
function blockingVariables(environment: NodeJS.ProcessEnv): string[] {
  return BLOCKING_VARIABLES.filter((name) => environment[name] !== undefined)
}

/**
 * Delete the blockers so the next Electron launch starts an app, and say so.
 *
 * Idempotent, and safe to call when nothing is set. Returns the names removed so
 * a caller can report them in its own voice; the warning here exists because the
 * removal is a silent repair otherwise, and a reader who wonders why their
 * variable stopped applying deserves to find out from the output.
 */
export function prepareElectronLaunchEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const blocking = blockingVariables(environment)
  if (blocking.length === 0) return []

  for (const name of blocking) delete environment[name]
  console.warn(
    `已清除环境变量 ${blocking.join('、')}：它会让 electron.exe 退化成普通 Node，`
    + '主进程读取 app 对象时崩溃，Playwright 只会报 “Process failed to launch!”。'
    + '本进程后续启动的 Electron 不再继承该变量。',
  )
  return blocking
}
