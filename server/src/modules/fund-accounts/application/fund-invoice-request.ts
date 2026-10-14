/**
 * 开票申请域只通过这一组受控来源与 consumer 调用资金事务端口，客户端不得选择。
 *
 * 一个来源一个动作：
 * - `INVOICE_REQUEST.SETTLE` → INVOICE_FEE（开发票费用：必须大于 0，按归属人当前分成比例
 *   从用户与公司账户同时扣除，归属人是申请单的提交人）。
 *
 * 常量放在资金模块内是为了避免资金域反向依赖业务域；业务域从本文件导入。
 */
export const INVOICE_REQUEST_FUND_SOURCE = 'INVOICE_REQUEST'
export const INVOICE_REQUEST_SETTLE_CONSUMER = 'INVOICE_REQUEST.SETTLE'
export const INVOICE_REQUEST_POSTING_TYPE = 'INVOICE_FEE'
