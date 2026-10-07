// @vitest-environment node
import { execFileSync, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

it('real sandbox Python sys.exit(3) reports exit code 3 and failed work without publishing an artifact', async () => {
  const root = path.resolve(__dirname, '../../../..'), base = path.join(root, 'output/productFollowup/T06/teacherLocalCompute')
  await fs.mkdir(base, { recursive: true })
  const directory = await fs.mkdtemp(path.join(base, 'exit3-')), profile = path.join(directory, 'profile')
  await fs.mkdir(profile)
  const result = path.join(directory, 'facts.json'), request = path.join(directory, 'request.json'), profileArgument = `--user-data-dir=${profile}`
  await fs.writeFile(request, JSON.stringify({ root, directory, profile, result }))
  const requireProduct = createRequire(path.join(root, 'package.json')), executable = requireProduct('electron') as string
  const env: NodeJS.ProcessEnv = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [path.join(__dirname, 'teacherLocalComputeExit3Harness.cjs'), request, profileArgument],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout!.on('data', chunk => { stdout += String(chunk) }); child.stderr!.on('data', chunk => { stderr += String(chunk) })
  try {
    const exit = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Actual exit-3 worker did not settle; evidence: ${directory}`)), 75_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); resolve(code) })
    })
    const facts = JSON.parse(await fs.readFile(result, 'utf8'))
    expect(exit, JSON.stringify({ facts, stderr })).toBe(0)
    expect(facts.error, JSON.stringify(facts)).toBeUndefined()
    expect(facts.final).toMatchObject({ status: 'failed', exitCode: 3, stopped: false, artifacts: [] })
    expect(facts.final.reason).toMatch(/(?:退出码|exit(?:\s+code)?)\s*3/i)
    const messages = facts.logs.entries.map((entry: { message: string }) => entry.message).join('\n')
    expect(messages).toContain('before normal Python exit 3')
    expect(messages).not.toContain('must not run after exit')
    expect(messages).not.toMatch(/Traceback|SystemExit/i)
    expect(facts.readArtifact).toMatchObject({ rejected: true, code: 'artifact-not-ready' })
  } finally {
    await fs.writeFile(path.join(directory, 'electron.log'), JSON.stringify({ stdout, stderr }, null, 2))
    if (child.pid && child.exitCode === null && child.signalCode === null && child.spawnargs.includes(profileArgument)) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' }) }
        catch (error) { await fs.writeFile(path.join(directory, 'cleanup-error.txt'), String(error)) }
      } else child.kill()
    }
  }
}, 90_000)
