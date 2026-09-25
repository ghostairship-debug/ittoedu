import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCourseProjectArchive } from '../../../src/core/drivers/codecs/courseProjectArchive'
import {
  COURSE_PROJECT_V9_FIXTURE_MTIME,
  listCourseProjectV9Fixtures,
} from './sources'

const fixtureRoot = dirname(fileURLToPath(import.meta.url))

function main(): void {
  for (const fixture of listCourseProjectV9Fixtures()) {
    const bytes = createCourseProjectArchive(fixture.data, {
      mtime: COURSE_PROJECT_V9_FIXTURE_MTIME,
    })
    if (bytes.byteLength === 0) {
      throw new Error(`Generated empty archive for ${fixture.id}`)
    }
    const path = join(fixtureRoot, fixture.filename)
    writeFileSync(path, bytes)
    console.log(`${fixture.filename}\t${bytes.byteLength} bytes\t${fixture.covers.join(', ')}`)
  }
}

main()
