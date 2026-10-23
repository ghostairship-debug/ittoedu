import { scanHtmlSource } from '../../shared/html/htmlSourceScanner'

/** Controls whose value cannot introduce arbitrary authored text. Unknown types are text inputs. */
const FINITE_INPUT_TYPES = new Set([
 'button','checkbox','color','date','datetime-local','hidden','image','month',
 'number','radio','range','reset','submit','time','week',
])

function hasFreeTextControl(value:string,scriptSource=false):boolean {
 // Source/code carriers contain HTML inside JS string literals. The HTML lexer
 // needs the quoted attribute value rather than the JS-escaped quote spelling.
 const html=scriptSource?value.replace(/\\(["'])/g,'$1'):value
 if(!/<(?:input|textarea|script|iframe)\b|\bcontenteditable\b|\bon\w+\s*=/i.test(html))return false
 for(const token of scanHtmlSource(html).tokens){
   if(token.kind==='raw-text'&&token.rawKind==='script'
     &&hasFreeTextControl(html.slice(token.span.start,token.span.end),true))return true
   if(token.kind!=='start-tag')continue
   const attributes=token.attributes??[]
   for(const attribute of attributes){
     if(attribute.name==='srcdoc'&&attribute.decodedValue&&hasFreeTextControl(attribute.decodedValue))return true
     if(/^on[a-z]+$/.test(attribute.name)&&attribute.decodedValue&&hasFreeTextControl(attribute.decodedValue,true))return true
   }
   const editable=attributes.find(attribute=>attribute.name==='contenteditable')
   if(editable&&['','true','plaintext-only'].includes((editable.decodedValue??'').trim().toLowerCase()))return true
   if(token.name==='textarea')return true
   if(token.name==='input'){
     const type=attributes.find(attribute=>attribute.name==='type')?.decodedValue?.toLowerCase()??''
     if(!FINITE_INPUT_TYPES.has(type))return true
   }
 }
 return false
}

/** Delivery face selection follows fontsource's actual unicode ranges. */
export interface BundledFontCharacterUse { codePoints:ReadonlySet<number>; dynamic:boolean }
export function bundledFontCharacterUse(payload:unknown):BundledFontCharacterUse {
 const codePoints=new Set<number>();let dynamic=false;const seen=new Set<object>();
 const text=(value:string,scriptSource:boolean)=>{
   if (hasFreeTextControl(value,scriptSource)
      || /\b(?:String\.from(?:CharCode|CodePoint)|fetch\s*\(|XMLHttpRequest|WebSocket|document\.write\s*\()/u.test(value)) dynamic=true;
   const decoded=value.replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi,(_all,hex,decimal)=>String.fromCodePoint(Math.min(0x10ffff,Number.parseInt(hex??decimal,hex?16:10))))
      .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})/gi,(_all,braced,plain)=>String.fromCodePoint(Number.parseInt(braced??plain,16)))
      .replace(/\\([0-9a-f]{1,6})\s/gi,(_all,hex)=>String.fromCodePoint(Math.min(0x10ffff,Number.parseInt(hex,16))));
   for(const character of decoded)codePoints.add(character.codePointAt(0)!);
 };
 const visit=(value:unknown,scriptSource=false)=>{if(typeof value==='string'){text(value,scriptSource);return;}if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);if(Array.isArray(value)){value.forEach(entry=>visit(entry,scriptSource));return;}const record=value as Record<string,unknown>;
   if(record.key==='guoling.input')dynamic=true;
   for(const [key,entry]of Object.entries(record)){if(['url','path','filename','mimeType'].includes(key))continue;visit(entry,scriptSource||['source','code','modules','publishedModuleBundle','publishedDocumentBundles'].includes(key)||/\.[cm]?[jt]sx?$/i.test(key));}
 };visit(payload);
 // Teacher controls and numeric/timer/program output require a small stable basic repertoire.
 for(let point=0x20;point<=0x7e;point++)codePoints.add(point);
 for(const character of '上一页下一页目录开始结束复位播放暂停缩小放大恢复默认视图静音全屏')codePoints.add(character.codePointAt(0)!);
 return {codePoints,dynamic};
}
export function unicodeRangeIntersects(range:string|undefined,use:BundledFontCharacterUse):boolean {
 if(!range||use.dynamic)return true;
 const spans=range.split(',').map(token=>/^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(token));
 if(spans.some(span=>!span))return true; // A face without understood range must retain its coverage.
 return spans.some(span=>{const from=Number.parseInt(span![1].replace(/\?/g,'0'),16),to=Number.parseInt(span![2]??span![1].replace(/\?/g,'f'),16);return [...use.codePoints].some(point=>point>=from&&point<=to);});
}
