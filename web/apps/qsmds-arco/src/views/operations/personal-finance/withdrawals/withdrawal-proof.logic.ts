import type { FundWithdrawalDto } from '@/api/generated/types.gen'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'

/**
 * 付款截图走提款专属的私有内容路由，不经通用媒体键。
 * 列表缩略位与预览使用同一地址；服务端按当前会话校验本人归属。
 */
function resolveWithdrawalProofUrl(id: string): string {
  return `/api/fund-withdrawals/me/${encodeURIComponent(id)}/payment-proof`
}

/** 运营列表的付款截图列：未审批通过的单据没有截图时返回空数组，由 ImageGroup 显示占位。 */
export function buildWithdrawalProofItems(
  row: Pick<FundWithdrawalDto, 'id' | 'paymentProof'>,
  label: string,
): ImageGroupItem[] {
  const proof = row.paymentProof
  if (proof == null) {
    return []
  }
  const src = resolveWithdrawalProofUrl(row.id)
  return [{
    alt: label,
    key: proof.mediaAssetId,
    previewSrc: src,
    src,
    tooltip: proof.fileName,
  }]
}
