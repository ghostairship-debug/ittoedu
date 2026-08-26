import { extractFile } from '@electron/asar'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { promisify } from 'node:util'

export interface FileArtifactEvidence {
  path: string
  sizeBytes: number
  sha256: string
}

export interface WindowsVersionEvidence {
  fileVersion: string
  productVersion: string
  productName: string
}

export interface ExecutableArtifactEvidence extends FileArtifactEvidence {
  windowsVersion: WindowsVersionEvidence
}

export interface AsarPackageMetadata {
  name: string
  version: string
  productName?: string
}

export interface AsarArtifactEvidence extends FileArtifactEvidence {
  package: AsarPackageMetadata
}

const execFileAsync = promisify(execFile)

export function isExpectedWindowsVersion(
  actualVersion: string,
  expectedVersion: string,
): boolean {
  const actual = actualVersion.trim()
  const expected = expectedVersion.trim()
  if (!actual || !expected) return false
  if (actual === expected) return true
  return /^\d+\.\d+\.\d+$/.test(expected) && actual === `${expected}.0`
}

export function assertExpectedWindowsVersion(
  evidence: WindowsVersionEvidence,
  expectedVersion: string,
  expectedProductName: string,
  label: string,
): void {
  if (
    !isExpectedWindowsVersion(evidence.fileVersion, expectedVersion) ||
    !isExpectedWindowsVersion(evidence.productVersion, expectedVersion)
  ) {
    throw new Error(
      `${label} 版本与 package.json 不一致：` +
        `FileVersion=${evidence.fileVersion || '<empty>'}，` +
        `ProductVersion=${evidence.productVersion || '<empty>'}，` +
        `期望 ${expectedVersion}`,
    )
  }
  if (evidence.productName !== expectedProductName) {
    throw new Error(
      `${label} 产品身份不一致：` +
        `ProductName=${evidence.productName || '<empty>'}，` +
        `期望 ${expectedProductName}`,
    )
  }
}

export function assertExpectedAsarPackage(
  metadata: AsarPackageMetadata,
  expectedName: string,
  expectedVersion: string,
): void {
  if (metadata.name !== expectedName || metadata.version !== expectedVersion) {
    throw new Error(
      'app.asar 内嵌 package.json 与待发布源码不一致：' +
        `${metadata.name || '<empty>'}@${metadata.version || '<empty>'}，` +
        `期望 ${expectedName}@${expectedVersion}`,
    )
  }
}

/**
 * Assert an offline single HTML fetches nothing remote.
 *
 * Offline portability is about references the document would load, not about the
 * characters `http` appearing anywhere in it. A lesson using a bundled family
 * embeds the font and, as OFL 1.1 §2 requires, the licence verbatim — and that
 * text carries `http://scripts.sil.org/OFL` and the foundry's URL. They sit
 * inside an HTML comment, which nothing fetches, so a whole-file search reports
 * a remote dependency that does not exist. Measured on an export declaring the
 * bundled Chinese family: 101 `@font-face`, zero remote loads, and the bare
 * search failing.
 *
 * Lives here because both release verifiers need it and the same check already
 * had to be fixed once in `tests/e2e/editor.spec.ts` (`a4dd298`) while these two
 * copies were missed. One implementation is what keeps the third copy from
 * drifting.
 */
export function assertNoRemoteUrlReferences(html: string, label: string): void {
  const fetchable = html.replace(/<!--[\s\S]*?-->/gu, '')
  const found = [...new Set(
    [...fetchable.matchAll(/https?:\/\/[^\s"'<)]+/gu)].map((match) => match[0]),
  )]
  if (found.length > 0) {
    throw new Error(`${label} 含有远程 URL：${found.slice(0, 5).join('、')}`)
  }
}

export async function collectFileArtifactEvidence(
  filePath: string,
): Promise<FileArtifactEvidence> {
  const stats = await fs.stat(filePath)
  if (!stats.isFile()) throw new Error(`发布产物不是普通文件：${filePath}`)
  const sha256 = await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex').toUpperCase()))
  })
  return {
    path: filePath,
    sizeBytes: stats.size,
    sha256,
  }
}

export async function readWindowsVersionEvidence(
  filePath: string,
): Promise<WindowsVersionEvidence> {
  if (process.platform !== 'win32') {
    throw new Error('Windows FileVersion/ProductVersion 校验只能在 Windows 上执行')
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$target = $env:COURSEWARE_RELEASE_ARTIFACT',
    "if ([string]::IsNullOrWhiteSpace($target)) { throw '缺少待校验产物路径' }",
    '$info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($target)',
    '[pscustomobject]@{',
    '  fileVersion = [string]$info.FileVersion',
    '  productVersion = [string]$info.ProductVersion',
    '  productName = [string]$info.ProductName',
    '} | ConvertTo-Json -Compress',
  ].join('\n')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: {
        ...process.env,
        COURSEWARE_RELEASE_ARTIFACT: filePath,
      },
      windowsHide: true,
    },
  )
  const parsed = JSON.parse(stdout.trim()) as Partial<WindowsVersionEvidence>
  return {
    fileVersion: typeof parsed.fileVersion === 'string' ? parsed.fileVersion : '',
    productVersion:
      typeof parsed.productVersion === 'string' ? parsed.productVersion : '',
    productName: typeof parsed.productName === 'string' ? parsed.productName : '',
  }
}

export function readAsarPackageMetadata(
  asarPath: string,
): AsarPackageMetadata {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'))
  } catch (error) {
    throw new Error(
      `无法读取 app.asar 内嵌 package.json：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('app.asar 内嵌 package.json 不是 JSON 对象')
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.name !== 'string' || typeof record.version !== 'string') {
    throw new Error('app.asar 内嵌 package.json 缺少有效 name/version')
  }
  return {
    name: record.name,
    version: record.version,
    ...(typeof record.productName === 'string'
      ? { productName: record.productName }
      : {}),
  }
}
