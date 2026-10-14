import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { sourceResourceReferences } from '../../src/core/components/library/references'
it('keeps imported CSS/JSON data out of resources API dynamic scope and preserves declared bindings', () => {
  const project = createBlankCourseProjectV10('资源'), implementation = { kind: 'source' as const, language: 'javascript' as const, workspace: { ownerId: 'code', entry: 'index.js' }, resourceBindings: { first: 'used', second: 'branch' } }
  for (const id of ['used','branch','unused']) project.assets[id] = { id, path: `assets/${id}.png`, mimeType: 'image/png', byteLength: 1 }
  const encoder = new TextEncoder(), resources = { assets: {}, components: { code: { 'index.js': encoder.encode("import './style.css';import settings from './settings.json';export default {mount(ctx){ctx.resources.url('first');ctx.resources.url('second')}}"), 'style.css': encoder.encode('.card{color:red;background:url(./picture.png)}'), 'settings.json': encoder.encode('{"title":"说明"}'), 'picture.png': Uint8Array.of(255) } } }
  expect(sourceResourceReferences(implementation,project,resources)).toEqual({ assetIds: ['used','branch'], dynamic: false })
})
