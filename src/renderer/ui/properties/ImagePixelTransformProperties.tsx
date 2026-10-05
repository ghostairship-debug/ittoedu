import { useState } from 'react'
import type { ImageTransformOperation } from '../../../shared/imageTransformContract'
import type { ComponentAsset } from '../../../shared/contracts/component-platform/project'
import { BufferedInput } from './PropertyControls'
import { ColorInput } from '../ColorInput'

/** Pixel intents only. The App captures the image, produces resources and commits the single batch. */
export function ImagePixelTransformProperties({ asset, transform }: {
  asset?: ComponentAsset
  transform(operations: readonly ImageTransformOperation[]): Promise<void>
}) {
  const [sourceColor,setSourceColor]=useState('#ffffff'),[targetColor,setTargetColor]=useState('#22c55e')
  const [tolerance,setTolerance]=useState(32),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [region,setRegion]=useState({x:0,y:0,width:asset?.width??1,height:asset?.height??1})
  const [size,setSize]=useState({width:asset?.width??1,height:asset?.height??1})
  const dimensions=Boolean(asset?.width&&asset?.height)
  const apply=async(operations:readonly ImageTransformOperation[])=>{
    try{setError('');setBusy(true);await transform(operations)}
    catch(failure){setError(failure instanceof Error?failure.message:String(failure))}
    finally{setBusy(false)}
  }
  return <details className="property-section"><summary>编辑原图像素</summary>
    <p className="property-hint">生成新的图片素材，保留原图、显示框和共享素材。</p>
    <fieldset disabled={busy} style={{border:0,padding:0}}>
      <ColorInput id="image-pixel-source" label="替换原颜色" value={sourceColor} onChange={setSourceColor}/>
      <ColorInput id="image-pixel-target" label="替换目标颜色" value={targetColor} onChange={setTargetColor}/>
      <BufferedInput label="颜色容差" type="number" value={tolerance} min={0} max={441} onCommit={value=>setTolerance(Number(value))}/>
      <button type="button" className="secondary-button" onClick={()=>void apply([{kind:'replace-color',sourceColor,targetColor,tolerance}])}>替换像素颜色</button>
      {dimensions?<>
        <p className="property-hint">原图尺寸：{asset!.width} × {asset!.height} 像素</p>
        {(['x','y','width','height'] as const).map(field=><BufferedInput key={field} label={`像素裁剪${({x:'左边',y:'上边',width:'宽',height:'高'})[field]}`} type="number" value={region[field]} min={field==='x'||field==='y'?0:1} step={1}
          onCommit={value=>setRegion(current=>({...current,[field]:Math.round(Number(value))}))}/>)}
        <button type="button" className="secondary-button" onClick={()=>void apply([{kind:'crop',region}])}>裁剪原图像素</button>
        {(['width','height'] as const).map(field=><BufferedInput key={field} label={`重采样${field==='width'?'宽':'高'}`} type="number" value={size[field]} min={1} step={1}
          onCommit={value=>setSize(current=>({...current,[field]:Math.round(Number(value))}))}/>)}
        <button type="button" className="secondary-button" onClick={()=>void apply([{kind:'resize',...size,method:'nearest-neighbor'}])}>重采样原图</button>
      </>:<p className="property-hint">缺少原图尺寸，仍可替换像素颜色；尺寸读取后可进行像素裁剪与重采样。</p>}
    </fieldset>
    {busy&&<p role="status">正在处理图片…</p>}{error&&<p role="alert">{error}</p>}
  </details>
}
