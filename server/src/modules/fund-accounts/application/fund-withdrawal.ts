/**
 * 用户提款域的受控资金来源与 consumer，常量放在资金模块内避免资金域反向依赖业务域。
 * 审批通过时只允许 USER_WITHDRAWAL 从申请人账户扣款；来源/consumer/类型均由服务端固定。
 */
export const FUND_WITHDRAWAL_FUND_SOURCE = 'FUND_WITHDRAWAL'
export const FUND_WITHDRAWAL_APPROVE_CONSUMER = 'FUND_WITHDRAWAL.PAY'
export const FUND_WITHDRAWAL_POSTING_TYPE = 'USER_WITHDRAWAL'
/** 摘要只描述业务含义；提款单号由批次 businessNo 单独记录。 */
export const FUND_WITHDRAWAL_SUMMARY = '用户提款'
