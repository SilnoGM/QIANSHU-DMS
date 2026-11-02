import type { ContainerSwapContextDto, ContainerSwapRequestDto } from '../../../api/generated/types.gen'

export interface ContainerMarkSource {
  readonly shippingMarkText: string | null
  readonly containerLoadingMarks: readonly string[]
}

/** 多行装柜唛头只展示首个，其余用“+ N项”折叠；完整列表由 title 承载。 */
export function loadingMarkSummary(marks: readonly string[]): string {
  const values = marks.map(mark => mark.trim()).filter(Boolean)
  if (values.length === 0) {
    return ''
  }
  if (values.length === 1) {
    return values[0] ?? ''
  }
  return `${values[0]} + ${values.length - 1}项`
}

export function containerMarkDisplay(input: ContainerMarkSource): string {
  const marks = input.containerLoadingMarks.map(mark => mark.trim()).filter(Boolean)
  const shippingMark = input.shippingMarkText?.trim() ?? ''
  const summary = loadingMarkSummary(marks)
  const showShippingMark = shippingMark !== '' && !marks.includes(shippingMark)
  return [summary, showShippingMark ? shippingMark : ''].filter(Boolean).join(' · ') || '—'
}

export function containerMarkTitle(input: ContainerMarkSource): string {
  const marks = input.containerLoadingMarks.map(mark => mark.trim()).filter(Boolean)
  const shippingMark = input.shippingMarkText?.trim() ?? ''
  return [marks.join('、'), shippingMark !== '' && !marks.includes(shippingMark) ? shippingMark : '']
    .filter(Boolean)
    .join(' · ') || '—'
}

/** 手工 COD 允许为空（无代收）；非空时必须是非负、最多 28 位整数和 2 位小数。 */
export function isValidSwapCod(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '' || /^\d{1,28}(?:\.\d{1,2})?$/u.test(trimmed)
}

export function swapCodDrafts(context: ContainerSwapContextDto): Record<string, string> {
  return Object.fromEntries(
    [...context.left.containerLoadingItems, ...context.right.containerLoadingItems]
      .map(line => [line.id, line.codAmountTwd ?? '']),
  )
}

export function swapCodTotal(lines: readonly { readonly codAmountTwd: string | null }[]): string {
  const total = lines.reduce((sum, line) => sum + Number(line.codAmountTwd ?? 0), 0)
  return total.toFixed(2)
}

export function buildSwapRequest(input: {
  readonly leftShipmentId: string
  readonly rightShipmentId: string
  readonly context: ContainerSwapContextDto
  readonly codDrafts: Readonly<Record<string, string>>
  readonly note: string
}): ContainerSwapRequestDto {
  const lineInput = (line: ContainerSwapContextDto['left']['containerLoadingItems'][number]) => {
    const cod = input.codDrafts[line.id]?.trim() ?? ''
    return {
      loadingItemId: line.id,
      expectedVersion: line.version,
      codAmountTwd: cod === '' ? null : cod,
    }
  }
  return {
    leftShipmentId: input.leftShipmentId,
    rightShipmentId: input.rightShipmentId,
    leftLines: input.context.left.containerLoadingItems.map(lineInput),
    rightLines: input.context.right.containerLoadingItems.map(lineInput),
    note: input.note.trim() || null,
  }
}
