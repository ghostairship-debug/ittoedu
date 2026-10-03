#!/usr/bin/env node
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import path from 'node:path'

// Optional content assembly only. Product import, identities and saving belong to the host.
const options = { css: [], js: [] }
const allowed = new Set(['body', 'out', 'title', 'lang', 'css', 'js'])
try {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    process.stdout.write('Usage: node assemble-html.mjs --body body.html --out lesson.html [--title Title] [--lang zh-CN] [--css theme.css] [--js lesson.js]\n')
    process.exit(0)
  }
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '')
    const value = args[i + 1]
    if (!args[i]?.startsWith('--') || !allowed.has(key) || value === undefined) throw new Error(`Invalid argument: ${args[i]}`)
    if (key === 'css' || key === 'js') options[key].push(path.resolve(value))
    else options[key] = value
  }
  if (!options.body || !options.out) throw new Error('--body and --out are required')
  const bodyPath = path.resolve(options.body)
  const outputPath = path.resolve(options.out)
  if (bodyPath === outputPath) throw new Error('The output document must differ from the source body fragment')
  const outputDir = path.dirname(outputPath)
  const body = await readFile(bodyPath, 'utf8')
  await Promise.all([...options.css, ...options.js].map(filename => access(filename)))
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const url = filename => path.relative(outputDir, filename).split(path.sep).map(encodeURIComponent).join('/')
  const styles = options.css.map(filename => `<link rel="stylesheet" href="${escape(url(filename))}">`).join('\n')
  const scripts = options.js.map(filename => `<script src="${escape(url(filename))}"></script>`).join('\n')
  const html = `<!doctype html>\n<html lang="${escape(options.lang ?? 'zh-CN')}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escape(options.title ?? path.basename(outputPath, path.extname(outputPath)))}</title>\n${styles}\n</head>\n<body>\n${body}\n${scripts}\n</body>\n</html>\n`
  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, html, 'utf8')
  process.stdout.write(`Created ${outputPath}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
