import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  calculateOceanBill, calculateOceanCharge, calculateOceanLine, calculateOceanVolume,
} from '../ocean-freight-calculation/ocean-freight-calculation'
import { effectiveOceanCodAmount } from './ocean-freight-cod-source'

const decimalText = (value: Prisma.Decimal | null) => value === null ? null : value.toFixed()

function differs(current: Record<string, unknown>, next: Record<string, string | number | null>) {
  return Object.entries(next).some(([field, value]) => {
    const previous = current[field]
    if (previous === null || value === null) return previous !== value
    return Prisma.Decimal.isDecimal(previous) ? !previous.equals(value) : previous !== value
  })
}

@Injectable()
export class OceanFreightBillCalculationService {
  async recalculateInTransaction(tx: Prisma.TransactionClient, billId: string): Promise<void> {
    // 所有影响账单计算的写入须先锁账单，再按同一顺序锁明细和费用，避免并发重算读到半次修改。
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ocean_freight_bills WHERE id = ${billId}::uuid FOR UPDATE`)
    const bill = await tx.oceanFreightBill.findUnique({ where: { id: billId } })
    if (!bill) throw new ApiException(404, 'OCEAN_FREIGHT_BILL_NOT_FOUND', '海运账单不存在')
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ocean_freight_bill_lines WHERE bill_id = ${billId}::uuid ORDER BY line_number, id FOR UPDATE`)
    await tx.$queryRaw(Prisma.sql`SELECT c.id FROM ocean_freight_bill_charges c
      JOIN ocean_freight_bill_lines l ON l.id = c.bill_line_id
      WHERE l.bill_id = ${billId}::uuid ORDER BY l.line_number, l.id, c.id FOR UPDATE OF c`)
    const lines = await tx.oceanFreightBillLine.findMany({
      where: { billId }, orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
      include: { charges: { orderBy: { id: 'asc' } } },
    })
    // 对账确认后的数字属于冻结事实；后续撤回或重开流程必须先明确解除确认，不能由重算隐式覆盖。
    if (lines.some(line => line.reconciliationStatus === 'CONFIRMED')) {
      throw new ApiException(409, 'OCEAN_FREIGHT_BILL_STATE_CHANGED', '账单包含已确认明细，不能重新计算')
    }
    const twdPerCny = bill.twdPerCny.toFixed()
    const calculatedLines = lines.map(line => {
      const volume = calculateOceanVolume({
        lengthCm: decimalText(line.lengthCm), widthCm: decimalText(line.widthCm), heightCm: decimalText(line.heightCm),
        packageCount: line.packageCount, reportedVolumeCai: decimalText(line.reportedVolumeCai),
      })
      const charges = line.charges.map(charge => ({
        original: charge,
        result: calculateOceanCharge({
          pricingBasis: charge.pricingBasis, chargeNature: charge.chargeNature, currencyCode: charge.currencyCode,
          // 计重、计材的历史 amount/quantity 都是派生值，必须丢弃；固定费用才以保存金额作为输入。
          amount: charge.pricingBasis === 'FIXED' ? charge.amount.toFixed() : null,
          unitPriceAmount: decimalText(charge.unitPriceAmount), reportedAmount: decimalText(charge.reportedAmount),
        }, { grossWeightKg: decimalText(line.grossWeightKg), chargeableVolumeCai: volume.chargeableVolumeCai }),
      }))
      const input = {
        codAmountTwd: effectiveOceanCodAmount(line.sourceData, decimalText(line.codAmountTwd), line.lineType),
        // 当前空集合表示尚未录入费用。明确零费用应保存一条固定金额为 0 的费用，不能把缺值视作免费。
        charges: charges.length === 0 ? null : charges.map(charge => charge.result),
      }
      const money = calculateOceanLine({ ...input, twdPerCny })
      return {
        original: line, charges, input,
        data: {
          volumeCai: volume.volumeCai, chargeableVolumeCai: volume.chargeableVolumeCai,
          chargeTotalAmountTwd: money.chargeTotalAmountTwd, payableAmountCny: money.payableAmountCny,
          returnAmountCny: money.returnAmountCny, netReturnAmountCny: money.netReturnAmountCny,
        },
      }
    })
    // 先完成全部行及合计校验，再写派生字段；来源快照、上报值和原始 COD 均不被重算修改。
    const totals = calculateOceanBill({ lines: calculatedLines.map(line => line.input), twdPerCny })
    for (const line of calculatedLines) {
      for (const charge of line.charges) {
        const data = { amount: charge.result.amount, chargeableQuantity: charge.result.chargeableQuantity }
        if (differs(charge.original, data)) {
          await tx.oceanFreightBillCharge.update({ where: { id: charge.original.id }, data })
        }
      }
      if (differs(line.original, line.data)) {
        await tx.oceanFreightBillLine.update({ where: { id: line.original.id }, data: { ...line.data, version: { increment: 1 } } })
      }
    }
    // 这是调用方事务内的内部能力：调用方负责整次业务变更的账单版本与操作人，避免一次命令重复增加版本。
    if (differs(bill, totals)) await tx.oceanFreightBill.update({ where: { id: billId }, data: totals })
  }
}
