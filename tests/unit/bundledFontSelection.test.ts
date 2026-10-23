import {expect,it} from 'vitest'
import {bundledFontCharacterUse,unicodeRangeIntersects} from '../../src/renderer/export/bundledFontSelection'
it('selects actual Unicode and escaped/generated literal text without dropping unbounded input coverage',()=>{
 const use=bundledFontCharacterUse({title:'中',html:'<span>&#x7532;</span>',source:'output.textContent="\\u4e59"'});
 expect(unicodeRangeIntersects('U+4E00-4EFF',use)).toBe(true);expect(unicodeRangeIntersects('U+7500-75FF',use)).toBe(true);
 expect(unicodeRangeIntersects('U+8F00-8FFF',use)).toBe(false);expect(unicodeRangeIntersects(undefined,use)).toBe(true);
 const dynamic=bundledFontCharacterUse({html:'<input type="text">'});
 expect(dynamic.dynamic).toBe(true);expect(unicodeRangeIntersects('U+8F00-8FFF',dynamic)).toBe(true);
})

it('keeps range and numeric experiments finite while retaining actual text input coverage',()=>{
 for(const type of ['range','number','button','hidden','checkbox','radio','date','datetime-local','month','week','time','color','image','reset','submit']){
   const use=bundledFontCharacterUse({html:`<input class="control" type="${type}" value="0" aria-label="清水克数">`});
   expect(use.dynamic,type).toBe(false);expect(unicodeRangeIntersects('U+9F00-9FFF',use),type).toBe(false);
 }
 for(const html of ['<input>','<input type="">','<input type=text>','<input type=search>','<input type=email>','<input type=url>','<input type=tel>','<input type=password>','<input type=file>','<input type=unknown>','<input type=" range ">','<textarea readonly>固定初始文字</textarea>']){
   const use=bundledFontCharacterUse({html});
   expect(use.dynamic,html).toBe(true);expect(unicodeRangeIntersects('U+9F00-9FFF',use),html).toBe(true);
 }
 expect(bundledFontCharacterUse({html:'<input TYPE="RaNgE"><input type="&#114;ange">'}).dynamic).toBe(false);
})

it('reads real HTML tags and contenteditable values rather than matching comments or attributes',()=>{
 for(const html of ['<p contenteditable>说明</p>','<p contenteditable class="text">说明</p>','<p contenteditable="true">说明</p>','<p contenteditable="plaintext-only">说明</p>','<iframe srcdoc="&lt;input type=text>"></iframe>','<button onclick="root.innerHTML=\'&lt;input type=text>\'">添加</button>']){
   expect(bundledFontCharacterUse({html}).dynamic,html).toBe(true);
 }
 for(const html of ['<!-- <input type=text> -->','<style>/* <input> */</style>','<p title="<input type=text>">说明</p>','<p contenteditable="false">说明</p>']){
   expect(bundledFontCharacterUse({html}).dynamic,html).toBe(false);
 }
})

it('understands quoted HTML inside source code and script bodies without treating escaped HTML attributes as valid',()=>{
 const range=String.raw`root.innerHTML = "<input type=\"range\" min=\"0\" max=\"100\">";`;
 const text=String.raw`root.innerHTML = "<input type=\"text\">";`;
 for(const payload of [{source:range},{compiled:{code:range}},{'main.ts':range},{modules:{extensionless:range}},{publishedModuleBundle:range},{publishedDocumentBundles:{'0/1':range}},{html:`<script>${range}</script>`}]){
   expect(bundledFontCharacterUse(payload).dynamic).toBe(false);
 }
 for(const payload of [{source:text},{compiled:{code:text}},{'main.ts':text},{modules:{extensionless:text}},{publishedModuleBundle:text},{publishedDocumentBundles:{'0/1':text}},{html:`<script>${text}</script>`}]){
   expect(bundledFontCharacterUse(payload).dynamic).toBe(true);
 }
 expect(bundledFontCharacterUse({html:String.raw`<input type=\"range\">`}).dynamic).toBe(true);
})

it('retains unbounded native input and program output protections',()=>{
 // guoling.input currently uses a DOM text input even for decimal inputMode.
 expect(bundledFontCharacterUse({implementation:{kind:'builtin',key:'guoling.input'},data:{answer:{type:'number'}}}).dynamic).toBe(true);
 for(const source of ['fetch("data.json")','String.fromCharCode(0x4e2d)','String.fromCodePoint(0x4e2d)','new XMLHttpRequest()','new WebSocket(url)','document.write(text)']){
   expect(bundledFontCharacterUse({source}).dynamic,source).toBe(true);
 }
})
