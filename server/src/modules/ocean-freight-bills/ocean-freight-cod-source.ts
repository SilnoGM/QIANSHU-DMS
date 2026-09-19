import type { Prisma } from '../../generated/prisma/client'
import { ApiException } from '../../infrastructure/http/api.exception'
import { resolveOceanCod } from '../ocean-freight-calculation/ocean-freight-calculation'

type LineType = 'NORMAL' | 'ADJUSTMENT'
type Meaning = 'CURRENT' | 'HISTORICAL_REFERENCE' | 'UNRESOLVED'
const meanings: readonly string[] = ['CURRENT', 'HISTORICAL_REFERENCE', 'UNRESOLVED']
function invalid(): never { throw new ApiException(422, 'VALIDATION_FAILED', '请明确补费行代收金额是否属于本次有效代收') }

/** 原表可能把历史代收再次列在补费行，未明确说明时保留来源，不能重复参与返款。 */
export function prepareOceanCodSource(lineType: LineType, reportedCodAmountTwd: string | null, requested: unknown) {
  if (requested != null && (typeof requested !== 'string' || !meanings.includes(requested))) invalid()
  if (lineType === 'NORMAL' && requested != null && requested !== 'CURRENT') invalid()
  if (reportedCodAmountTwd === null && requested != null && requested !== 'UNRESOLVED') invalid()
  const meaning: Meaning = requested as Meaning | null | undefined
    ?? (lineType === 'NORMAL' || reportedCodAmountTwd !== null && /^0(?:\.0+)?$/u.test(reportedCodAmountTwd) ? 'CURRENT' : 'UNRESOLVED')
  const resolved = resolveOceanCod({ lineType, reportedCodAmountTwd, meaning })
  return {
    codAmountTwd: resolved.codAmountTwd,
    ...(lineType === 'ADJUSTMENT' ? { sourceData: { oceanFreightCod: { version: 1, meaning, reportedAmountTwd: resolved.reportedCodAmountTwd } } } : {}),
  }
}

export function readOceanCodSource(sourceData: Prisma.JsonValue | null | undefined, amount: string | null, lineType: LineType): { codSourceTreatment: Meaning; reportedCodAmountTwd: string | null } {
  const metadata = sourceData && typeof sourceData === 'object' && !Array.isArray(sourceData) ? sourceData.oceanFreightCod : null
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.version === 1
    && typeof metadata.meaning === 'string' && meanings.includes(metadata.meaning)
    && (metadata.reportedAmountTwd === null || typeof metadata.reportedAmountTwd === 'string')) {
    return { codSourceTreatment: metadata.meaning as Meaning, reportedCodAmountTwd: metadata.reportedAmountTwd }
  }
  // 兼容阶段 1 的来源缺省：正常行金额是明确本次值；补费非零金额缺少判断依据时保持待核实。
  return { codSourceTreatment: lineType === 'NORMAL' || amount !== null && /^0(?:\.0+)?$/u.test(amount) ? 'CURRENT' : 'UNRESOLVED', reportedCodAmountTwd: amount }
}

export function effectiveOceanCodAmount(sourceData: Prisma.JsonValue | null | undefined, amount: string | null, lineType: LineType): string | null {
  const { codSourceTreatment, reportedCodAmountTwd } = readOceanCodSource(sourceData, amount, lineType)
  if (codSourceTreatment === 'UNRESOLVED') return null
  if (codSourceTreatment === 'HISTORICAL_REFERENCE') return reportedCodAmountTwd === null ? null : '0.00'
  return amount
}
