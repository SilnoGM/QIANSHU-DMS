import { Prisma } from '../../generated/prisma/client'

/**
 * 开票申请的纯计算与判断：服务端写路径、列表展示与测试共用这一份口径。
 *
 * 金额约定：台币金额一律整数元（票面即整数）；入账成本是人民币，向上取整到整数后再按
 * 资金域的两位小数格式入账。所有运算走整数或十进制定点，不经过浮点。
 */

/** 营业税一般税率（固定项）。 */
export const INVOICE_TAX_RATE_PERCENT = 5

/** 开票服务费率：与「全流程金流费率」0.7% 无关，是代开票方收取的独立费用。 */
export const INVOICE_SERVICE_FEE_RATE = '0.06'

/** 邮寄费（人民币侧，固定项）。 */
export const INVOICE_MAILING_FEE_CNY = 30

/** 可结算等待期：自发票照片上传起满 120 小时。 */
export const INVOICE_SETTLE_WAIT_HOURS = 120

/** 营业税应税 = 四舍五入(销售额 × 5%)；整数运算，销售额 1 元时为 0。 */
export function calculateTaxAmount(salesAmount: number): number {
  return Math.floor((salesAmount * INVOICE_TAX_RATE_PERCENT + 50) / 100)
}

/** 明细行金额合计；每行金额必须等于数量 × 单价（数据库侧另有同一条 CHECK）。 */
export function sumLineAmounts(
  lines: readonly { readonly quantity: number, readonly unitPrice: number }[],
): number {
  return lines.reduce((total, line) => total + line.quantity * line.unitPrice, 0)
}

/** 可结算时刻 = 上传时刻 + 120 小时。 */
export function resolveSettleableAt(documentUploadedAt: Date): Date {
  return new Date(documentUploadedAt.getTime() + INVOICE_SETTLE_WAIT_HOURS * 3_600_000)
}

/** 满 120 小时（含恰好整点）即可结算；未上传照片时恒为不可结算。 */
export function isSettleable(documentUploadedAt: Date | null, now: Date): boolean {
  if (documentUploadedAt === null) {
    return false
  }
  return now.getTime() >= resolveSettleableAt(documentUploadedAt).getTime()
}

/**
 * 入账成本 = 向上取整(总计 ÷ 汇率 × 0.06 + 30)。
 * 严格按「先除汇率、再乘费率、最后加邮寄费」的顺序执行，结果按资金域口径给两位小数。
 */
export function calculateSettleAmountCny(
  totalAmount: bigint,
  foreignUnitsPerCny: Prisma.Decimal,
): string {
  return new Prisma.Decimal(totalAmount.toString())
    .div(foreignUnitsPerCny)
    .mul(INVOICE_SERVICE_FEE_RATE)
    .plus(INVOICE_MAILING_FEE_CNY)
    .ceil()
    .toFixed(2)
}

/** 完整算式文本，供结算弹窗与审计说明使用（保留计算顺序，便于人工复核）。 */
export function describeSettleFormula(
  totalAmount: bigint,
  foreignUnitsPerCny: Prisma.Decimal,
): string {
  return [
    '总计 ',
    totalAmount.toString(),
    ' ÷ 汇率 ',
    foreignUnitsPerCny.toString(),
    ' × 0.06 + 30 = ',
    calculateSettleAmountCny(totalAmount, foreignUnitsPerCny),
  ].join('')
}
