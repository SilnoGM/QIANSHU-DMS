import { HttpStatus, Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import { DictionaryLookupService, DictionaryValueUnavailableError } from '../dictionaries/dictionary-lookup.service'
import type {
  SaveShippingMarkBindingDto, ShippingMarkBindingDto, ShippingMarkBindingPageDto,
  ShippingMarkBindingQueryDto, ShippingMarkOptionsPageDto, ShippingMarkOptionsQueryDto,
} from './shipping-mark-binding.dto'
import { readBindingPage, ruleAvailability, SHIPPING_MARK_RULE_SELECT, summarizeRule } from './shipping-mark-binding.persistence'

function conflict(code: string, message: string): never {
  throw new ApiException(HttpStatus.CONFLICT, code, message)
}

function rethrow(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof DictionaryValueUnavailableError) conflict('SHIPPING_MARK_SUPPLIER_UNAVAILABLE', '供应商当前不可用，请检查字典启用状态')
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505', 'P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
    conflict('SHIPPING_MARK_BINDING_CHANGED', '绑定或规则状态已变化，请刷新核对后重试')
  }
  // 不把 SQL、驱动错误或完整请求回传客户端；无法确定结果时只允许查询核对。
  throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', '服务器内部错误')
}

@Injectable()
export class PurchaseShippingMarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookup: DictionaryLookupService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ShippingMarkBindingQueryDto): Promise<ShippingMarkBindingPageDto> {
    try {
      return await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const page = await readBindingPage(transaction, query)
        const rule = summarizeRule(await transaction.numberingRule.findUnique({ where: { ruleCode: 'CUSTOM_MARK' }, select: SHIPPING_MARK_RULE_SELECT }))
        return { ...page, page: query.page, pageSize: query.pageSize, customRule: { rule, availability: ruleAvailability(rule) } }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    }
    catch (error) { return rethrow(error) }
  }

  async options(query: ShippingMarkOptionsQueryDto): Promise<ShippingMarkOptionsPageDto> {
    try {
      return await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const keyword = query.keyword?.trim()
        const where: Prisma.NumberingRuleWhereInput = {
          purpose: 'SHIPPING_MARK', status: 'ENABLED', versions: { some: { status: 'ACTIVE' } },
          ...(keyword ? { OR: [{ ruleCode: { contains: keyword, mode: 'insensitive' } }, { name: { contains: keyword, mode: 'insensitive' } }] } : {}),
        }
        const total = await transaction.numberingRule.count({ where })
        const rules = await transaction.numberingRule.findMany({ where, select: SHIPPING_MARK_RULE_SELECT, orderBy: [{ ruleCode: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })
        return { items: rules.map(rule => summarizeRule(rule)!), total, page: query.page, pageSize: query.pageSize }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    }
    catch (error) { return rethrow(error) }
  }

  async save(context: { actorUserId: string, requestId: string }, supplierValue: string, input: SaveShippingMarkBindingDto): Promise<ShippingMarkBindingDto> {
    try {
      return await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        // 全系统锁序：字典 Type / Item -> 绑定 -> 规则。首次插入无行可锁，主键裁决竞争。
        const supplier = await this.lookup.requireEffectiveValue(transaction, { dictionaryCode: 'service_provider.supplier', value: supplierValue })
        const bindings = await transaction.$queryRaw<{ ruleId: string, version: number, updatedAt: Date }[]>(Prisma.sql`
          SELECT rule_id AS "ruleId", version, updated_at AS "updatedAt"
          FROM supplier_shipping_mark_rule_bindings WHERE supplier_value = ${supplier.value} FOR UPDATE
        `)
        const previous = bindings[0]
        if ((previous?.version ?? 0) !== input.expectedVersion) conflict('SHIPPING_MARK_BINDING_CHANGED', '绑定已被修改，请刷新核对后重试')
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM numbering_rules WHERE id = ${input.ruleId}::uuid FOR SHARE`)
        // 发布与启停会更新规则行；共享锁确保保存绑定期间所读生效版本不会悄然变化。
        const rule = summarizeRule(await transaction.numberingRule.findUnique({ where: { id: input.ruleId }, select: SHIPPING_MARK_RULE_SELECT }))
        if (ruleAvailability(rule) !== 'AVAILABLE') conflict('SHIPPING_MARK_RULE_UNAVAILABLE', '请选择已启用且有生效版本的唛头规则')
        let saved: { version: number, updatedAt: Date }
        if (previous?.ruleId === input.ruleId) {
          saved = previous
        }
        else {
          saved = previous
            ? await transaction.supplierShippingMarkRuleBinding.update({ where: { supplierValue: supplier.value }, data: { ruleId: input.ruleId, version: { increment: 1 }, updatedByUserId: context.actorUserId } })
            : await transaction.supplierShippingMarkRuleBinding.create({ data: { supplierValue: supplier.value, ruleId: input.ruleId, createdByUserId: context.actorUserId, updatedByUserId: context.actorUserId } })
          await this.audit.record(transaction, {
            eventType: previous ? 'SHIPPING_MARK_BINDING_UPDATED' : 'SHIPPING_MARK_BINDING_CREATED',
            outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
            requestId: context.requestId, targetType: 'shipping_mark_binding', targetId: supplier.value,
            metadata: { supplierValue: supplier.value, previousRuleId: previous?.ruleId ?? null, ruleId: input.ruleId, version: saved.version },
          })
        }
        return { supplierValue: supplier.value, supplierLabel: supplier.label, supplierEnabled: true, rule, availability: 'AVAILABLE', version: saved.version, updatedAt: saved.updatedAt.toISOString() }
      })
    }
    catch (error) { return rethrow(error) }
  }
}
