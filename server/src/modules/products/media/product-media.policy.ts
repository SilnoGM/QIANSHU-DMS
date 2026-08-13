import { MediaType } from '../../../generated/prisma/enums'

/**
 * Product 领域只允许图片和视频；DOCUMENT 属于 MediaAsset 基础能力，不能由 Product 策略放行。
 * 该策略留在 Product 领域，避免业务中立的 MediaAssetService 反向依赖 Product。
 */
export const PRODUCT_MEDIA_ALLOWED_TYPES: readonly MediaType[] = Object.freeze([
  MediaType.IMAGE,
  MediaType.VIDEO,
])
