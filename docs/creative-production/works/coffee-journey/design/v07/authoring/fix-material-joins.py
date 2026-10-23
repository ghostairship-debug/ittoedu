from pathlib import Path
base=Path(__file__).resolve().parent.parent
p=base/'background-runtime.js'
s=p.read_text(encoding='utf-8-sig')
s=s.replace(" function maskedSprite(ctx,key,mask)",""" // Premultiplied, energy-preserving material blend: transparent edges do not stack.
 function blendLayers(ctx,key,a,b,t){
  if(t<=0){a(ctx);return}if(t>=1){b(ctx);return}
  const ca=scratch(key+'-a'),cb=scratch(key+'-b'),co=scratch(key+'-mix');
  const ga=ca.getContext('2d'),gb=cb.getContext('2d'),go=co.getContext('2d');
  ga.setTransform(2,0,0,2,280,280);gb.setTransform(2,0,0,2,280,280);a(ga);b(gb);
  go.globalAlpha=1-t;go.drawImage(ca,0,0);go.globalCompositeOperation='lighter';go.globalAlpha=t;go.drawImage(cb,0,0);
  ctx.drawImage(co,-140,-140,280,280);
 }
 function maskedSprite(ctx,key,mask)""")
s=s.replace("function fruitToSeeds(ctx,q){\n  if(q===0){full(ctx,'cherry');return}seedPair(ctx);shells(ctx,smooth(.02,.98,q));\n  // At the sealed state the intact skin covers both seeds without transparency.\n  withAlpha(ctx,1-smooth(0,.10,q),()=>full(ctx,'cherry'));\n }", """function fruitToSeeds(ctx,q){
  // At closure the fruit is one image; introducing the opaque inner assembly uses
  // a registered premultiplied blend, so alpha edges never acquire an extra outline.
  blendLayers(ctx,'peel-entry',c=>full(c,'cherry'),c=>{seedPair(c);shells(c,smooth(.02,.98,q))},smooth(0,.12,q));
 }""")
s=s.replace("function seedsToGreen(ctx,q){", "function seedTurn(ctx,q){")
s=s.replace(" function roastedBean(ctx,q){\n  const gold=smooth(0,.52,q),roast=smooth(.42,1,q);\n  full(ctx,'green');withAlpha(ctx,gold,()=>full(ctx,'gold'));withAlpha(ctx,roast,()=>full(ctx,'roast'));\n }", """ function seedsToGreen(ctx,q){
  // Align the union-clipped pair and its independently moving faces while their
  // transforms are still almost identical. No material replacement at the boundary.
  blendLayers(ctx,'seed-entry',c=>fruitToSeeds(c,1),c=>seedTurn(c,q),smooth(0,.10,q));
 }
 function roastedBean(ctx,q){
  if(q<=.5)blendLayers(ctx,'roast-green-gold',c=>full(c,'green'),c=>full(c,'gold'),smooth(0,.5,q));
  else blendLayers(ctx,'roast-gold-brown',c=>full(c,'gold'),c=>full(c,'roast'),smooth(.5,1,q));
 }""")
# An identity CSS filter still forces a different raster path in Chromium. Remove
# the filter continuously when the photographic fruit has fully acquired material.
s=s.replace("ctx.filter='sepia('+(1-material)+') saturate('+mix(.42,1,material)+') brightness('+mix(.38,1,material)+') blur('+((1-material)*.65)+'px)'", "ctx.filter=material>=1?'none':'sepia('+(1-material)+') saturate('+mix(.42,1,material)+') brightness('+mix(.38,1,material)+') blur('+((1-material)*.65)+'px)'")
assert 'function seedsToGreen' in s and 'blendLayers(ctx,\'peel-entry\'' in s and 'roast-green-gold' in s
p.write_text(s,encoding='utf-8')
report=base/'evidence/material-continuity.json'
if report.exists() and not (base/'evidence/material-continuity-before-fix.json').exists():(base/'evidence/material-continuity-before-fix.json').write_bytes(report.read_bytes())
session=base/'authoring/session.cjs';s=session.read_text(encoding='utf-8-sig')
s=s.replace("await expect(frame).toBeVisible();", "await expect(frame).toBeVisible({timeout:60000});")
s=s.replace(" const page=await app.firstWindow();", " try {\n const page=await app.firstWindow();")
s=s.replace("return{app,page,frame,id,out,base,workspace,snapshot,files,commit,history,invoke,save,exportHtml,close,errors,expect,chromium};", "return{app,page,frame,id,out,base,workspace,snapshot,files,commit,history,invoke,save,exportHtml,close,errors,expect,chromium};\n }catch(error){await app.evaluate(({app,BrowserWindow})=>{BrowserWindow.getAllWindows().forEach(w=>w.destroy());app.exit(0)}).catch(()=>{});await app.close().catch(()=>{});throw error}")
session.write_text(s,encoding='utf-8')
print('Corrected registered boundary compositing; startup wait and failed-session cleanup.')