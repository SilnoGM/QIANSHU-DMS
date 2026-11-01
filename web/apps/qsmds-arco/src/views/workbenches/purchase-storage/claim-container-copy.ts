import type { ShipmentStorageClaimContainerChangeDto } from '@/api/generated/types.gen'

interface RecipientGroup {
  readonly containerBatchId: string
  readonly containerBatchName: string
  readonly lines: readonly string[]
  readonly marks: string[]
  firstLine: number
}

interface CodGroup {
  readonly containerBatchId: string
  readonly containerBatchName: string
  readonly lines: readonly string[]
  readonly cancel: boolean
  readonly marks: string[]
  firstLine: number
}

function formatCodAmount(value: string | null): string {
  // 与海运柜次页保持一致：去掉无意义的全零小数，不引入千分位。
  return value === null ? '无代收' : `NT$ ${value.replace(/\.0+$/u, '')}`
}

function recipientChangeLines(change: ShipmentStorageClaimContainerChangeDto): string[] {
  return [
    change.beforeRecipientName !== change.afterRecipientName
      ? `客户姓名改为：${change.afterRecipientName}`
      : null,
    change.beforeRecipientPhone !== change.afterRecipientPhone
      ? `客户电话改为：${change.afterRecipientPhone}`
      : null,
    change.beforeRecipientAddress !== change.afterRecipientAddress
      ? `收件地址改为：${change.afterRecipientAddress}`
      : null,
  ].filter((value): value is string => value !== null)
}

function codChangeLines(change: ShipmentStorageClaimContainerChangeDto): {
  cancel: boolean
  lines: string[]
} {
  if (change.afterCodAmountTwd === null) {
    return {
      cancel: true,
      lines: [`原代收：${formatCodAmount(change.beforeCodAmountTwd)}，取消代收`],
    }
  }
  return {
    cancel: false,
    lines: [
      `原代收：${formatCodAmount(change.beforeCodAmountTwd)}`,
      `新代收改为：${formatCodAmount(change.afterCodAmountTwd)}`,
    ],
  }
}

function addMark(group: { marks: string[] }, mark: string): void {
  // 同一唛头可能被重复行引用；复制文案按唛头去重，避免出现“J-1、J-1”。
  if (!group.marks.includes(mark)) {
    group.marks.push(mark)
  }
}

function groupKey(batchId: string, lines: readonly string[]): string {
  return `${batchId}\u0000${JSON.stringify(lines)}`
}

function recipientBlock(group: RecipientGroup): string {
  return [
    '‼️【收件人信息修改】',
    `柜次：${group.containerBatchName}`,
    `唛头：${group.marks.join('、')}`,
    '',
    ...group.lines,
  ].join('\n')
}

function codBlock(group: CodGroup): string {
  return [
    group.cancel ? '‼️【代收款取消】' : '‼️【代收款修改】',
    `柜次：${group.containerBatchName}`,
    `唛头：${group.marks.join('、')}`,
    '',
    ...group.lines,
  ].join('\n')
}

/**
 * 按装柜明细行顺序生成文案；同一柜次、同一修改内容的连续行合并唛头。
 * 收件人按“发生变化的字段 + 修改后值”分组；COD 按“修改前后值”分组。
 */
export function buildClaimContainerCopyText(
  changes: readonly ShipmentStorageClaimContainerChangeDto[],
): string {
  const ordered = [...changes].sort((left, right) => left.lineNumber - right.lineNumber)
  const recipientGroups = new Map<string, RecipientGroup>()
  const codGroups = new Map<string, CodGroup>()

  for (const change of ordered) {
    const mark = change.oceanShippingMarkText?.trim() || '—'
    if (change.recipientChanged) {
      const lines = recipientChangeLines(change)
      if (lines.length > 0) {
        const key = groupKey(change.containerBatchId, lines)
        const group = recipientGroups.get(key) ?? {
          containerBatchId: change.containerBatchId,
          containerBatchName: change.containerBatchName,
          firstLine: change.lineNumber,
          lines,
          marks: [],
        }
        group.firstLine = Math.min(group.firstLine, change.lineNumber)
        addMark(group, mark)
        recipientGroups.set(key, group)
      }
    }
    if (change.codChanged) {
      const cod = codChangeLines(change)
      const key = groupKey(change.containerBatchId, cod.lines)
      const group = codGroups.get(key) ?? {
        cancel: cod.cancel,
        containerBatchId: change.containerBatchId,
        containerBatchName: change.containerBatchName,
        firstLine: change.lineNumber,
        lines: cod.lines,
        marks: [],
      }
      group.firstLine = Math.min(group.firstLine, change.lineNumber)
      addMark(group, mark)
      codGroups.set(key, group)
    }
  }

  const blocks = [
    ...[...recipientGroups.values()].map(group => ({
      firstLine: group.firstLine,
      kind: 'recipient' as const,
      text: recipientBlock(group),
    })),
    ...[...codGroups.values()].map(group => ({
      firstLine: group.firstLine,
      kind: 'cod' as const,
      text: codBlock(group),
    })),
  ].sort((left, right) => (
    left.firstLine - right.firstLine
    || (left.kind === right.kind ? 0 : left.kind === 'recipient' ? -1 : 1)
  ))

  return blocks.map(block => block.text).join('\n\n')
}
