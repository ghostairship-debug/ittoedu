interface ZipLocalCalendarFields {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
  seconds: number
}

/**
 * fflate encodes ZIP DOS timestamps from local calendar fields. Convert a
 * canonical UTC business instant into stable local-noon fields so the same
 * archive can be produced in every host timezone without changing business
 * timestamps stored inside the document.
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
  for (const key of Object.keys(expected) as Array<keyof ZipLocalCalendarFields>) {
    if (observed[key] !== expected[key]) {
      throw new Error(
        `ZIP 时间在宿主时区下不稳定：`
        + `期望本地 ${JSON.stringify(expected)}，实际 ${JSON.stringify(observed)}`,
      )
    }
  }
  return mtime
}
