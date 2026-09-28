import path from 'node:path'
import { build } from 'esbuild'
import type { Plugin } from 'vite'

/** Fixed, app-owned page agent. Renderer Vite clears dist-renderer before build, so emit after bundle closure. */
export function htmlPreviewAgentPlugin(): Plugin {
  let root = process.cwd()
  let outDir = 'dist-renderer'
  let command: 'serve' | 'build' = 'build'
  const emit = async () => {
    await build({
      entryPoints: [path.resolve(root, 'src/player/htmlPreview/htmlPreviewAgent.ts')],
      outfile: path.resolve(root, outDir, 'html-preview-agent.iife.js'),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      sourcemap: false,
      minify: command === 'build',
      legalComments: 'none',
      write: true,
    })
  }
  return {
    name: 'html-preview-agent',
    configResolved(config) { root = config.root; outDir = config.build.outDir; command = config.command },
    configureServer(server) { void emit().catch(error => server.config.logger.error(`HTML preview agent: ${String(error)}`)) },
    async closeBundle() { if (command === 'build') await emit() },
  }
}
