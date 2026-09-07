import { createHash } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { DictionaryLookupService, DictionaryValueUnavailableError } from '../dictionaries/dictionary-lookup.service'
import { isNormalizableDictionaryItemValue, normalizeDictionaryItemValue } from '../dictionaries/dictionary.normalizer'
import type { PurchaseOrderShippingMarkResolutionDto, PurchaseOrderShippingMarkResolutionQueryDto } from './purchase-shipping-mark-resolution.dto'
import type { ShippingMarkAvailability } from './shipping-mark-binding.dto'
import { ruleAvailability, SHIPPING_MARK_RULE_SELECT, summarizeRule } from './shipping-mark-binding.persistence'

export interface PurchaseShippingMarkResolutionInput {
  readonly productMode: 'CATALOG' | 'CUSTOM'
  readonly supplierValue?: string | null
}

interface BindingIdentity {
  readonly ruleId: string
  readonly version: number
}

const CUSTOM_RULE_CODE = 'CUSTOM_MARK'
const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const AVAILABILITY_MESSAGES: Record<ShippingMarkAvailability, string> = {
  AVAILABLE: '正式提交后自动派发，规则容量与生成结果将在提交时最终校验',
  SUPPLIER_UNAVAILABLE: '供应商当前不可用，请检查供应商字典启用状态',
  UNBOUND: '该供应商尚未绑定唛头规则，请联系管理员配置',
  RULE_MISSING: '唛头规则不存在，请联系管理员配置',
  WRONG_PURPOSE: '绑定规则的用途不是唛头，请联系管理员核对',
  RULE_DISABLED: '唛头规则尚未启用或已停用，请联系管理员核对',
  NO_ACTIVE_VERSION: '唛头规则尚无生效版本，请联系管理员发布',
}

function normalizeSupplier(input: PurchaseShippingMarkResolutionInput): string | null {
  if (input.productMode === 'CUSTOM' && input.supplierValue == null) return null
  if (input.productMode === 'CATALOG' && isNormalizableDictionaryItemValue(input.supplierValue)) {
    return normalizeDictionaryItemValue(input.supplierValue)
  }
  throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', '请求参数校验失败')
}

@Injectable()
export class PurchaseShippingMarkResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookup: DictionaryLookupService,
  ) {}

  async read(query: PurchaseOrderShippingMarkResolutionQueryDto): Promise<PurchaseOrderShippingMarkResolutionDto> {
    try {
      return await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        return this.resolve(transaction, query, false)
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      const facts = readPersistenceErrorFacts(error)
      if (['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
        throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', '采购依赖状态已变化，请刷新核对后重试')
      }
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', '服务器内部错误')
    }
  }

  /**
   * 只解析调用方已确定的采购场景，不接受规则选择。调用方持有事务并先设置超时；
   * lock=true 时共享锁持续到采购提交结束，防止核对摘要后绑定或生效版本发生变化。
   * 这里只判定静态可用性，不访问计数器、不预留容量，也不派发候选编号。
   */
  async resolve(
    transaction: Prisma.TransactionClient,
    input: PurchaseShippingMarkResolutionInput,
    lock: boolean,
  ): Promise<PurchaseOrderShippingMarkResolutionDto> {
    const supplierValue = normalizeSupplier(input)
    const result: PurchaseOrderShippingMarkResolutionDto = {
      productMode: input.productMode,
      matchSource: input.productMode === 'CATALOG' ? 'SUPPLIER_BINDING' : 'CUSTOM_RULE',
      ruleId: null,
      ruleCode: input.productMode === 'CUSTOM' ? CUSTOM_RULE_CODE : null,
      name: null,
      activeRevision: null,
      availability: 'RULE_MISSING',
      message: AVAILABILITY_MESSAGES.RULE_MISSING,
      resolutionToken: null,
    }
    let binding: BindingIdentity | null = null
    if (supplierValue !== null) {
      if (!await this.supplierIsEffective(transaction, supplierValue, lock)) {
        return { ...result, availability: 'SUPPLIER_UNAVAILABLE', message: AVAILABILITY_MESSAGES.SUPPLIER_UNAVAILABLE }
      }
      // 锁序与绑定配置写入保持一致：Dictionary Type / Item -> Binding -> Rule。
      binding = lock
        ? (await transaction.$queryRaw<BindingIdentity[]>(Prisma.sql`
            SELECT rule_id AS "ruleId", version
            FROM supplier_shipping_mark_rule_bindings
            WHERE supplier_value = ${supplierValue} FOR SHARE
          `))[0] ?? null
        : await transaction.supplierShippingMarkRuleBinding.findUnique({ where: { supplierValue }, select: { ruleId: true, version: true } })
      if (binding === null) {
        return { ...result, availability: 'UNBOUND', message: AVAILABILITY_MESSAGES.UNBOUND }
      }
      result.ruleId = binding.ruleId
    }

    const where = binding === null ? { ruleCode: CUSTOM_RULE_CODE } : { id: binding.ruleId }
    if (lock) {
      await transaction.$queryRaw(binding === null
        ? Prisma.sql`SELECT id FROM numbering_rules WHERE rule_code = ${CUSTOM_RULE_CODE} FOR SHARE`
        : Prisma.sql`SELECT id FROM numbering_rules WHERE id = ${binding.ruleId}::uuid FOR SHARE`)
    }
    // 发布与启停均更新 Rule；持锁后读取 ACTIVE revision，与后续派发共用同一事务。
    const rule = summarizeRule(await transaction.numberingRule.findUnique({ where, select: SHIPPING_MARK_RULE_SELECT }))
    const availability = ruleAvailability(rule)
    Object.assign(result, {
      ruleId: rule?.id ?? result.ruleId,
      ruleCode: rule?.ruleCode ?? result.ruleCode,
      name: rule?.name ?? null,
      activeRevision: rule?.activeRevision ?? null,
      availability,
      message: AVAILABILITY_MESSAGES[availability],
    })
    if (availability === 'AVAILABLE') {
      // 摘要仅含稳定身份及并发版本；字典标签、规则名称变化不会要求重新确认。
      result.resolutionToken = createHash('sha256').update(JSON.stringify({
        version: 'purchase-order.shipping-mark-resolution.v1',
        productMode: input.productMode,
        supplierValue,
        bindingVersion: binding?.version ?? null,
        ruleId: result.ruleId,
        activeRevision: result.activeRevision,
      })).digest('hex')
    }
    return result
  }

  private async supplierIsEffective(transaction: Prisma.TransactionClient, supplierValue: string, lock: boolean): Promise<boolean> {
    const input = { dictionaryCode: SUPPLIER_DICTIONARY_CODE, value: supplierValue }
    if (!lock) {
      const supplier = await this.lookup.resolveStoredValueInTransaction(transaction, input)
      return supplier.known && supplier.effectiveEnabled
    }
    try {
      await this.lookup.requireEffectiveValue(transaction, input)
      return true
    }
    catch (error) {
      if (error instanceof DictionaryValueUnavailableError) return false
      // SQL 失败必须交回事务调用方处理，不能把已中止事务继续用作配置不可用响应。
      throw error
    }
  }
}
