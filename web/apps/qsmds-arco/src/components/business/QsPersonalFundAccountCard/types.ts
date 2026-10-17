/**
 * 个人资金账户卡片的展示模型。
 *
 * 字段与 `GET /api/fund-accounts/me` 的 `account` 对齐；组件不直接依赖
 * generated API 类型，便于组件库示例和后续页面用本地数据渲染。
 */
export interface QsPersonalFundAccountCardAccount {
  readonly id: string
  readonly currency: string
  readonly balance: string
  readonly userShareRate: string
  readonly shareRateUpdatedAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

export type QsPersonalFundAccountCardState = 'loading' | 'error' | 'empty' | 'ready'
