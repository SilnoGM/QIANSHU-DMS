import { ApiException } from '../../infrastructure/http/api.exception'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { NumberingGenerationError } from '../numbering/numbering.errors'

/** 对账批次域内的失败出口：只抛带稳定错误码的业务异常。 */
export function slhReconciliationBatchFailure(code: string, message: string, status = 422): never {
  throw new ApiException(status, code, message)
}

/**
 * 持久化与编号异常到域内错误码的映射。可重试的并发冲突与「提交标识被复用」
 * 必须给出不同错误码，前端才能区分「刷新重试」与「别用同一个键」。
 */
export function mapSlhReconciliationBatchError(error: unknown): never {
  if (error instanceof ApiException) {
    throw error
  }
  if (error instanceof NumberingGenerationError) {
    return slhReconciliationBatchFailure('SLH_RECON_BATCH_NUMBERING_UNAVAILABLE', '批次编号暂时无法派发，请检查编号规则 SLH_RECON_BATCH_NO 后重试', 409)
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
