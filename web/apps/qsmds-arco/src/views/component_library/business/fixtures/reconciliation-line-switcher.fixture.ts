import type {
  QsReconciliationLineSwitcherItem,
  QsReconciliationLineSwitcherTone,
} from '@/components/business/QsReconciliationLineSwitcher/types'

/**
 * 组件库示例数据：只服务展示与调试，任何正式页面都不得引用本文件。
 * 状态取值与状态色都在这里定义，用来证明组件本身不内置任何状态字面量。
 */
export const RECONCILIATION_LINE_SWITCHER_STATUS_TONES: Readonly<Record<string, QsReconciliationLineSwitcherTone>> = {
  未核对: 'danger',
  已核对: 'success',
}

/** 正式域用状态码而非中文取值，示例同样给一份带 statusLabel 的映射。 */
export const RECONCILIATION_LINE_SWITCHER_CODE_TONES: Readonly<Record<string, QsReconciliationLineSwitcherTone>> = {
  PENDING: 'danger',
  REVIEWING: 'warning',
  RECONCILED: 'success',
}

function createItems(rows: readonly (readonly [string, string, string])[]): readonly QsReconciliationLineSwitcherItem[] {
  return rows.map(([value, label, status]) => ({ value, label, status }))
}

export const RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS = createItems([
  ['LH-20261009-001', 'J-070924', '已核对'],
  ['LH-20261009-002', 'H-080334', '未核对'],
  ['LH-20261009-003', 'J-070925', '未核对'],
  ['LH-20261009-004', 'K-090117', '已核对'],
  ['LH-20261009-005', 'H-080335', '未核对'],
  ['LH-20261009-006', 'M-110482', '已核对'],
  ['LH-20261009-007', 'J-070926', '未核对'],
  ['LH-20261009-008', 'P-120733', '已核对'],
  ['LH-20261009-009', 'H-080336', '未核对'],
  ['LH-20261009-010', 'K-090118', '已核对'],
  ['LH-20261009-011', 'M-110483', '未核对'],
  ['LH-20261009-012', 'P-120734', '未核对'],
])

/** 恰好 7 条：条带刚好铺满且不留空档。 */
export const RECONCILIATION_LINE_SWITCHER_EXACT_ITEMS = createItems([
  ['LH-20261009-001', 'J-070924', '已核对'],
  ['LH-20261009-002', 'H-080334', '未核对'],
  ['LH-20261009-003', 'J-070925', '未核对'],
  ['LH-20261009-004', 'K-090117', '已核对'],
  ['LH-20261009-005', 'H-080335', '未核对'],
  ['LH-20261009-006', 'M-110482', '已核对'],
  ['LH-20261009-007', 'J-070926', '未核对'],
])

/** 少于条带槽位数：条带只显示实际存在的项。 */
export const RECONCILIATION_LINE_SWITCHER_SHORT_ITEMS = createItems([
  ['LH-20261009-001', 'J-070924', '未核对'],
  ['LH-20261009-002', 'H-080334', '已核对'],
  ['LH-20261009-003', 'J-070925', '未核对'],
])

export const RECONCILIATION_LINE_SWITCHER_SINGLE_ITEMS = createItems([
  ['LH-20261009-001', 'J-070924', '未核对'],
])

/** 状态码取值 + 中文朗读文案，含一个未在 statusTones 中登记的状态用于验证中性回落。 */
export const RECONCILIATION_LINE_SWITCHER_CODE_ITEMS: readonly QsReconciliationLineSwitcherItem[] = [
  { value: 'LH-20261009-001', label: 'J-070924', status: 'RECONCILED', statusLabel: '已核对' },
  { value: 'LH-20261009-002', label: 'H-080334', status: 'REVIEWING', statusLabel: '核对中' },
  { value: 'LH-20261009-003', label: 'J-070925', status: 'PENDING', statusLabel: '未核对' },
  { value: 'LH-20261009-004', label: 'K-090117', status: 'ARCHIVED', statusLabel: '已归档' },
]

export const RECONCILIATION_LINE_SWITCHER_EMPTY_ITEMS: readonly QsReconciliationLineSwitcherItem[] = []
