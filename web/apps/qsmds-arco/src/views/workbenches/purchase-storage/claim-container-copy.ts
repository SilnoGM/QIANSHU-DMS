import type { ShipmentStorageClaimContainerChangeDto } from '@/api/generated/types.gen'

function formatCodAmount(value: string | null): string {
  // 与海运柜次页保持一致：去掉无意义的全零小数，不引入千分位。
  return value === null ? '无代收' : `NT$ ${value.replace(/\.0+$/u, '')}`
}

function recipientBlock(change: ShipmentStorageClaimContainerChangeDto): string | null {
  const changes = [
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
  if (changes.length === 0) {
    return null
  }
  return [
    '‼️【收件人信息修改】',
    `柜次：${change.containerBatchName}`,
    `唛头：${change.oceanShippingMarkText?.trim() || '—'}`,
    '',
    ...changes,
  ].join('\n')
}

function codBlock(change: ShipmentStorageClaimContainerChangeDto): string | null {
  if (!change.codChanged) {
    return null
  }
  const heading = [
    change.afterCodAmountTwd === null ? '‼️【代收款取消】' : '‼️【代收款修改】',
    `柜次：${change.containerBatchName}`,
    `唛头：${change.oceanShippingMarkText?.trim() || '—'}`,
    '',
  ]
  if (change.afterCodAmountTwd === null) {
    return [
      ...heading,
      `原代收：${formatCodAmount(change.beforeCodAmountTwd)}，取消代收`,
    ].join('\n')
  }
  return [
    ...heading,
    `原代收：${formatCodAmount(change.beforeCodAmountTwd)}`,
    `新代收改为：${formatCodAmount(change.afterCodAmountTwd)}`,
  ].join('\n')
}

/** 按装柜明细行顺序拼接；同一条明细先收件人、后 COD，段落间空行。 */
export function buildClaimContainerCopyText(
  changes: readonly ShipmentStorageClaimContainerChangeDto[],
): string {
  return [...changes]
    .sort((left, right) => left.lineNumber - right.lineNumber)
    .flatMap(change => [recipientBlock(change), codBlock(change)])
    .filter((block): block is string => block !== null)
    .join('\n\n')
}
