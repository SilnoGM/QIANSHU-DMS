/**
 * 对账状态是「账单管理」与「账单对账」共用的桥：明细行二态、账单三态，
 * 两者取值不同但同源——账单三态只由明细行的对账情况汇总派生，不单独存储。
 * 本模块是这套取值的唯一定义处，接口层与派生逻辑都从这里取。
 */

/** 明细行对账状态：已对账由该行的对账时刻是否存在决定。 */
export type SlhBillLineReconciliationStatus = 'PENDING' | 'RECONCILED'

/** 账单对账状态：未对账 / 部分对账 / 对账完成。 */
export type SlhBillReconciliationStatus = 'PENDING' | 'PARTIAL' | 'COMPLETED'

export function resolveSlhBillLineReconciliationStatus(reconciledAt: Date | null): SlhBillLineReconciliationStatus {
  return reconciledAt === null ? 'PENDING' : 'RECONCILED'
}

/**
 * 账单三态由明细行汇总派生：一条都没对 → 未对账；全部对完 → 对账完成；中间 → 部分对账。
 * 明细行数为 0 时按未对账处理（账单必然有明细，此分支只作防御）；已对账行数多于总行数时按完成处理，
 * 避免脏数据把状态卡在「部分对账」。
 */
export function resolveSlhBillReconciliationStatus(input: { lineCount: number, reconciledLineCount: number }): SlhBillReconciliationStatus {
  if (input.reconciledLineCount <= 0) {
    return 'PENDING'
  }
  return input.reconciledLineCount >= input.lineCount ? 'COMPLETED' : 'PARTIAL'
}
