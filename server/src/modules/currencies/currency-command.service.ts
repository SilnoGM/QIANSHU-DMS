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
import {
  createCurrencyRecord,
  readCurrencyCommandDto,
  readCurrencyForMutation,
  readExchangeRateForCurrency,
  updateCurrencyRecord,
  type UpdateCurrencyRecordInput,
} from './currency-command.persistence'
import type {
  ChangeCurrencyStatusRequestDto,
  CreateCurrencyRequestDto,
  UpdateCurrencyRequestDto,
} from './dto/currency-command.dto'
import type { CurrencyDto } from './dto/currency.dto'
import {
  normalizeCurrencyCode,
  normalizeCurrencyName,
  normalizeNullableCurrencyText,
  normalizeOptionalCurrencySymbol,
  normalizeOptionalCurrencyText,
} from './currency.normalizer'
import { mapCurrencyPersistenceError } from './currency.persistence-error.mapper'

export interface CurrencyCommandContext {
  /** 只接受 AuthenticationGuard 写入的可信 Session User id。 */
  readonly actorUserId: string
  /** 只接受 request-id middleware 生成或校验后的请求标识。 */
  readonly requestId: string
}

type CurrencyStatusOperation = 'enable' | 'disable'

function currencyException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function requireCurrencyDto(currency: CurrencyDto | null): CurrencyDto {
  if (currency === null) {
    throw new Error('Currency mutation response invariant violated')
  }
  return currency
}

function assertExpectedVersion(
  currentVersion: number,
  expectedVersion: number,
): void {
  if (currentVersion !== expectedVersion) {
    throw currencyException(
      HttpStatus.CONFLICT,
      'CURRENCY_STATE_CHANGED',
      '货币状态已变化，请刷新后重试',
    )
  }
}

/**
 * 货币写服务统一持有事务、版本、锁序与审计边界；规范化在事务外完成，事务内
 * 第一条 SQL 固定设置 timeout。所有成功 Audit 与业务写使用同一 TransactionClient。
 */
@Injectable()
export class CurrencyCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    context: CurrencyCommandContext,
    input: CreateCurrencyRequestDto,
  ): Promise<CurrencyDto> {
    const code = normalizeCurrencyCode(input.code)
    const name = normalizeCurrencyName(input.name)
    const englishName = normalizeNullableCurrencyText(
      input.englishName,
      'englishName',
      128,
    )
    const symbol = normalizeNullableCurrencyText(
      input.symbol,
      'symbol',
      16,
    )
    const changedFields = [
      'code',
      'enabled',
      ...(Object.hasOwn(input, 'englishName') ? ['englishName'] : []),
      'minorUnit',
      'name',
      'sortOrder',
      ...(Object.hasOwn(input, 'symbol') ? ['symbol'] : []),
    ].sort().join(',')

    return this.runMutation(async (transaction) => {
      const created = await createCurrencyRecord(transaction, {
        code,
        name,
        englishName,
        symbol,
        minorUnit: input.minorUnit,
        enabled: false,
        sortOrder: input.sortOrder,
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.CURRENCY_CREATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'Currency',
        targetId: created.id,
        requestId: context.requestId,
        metadata: {
          currencyCode: code,
          changedFields,
          version: 1,
        },
      })

      return requireCurrencyDto(
        await readCurrencyCommandDto(transaction, created.id),
      )
    })
  }

  async update(
    context: CurrencyCommandContext,
    currencyId: string,
    input: UpdateCurrencyRequestDto,
  ): Promise<CurrencyDto> {
    const normalizedId = currencyId.toLowerCase()
    const updatesName =
      Object.hasOwn(input, 'name') && input.name !== undefined
    const updatesEnglishName =
      Object.hasOwn(input, 'englishName') && input.englishName !== undefined
    const updatesSymbol =
      Object.hasOwn(input, 'symbol') && input.symbol !== undefined
    const updatesSortOrder =
      Object.hasOwn(input, 'sortOrder') && input.sortOrder !== undefined

    if (
      !updatesName
      && !updatesEnglishName
      && !updatesSymbol
      && !updatesSortOrder
    ) {
      throw currencyException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
      )
    }

    const normalizedName = updatesName
      ? normalizeCurrencyName(input.name)
      : undefined
    const englishName = updatesEnglishName
      ? normalizeOptionalCurrencyText(input.englishName, 'englishName', 128)
      : undefined
    const symbol = updatesSymbol
      ? normalizeOptionalCurrencySymbol(input.symbol)
      : undefined

    return this.runMutation(async (transaction) => {
      const current = await readCurrencyForMutation(
        transaction,
        normalizedId,
      )
      if (current === null) {
        throw currencyException(
          HttpStatus.NOT_FOUND,
          'CURRENCY_NOT_FOUND',
          '货币不存在',
        )
      }
      assertExpectedVersion(current.version, input.expectedVersion)

      const data: UpdateCurrencyRecordInput = {}
      const changedFields: string[] = []
      if (normalizedName !== undefined && normalizedName !== current.name) {
        data.name = normalizedName
        changedFields.push('name')
      }
      if (
        updatesEnglishName
        && englishName !== current.englishName
      ) {
        data.englishName = englishName
        changedFields.push('englishName')
      }
      if (updatesSymbol && symbol !== current.symbol) {
        data.symbol = symbol
        changedFields.push('symbol')
      }
      if (
        updatesSortOrder
        && input.sortOrder !== current.sortOrder
      ) {
        data.sortOrder = input.sortOrder
        changedFields.push('sortOrder')
      }

      if (changedFields.length === 0) {
        return requireCurrencyDto(
          await readCurrencyCommandDto(transaction, normalizedId),
        )
      }

      await updateCurrencyRecord(transaction, normalizedId, data)
      changedFields.sort()
      await this.audit.record(transaction, {
        eventType: AuditEventType.CURRENCY_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'Currency',
        targetId: normalizedId,
        requestId: context.requestId,
        metadata: {
          currencyCode: current.code,
          changedFields: changedFields.join(','),
          previousVersion: current.version,
          version: current.version + 1,
        },
      })

      return requireCurrencyDto(
        await readCurrencyCommandDto(transaction, normalizedId),
      )
    })
  }

  enable(
    context: CurrencyCommandContext,
    currencyId: string,
    input: ChangeCurrencyStatusRequestDto,
  ): Promise<CurrencyDto> {
    return this.setEnabled(context, currencyId, input, 'enable')
  }

  disable(
    context: CurrencyCommandContext,
    currencyId: string,
    input: ChangeCurrencyStatusRequestDto,
  ): Promise<CurrencyDto> {
    return this.setEnabled(context, currencyId, input, 'disable')
  }

  private async setEnabled(
    context: CurrencyCommandContext,
    currencyId: string,
    input: ChangeCurrencyStatusRequestDto,
    operation: CurrencyStatusOperation,
  ): Promise<CurrencyDto> {
    const normalizedId = currencyId.toLowerCase()
    const desiredEnabled = operation === 'enable'

    return this.runMutation(async (transaction) => {
      const current = await readCurrencyForMutation(
        transaction,
        normalizedId,
      )
      if (current === null) {
        throw currencyException(
          HttpStatus.NOT_FOUND,
          'CURRENCY_NOT_FOUND',
          '货币不存在',
        )
      }
      assertExpectedVersion(current.version, input.expectedVersion)

      if (current.code === 'CNY' && !desiredEnabled) {
        throw currencyException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'BASE_CURRENCY_CANNOT_BE_DISABLED',
          '人民币为固定基准币，不能停用',
        )
      }
      if (current.enabled === desiredEnabled) {
        return requireCurrencyDto(
          await readCurrencyCommandDto(transaction, normalizedId),
        )
      }

      if (desiredEnabled && current.code !== 'CNY') {
        const currentRate = await readExchangeRateForCurrency(
          transaction,
          normalizedId,
        )
        if (currentRate === null) {
          throw currencyException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'CURRENCY_EXCHANGE_RATE_REQUIRED',
            '请先配置当前汇率再启用该货币',
          )
        }
      }

      await updateCurrencyRecord(transaction, normalizedId, {
        enabled: desiredEnabled,
      })
      await this.audit.record(transaction, {
        eventType: desiredEnabled
          ? AuditEventType.CURRENCY_ENABLED
          : AuditEventType.CURRENCY_DISABLED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'Currency',
        targetId: normalizedId,
        requestId: context.requestId,
        metadata: {
          currencyCode: current.code,
          changedFields: 'enabled',
          previousVersion: current.version,
          version: current.version + 1,
        },
      })

      return requireCurrencyDto(
        await readCurrencyCommandDto(transaction, normalizedId),
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
      throw mapCurrencyPersistenceError(error)
    }
  }
}
