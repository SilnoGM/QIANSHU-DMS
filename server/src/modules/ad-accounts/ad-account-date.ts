/**
 * 广告账户日期口径。
 *
 * 消耗窗口只取「已完成」的自然日：今天的数据不完整，纳入会低估日均，
 * 进而把可持续天数算得偏高。
 */

const DAY_MS = 24 * 60 * 60 * 1_000

export const SPEND_WINDOW_DAYS = 7

const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatShanghaiDate(value: Date): string {
  return shanghaiDateFormatter.format(value)
}

/** 最近 7 个完整自然日（不含今天）。 */
export function resolveSpendWindow(now: Date): { startDate: string, endDate: string } {
  const todayStart = new Date(`${formatShanghaiDate(now)}T00:00:00+08:00`)
  const end = new Date(todayStart.getTime() - DAY_MS)
  const start = new Date(end.getTime() - (SPEND_WINDOW_DAYS - 1) * DAY_MS)

  return { startDate: formatShanghaiDate(start), endDate: formatShanghaiDate(end) }
}

/** @db.Date 列按 UTC 零点写入，避免服务器时区影响日期落点。 */
export function toSpendDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}
