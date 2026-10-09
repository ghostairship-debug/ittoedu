import path from 'node:path'
import { promises as fs } from 'node:fs'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

/** Convert the generated artwork into the application's PNG and Windows ICO. */
async function main(): Promise<void> {
  const directory = path.resolve('resources', 'icons')
  const source = await fs.readFile(path.join(directory, 'icon-source.png'))
  const pngPath = path.join(directory, 'icon.png')
  await fs.writeFile(pngPath, await sharp(source).resize(1024, 1024, { fit: 'contain' }).png({ compressionLevel: 9 }).toBuffer())
  const images = await Promise.all([256, 128, 64, 48, 32, 16].map(size =>
    sharp(source).resize(size, size, { fit: 'contain' }).png({ compressionLevel: 9 }).toBuffer()))
  await fs.writeFile(path.join(directory, 'icon.ico'), await pngToIco(images))
  console.log(`已生成果铃工作台图标：${pngPath}`)
}

main().catch(error => { console.error('图标转换失败', error); process.exitCode = 1 })
