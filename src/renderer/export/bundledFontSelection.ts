/** Delivery face selection follows fontsource's actual unicode ranges. */
export interface BundledFontCharacterUse { codePoints:ReadonlySet<number>; dynamic:boolean }
export function bundledFontCharacterUse(payload:unknown):BundledFontCharacterUse {
 const codePoints=new Set<number>();let dynamic=false;const seen=new Set<object>();
 const text=(value:string)=>{
   if (/<(?:textarea|input)\b[^>]*(?:type\s*=\s*["']?(?:text|search|email|url)\b|(?:(?!type\s*=)[^>])*>)/i.test(value)
      || /\b(?:String\.from(?:CharCode|CodePoint)|fetch\s*\(|XMLHttpRequest|WebSocket|document\.write\s*\()/u.test(value)) dynamic=true;
   const decoded=value.replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi,(_all,hex,decimal)=>String.fromCodePoint(Math.min(0x10ffff,Number.parseInt(hex??decimal,hex?16:10))))
      .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})/gi,(_all,braced,plain)=>String.fromCodePoint(Number.parseInt(braced??plain,16)))
      .replace(/\\([0-9a-f]{1,6})\s/gi,(_all,hex)=>String.fromCodePoint(Math.min(0x10ffff,Number.parseInt(hex,16))));
   for(const character of decoded)codePoints.add(character.codePointAt(0)!);
 };
 const visit=(value:unknown)=>{if(typeof value==='string'){text(value);return;}if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);if(Array.isArray(value)){value.forEach(visit);return;}const record=value as Record<string,unknown>;
   if(record.key==='guoling.input')dynamic=true;
   for(const [key,entry]of Object.entries(record)){if(['url','path','filename','mimeType'].includes(key))continue;visit(entry);}
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
