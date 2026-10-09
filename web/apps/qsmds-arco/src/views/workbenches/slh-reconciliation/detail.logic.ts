import type { SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'

/**
 * 复制用的成员清单：一行一条「明细行 ID · 品名 · 柜次名 #行号」。
 *
 * 明细行 ID 在前是因为它是这份清单的用途所在——创建时的范围比对、后续的核对动作
 * 都以它为准；其余两项只用来辨认这条 ID 是哪一行。文案与页面上的文字列表同形，
 * 保证「复制到的」和「看到的」一致。
 */
export function buildSlhReconciliationMemberListText(members: readonly SlhReconciliationBatchMemberDto[]): string {
  return members
    .map(member => [
      member.lineId,
      member.goodsName,
      `${member.matchedContainerBatchName} #${member.matchedLoadingItemLineNumber}`,
    ].join(' · '))
    .join('\n')
}
