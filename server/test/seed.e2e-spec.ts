import type { PrismaService } from '../src/infrastructure/database/prisma.service'
import { SeedService } from '../src/cli/seed/seed.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { CurrencyCommandService } from '../src/modules/currencies/currency-command.service'
import { DictionaryCommandService } from '../src/modules/dictionaries/dictionary-command.service'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { ExchangeRateCommandService } from '../src/modules/exchange-rates/exchange-rate-command.service'
import { FundConfigurationCommandService } from '../src/modules/fund-accounts/application/fund-configuration-command.service'
import { NumberingCommandService } from '../src/modules/numbering/numbering-command.service'
import { NumberingQueryService } from '../src/modules/numbering/numbering-query.service'
import { PurchaseShippingMarksService } from '../src/modules/purchase-shipping-marks/purchase-shipping-marks.service'
import { RolesService } from '../src/modules/roles/roles.service'
import { IsolatedNumberingPrismaService } from './numbering-e2e-database'
import { assertIsolatedReplayPrecondition } from './isolated-replay-precondition'
import { createPurchaseShippingMarkDatabase } from './purchase-shipping-mark-e2e-database'

/** 内置数据的验收口径固定在本文件，避免断言直接引用被实现的数据集而失去独立校验意义。 */
const expectedRates: ReadonlyArray<readonly [string, string]> = [
  ['TWD', '5.2'],
  ['MYR', '0.6'],
  ['USD', '0.148'],
]
const expectedDictionaries: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['mainland.warehouse', [
    'SLH.SZ.BA.SJJD.HSNP.B5',
    'SLH.DW.FHSNL.4HGYQ.B',
    'YJ.594540.DGHM.ZTBHCG.B.DXM',
    'QITA',
  ]],
  ['payment.method', [
    'ALIPAY',
    'WECHAT',
    'BANK_TRANSFER',
    'BILL_COD_SETTLEMENT',
    'CASH',
    'CHECK',
    'LETTER_OF_CREDIT',
  ]],
  ['service_provider.carrier', ['TEST']],
  ['service_provider.supplier', ['TEST']],
  ['warehouse.packaging_type', ['WOODEN_BOX', 'WOODEN_FRAME']],
]
const expectedRoles: ReadonlyArray<readonly [string, number]> = [
  ['finance_staff', 26],
  ['operations_staff', 19],
  ['purchasing_staff', 8],
]
const expectedRuleShapes: Readonly<Record<string, string>> = {
  BTJ_MARK: 'FIXED(BTJ) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  CONTAINER_BATCH_NO: 'FIXED(CTN) SEP(/) DATE(YYYY) SEP(-) SEQ(3)',
  CTN_BILL_NO: 'FIXED(CBILL) SEP(/) DATE(YYYYMM) SEP(-) SEQ(2)',
  CUSTOM_MARK: 'FIXED(CUSTOM) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  DBJ_MARK: 'FIXED(DBJ) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  FSL_MARK: 'FIXED(FSL) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  FUND_POSTING_BATCH_NO: 'FIXED(FUND) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(5)',
  INVOICE_REQUEST: 'FIXED(INV) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  LDC_MARK: 'FIXED(LDC) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  PRODUCT: 'FIXED(PROD) SEP(/) SEQ(5)',
  PSJ_MARK: 'FIXED(PSJ) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  PURCHASE_ORDER: 'FIXED(PO) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(5)',
  SALES_COLLECTION: 'FIXED(SCO) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  SALES_ORDER: 'FIXED(SO) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(5)',
  SEA_FRT_VOY_NO: 'FIXED(SEAF) SEP(/) DATE(YYYYMM) SEP(-) SEQ(2)',
  SHIPMENT_NO: 'FIXED(PKG) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(5)',
  SLH_RECON_BATCH_NO: 'FIXED(SRB) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(3)',
  SSJ_MARK: 'FIXED(SSJ) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  TEST: 'FIXED(TEST) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  TEST_MARK: 'FIXED(TEST) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
  WGJ_MARK: 'FIXED(WGJ) SEP(/) DATE(YYYYMMDD) SEP(-) SEQ(4)',
}

function describeSegments(
  segments: ReadonlyArray<{
    position: number
    type: string
    fixedValue: string | null
    dateFormat: string | null
    separatorValue: string | null
    sequenceWidth: number | null
  }>,
): string {
  return [...segments]
    .sort((left, right) => left.position - right.position)
    .map((segment) => {
      if (segment.type === 'FIXED') return `FIXED(${segment.fixedValue})`
      if (segment.type === 'DATE') return `DATE(${segment.dateFormat})`
      if (segment.type === 'SEPARATOR') return `SEP(${segment.separatorValue})`
      if (segment.type === 'SEQUENCE') return `SEQ(${segment.sequenceWidth})`
      return segment.type
    })
    .join(' ')
}

async function countRows(prisma: PrismaService) {
  const [
    currencies,
    exchangeRates,
    dictionaryTypes,
    dictionaryItems,
    roles,
    rolePermissions,
    numberingRules,
    numberingVersions,
    numberingSegments,
    bindings,
    fundPostingTypes,
    fundRuleLegs,
    sourceTypeBindings,
    auditEvents,
  ] = await Promise.all([
    prisma.currency.count(),
    prisma.exchangeRate.count(),
    prisma.dictionaryType.count(),
    prisma.dictionaryItem.count(),
    prisma.role.count(),
    prisma.rolePermission.count(),
    prisma.numberingRule.count(),
    prisma.numberingRuleVersion.count(),
    prisma.numberingRuleSegment.count(),
    prisma.supplierShippingMarkRuleBinding.count(),
    prisma.fundPostingType.count(),
    prisma.fundPostingRuleLeg.count(),
    prisma.fundBusinessSourcePostingType.count(),
    prisma.auditEvent.count(),
  ])
  return {
    currencies,
    exchangeRates,
    dictionaryTypes,
    dictionaryItems,
    roles,
    rolePermissions,
    numberingRules,
    numberingVersions,
    numberingSegments,
    bindings,
    fundPostingTypes,
    fundRuleLegs,
    sourceTypeBindings,
    auditEvents,
  }
}

function createSeedFixture(prisma: PrismaService) {
  const audit = new AuditService()
  const lookup = new DictionaryLookupService(prisma)
  return new SeedService({
    prisma,
    roles: new RolesService(prisma, audit),
    dictionaries: new DictionaryCommandService(prisma, audit),
    currencies: new CurrencyCommandService(prisma, audit),
    exchangeRates: new ExchangeRateCommandService(prisma, audit),
    numbering: new NumberingCommandService(prisma, audit, new NumberingQueryService(prisma)),
    shippingMarks: new PurchaseShippingMarksService(prisma, lookup, audit),
    fundConfiguration: new FundConfigurationCommandService(prisma, audit),
  })
}

describe('系统上线内置数据 seed', () => {
  let database: Awaited<ReturnType<typeof createPurchaseShippingMarkDatabase>>
  let prisma: PrismaService
  let seed: SeedService

  beforeAll(async () => {
    // 隔离回放的前置条件先失败：历史迁移在 public 里自校验顺联航账单表。
    await assertIsolatedReplayPrecondition()
    database = await createPurchaseShippingMarkDatabase()
    prisma = new IsolatedNumberingPrismaService(database) as unknown as PrismaService
    await prisma.onModuleInit()
    seed = createSeedFixture(prisma)
  }, 120_000)

  afterAll(async () => {
    if (prisma !== undefined) {
      await prisma.onModuleDestroy()
    }
    if (database !== undefined) {
      await database.dispose()
    }
  })

  it('缺少 system_admin 成员时拒绝执行，避免无操作者写审计', async () => {
    await expect(seed.run({ apply: true })).rejects.toMatchObject({
      code: 'SEED_SYSTEM_ADMIN_REQUIRED',
    })
    expect((await countRows(prisma)).roles).toBe(1)
  })

  it('预览模式不写入任何一行数据', async () => {
    const admin = await createSystemAdmin(prisma)
    expect(admin.userId).toMatch(/^[0-9a-f-]{36}$/u)

    const before = await countRows(prisma)
    const result = await seed.run({ apply: false })
    const after = await countRows(prisma)

    expect(result.applied).toBe(false)
    expect(after).toEqual(before)
    const currencies = await prisma.currency.findMany({ select: { code: true, enabled: true } })
    expect(currencies.filter(currency => currency.code !== 'CNY').every(currency => !currency.enabled)).toBe(true)
    // 新资金批次编号规则由 migration 预置（不是 seed 写入），预览只能保持这个基线。
    expect(await prisma.numberingRule.count()).toBe(1)
  })

  it('执行后六类内置数据全部就位', async () => {
    const result = await seed.run({ apply: true })

    expect(result.applied).toBe(true)
    expect(result.conflicts).toEqual([])

    await expectCurrencies(prisma)
    await expectDictionaries(prisma)
    await expectRoles(prisma)
    await expectNumberingRules(prisma)
    await expectShippingMarkBinding(prisma)
    await expectFundConfiguration(prisma)
  }, 180_000)

  it('重复执行不再写入任何数据并报告全部跳过', async () => {
    const before = await countRows(prisma)
    const result = await seed.run({ apply: true })
    const after = await countRows(prisma)

    expect(after).toEqual(before)
    expect(result.conflicts).toEqual([])
    for (const category of result.categories) {
      expect(category.created).toBe(0)
    }
  }, 120_000)
})

async function createSystemAdmin(prisma: PrismaService): Promise<{ userId: string }> {
  const role = await prisma.role.findFirstOrThrow({ where: { code: 'system_admin' } })
  const user = await prisma.user.create({
    data: {
      username: 'seed-admin',
      usernameNormalized: 'seed-admin',
      displayName: '系统管理员',
      passwordHash: 'e2e-only-not-a-real-password-hash',
      passwordChangedAt: new Date(),
    },
  })
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } })
  return { userId: user.id }
}

async function expectCurrencies(prisma: PrismaService) {
  const currencies = await prisma.currency.findMany({ include: { exchangeRate: true } })
  expect(currencies).toHaveLength(4)
  for (const [code, rate] of expectedRates) {
    const currency = currencies.find(item => item.code === code)
    expect(currency?.enabled).toBe(true)
    expect(currency?.exchangeRate?.foreignUnitsPerCny.toString()).toBe(rate)
  }
  expect(currencies.find(item => item.code === 'CNY')?.enabled).toBe(true)
  expect(currencies.find(item => item.code === 'CNY')?.exchangeRate).toBeNull()
}

async function expectDictionaries(prisma: PrismaService) {
  const types = await prisma.dictionaryType.findMany({ include: { items: true } })
  expect(types.map(type => type.code).sort()).toEqual(expectedDictionaries.map(([code]) => code).sort())
  for (const [code, values] of expectedDictionaries) {
    const type = types.find(item => item.code === code)
    expect({ code, enabled: type?.enabled }).toEqual({ code, enabled: true })
    const enabledValues = (type?.items ?? []).filter(item => item.enabled).map(item => item.value).sort()
    expect({ code, enabledValues }).toEqual({ code, enabledValues: [...values].sort() })
    // 数据集要求全部条目启用，不能出现停用条目。
    expect((type?.items ?? []).filter(item => !item.enabled)).toEqual([])
  }
}

async function expectRoles(prisma: PrismaService) {
  const roles = await prisma.role.findMany({
    include: { permissions: { include: { permission: true } } },
  })
  expect(roles.filter(role => !role.isSystem).map(role => role.code).sort())
    .toEqual(expectedRoles.map(([code]) => code).sort())
  for (const [code, count] of expectedRoles) {
    const role = roles.find(item => item.code === code)
    expect({ code, count: role?.permissions.length }).toEqual({ code, count })
    expect(role?.permissions.every(entry => entry.permission.systemOnly === false)).toBe(true)
  }
}

async function expectNumberingRules(prisma: PrismaService) {
  const rules = await prisma.numberingRule.findMany({
    include: { versions: { include: { segments: true } } },
  })
  expect(rules.map(rule => rule.ruleCode).sort()).toEqual(Object.keys(expectedRuleShapes).sort())

  for (const [ruleCode, shape] of Object.entries(expectedRuleShapes)) {
    const rule = rules.find(item => item.ruleCode === ruleCode)
    expect({ ruleCode, status: rule?.status }).toEqual({ ruleCode, status: 'ENABLED' })
    const active = rule?.versions.filter(version => version.status === 'ACTIVE') ?? []
    expect({ ruleCode, activeCount: active.length }).toEqual({ ruleCode, activeCount: 1 })
    expect({ ruleCode, shape: describeSegments(active[0].segments) }).toEqual({ ruleCode, shape })
  }
  expect(rules.find(rule => rule.ruleCode === 'CUSTOM_MARK')?.purpose).toBe('SHIPPING_MARK')
  expect(rules.find(rule => rule.ruleCode === 'CUSTOM_MARK')?.name).toBe('自定义产品唛头')
}

async function expectShippingMarkBinding(prisma: PrismaService) {
  const bindings = await prisma.supplierShippingMarkRuleBinding.findMany({
    include: { rule: true },
  })
  expect(bindings.map(binding => [binding.supplierValue, binding.rule.ruleCode]))
    .toEqual([['TEST', 'TEST_MARK']])
}

async function expectFundConfiguration(prisma: PrismaService) {
  const postingType = await prisma.fundPostingType.findUniqueOrThrow({
    where: { code: 'WOODEN_PACKING_COST' },
    include: { ruleVersions: { include: { legs: true } } },
  })
  expect(postingType).toMatchObject({
    name: '打木架费用',
    businessCategory: 'COST',
    requiresUser: true,
    amountSignPolicy: 'POSITIVE_ONLY',
    inputMode: 'STANDARD',
    enabled: true,
  })
  const active = postingType.ruleVersions.filter(version => version.status === 'ACTIVE')
  expect(active).toHaveLength(1)
  expect(postingType.currentRuleVersionId).toBe(active[0].id)
  expect(active[0].legs
    .sort((left, right) => left.position - right.position)
    .map(leg => [leg.position, leg.accountTarget, leg.directionPolicy, leg.amountStrategy]))
    .toEqual([
      [1, 'USER', 'DEBIT', 'USER_SHARE'],
      [2, 'COMPANY', 'DEBIT', 'COMPANY_REMAINDER'],
    ])

  const source = await prisma.fundBusinessSource.findUniqueOrThrow({
    where: { code: 'PACKAGING_COST' },
    include: { allowedPostingTypes: { include: { postingType: true } } },
  })
  expect(source.allowedPostingTypes.map(entry => entry.postingType.code))
    .toEqual(['WOODEN_PACKING_COST'])
}
