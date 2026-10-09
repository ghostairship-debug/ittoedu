// @vitest-environment node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_COMPANY,
  APP_E2E_TEMP_DIRECTORY_NAME,
  APP_EXECUTABLE_NAME,
  APP_ID,
  APP_NAME,
  APP_PDF_TEMP_FILE_PREFIX,
  APP_PREVIEW_TEMP_DIRECTORY_NAME,
  APP_PRODUCT_NAME,
  APP_USER_DATA_DIRECTORY_NAME,
} from '../../src/shared/constants'

const root = path.resolve(__dirname, '..', '..')

describe('product identity configuration', () => {
  it('freezes the public identity and internal path names', () => {
    expect({
      name: APP_NAME,
      productName: APP_PRODUCT_NAME,
      company: APP_COMPANY,
      appId: APP_ID,
      executable: APP_EXECUTABLE_NAME,
      userData: APP_USER_DATA_DIRECTORY_NAME,
      previewTemp: APP_PREVIEW_TEMP_DIRECTORY_NAME,
      pdfTempPrefix: APP_PDF_TEMP_FILE_PREFIX,
      e2eTemp: APP_E2E_TEMP_DIRECTORY_NAME,
    }).toEqual({
      name: '果铃工作台',
      productName: '果铃工作台',
      company: 'ittoedu',
      appId: 'com.ittoedu.courseware-editor',
      executable: 'guoling-workbench',
      userData: 'ittoedu-courseware-editor',
      previewTemp: 'guoling-workbench-preview',
      pdfTempPrefix: 'ittoedu-courseware-pdf-',
      e2eTemp: 'guoling-workbench-e2e',
    })
  })

  it('keeps npm package identity aligned in the manifest and lockfile', async () => {
    const [packageManifest, packageLock] = await Promise.all([
      readFile(path.join(root, 'package.json'), 'utf8').then(
        (contents) => JSON.parse(contents) as Record<string, unknown>,
      ),
      readFile(path.join(root, 'package-lock.json'), 'utf8').then(
        (contents) => JSON.parse(contents) as {
          name?: unknown
          packages?: Record<string, { name?: unknown }>
        },
      ),
    ])

    expect(packageManifest.name).toBe(APP_EXECUTABLE_NAME)
    expect(packageManifest.author).toBe(APP_COMPANY)
    expect(packageLock.name).toBe(APP_EXECUTABLE_NAME)
    expect(packageLock.packages?.['']?.name).toBe(APP_EXECUTABLE_NAME)
  })

  it('keeps the Windows build identity aligned with shared constants', async () => {
    const builder = await readFile(
      path.join(root, 'electron-builder.yml'),
      'utf8',
    )

    expect(builder).toContain(`appId: ${APP_ID}`)
    expect(builder).toContain(`productName: ${APP_PRODUCT_NAME}`)
    expect(builder).toContain(`executableName: ${APP_EXECUTABLE_NAME}`)
    expect(builder).toContain(
      `artifactName: ${APP_EXECUTABLE_NAME}-portable-\${version}.\${ext}`,
    )
    expect(builder).toContain(
      `artifactName: ${APP_EXECUTABLE_NAME}-\${version}-\${arch}.\${ext}`,
    )
  })

  it('uses only the new managed Skill manifest and source identity', async () => {
    const installer = await readFile(
      path.join(root, 'scripts', 'install-courseware-skills.ps1'),
      'utf8',
    )

    expect(installer).toContain(
      "$manifestFileName = '.ittoedu-courseware-editor-managed-skills.json'",
    )
    expect(installer).toContain("$sourceId = 'ittoedu-courseware-editor'")
  })

  it('injects the shared product name into the current product surfaces', async () => {
    const [html, rendererConfig, playerConfig, toolbar, launcher] = await Promise.all([
      readFile(path.join(root, 'index.html'), 'utf8'),
      readFile(path.join(root, 'vite.renderer.config.ts'), 'utf8'),
      readFile(path.join(root, 'vite.player.config.ts'), 'utf8'),
      readFile(path.join(root, 'src', 'renderer', 'ui', 'TopToolbar.tsx'), 'utf8'),
      readFile(path.join(root, '启动果铃工作台.cmd'), 'utf8'),
    ])

    expect(html).toContain('<title>__APP_NAME__</title>')
    expect(rendererConfig).toContain("import { APP_NAME } from './src/shared/constants'")
    expect(rendererConfig).toContain("html.replaceAll('__APP_NAME__', APP_NAME)")
    expect(playerConfig).toContain("name: 'CoursewarePlayer'")
    expect(playerConfig).not.toContain('PhaserCoursewarePlayer')
    expect(toolbar).toContain('title={APP_NAME}')
    expect(toolbar).not.toContain('Phaser 轻量交互课件编辑器')
    expect(launcher).toContain('[Guoling Workbench]')
    expect(launcher).not.toContain('[Courseware Editor]')
  })
})
