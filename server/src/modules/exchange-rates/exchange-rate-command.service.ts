import { HttpStatus, Injectable } from '@nestjs/common'

import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import type {
  CreateExchangeRateRequestDto,
  UpdateExchangeRateRequestDto,
} from './dto/exchange-rate-command.dto'
import type { ExchangeRateDto } from './dto/exchange-rate.dto'
import {
  createExchangeRateRecord,
  readCurrencyForExchangeRate,
  readExchangeRateCommandDto,
  readExchangeRateForCurrency,
  readExchangeRateForMutation,
  readExchangeRateIdentity,
  updateExchangeRateRecord,
} from './exchange-rate-command.persistence'
import { normalizeForeignUnitsPerCny } from './exchange-rate.normalizer'
import { mapExchangeRatePersistenceError } from './exchange-rate.persistence-error.mapper'

export interface ExchangeRateCommandContext {
  /** 只接受 AuthenticationGuard 写入的可信 Session User id。 */
  readonly actorUserId: string
  /** 只接受 request-id middleware 生成或校验后的请求标识。 */
  readonly requestId: string
}

function exchangeRateException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function requireExchangeRateDto(
  rate: ExchangeRateDto | null,
): ExchangeRateDto {
  if (rate === null) {
    throw new Error('ExchangeRate mutation response invariant violated')
  }
  return rate
}

/**
 * 当前汇率写服务只维护每个非 CNY 的唯一当前行；不包含删除、历史、有效期或自动
 * 重试。事务锁顺序始终为 Currency → ExchangeRate，成功 Audit 与业务写同事务。
 */
@Injectable()
export class ExchangeRateCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    context: ExchangeRateCommandContext,
    input: CreateExchangeRateRequestDto,
  ): Promise<ExchangeRateDto> {
    const currencyId = input.currencyId.toLowerCase()
    const foreignUnitsPerCny = normalizeForeignUnitsPerCny(
      input.foreignUnitsPerCny,
    )

    return this.runMutation(async (transaction) => {
      const currency = await readCurrencyForExchangeRate(
        transaction,
        currencyId,
      )
      if (currency === null) {
        throw exchangeRateException(
          HttpStatus.NOT_FOUND,
          'CURRENCY_NOT_FOUND',
          '货币不存在',
        )
      }
      if (currency.code === 'CNY') {
        throw exchangeRateException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'BASE_CURRENCY_EXCHANGE_RATE_FORBIDDEN',
          '人民币为固定基准币，不配置当前汇率',
        )
      }

      const existing = await readExchangeRateForCurrency(
        transaction,
        currencyId,
      )
      if (existing !== null) {
        throw exchangeRateException(
          HttpStatus.CONFLICT,
          'EXCHANGE_RATE_ALREADY_EXISTS',
          '该货币已配置当前汇率',
        )
      }

      const created = await createExchangeRateRecord(transaction, {
        currencyId,
        foreignUnitsPerCny,
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.EXCHANGE_RATE_CREATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'ExchangeRate',
        targetId: created.id,
        requestId: context.requestId,
        metadata: {
          currencyCode: currency.code,
          changedFields: 'foreignUnitsPerCny',
          newForeignUnitsPerCny: foreignUnitsPerCny,
          version: 1,
        },
      })

      return requireExchangeRateDto(
        await readExchangeRateCommandDto(transaction, created.id),
      )
    })
  }

  async update(
    context: ExchangeRateCommandContext,
    exchangeRateId: string,
    input: UpdateExchangeRateRequestDto,
  ): Promise<ExchangeRateDto> {
    const normalizedId = exchangeRateId.toLowerCase()
    const foreignUnitsPerCny = normalizeForeignUnitsPerCny(
      input.foreignUnitsPerCny,
    )

    return this.runMutation(async (transaction) => {
      const identity = await readExchangeRateIdentity(
        transaction,
        normalizedId,
      )
      if (identity === null) {
        throw exchangeRateException(
          HttpStatus.NOT_FOUND,
          'EXCHANGE_RATE_NOT_FOUND',
          '当前汇率不存在',
        )
      }

      const currency = await readCurrencyForExchangeRate(
        transaction,
        identity.currencyId,
      )
      if (currency === null) {
        throw new Error('ExchangeRate currency invariant violated')
      }
      const current = await readExchangeRateForMutation(
        transaction,
        normalizedId,
      )
      if (
        current === null
        || current.currencyId.toLowerCase()
          !== identity.currencyId.toLowerCase()
      ) {
        throw exchangeRateException(
          HttpStatus.CONFLICT,
          'EXCHANGE_RATE_STATE_CHANGED',
          '当前汇率已变化，请刷新后重试',
        )
      }
      if (current.version !== input.expectedVersion) {
        throw exchangeRateException(
          HttpStatus.CONFLICT,
          'EXCHANGE_RATE_STATE_CHANGED',
          '当前汇率已变化，请刷新后重试',
        )
      }
      if (currency.code === 'CNY') {
        throw exchangeRateException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'BASE_CURRENCY_EXCHANGE_RATE_FORBIDDEN',
          '人民币为固定基准币，不配置当前汇率',
        )
      }
      if (current.foreignUnitsPerCny === foreignUnitsPerCny) {
        return requireExchangeRateDto(
          await readExchangeRateCommandDto(transaction, normalizedId),
        )
      }

      await updateExchangeRateRecord(transaction, normalizedId, {
        foreignUnitsPerCny,
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.EXCHANGE_RATE_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'ExchangeRate',
        targetId: normalizedId,
        requestId: context.requestId,
        metadata: {
          currencyCode: currency.code,
          changedFields: 'foreignUnitsPerCny',
          oldForeignUnitsPerCny: current.foreignUnitsPerCny,
          newForeignUnitsPerCny: foreignUnitsPerCny,
          previousVersion: current.version,
          version: current.version + 1,
        },
      })

      return requireExchangeRateDto(
        await readExchangeRateCommandDto(transaction, normalizedId),
      )
    })
  }

  private async runMutation<T>(
    operation: (
      transaction: Parameters<
        Parameters<PrismaService['$transaction']>[0]
      >[0],
    ) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        // 该调用必须是事务内第一条 SQL，锁等待和语句时间不能被外部输入放宽。
        await applyTransactionTimeouts(transaction)
        return operation(transaction)
      })
    } catch (error) {
      throw mapExchangeRatePersistenceError(error)
    }
  }
}
