import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8'))
}

async function sha256(relativePath) {
  const bytes = await readFile(path.join(repositoryRoot, relativePath))
  return createHash('sha256').update(bytes).digest('hex')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const attestation = await readJson('catalog.post-verification-attestation.json')
assert(attestation.schemaVersion === 2, 'Attestation schemaVersion must be 2')

const evidencePath = attestation.evidence?.runtimeEvidencePath
assert(typeof evidencePath === 'string', 'Attestation runtimeEvidencePath is missing')
const absoluteEvidencePath = path.resolve(repositoryRoot, evidencePath)
const relativeEvidencePath = path.relative(repositoryRoot, absoluteEvidencePath)
assert(
  relativeEvidencePath !== '..' && !relativeEvidencePath.startsWith(`..${path.sep}`),
  'Attestation runtime evidence must be an immutable file inside this repository',
)

const evidenceHash = await sha256(relativeEvidencePath)
assert(
  evidenceHash === attestation.evidence.runtimeEvidenceSha256,
  `Runtime evidence SHA-256 mismatch: ${evidenceHash}`,
)
const catalogHash = await sha256('catalog.json')
assert(
  catalogHash === attestation.evidence.postCatalogSha256,
  `Post-verification catalog SHA-256 mismatch: ${catalogHash}`,
)

const evidence = await readJson(relativeEvidencePath)
const catalog = await readJson('catalog.json')
const matrix = attestation.matrix
assert(evidence.generatedAt === attestation.verifiedAt, 'Evidence time is not bound to verifiedAt')
assert(evidence.packageCount === matrix.packageCount, 'Evidence package count mismatch')
assert(evidence.pressure?.sceneCount === matrix.sceneCount, 'Evidence scene count mismatch')
assert(evidence.pressure?.rounds === matrix.pressureRounds, 'Evidence pressure rounds mismatch')
assert(
  evidence.pressure?.navigationCount === matrix.navigationCount,
  'Evidence navigation count mismatch',
)
assert(
  evidence.backgroundWindowIsolation === matrix.backgroundWindowIsolation,
  'Evidence background-window isolation mismatch',
)
assert(Array.isArray(catalog.packages), 'catalog.json packages must be an array')
assert(catalog.packages.length === matrix.packageCount, 'Catalog package count mismatch')
for (const surface of [
  evidence.verified?.generatedStandaloneHtml,
  evidence.verified?.generatedWebPackage,
  evidence.preview,
  evidence.exportedStandalone,
  evidence.exportedWebPackage,
]) {
  assert(surface?.minMounted === 1 && surface?.maxMounted === 1, 'Mounted component isolation failed')
  assert(Array.isArray(surface.externalRequests) && surface.externalRequests.length === 0, 'External request found')
  assert(Array.isArray(surface.pageErrors) && surface.pageErrors.length === 0, 'Player page error found')
}
assert(evidence.staticExports?.pdfPages === matrix.sceneCount, 'PDF page count mismatch')
assert(evidence.staticExports?.pptxSlides === matrix.sceneCount, 'PPTX slide count mismatch')

console.log(
  `Attestation verified: ${matrix.packageCount} packages, ${matrix.navigationCount} pressure navigations, evidence ${evidenceHash}`,
)
