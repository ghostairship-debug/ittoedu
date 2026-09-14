import path from 'node:path'
import { MAX_GENERATION_RESOURCE_BYTES } from '../../shared/generationContract'

const quotePowerShell = (value: string) => `'${value.replace(/'/g, "''")}'`
const quotePosix = (value: string) => `'${value.replace(/'/g, "'\\''")}'`

/** A narrow native-CLI command. The process inherits the CLI's existing authorization. */
export function candidateMediaDeliveryAccess(root: string, platform = process.platform) {
  const launcher = path.join(path.resolve(root), platform === 'win32' ? 'deliver-media.ps1' : 'deliver-media.sh')
  return { launcher,
    command: platform === 'win32'
      ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${quotePowerShell(launcher)}`
      : `sh ${quotePosix(launcher)}`,
    arguments: ['sourcePath', 'resourceName'],
    instruction: '在启动命令后依次传原生素材工具实际返回的绝对源路径和资源文件名；两参数均按当前shell作为单个字符串转义。命令输出当前请求的$candidateFile引用。无需查找Node、复制脚本或编码base64。可直接指定输出的工具也可写入当前resources。',
  }
}

/** Kept self-contained because it runs in the CLI's process tree, outside Main. */
export function candidateMediaDeliveryFiles(executable = process.execPath): Record<string, string> {
  return {
    'deliver-media.cjs': String.raw`const fs = require('node:fs').promises;
const path = require('node:path');
const limit = ${MAX_GENERATION_RESOURCE_BYTES};
async function main() {
  const [source, name, ...extra] = process.argv.slice(2);
  if (extra.length || !source || !path.isAbsolute(source) || !name || name.length > 200 || /[\\/:\0]/.test(name) || name === '.' || name === '..') throw new Error('需要真实工具返回的绝对源路径和单个资源文件名');
  const root = await fs.realpath(__dirname);
  if (root !== path.resolve(__dirname)) throw new Error('当前候选根不能是链接');
  const resourceRoot = path.join(root, 'resources');
  await fs.mkdir(resourceRoot, { recursive: true });
  if (await fs.realpath(resourceRoot) !== resourceRoot) throw new Error('当前resources不能是链接');
  const handle = await fs.open(source, 'r');
  let bytes;
  try {
    const info = await handle.stat();
    if (!info.isFile() || !info.size || info.size > limit) throw new Error('素材必须是非空普通文件且不超过12 MiB');
    bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('源素材在交付期间发生变化');
  } finally { await handle.close(); }
  const target = path.join(resourceRoot, name);
  if (path.dirname(target) !== resourceRoot) throw new Error('资源名超出当前候选根');
  try { await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await fs.realpath(target) !== target) throw new Error('目标素材不能是链接');
    const existing = await fs.readFile(target);
    if (!existing.equals(bytes)) throw new Error('该资源名已交付不同素材，请使用新资源名');
  }
  if (await fs.realpath(target) !== target || await fs.realpath(resourceRoot) !== resourceRoot) throw new Error('素材交付位置发生变化');
  const reference = { $candidateFile: 'resources/' + name };
  const manifest = path.join(root, 'delivered-media.jsonl');
  try { await fs.writeFile(manifest, '', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (await fs.realpath(manifest) !== manifest) throw new Error('素材交付清单不能是链接');
  const log = await fs.open(manifest, 'a');
  try {
    const info = await log.stat(), line = JSON.stringify({ version: 1, source: reference }) + '\n';
    if (!info.isFile() || info.size + Buffer.byteLength(line) > 65536) throw new Error('本轮素材交付清单超过大小上限');
    await log.write(line);
  } finally { await log.close(); }
  if (await fs.realpath(manifest) !== manifest) throw new Error('素材交付清单位置发生变化');
  process.stdout.write(JSON.stringify(reference) + '\n');
}
main().catch(error => { process.stderr.write(String(error.message || error) + '\n'); process.exitCode = 1; });
`,
    // Windows PowerShell 5 reads UTF-8 without a BOM as the system code page.
    // The bundled executable itself can be installed in a non-ASCII path.
    'deliver-media.ps1': `\uFEFFparam([Parameter(Mandatory=$true)][string]$SourcePath, [Parameter(Mandatory=$true)][string]$ResourceName)
$ErrorActionPreference = 'Stop'
$previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE = '1'
  & ${quotePowerShell(executable)} (Join-Path $PSScriptRoot 'deliver-media.cjs') $SourcePath $ResourceName
  exit $LASTEXITCODE
} finally { $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode }
`,
    'deliver-media.sh': `#!/bin/sh
ELECTRON_RUN_AS_NODE=1 exec ${quotePosix(executable)} "$(dirname "$0")/deliver-media.cjs" "$@"
`,
  }
}
