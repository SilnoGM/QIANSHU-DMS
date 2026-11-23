import { Prisma } from '../../generated/prisma/client'
import {
  AD_ACCOUNT_BALANCE_ALERT_USD,
  resolveAverageDailySpend,
  resolveAvailableBalance,
  resolveCoveredDays,
  resolveSustainableDays,
  shouldAlertLowBalance,
} from './ad-account-balance'

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value)

describe('resolveAvailableBalance', () => {
  it('subtracts spent amount from spend cap', () => {
    expect(
      resolveAvailableBalance({
        spendCap: '100.01',
        amountSpent: '21.59',
        disabledTransferAmount: '0.00',
      })?.toFixed(2),
    ).toBe('78.42')
  })

  it('subtracts disabled transfer amount only when positive', () => {
    expect(
      resolveAvailableBalance({
        spendCap: '100.00',
        amountSpent: '21.59',
        disabledTransferAmount: '10.00',
      })?.toFixed(2),
    ).toBe('68.41')

    expect(
      resolveAvailableBalance({
        spendCap: '100.00',
        amountSpent: '21.59',
        disabledTransferAmount: '0.00',
      })?.toFixed(2),
    ).toBe('78.41')
  })

  it('keeps negative balance as overspend instead of clamping to zero', () => {
    expect(
      resolveAvailableBalance({
        spendCap: '100.00',
        amountSpent: '120.50',
        disabledTransferAmount: '0.00',
      })?.toFixed(2),
    ).toBe('-20.50')
  })

  it('returns null for accounts without a spend cap', () => {
    expect(
      resolveAvailableBalance({
        spendCap: '0.00',
        amountSpent: '0.00',
        disabledTransferAmount: '0.00',
      }),
    ).toBeNull()
  })

  it('uses decimal arithmetic instead of floating point', () => {
    expect(
      resolveAvailableBalance({
        spendCap: '0.30',
        amountSpent: '0.10',
        disabledTransferAmount: '0.00',
      })?.toFixed(2),
    ).toBe('0.20')
  })
})

describe('resolveCoveredDays', () => {
  const now = new Date('2026-11-22T10:00:00+08:00')

  it('caps the window at seven days for established accounts', () => {
    expect(resolveCoveredDays(new Date('2026-09-01T00:00:00+08:00'), now, 7)).toBe(7)
  })

  it('uses elapsed days for accounts opened inside the window', () => {
    expect(resolveCoveredDays(new Date('2026-11-20T10:00:00+08:00'), now, 7)).toBe(2)
  })

  it('never returns less than one day', () => {
    expect(resolveCoveredDays(new Date('2026-11-22T09:30:00+08:00'), now, 7)).toBe(1)
  })
})

describe('resolveAverageDailySpend', () => {
  it('divides total spend by covered days', () => {
    expect(resolveAverageDailySpend(decimal('20.58'), 7).toFixed(2)).toBe('2.94')
  })

  it('rounds to two decimals', () => {
    expect(resolveAverageDailySpend(decimal('10.00'), 3).toFixed(2)).toBe('3.33')
  })

  it('returns zero when there is no spend', () => {
    expect(resolveAverageDailySpend(decimal('0.00'), 7).toFixed(2)).toBe('0.00')
  })
})

describe('resolveSustainableDays', () => {
  it('returns zero for exhausted accounts even when average spend is zero', () => {
    expect(resolveSustainableDays({ availableBalance: decimal('0.00'), averageDailySpend: decimal('0.00') })).toBe(0)
  })

  it('returns zero for overspent accounts', () => {
    expect(resolveSustainableDays({ availableBalance: decimal('-20.50'), averageDailySpend: decimal('5.00') })).toBe(0)
  })

  it('returns null when the account does not spend', () => {
    expect(resolveSustainableDays({ availableBalance: decimal('78.42'), averageDailySpend: decimal('0.00') })).toBeNull()
  })

  it('returns null when available balance cannot be computed', () => {
    expect(resolveSustainableDays({ availableBalance: null, averageDailySpend: decimal('5.00') })).toBeNull()
  })

  it('floors the ratio', () => {
    expect(resolveSustainableDays({ availableBalance: decimal('78.42'), averageDailySpend: decimal('2.94') })).toBe(26)
    expect(resolveSustainableDays({ availableBalance: decimal('32.93'), averageDailySpend: decimal('39.54') })).toBe(0)
  })
})

describe('shouldAlertLowBalance', () => {
  const base = { vendorMissing: false }

  it('alerts below the threshold', () => {
    expect(shouldAlertLowBalance({ ...base, availableBalance: decimal('29.99') })).toBe(true)
  })

  it('does not alert exactly at the threshold', () => {
    expect(shouldAlertLowBalance({ ...base, availableBalance: decimal(String(AD_ACCOUNT_BALANCE_ALERT_USD)) })).toBe(false)
  })

  it('alerts for zero and negative balances', () => {
    expect(shouldAlertLowBalance({ ...base, availableBalance: decimal('0.00') })).toBe(true)
    expect(shouldAlertLowBalance({ ...base, availableBalance: decimal('-1.00') })).toBe(true)
  })

  it('does not alert accounts without a spend cap', () => {
    expect(shouldAlertLowBalance({ ...base, availableBalance: null })).toBe(false)
  })

  it('does not alert when vendor data is missing', () => {
    expect(shouldAlertLowBalance({ vendorMissing: true, availableBalance: decimal('1.00') })).toBe(false)
  })
})
