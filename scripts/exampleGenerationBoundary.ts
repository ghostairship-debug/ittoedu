import { promises as fs } from 'node:fs'
import path from 'node:path'

export type GeneratedExampleOutputs = Readonly<Record<string, Uint8Array>>

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index])
}

export async function checkTrackedExampleOutputs(
  outputDirectory: string,
  outputs: GeneratedExampleOutputs,
  label: string,
): Promise<void> {
  for (const relativePath of Object.keys(outputs).sort()) {
    const expected = outputs[relativePath]
    if (!expected) throw new Error(`${label} 缺少预期输出：${relativePath}`)
    const outputPath = path.join(outputDirectory, relativePath)
    let actual: Uint8Array
    try {
      actual = new Uint8Array(await fs.readFile(outputPath))
    } catch (error) {
      throw new Error(
        `${label} 缺少 tracked fixture：${relativePath}；请运行 npm run refresh:examples`,
        { cause: error },
      )
    }
    if (!equalBytes(actual, expected)) {
      throw new Error(
        `${label} fixture 已过期：${relativePath}；请运行 npm run refresh:examples`,
      )
    }
    console.log(`OK\t${relativePath}\t${actual.byteLength} bytes`)
  }
}
