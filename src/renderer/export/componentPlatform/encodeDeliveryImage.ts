import type { ComponentAsset } from '../../../shared/contracts/component-platform'
/** Encode a delivery derivative at its real intrinsic resolution; author bytes remain untouched. */
export async function encodeDeliveryImage(asset: Readonly<ComponentAsset>, bytes: Uint8Array, dom: Document, signal?: AbortSignal): Promise<{bytes:Uint8Array;mimeType:string;filename?:string}|undefined> {
  if(!['image/png','image/jpeg'].includes(asset.mimeType??''))return
  // APNG has a live animation owner; one raster frame cannot replace its program.
  if(asset.mimeType==='image/png')for(let offset=8;offset+12<=bytes.length;){const size=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0);const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));if(type==='acTL')return;offset+=size+12}
  signal?.throwIfAborted()
  const url=URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type:asset.mimeType})),image=new dom.defaultView!.Image()
  try{image.src=url;await image.decode();signal?.throwIfAborted();const canvas=dom.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');if(!context)return;context.drawImage(image,0,0);const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',1));signal?.throwIfAborted();if(!blob||blob.type!=='image/webp'||blob.size>=bytes.length)return;return{bytes:new Uint8Array(await blob.arrayBuffer()),mimeType:blob.type,filename:asset.filename?.replace(/\.[^.]+$/,'.webp')}}
  finally{URL.revokeObjectURL(url)}
}
