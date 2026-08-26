import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { windowsSourceLaunchContractIssues } from '../../scripts/windowsSourceLaunchContract'

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
) as { scripts: Record<string, string> }
const doubleClickLauncher = readFileSync(
  resolve(__dirname, '..', '..', '启动课件编辑器.cmd'),
  'utf8',
)

describe('Windows source launch contract', () => {
  it('keeps npm start aligned with the documented Electron launch properties', () => {
    expect(windowsSourceLaunchContractIssues(packageJson.scripts)).toEqual([])
  })

  it('does not tie the contract to the current TypeScript command runner', () => {
    expect(windowsSourceLaunchContractIssues({
      ...packageJson.scripts,
      start:
        'npm run build:desktop && cross-env VITE_DEV_SERVER_URL= node scripts/launch-electron.js .',
    })).toEqual([])
  })

  it('rejects the old direct Electron launch that bypassed environment cleanup', () => {
    expect(windowsSourceLaunchContractIssues({
      ...packageJson.scripts,
      start: 'npm run build:desktop && cross-env VITE_DEV_SERVER_URL= electron .',
    })).toContain('npm start 未通过共享 Electron 启动入口启动应用')
  })

  it('sanitizes the inherited Electron mode in the double-click launcher too', () => {
    expect(doubleClickLauncher).toContain('set "ELECTRON_RUN_AS_NODE="')
  })
})
