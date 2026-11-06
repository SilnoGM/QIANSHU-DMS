import { HttpStatus } from '@nestjs/common'

import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'

export function machineViewingFailure(code: string, message: string, status = 422): never {
  throw new ApiException(status, code, message)
}

export const MACHINE_VIEWING_ERROR_CODES = {
  VALIDATION_FAILED: 'MACHINE_VIEWING_VALIDATION_FAILED',
  IDEMPOTENCY_CONFLICT: 'MACHINE_VIEWING_IDEMPOTENCY_CONFLICT',
  CONFLICT: 'MACHINE_VIEWING_CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type MachineViewingErrorCode =
  (typeof MACHINE_VIEWING_ERROR_CODES)[keyof typeof MACHINE_VIEWING_ERROR_CODES]

/**
 * 预约登记的错误面只有「入参无效」「幂等键冲突」「并发冲突」三类。
 * 数据库约束与唯一键错误统一收敛为可重试的 409，不把驱动细节透给前端。
 */
export function mapMachineViewingError(error: unknown): never {
  if (error instanceof ApiException) {
    throw error
  }
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505'].some(code => hasPersistenceCode(facts, code))) {
    return machineViewingFailure(
      MACHINE_VIEWING_ERROR_CODES.CONFLICT,
      '预约已经存在，请刷新后重试',
      HttpStatus.CONFLICT,
    )
  }
  if (['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
    return machineViewingFailure(
      MACHINE_VIEWING_ERROR_CODES.CONFLICT,
      '资料已变化或正在处理，请刷新后重试',
      HttpStatus.CONFLICT,
    )
  }
  throw error
}
