/**
 * 开票成本的纯计算：与后端 modules/invoice-requests/invoice-request.logic.ts 的同名常量、
 * 同一运算顺序保持一致（先除汇率、再乘费率、最后加邮寄费，向上取整发生在最后一步）。
 *
 * 前端只用于申请页的成本预估与审批页的结算预览；入账金额一律以服务端复算为准
 * （结算时按当时汇率冻结快照，界面值与重算值不一致会被拒绝）。
 */

/** 开票服务费率：与「全流程金流费率」0.7% 无关，是代开票方收取的独立费用。 */
export const INVOICE_SERVICE_FEE_RATE = 0.06

/** 挂号信邮寄费（人民币侧固定项）。 */
export const INVOICE_MAILING_FEE_CNY = 30

/**
 * 预估／入账成本（人民币）= 向上取整(总计 ÷ 汇率 × 0.06 + 30)。
 * 总计为台币整数，汇率是「1 人民币兑多少台币」；输入非法时返回 null，
 * 由调用方显示占位，避免展示按错误输入算出的数字。
 */
export function calculateEstimatedCostCny(totalAmount: number, foreignUnitsPerCny: number): number | null {
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    return null
  }
  if (!Number.isFinite(foreignUnitsPerCny) || foreignUnitsPerCny <= 0) {
    return null
  }
  return Math.ceil((totalAmount / foreignUnitsPerCny) * INVOICE_SERVICE_FEE_RATE + INVOICE_MAILING_FEE_CNY)
}
