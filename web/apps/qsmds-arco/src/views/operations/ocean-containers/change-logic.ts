import type { OperationsOceanContainerLineDto } from '@/api/generated/types.gen'
import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

export type OceanChangeKind = 'RECIPIENT' | 'COD'
export type OceanChangeLine = OperationsOceanContainerLineDto
export interface OceanChangeDraft {
  recipientName: string | null
  recipientPhone: string | null
  recipientAddress: string | null
  remark: string | null
  codAmountTwd: string | null
}
export type OceanChangeValue
  = | { kind: 'RECIPIENT', recipientName: string | null, recipientPhone: string | null, recipientAddress: string | null, remark: string | null }
    | { kind: 'COD', codAmountTwd: string | null }
export type OceanChangeInput = OceanChangeValue & { requestKey: string, expectedVersion: number, notificationConfirmed: true }
export interface OceanChangeResult { line: OceanChangeLine, changeId: string }
export interface OceanUndoInput { requestKey: string, expectedVersion: number }
export const RECIPIENT_FIELDS = ['recipientName', 'recipientPhone', 'recipientAddress', 'remark'] as const
export const RECIPIENT_LIMITS = { recipientName: 128, recipientPhone: 128, recipientAddress: 2000, remark: 2000 } as const
export const OCEAN_COD_MAX = '9999999999999999999999999999.99'
const labels = { recipientName: '客户姓名', recipientPhone: '客户电话', recipientAddress: '收件地址', remark: '备注' } as const

export function oceanChangeDraft(line: OceanChangeDraft): OceanChangeDraft {
  return Object.fromEntries([...RECIPIENT_FIELDS, 'codAmountTwd'].map(key => [key, line[key as keyof OceanChangeDraft]])) as unknown as OceanChangeDraft
}

export function normalizeOceanChange(kind: OceanChangeKind, draft: OceanChangeDraft): { value?: OceanChangeValue, error?: string } {
  if (kind === 'COD') {
    const amount = validateMoneyString(draft.codAmountTwd === '' ? null : draft.codAmountTwd, { precision: 2, min: '0', max: OCEAN_COD_MAX })
    return amount.valid ? { value: { kind, codAmountTwd: amount.normalizedValue } } : { error: 'invalidAmount' }
  }
  if (RECIPIENT_FIELDS.some(key => /[\p{Cc}\p{Cs}]/u.test((draft[key] ?? '').replace(/[\n\r\t]/gu, '')))) {
    return { error: 'invalidText' }
  }
  const values = Object.fromEntries(RECIPIENT_FIELDS.map(key => [key, normalizeRecipientText(draft[key])])) as Omit<Extract<OceanChangeValue, { kind: 'RECIPIENT' }>, 'kind'>
  if (RECIPIENT_FIELDS.some(key => [...(values[key] ?? '')].length > RECIPIENT_LIMITS[key])) {
    return { error: 'textTooLong' }
  }
  return { value: { kind, ...values } }
}

export function oceanChangeDiff(line: OceanChangeLine, next: OceanChangeValue) {
  if (next.kind === 'COD') {
    const original = normalizeOceanChange('COD', line).value
    return [{ key: 'codAmountTwd', before: original?.kind === 'COD' ? original.codAmountTwd : line.codAmountTwd, after: next.codAmountTwd }]
  }
  return RECIPIENT_FIELDS.map(key => ({ key, before: normalizeRecipientText(line[key]), after: next[key] }))
}

function normalizeRecipientText(value: string | null): string | null {
  return value?.replace(/\r\n?/gu, '\n').trim() || null
}

export function buildOceanChangeText(containerName: string, line: OceanChangeLine, next: OceanChangeValue): string {
  const heading = [`【装柜明细${next.kind === 'RECIPIENT' ? '收件人信息' : '代收款'}修改】`, `柜次：${containerName}`, `海运唛头：${line.oceanShippingMarkText || '—'}`]
  if (next.kind === 'COD') {
    const before = normalizeOceanChange('COD', line).value
    const amount = before?.kind === 'COD' ? before.codAmountTwd : line.codAmountTwd
    return [...heading, '', `修改前：${amount === null ? '无代收' : `${amount} TWD`}`, `修改后：${next.codAmountTwd === null ? '取消代收' : `${next.codAmountTwd} TWD`}`].join('\n')
  }
  return [...heading, '', '【修改前】', ...RECIPIENT_FIELDS.map(key => `${labels[key]}：${normalizeRecipientText(line[key]) || '—'}`), '', '【修改后】', ...RECIPIENT_FIELDS.map(key => `${labels[key]}：${next[key] || (normalizeRecipientText(line[key]) ? '—（清空）' : '—')}`)].join('\n')
}
