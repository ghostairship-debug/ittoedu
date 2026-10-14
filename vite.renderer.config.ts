import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { APP_NAME } from './src/shared/constants'
import { htmlPreviewAgentPlugin } from './scripts/htmlPreviewAgentPlugin'
import { bundledFontOutputManifest } from './src/shared/fonts/bundledFontOutputManifest'
import type { BundledFontFamilyDescriptor } from './src/shared/fonts/bundledFontManifest'
import {
  bundledFontFaceSpecifiers,
  resolveBundledFontDescriptors,
} from './src/shared/fonts/bundledFontSources'

function productIdentityPlugin(): Plugin {
  return {
    name: 'product-identity',
    transformIndexHtml(html) {
      return html.replaceAll('__APP_NAME__', APP_NAME)
    },
  }
}

function playerBundlePlugin(): Plugin {
  const bundles: Record<string, string> = { 'virtual:player-bundle': 'player.iife.js', 'virtual:compiled-player-bundle': 'compiled-player.iife.js' }
  return {
    name: 'embedded-player-bundle',
    resolveId(id) {
      return Object.hasOwn(bundles, id) ? `\0${id}` : undefined
    },
    load(id) {
      const filename = bundles[id.slice(1)]
      if (!id.startsWith('\0') || !filename) return undefined
      const bundlePath = resolve(__dirname, 'dist-player', filename)
      return `export default ${JSON.stringify(readFileSync(bundlePath, 'utf8'))}`
    },
  }
}

function bundledFontsPlugin(): Plugin {
  const virtualId = 'virtual:bundled-fonts'
  const resolvedVirtualId = `\0${virtualId}`
  let descriptors: readonly BundledFontFamilyDescriptor[] | undefined
  return {
    name: 'bundled-fonts-manifest',
    resolveId(id) {
      return id === virtualId ? resolvedVirtualId : undefined
    },
    load(id) {
      if (id !== resolvedVirtualId) return undefined
      descriptors = resolveBundledFontDescriptors(
        resolve(__dirname, 'node_modules'),
      )
      const specifiers = bundledFontFaceSpecifiers(descriptors)
      const imports = specifiers
        .map((specifier, index) => `import u${index} from ${JSON.stringify(`${specifier}?url`)}`)
        .join('\n')
      const urls = specifiers.map((_specifier, index) => `u${index}`).join(', ')
      return [
        `import { assembleBundledFontManifest } from ${JSON.stringify(
          resolve(__dirname, 'src/shared/fonts/bundledFontManifest.ts').replaceAll('\\', '/'),
        )}`,
        imports,
        `export default assembleBundledFontManifest(${JSON.stringify(descriptors)}, [${urls}])`,
        '',
      ].join('\n')
    },
    generateBundle(_options, bundle) {
      if (!descriptors) return
      const assets = Object.values(bundle).filter(value => value.type === 'asset')
      this.emitFile({ type: 'asset', fileName: 'bundled-font-manifest.json', source: JSON.stringify(bundledFontOutputManifest(descriptors, assets)) })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [productIdentityPlugin(), react(), playerBundlePlugin(), bundledFontsPlugin(), htmlPreviewAgentPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  worker: { format: 'es' },
  build: {
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admission: resolve(__dirname, 'admission.html'), observation: resolve(__dirname, 'observation.html'), attachmentExtraction: resolve(__dirname, 'attachment-extraction.html'), nativeTextMeasurement: resolve(__dirname, 'native-text-measurement.html'), documentExport: resolve(__dirname, 'document-export.html'), pptxImport: resolve(__dirname, 'pptx-import.html'), compute: resolve(__dirname, 'compute.html') } },
    outDir: 'dist-renderer',
    emptyOutDir: true,
    sourcemap: true,
    // Bundled font faces must stay as emitted files. The export path reads their
    // bytes with `fetch()`, which `connect-src` governs, and the editor CSP does
    // not allow `data:` there — an inlined slice is renderable but unreadable,
    // and the all-or-nothing family rule turns one inlined slice into a silently
    // unembedded family. Only fonts are exempted so other assets keep inlining.
    assetsInlineLimit: (filePath) => (/\.woff2?$/iu.test(filePath) ? false : undefined),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
