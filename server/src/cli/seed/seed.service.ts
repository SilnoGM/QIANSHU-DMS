import { randomUUID } from 'node:crypto'

import { UserStatus } from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { CurrencyCommandService } from '../../modules/currencies/currency-command.service'
import type { DictionaryCommandService } from '../../modules/dictionaries/dictionary-command.service'
import type { ExchangeRateCommandService } from '../../modules/exchange-rates/exchange-rate-command.service'
import type { FundConfigurationCommandService } from '../../modules/fund-accounts/application/fund-configuration-command.service'
import type { NumberingCommandService } from '../../modules/numbering/numbering-command.service'
import type { PurchaseShippingMarksService } from '../../modules/purchase-shipping-marks/purchase-shipping-marks.service'
import type { RolesService } from '../../modules/roles/roles.service'
import {
  SEED_DICTIONARIES,
  SEED_EXCHANGE_RATES,
  SEED_FUND_POSTING_TYPES,
  SEED_NUMBERING_RULES,
  SEED_PACKAGING_COST_SOURCE_CODE,
  SEED_ROLES,
  SEED_SHIPPING_MARK_BINDINGS,
} from './seed.dataset'

export type SeedCategory =
  | 'currencies'
  | 'dictionaries'
  | 'roles'
  | 'numberingRules'
  | 'shippingMarkBindings'
  | 'fundPostingTypes'

export interface SeedCategorySummary {
  readonly category: SeedCategory
  readonly created: number
  readonly skipped: number
}

export interface SeedRunResult {
  readonly applied: boolean
  readonly actorUserId: string
  readonly categories: readonly SeedCategorySummary[]
  /** 已存在但状态不满足要求、且不自动修改的条目；非空表示需要人工处理。 */
  readonly conflicts: readonly string[]
}

/**
 * seed 失败一律收敛为固定 code 与固定文案，避免连接串、SQL 参数或数据行内容
 * 进入终端历史与运维采集。
 */
export class SeedOperationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SeedOperationError'
    this.code = code
  }
}

export interface SeedServiceDependencies {
  readonly prisma: PrismaService
  readonly roles: RolesService
  readonly dictionaries: DictionaryCommandService
  readonly currencies: CurrencyCommandService
  readonly exchangeRates: ExchangeRateCommandService
  readonly numbering: NumberingCommandService
  readonly shippingMarks: PurchaseShippingMarksService
  readonly fundConfiguration: FundConfigurationCommandService
}

interface SeedCommandContext {
  readonly actorUserId: string
  readonly requestId: string
}

/**
 * 上线内置数据的一次性写入器。所有写入复用正式命令服务，因此状态机、乐观锁、
 * 配置指纹与审计事件与人工操作完全一致；已存在的记录一律不覆盖，保证可重复执行。
 */
export class SeedService {
  private readonly prisma: PrismaService
  private readonly roles: RolesService
  private readonly dictionaries: DictionaryCommandService
  private readonly currencies: CurrencyCommandService
  private readonly exchangeRates: ExchangeRateCommandService
  private readonly numbering: NumberingCommandService
  private readonly shippingMarks: PurchaseShippingMarksService
  private readonly fundConfiguration: FundConfigurationCommandService

  constructor(dependencies: SeedServiceDependencies) {
    this.prisma = dependencies.prisma
    this.roles = dependencies.roles
    this.dictionaries = dependencies.dictionaries
    this.currencies = dependencies.currencies
    this.exchangeRates = dependencies.exchangeRates
    this.numbering = dependencies.numbering
    this.shippingMarks = dependencies.shippingMarks
    this.fundConfiguration = dependencies.fundConfiguration
  }

  async run(options: { readonly apply: boolean }): Promise<SeedRunResult> {
    const actorUserId = await this.resolveSystemAdmin()
    const context: SeedCommandContext = { actorUserId, requestId: randomUUID() }
    const conflicts: string[] = []
    const categories: SeedCategorySummary[] = []

    categories.push(await this.seedCurrencies(context, options.apply))
    categories.push(await this.seedDictionaries(context, options.apply))
    categories.push(await this.seedRoles(context, options.apply))
    categories.push(await this.seedNumberingRules(context, options.apply, conflicts))
    categories.push(await this.seedShippingMarkBindings(context, options.apply, conflicts))
    categories.push(await this.seedFundPostingTypes(context, options.apply))

    return Object.freeze({
      applied: options.apply,
      actorUserId,
      categories,
      conflicts,
    })
  }

  /** 审计与业务表的 actor 外键都要求真实用户，因此必须先完成管理员初始化。 */
  private async resolveSystemAdmin(): Promise<string> {
    const membership = await this.prisma.userRole.findFirst({
      where: {
        role: { code: 'system_admin' },
        user: { status: UserStatus.ACTIVE },
      },
      orderBy: { userId: 'asc' },
      select: { userId: true },
    })
    if (membership === null) {
      throw new SeedOperationError(
        'SEED_SYSTEM_ADMIN_REQUIRED',
        '未找到可用的 system_admin 成员，请先执行 auth:bootstrap-admin',
      )
    }
    return membership.userId
  }

  /**
   * 币种目录由迁移内置，这里只补汇率并启用币种。数据库触发器要求"先汇率后启用"，
   * 顺序不可颠倒；CNY 是基础币种，不参与汇率配置。
   */
  private async seedCurrencies(
    context: SeedCommandContext,
    apply: boolean,
  ): Promise<SeedCategorySummary> {
    let created = 0
    let skipped = 0

    for (const entry of SEED_EXCHANGE_RATES) {
      const currency = await this.prisma.currency.findUnique({
        where: { code: entry.currencyCode },
        include: { exchangeRate: true },
      })
      if (currency === null) {
        throw new SeedOperationError(
          'SEED_CURRENCY_NOT_FOUND',
          `币种 ${entry.currencyCode} 不存在，请确认迁移已执行`,
        )
      }

      if (currency.exchangeRate === null) {
        if (apply) {
          await this.exchangeRates.create(context, {
            currencyId: currency.id,
            foreignUnitsPerCny: entry.foreignUnitsPerCny,
          })
        }
        created += 1
      }
      else {
        skipped += 1
      }

      if (currency.enabled) {
        skipped += 1
        continue
      }
      if (apply) {
        await this.currencies.enable(context, currency.id, {
          expectedVersion: currency.version,
        })
      }
      created += 1
    }

    return { category: 'currencies', created, skipped }
  }

  /** 新类型与新条目默认停用，必须按"建条目 → 启用条目 → 启用类型"的顺序补齐。 */
  private async seedDictionaries(
    context: SeedCommandContext,
    apply: boolean,
  ): Promise<SeedCategorySummary> {
    let created = 0
    let skipped = 0

    for (const type of SEED_DICTIONARIES) {
      const existingType = await this.prisma.dictionaryType.findUnique({
        where: { code: type.code },
        include: { items: true },
      })

      if (existingType === null) {
        if (!apply) {
          created += 1 + type.items.length
          continue
        }
        const typeDto = await this.dictionaries.createType(context, {
          code: type.code,
          name: type.name,
          sortOrder: type.sortOrder,
        })
        created += 1
        for (const item of type.items) {
          const itemDto = await this.dictionaries.createItem(context, typeDto.id, {
            value: item.value,
            label: item.label,
            tone: item.tone,
            sortOrder: item.sortOrder,
          })
          await this.dictionaries.enableItem(context, typeDto.id, itemDto.id, {
            expectedVersion: itemDto.version,
          })
          created += 1
        }
        await this.dictionaries.enableType(context, typeDto.id, {
          expectedVersion: typeDto.version,
        })
        continue
      }

      const itemsByValue = new Map(existingType.items.map(item => [item.value, item]))
      let typeNeedsEnable = !existingType.enabled

      for (const item of type.items) {
        const existingItem = itemsByValue.get(item.value)
        if (existingItem === undefined) {
          if (apply) {
            const itemDto = await this.dictionaries.createItem(context, existingType.id, {
              value: item.value,
              label: item.label,
              tone: item.tone,
              sortOrder: item.sortOrder,
            })
            await this.dictionaries.enableItem(context, existingType.id, itemDto.id, {
              expectedVersion: itemDto.version,
            })
          }
          typeNeedsEnable = true
          created += 1
        }
        else if (!existingItem.enabled) {
          if (apply) {
            await this.dictionaries.enableItem(context, existingType.id, existingItem.id, {
              expectedVersion: existingItem.version,
            })
          }
          typeNeedsEnable = true
          created += 1
        }
        else {
          skipped += 1
        }
      }

      if (!typeNeedsEnable) {
        skipped += 1
        continue
      }
      if (apply) {
        // 前面的条目写入会推进类型版本，启用前必须重读当前版本。
        const refreshed = await this.prisma.dictionaryType.findUniqueOrThrow({
          where: { id: existingType.id },
          select: { version: true, enabled: true },
        })
        if (!refreshed.enabled) {
          await this.dictionaries.enableType(context, existingType.id, {
            expectedVersion: refreshed.version,
          })
        }
      }
      created += 1
    }

    return { category: 'dictionaries', created, skipped }
  }

  /** 只有权限集合与目标不一致时才整体替换，避免重复执行产生无意义的授权审计。 */
  private async seedRoles(
    context: SeedCommandContext,
    apply: boolean,
  ): Promise<SeedCategorySummary> {
    let created = 0
    let skipped = 0

    for (const role of SEED_ROLES) {
      const desiredPermissions = await this.prisma.permission.findMany({
        where: { code: { in: [...role.permissionCodes] } },
        select: { id: true, code: true, systemOnly: true },
      })
      const missing = role.permissionCodes.filter(
        code => !desiredPermissions.some(permission => permission.code === code),
      )
      if (missing.length > 0) {
        throw new SeedOperationError(
          'SEED_PERMISSION_NOT_FOUND',
          `权限目录缺少内置角色所需权限：${missing.join(', ')}`,
        )
      }
      const systemOnly = desiredPermissions.filter(permission => permission.systemOnly)
      if (systemOnly.length > 0) {
        throw new SeedOperationError(
          'SEED_PERMISSION_SYSTEM_ONLY',
          `内置角色不能包含系统专属权限：${systemOnly.map(permission => permission.code).join(', ')}`,
        )
      }
      const permissionIds = desiredPermissions.map(permission => permission.id)

      const existingRole = await this.prisma.role.findUnique({
        where: { code: role.code },
        include: { permissions: { include: { permission: { select: { code: true } } } } },
      })

      if (existingRole === null) {
        if (apply) {
          const roleDto = await this.roles.create(context, {
            code: role.code,
            name: role.name,
            description: role.description,
          })
          await this.roles.replacePermissions(context, roleDto.id, { permissionIds })
        }
        created += 1
        continue
      }

      const currentCodes = new Set(
        existingRole.permissions.map(entry => entry.permission.code),
      )
      const sameSet = currentCodes.size === role.permissionCodes.length
        && role.permissionCodes.every(code => currentCodes.has(code))
      if (sameSet) {
        skipped += 1
        continue
      }
      if (apply) {
        await this.roles.replacePermissions(context, existingRole.id, { permissionIds })
      }
      created += 1
    }

    return { category: 'roles', created, skipped }
  }

  /**
   * 编号规则发布后配置冻结、rule_code 不可删除，因此只新建缺失规则；已存在但
   * 不可用的规则记入 conflicts 交人工处理，不做任何自动修改。
   */
  private async seedNumberingRules(
    context: SeedCommandContext,
    apply: boolean,
    conflicts: string[],
  ): Promise<SeedCategorySummary> {
    let created = 0
    let skipped = 0

    for (const rule of SEED_NUMBERING_RULES) {
      const existing = await this.prisma.numberingRule.findUnique({
        where: { ruleCode: rule.ruleCode },
        include: { versions: { select: { status: true } } },
      })

      if (existing !== null) {
        const hasActive = existing.versions.some(version => version.status === 'ACTIVE')
        if (existing.status !== 'ENABLED' || !hasActive) {
          conflicts.push(
            `${rule.ruleCode}: 已存在但状态为 ${existing.status}${hasActive ? '' : '、缺少 ACTIVE 版本'}，需要人工核对`,
          )
        }
        skipped += 1
        continue
      }

      if (!apply) {
        created += 1
        continue
      }

      const detail = await this.numbering.create(context, {
        purpose: rule.purpose,
        ruleCode: rule.ruleCode,
        name: rule.name,
        description: rule.description,
        resetPolicy: rule.resetPolicy,
        segments: [...rule.segments],
      })
      if (detail.draftVersion === null) {
        throw new SeedOperationError(
          'SEED_NUMBERING_DRAFT_MISSING',
          `编号规则 ${rule.ruleCode} 未生成草稿版本`,
        )
      }
      const published = await this.numbering.publish(context, detail.id, {
        expectedVersion: detail.version,
        draftRevision: detail.draftVersion.revision,
      })
      await this.numbering.enable(context, detail.id, {
        expectedVersion: published.version,
      })
      created += 1
    }

    return { category: 'numberingRules', created, skipped }
  }

  private async seedShippingMarkBindings(
    context: SeedCommandContext,
    apply: boolean,
    conflicts: string[],
  ): Promise<SeedCategorySummary> {
    let created = 0
    let skipped = 0

    for (const binding of SEED_SHIPPING_MARK_BINDINGS) {
      const existing = await this.prisma.supplierShippingMarkRuleBinding.findUnique({
        where: { supplierValue: binding.supplierValue },
        select: { ruleId: true },
      })
      if (existing !== null) {
        skipped += 1
        continue
      }

      const rule = await this.prisma.numberingRule.findUnique({
        where: { ruleCode: binding.ruleCode },
        include: { versions: { select: { status: true } } },
      })
      if (rule === null && !apply) {
        // 预览模式下目标规则由本次运行内的编号规则环节创建，不算冲突。
        created += 1
        continue
      }
      if (
        rule === null
        || rule.status !== 'ENABLED'
        || !rule.versions.some(version => version.status === 'ACTIVE')
      ) {
        conflicts.push(
          `${binding.supplierValue}: 目标规则 ${binding.ruleCode} 当前不可用，未建立唛头绑定`,
        )
        continue
      }

      if (apply) {
        await this.shippingMarks.save(context, binding.supplierValue, {
          ruleId: rule.id,
          expectedVersion: 0,
        })
      }
      created += 1
    }

    return { category: 'shippingMarkBindings', created, skipped }
  }

  /**
   * 打木架付款依赖该业务类型。迁移只绑定已存在的类型，因此新库必须在此补建类型、
   * 发布规则并把它加入 PACKAGING_COST 来源的白名单，否则付款报 POSTING_UNAVAILABLE。
   */
  private async seedFundPostingTypes(
    context: SeedCommandContext,
    apply: boolean,
  ): Promise<SeedCategorySummary> {
    let created = 0
    let skipped = 0

    for (const type of SEED_FUND_POSTING_TYPES) {
      const existing = await this.prisma.fundPostingType.findUnique({
        where: { code: type.code },
        select: { id: true },
      })

      if (existing === null) {
        if (!apply) {
          // 预览模式尚未创建业务类型与来源绑定，按两步计数后结束。
          created += 2
          continue
        }
        const view = await this.fundConfiguration.createPostingType(context, {
          code: type.code,
          name: type.name,
          description: type.description,
          businessCategory: type.businessCategory,
          requiresUser: type.requiresUser,
          amountSignPolicy: type.amountSignPolicy,
          legs: type.legs.map(leg => ({ ...leg })),
        })
        if (view.draftRule === null) {
          throw new SeedOperationError(
            'SEED_FUND_DRAFT_MISSING',
            `资金业务类型 ${type.code} 未生成草稿规则`,
          )
        }
        const published = await this.fundConfiguration.publishDraftRule(context, {
          postingTypeId: view.id,
          draftRuleVersionId: view.draftRule.id,
          expectedVersion: view.version,
        })
        await this.fundConfiguration.setPostingTypeEnabled(context, {
          postingTypeId: view.id,
          enabled: true,
          expectedVersion: published.postingType.version,
        })
        created += 1
      }
      else {
        skipped += 1
      }

      const source = await this.prisma.fundBusinessSource.findUnique({
        where: { code: SEED_PACKAGING_COST_SOURCE_CODE },
        include: { allowedPostingTypes: { select: { postingTypeId: true } } },
      })
      if (source === null) {
        throw new SeedOperationError(
          'SEED_FUND_SOURCE_NOT_FOUND',
          `资金业务来源 ${SEED_PACKAGING_COST_SOURCE_CODE} 不存在，请确认迁移已执行`,
        )
      }

      const postingTypeId = existing?.id ?? await this.readPostingTypeId(type.code)
      const allowedIds = source.allowedPostingTypes.map(entry => entry.postingTypeId)
      if (allowedIds.includes(postingTypeId)) {
        skipped += 1
        continue
      }

      if (apply) {
        await this.fundConfiguration.updateBusinessSource(context, {
          businessSourceId: source.id,
          name: source.name,
          description: source.description,
          allowedPostingTypeIds: [...allowedIds, postingTypeId],
          expectedVersion: source.version,
        })
      }
      created += 1
    }

    return { category: 'fundPostingTypes', created, skipped }
  }

  private async readPostingTypeId(code: string): Promise<string> {
    const record = await this.prisma.fundPostingType.findUnique({
      where: { code },
      select: { id: true },
    })
    if (record === null) {
      throw new SeedOperationError(
        'SEED_FUND_TYPE_MISSING',
        `资金业务类型 ${code} 在预览阶段不存在`,
      )
    }
    return record.id
  }
}
