import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import type { ComputeBackendRequest as BackendRequest, ComputeProcess, ComputeProcessResult } from './ComputeBackend'
export type { ComputeProcess, ComputeProcessResult } from './ComputeBackend'

/** Linux amd64 Python 3.12.14 slim, pinned to the platform manifest and local
 * image identity observed on 2026-09-29. A tag is never an execution identity.
 */
export const PINNED_PYTHON_IMAGE_SOURCE = 'docker.io/library/python@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f'
export const PINNED_PYTHON_IMAGE_ID = 'sha256:9e87977b867847e186d066f531ef783b006d582a985c341c269446088d90f2c4'

export interface ComputeBackendRequest {
  /** Host-created directory containing input/ and output/. */
  directory: string
  program: string
  argv: readonly string[]
  /** Persisted by the owner before Podman may create this container. */
  containerName: string
}

const safeArg = (value: string) => typeof value === 'string' && !value.includes('\0')
const validContainerName = (name: string) => /^guoling-compute-[a-f0-9]{32}$/.test(name)

function observeProcess(child: ChildProcessWithoutNullStreams, timeoutMs?: number): Promise<{ code: number | null; stdout: string; stderr: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [], stderr: Buffer[] = []
    let finished = false
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => { child.kill(); finish(new Error('执行后端控制命令超时')) }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout.push(Buffer.from(chunk)) })
    child.stderr.on('data', (chunk: Buffer) => { stderr.push(Buffer.from(chunk)) })
    child.once('error', error => finish(error))
    child.once('close', code => finish(undefined, code))
    function finish(error?: Error, code: number | null = null) {
      if (finished) return
      finished = true; if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), truncated: false })
    }
  })
}

/**
 * One mature container backend, invoked through WSL without shell composition.
 * It is unavailable unless a pinned, locally provisioned Python image exists.
 * The container sees read-only input, writable work/output, no host workspace,
 * no network, and a read-only root filesystem. Podman owns descendant cleanup.
 */
export class PodmanComputeBackend {
  readonly kind = 'podman' as const
  constructor(private readonly options: { distro: string; image: string; wslExecutable?: string }) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(options.distro)) throw new Error('无效的 WSL 后端名称')
    if (!/^sha256:[a-f0-9]{64}$/.test(options.image)) throw new Error('计算镜像必须固定到本地 SHA-256 身份')
  }
  private command(args: readonly string[]): ChildProcessWithoutNullStreams {
    return spawn(this.options.wslExecutable ?? 'wsl.exe', ['-d', this.options.distro, '--exec', ...args], { windowsHide: true, stdio: 'pipe' })
  }
  private async short(args: readonly string[], timeoutMs = 10_000) {
    return observeProcess(this.command(args), timeoutMs)
  }
  async availability(): Promise<{ available: boolean; reason?: string }> {
    try {
      const version = await this.short(['podman', 'version', '--format', '{{.Version}}'])
      if (version.code !== 0) return { available: false, reason: `Podman 未就绪：${version.stderr.slice(0, 300)}` }
      const image = await this.short(['podman', 'image', 'exists', this.options.image])
      if (image.code !== 0) return { available: false, reason: '固定的本地 Python 镜像尚未配置，未自动拉取或执行其他镜像。' }
      return { available: true }
    } catch (error) { return { available: false, reason: error instanceof Error ? error.message : '执行后端不可用' } }
  }
  /** Explicit, unprivileged preparation for the bundled Python runtime.
   * No mutable tag, shell, administrator install, or substitute image is used.
   * Normal job submission only calls availability() and never downloads.
   */
  async provisionPinnedPython(): Promise<{ available: boolean; reason?: string }> {
    if (this.options.image !== PINNED_PYTHON_IMAGE_ID)
      return { available: false, reason: '本后端未配置为产品固定 Python 镜像，拒绝准备其他镜像。' }
    const existing = await this.availability()
    if (existing.available) return existing
    try {
      const pulled = await observeProcess(this.command(['podman', 'pull', '--quiet', PINNED_PYTHON_IMAGE_SOURCE]))
      if (pulled.code !== 0) return { available: false, reason: `固定 Python 镜像获取失败：${pulled.stderr.slice(0, 300)}` }
      const inspected = await this.short(['podman', 'image', 'inspect', PINNED_PYTHON_IMAGE_SOURCE, '--format', '{{.Id}}'])
      if (inspected.code !== 0 || inspected.stdout.trim() !== PINNED_PYTHON_IMAGE_ID)
        return { available: false, reason: '固定 Python 镜像身份与产品登记不一致，拒绝执行。' }
      return this.availability()
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : '固定 Python 镜像准备失败' }
    }
  }
  private async linuxPath(directory: string): Promise<string> {
    const result = await this.short(['wslpath', '-a', path.resolve(directory)])
    const linux = result.stdout.trim()
    if (result.code !== 0 || !linux.startsWith('/') || linux.includes('\n') || linux.includes('\r')) throw new Error('受管作业目录无法映射到执行后端')
    return linux
  }
  /** Recovery query; missing means no running container is observable, not that work succeeded. */
  async inspectContainer(name: string): Promise<'running' | 'exited' | 'missing' | 'unknown'> {
    if (!validContainerName(name)) throw new Error('计算容器身份无效')
    try {
      const inspected = await this.short(['podman', 'inspect', '--format', '{{.State.Running}}', name])
      if (inspected.code !== 0) return /no such (object|container)/i.test(inspected.stderr) ? 'missing' : 'unknown'
      return inspected.stdout.trim() === 'true' ? 'running' : 'exited'
    } catch { return 'unknown' }
  }
  async stopContainer(name: string): Promise<boolean> {
    if (!validContainerName(name)) throw new Error('计算容器身份无效')
    try { return (await this.short(['podman', 'stop', '--time', '1', name], 10_000)).code === 0 }
    catch { return false }
  }
  inspectExecution(name: string) { return this.inspectContainer(name) }
  stopExecution(name: string) { return this.stopContainer(name) }
  async start(request: ComputeBackendRequest | BackendRequest): Promise<ComputeProcess> {
    const name = 'executionId' in request ? request.executionId : request.containerName
    if (!safeArg(request.program) || !request.program || request.argv.some(arg => !safeArg(arg))
      || !validContainerName(name))
      throw new Error('受限执行参数无效')
    const available = await this.availability()
    if (!available.available) throw new Error(available.reason ?? '受限执行后端不可用')
    const root = await this.linuxPath(request.directory)
    const args = ['podman', 'run', '--rm', '--pull=never', '--name', name,
      '--network', 'none', '--read-only', '--pids-limit', '-1', '--stop-timeout', '1',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534',
      '--tmpfs', '/tmp:rw,nosuid,nodev',
      '--volume', `${root}/input:/job/input:ro`, '--volume', `${root}/output:/job/work:rw`, '--volume', `${root}/output:/job/output:rw`,
      '--workdir', '/job/output', '--env', 'GUOLING_INPUT_DIR=/job/input', '--env', 'GUOLING_OUTPUT_DIR=/job/output',
      '--entrypoint', request.program, this.options.image, ...request.argv]
    const child = this.command(args)
    let cancelled = false, finished = false
    const stop = async () => {
      if (finished) return true
      return (await this.stopContainer(name)) || finished
    }
    // Work remains active until it exits or its owner explicitly cancels it.
    // Cancellation stops the container tree, rather than only its WSL wrapper.
    const done = observeProcess(child).then(result => { finished = true; return {
      exitCode: result.code, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated, cancelled,
    } }, async error => { await stop(); finished = true; throw error })
    return { done, cancel: async () => { const confirmed = await stop(); cancelled ||= confirmed; return confirmed } }
  }
}
