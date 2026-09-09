import path from 'node:path'
import type { App } from 'electron'

/**
 * Rebuild-session AppData name. Intentionally different from the shared
 * product directory `ittoedu-courseware-editor` used by the V9 donor and
 * mature V8 installs, so leftover V9 recovery/recents cannot load here.
 * Explicit `--user-data-dir` still wins for e2e and tooling.
 */
export const REBUILD_USER_DATA_DIRECTORY_NAME = 'ittoedu-courseware-editor-v8-rebuild'

type ApplicationPathHost = Pick<App, 'getPath' | 'setPath'>

function explicitUserDataDirectory(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    if (argument === '--user-data-dir') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('Missing value for --user-data-dir')
      return path.resolve(value)
    }
    if (argument.startsWith('--user-data-dir=')) {
      const value = argument.slice('--user-data-dir='.length)
      if (!value) throw new Error('Missing value for --user-data-dir')
      return path.resolve(value)
    }
  }
  return null
}

export function configureApplicationStorage(
  application: ApplicationPathHost,
  argv: readonly string[] = process.argv,
): string {
  const explicitUserDataDirectoryPath = explicitUserDataDirectory(argv)
  if (explicitUserDataDirectoryPath) {
    application.setPath('userData', explicitUserDataDirectoryPath)
    return explicitUserDataDirectoryPath
  }
  const userDataPath = path.join(
    application.getPath('appData'),
    REBUILD_USER_DATA_DIRECTORY_NAME,
  )
  application.setPath('userData', userDataPath)
  return userDataPath
}
