import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import compatibility from './src/shared/browser/compatibilityTarget.json'

export default defineConfig({
  build: {
    target: compatibility.target,
    outDir: 'dist-player',
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, 'src/player/componentPlatform/entry.ts'),
      name: 'CoursewarePlayer',
      formats: ['iife'],
      fileName: () => 'player.iife.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    minify: 'esbuild',
  },
})
