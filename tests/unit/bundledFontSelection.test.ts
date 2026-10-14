import {expect,it} from 'vitest'
import {bundledFontCharacterUse,unicodeRangeIntersects} from '../../src/renderer/export/bundledFontSelection'
it('selects actual Unicode and escaped/generated literal text without dropping unbounded input coverage',()=>{
 const use=bundledFontCharacterUse({title:'中',html:'<span>&#x7532;</span>',source:'output.textContent="\\u4e59"'});
 expect(unicodeRangeIntersects('U+4E00-4EFF',use)).toBe(true);expect(unicodeRangeIntersects('U+7500-75FF',use)).toBe(true);
 expect(unicodeRangeIntersects('U+8F00-8FFF',use)).toBe(false);expect(unicodeRangeIntersects(undefined,use)).toBe(true);
 const dynamic=bundledFontCharacterUse({html:'<input type="text">'});
 expect(dynamic.dynamic).toBe(true);expect(unicodeRangeIntersects('U+8F00-8FFF',dynamic)).toBe(true);
})
