import { expect, it } from 'vitest'
import { globalVisibilityAtSurface } from '../../src/renderer/ui/properties/CourseGlobalPropertiesContextBuilder'
it('P0 keeps imported include scope after hiding a page and adding a new page',()=>{
  const visibility=globalVisibilityAtSurface({mode:'include',surfaceIds:['imported-page','peer-page']},'imported-page',false)
  expect(visibility).toEqual({mode:'include',surfaceIds:['peer-page']})
  const newPages=['imported-page','peer-page','new-page']
  expect(newPages.filter(id=>visibility.surfaceIds.includes(id))).toEqual(['peer-page'])
  expect(globalVisibilityAtSurface(visibility,'imported-page',true)).toEqual({mode:'include',surfaceIds:['peer-page','imported-page']})
})
it('P0 updates unrestricted/excluded scope while retaining future page semantics',()=>{
  expect(globalVisibilityAtSurface({mode:'all',surfaceIds:[]},'page',false)).toEqual({mode:'exclude',surfaceIds:['page']})
  expect(globalVisibilityAtSurface({mode:'exclude',surfaceIds:['page','peer']},'page',true)).toEqual({mode:'exclude',surfaceIds:['peer']})
  expect(globalVisibilityAtSurface({mode:'exclude',surfaceIds:['page']},'page',true)).toEqual({mode:'all',surfaceIds:[]})
})
