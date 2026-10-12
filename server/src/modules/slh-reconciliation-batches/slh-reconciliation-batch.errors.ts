import { ApiException } from '../../infrastructure/http/api.exception'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from '../fund-accounts/application/fund-posting.errors'
import { FundCalculationError } from '../fund-accounts/domain/fund-calculation.errors'
import { NumberingGenerationError } from '../numbering/numbering.errors'

/** 对账批次域内的失败出口：只抛带稳定错误码的业务异常。 */
export function slhReconciliationBatchFailure(code: string, message: string, status = 422): never {
  throw new ApiException(status, code, message)
}

/**
 * 「账户或比例还没配」的资金错误码：完成批次时统一提示去账户管理配置。
 * 与规则/来源本身不可用分开，避免把配置缺失说成系统故障。
 */
const FUND_ACCOUNT_CONFIGURATION_ERROR_CODES: ReadonlySet<string> = new Set([
  FUND_POSTING_ERROR_CODES.USER_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.ACCOUNT_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.ACCOUNT_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.COMPANY_ACCOUNT_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.SHARE_RATE_INVALID,
  FUND_POSTING_ERROR_CODES.POSTING_RULE_INVALID,
])

/**
 * 持久化、编号与资金动账异常到域内错误码的映射。可重试的并发冲突与「提交标识被复用」
 * 必须给出不同错误码，前端才能区分「刷新重试」与「别用同一个键」。
 */
export function mapSlhReconciliationBatchError(error: unknown): never {
  if (error instanceof ApiException) {
    throw error
  }
  if (error instanceof NumberingGenerationError) {
    return slhReconciliationBatchFailure('SLH_RECON_BATCH_NUMBERING_UNAVAILABLE', '批次编号暂时无法派发，请检查编号规则 SLH_RECON_BATCH_NO 后重试', 409)
  }
  if (error instanceof FundPostingError) {
    if (error.code === FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED) {
      return slhReconciliationBatchFailure('SLH_RECON_BATCH_STATE_CHANGED', '资料已变化或正在处理，请刷新后重试', 409)
    }
    if (error.code === FUND_POSTING_ERROR_CODES.INTERNAL_ERROR) {
      return slhReconciliationBatchFailure('INTERNAL_ERROR', '资金服务内部错误', 500)
    }
    if (FUND_ACCOUNT_CONFIGURATION_ERROR_CODES.has(error.code)) {
      return slhReconciliationBatchFailure('SLH_RECON_BATCH_POSTING_ACCOUNT_UNAVAILABLE', '资金账户未配置或未设置分成比例，请先在账户管理里配置后重试', 409)
    }
    return slhReconciliationBatchFailure('SLH_RECON_BATCH_POSTING_UNAVAILABLE', '资金入账规则当前不可用，批次未完成', 409)
  }
  if (error instanceof FundCalculationError) {
    return slhReconciliationBatchFailure('SLH_RECON_BATCH_POSTING_UNAVAILABLE', '当前金额无法按资金规则入账，批次未完成', 409)
  }
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505'].some(code => hasPersistenceCode(facts, code))) {
    return slhReconciliationBatchFailure('SLH_RECON_BATCH_CONFLICT', '该批次或编号已经存在，请刷新后重试', 409)
  }
  if (['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
    return slhReconciliationBatchFailure('SLH_RECON_BATCH_STATE_CHANGED', '资料已变化或正在处理，请刷新后重试', 409)
  }
  throw error
}
