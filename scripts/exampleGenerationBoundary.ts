import { promises as fs } from 'node:fs'
import path from 'node:path'

export type GeneratedExampleOutputs = Readonly<Record<string, Uint8Array>>

// 生成器把 checkout 文本原样嵌入产物前必须先归一化换行，
// 否则 Windows core.autocrlf=true 的 fresh checkout 会改变 tracked fixture 字节。
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index])
}

interface ZipLocalCalendarFields {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
  seconds: number
}

/**
 * ZIP 条目头里的 DOS 时间戳由 fflate 从 mtime 的**本地**日历分量推导
 * (`getFullYear()` … `getSeconds()`)，所以直接把一个绝对时刻交给它，
 * 每个时区都会写出不同的头字节。嵌套归档还会级联放大：内层
 * `.h5component` 字节变了，`project.json` 里记录的 provenance `sha256`
 * 随之变化，外层 `.h5lesson` 的 DEFLATE 输出又变一次。
 *
 * 这里返回的日期改为固定**本地**分量：业务时刻的 UTC 日历日 + 本地正午。
 * 取正午而非午夜，是为了避开午夜附近 DST 规则可能把墙钟归一化掉的窗口。
 * 结果只用于 ZIP 封装；`createdAt`/`updatedAt`/`importedAt` 等写进工程数据
 * 的业务字段继续使用 UTC ISO 时刻，语义保持无歧义。
 *
 * @param businessInstantIso 生成器的 UTC ISO 业务时刻，例如
 *   `2026-07-20T00:00:00.000Z`。必须能原样往返 `Date`，否则不带时区的字面量
 *   会在这一步重新引入时区依赖。
 */
export function createTimezoneStableZipMtime(businessInstantIso: string): Date {
  const instant = new Date(businessInstantIso)
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== businessInstantIso) {
    throw new Error(
      `ZIP 时间必须来自可原样往返的 UTC ISO 时刻，收到：${businessInstantIso}`,
    )
  }
  const expected: ZipLocalCalendarFields = {
    year: instant.getUTCFullYear(),
    month: instant.getUTCMonth() + 1,
    day: instant.getUTCDate(),
    hours: 12,
    minutes: 0,
    seconds: 0,
  }
  const mtime = new Date(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hours,
    expected.minutes,
    expected.seconds,
    0,
  )
  const observed: ZipLocalCalendarFields = {
    year: mtime.getFullYear(),
    month: mtime.getMonth() + 1,
    day: mtime.getDate(),
    hours: mtime.getHours(),
    minutes: mtime.getMinutes(),
    seconds: mtime.getSeconds(),
  }
  // 兜底：只有诡异的 DST 规则才会把选定的墙钟挪走，那时应当让生成失败，
  // 而不是静默产出依赖时区的字节。
  for (const key of Object.keys(expected) as Array<keyof ZipLocalCalendarFields>) {
    if (observed[key] !== expected[key]) {
      throw new Error(
        `ZIP 时间在 ${process.env.TZ ?? '宿主时区'} 下不稳定：`
        + `期望本地 ${JSON.stringify(expected)}，实际 ${JSON.stringify(observed)}`,
      )
    }
  }
  return mtime
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
