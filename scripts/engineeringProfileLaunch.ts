import { existsSync } from 'node:fs'
import path from 'node:path'

export const ENGINEERING_PROFILE_ARGUMENT = '--engineering-oauth-profile'
const ENGINEERING_PROFILE_NAME = 'Guoling-2.0-engineering-oauth'

/** An explicit source-checkout launch path for the already configured profile. */
export function resolveEngineeringProfileLaunch(
  argumentsToElectron: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): { args: string[]; profile: string | null } {
  if (!argumentsToElectron.includes(ENGINEERING_PROFILE_ARGUMENT)) {
    return { args: [...argumentsToElectron], profile: null }
  }

  const args = argumentsToElectron.filter((argument) => argument !== ENGINEERING_PROFILE_ARGUMENT)
  if (args.some((argument) => argument === '--user-data-dir' || argument.startsWith('--user-data-dir='))) {
    throw new Error('工程 OAuth 档不能与另一个 --user-data-dir 同时指定')
  }
  if (!environment.APPDATA) {
    throw new Error('找不到 APPDATA，无法定位已有的工程 OAuth 档')
  }

  const profile = path.join(environment.APPDATA, ENGINEERING_PROFILE_NAME)
  const settings = path.join(profile, 'workbench-v2', 'settings', 'execution-settings-v1.json')
  if (!fileExists(settings)) {
    throw new Error(`工程 OAuth 档未配置：${settings}`)
  }
  return { args: [...args, `--user-data-dir=${profile}`], profile }
}
