import { resolveSlhBillArchiveDefaults } from './slh-bill-archive'

// 文件名取自两份真实对账单；期间结束日期取自解析结果。
describe('slh bill archive defaults', () => {
  it('derives the name from the file name and the month from the period end', () => {
    expect(resolveSlhBillArchiveDefaults({
      periodEnd: '2026-01-16',
      sourceFileName: '1月账单（3）千树贸易账单.xlsx',
    })).toEqual({ billName: '1月账单（3）千树贸易账单', billMonth: '2026-01' })
  })

  it('uses the period end month even when the file name month differs', () => {
    // 十二月开柜、次年一月结账的账单：期间结束月才是账单所属月份。
    expect(resolveSlhBillArchiveDefaults({
      periodEnd: '2026-08-11',
      sourceFileName: '8月账单（2）千树贸易账单.xlsx',
    })).toEqual({ billName: '8月账单（2）千树贸易账单', billMonth: '2026-08' })
  })

  it('falls back to the file name month when the period date is unusable', () => {
    expect(resolveSlhBillArchiveDefaults({
      now: new Date('2026-09-27T00:00:00Z'),
      periodEnd: '',
      sourceFileName: '1月账单（3）千树贸易账单.xlsx',
    }).billMonth).toBe('2026-01')
  })

  it('leaves the month empty when neither source yields one', () => {
    expect(resolveSlhBillArchiveDefaults({
      now: new Date('2026-09-27T00:00:00Z'),
      periodEnd: '',
      sourceFileName: '账单.xlsx',
    }).billMonth).toBe('')
  })

  it('rejects an impossible month in the period date', () => {
    expect(resolveSlhBillArchiveDefaults({
      now: new Date('2026-09-27T00:00:00Z'),
      periodEnd: '2026-13-01',
      sourceFileName: '7月账单.xlsx',
    }).billMonth).toBe('2026-07')
  })

  it('keeps a name without extension intact and truncates an over-long one', () => {
    expect(resolveSlhBillArchiveDefaults({ periodEnd: '2026-01-16', sourceFileName: '对账单' }).billName).toBe('对账单')
    expect(resolveSlhBillArchiveDefaults({
      periodEnd: '2026-01-16',
      sourceFileName: `${'长'.repeat(240)}.xlsx`,
    }).billName).toHaveLength(200)
  })
})
