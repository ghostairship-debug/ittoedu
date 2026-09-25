export interface WindowsSourceLaunchScripts {
  start?: string
  'build:desktop'?: string
}

// build:desktop 可在三步之外追加其它前置（如 check:built-in-components、
// build:clipboard-helper），但必须始终包含 Player、renderer 与 Electron 构建。
const requiredBuildDesktopSteps = [
  'build:player',
  'build:renderer',
  'build:electron',
]

/**
 * Check the stable properties promised by the documented Windows source launch.
 *
 * The command runner is intentionally not fixed to `tsx`: the launch entry may
 * move to compiled JavaScript later, but it must keep using the shared Electron
 * launcher so inherited Electron environment flags are sanitized first.
 */
export function windowsSourceLaunchContractIssues(
  scripts: WindowsSourceLaunchScripts,
): string[] {
  const start = scripts.start ?? ''
  const issues: string[] = []

  if (!/\bnpm\s+run\s+build:desktop\b/iu.test(start)) {
    issues.push('npm start 未执行 build:desktop')
  }
  if (!/\bcross-env(?:\.cmd)?\s+VITE_DEV_SERVER_URL=(?:\s|$)/iu.test(start)) {
    issues.push('npm start 未显式清空 VITE_DEV_SERVER_URL')
  }
  if (!/\bscripts[\\/]launch-electron\.(?:[cm]?js|ts)\s+\.(?:\s|$)/iu.test(start)) {
    issues.push('npm start 未通过共享 Electron 启动入口启动应用')
  }
  const buildDesktop = scripts['build:desktop'] ?? ''
  if (
    requiredBuildDesktopSteps.some(
      (step) => !new RegExp(`\\bnpm\\s+run\\s+${step}\\b`, 'iu').test(buildDesktop),
    )
  ) {
    issues.push('build:desktop 未按约定构建 Player、renderer 与 Electron')
  }

  return issues
}
