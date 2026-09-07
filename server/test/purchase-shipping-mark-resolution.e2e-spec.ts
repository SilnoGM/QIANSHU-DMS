import { randomUUID } from 'node:crypto'

import type { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import type { NumberingRuleConfigResponseDto } from '../src/modules/numbering/dto/numbering-response.dto'
import { NumberingCommandService } from '../src/modules/numbering/numbering-command.service'
import { NumberingQueryService } from '../src/modules/numbering/numbering-query.service'
import { PurchaseShippingMarkResolverService } from '../src/modules/purchase-shipping-marks/purchase-shipping-mark-resolver.service'
import { PurchaseShippingMarksService } from '../src/modules/purchase-shipping-marks/purchase-shipping-marks.service'
import { IsolatedNumberingPrismaService } from './numbering-e2e-database'
import { createPurchaseShippingMarkDatabase } from './purchase-shipping-mark-e2e-database'

const ACTIVE_CONFIG: NumberingRuleConfigResponseDto = {
  resetPolicy: 'DAILY', timezone: 'Asia/Shanghai', maxOutputLength: 30,
  segments: [
    { type: 'FIXED', value: 'SM' }, { type: 'DATE', format: 'YYYYMMDD' },
    { type: 'SEPARATOR', value: '-' },
    { type: 'SEQUENCE', width: 16, startValue: '9007199254740993', step: '7' },
    { type: 'RANDOM', letterLength: 2, digitLength: 1, mode: 'SHUFFLED' },
  ],
}
const NEXT_CONFIG: NumberingRuleConfigResponseDto = {
  resetPolicy: 'NEVER', timezone: 'Asia/Shanghai', maxOutputLength: 8,
  segments: [{ type: 'FIXED', value: 'NEXT' }, { type: 'SEQUENCE', width: 4, startValue: '10', step: '2' }],
}

async function createFixture() {
  const database = await createPurchaseShippingMarkDatabase()
  const prisma = new IsolatedNumberingPrismaService(database) as unknown as PrismaService
  try {
    await prisma.onModuleInit()
    const actor = await prisma.user.create({ data: {
      username: 'mark-resolution', usernameNormalized: 'mark-resolution', displayName: 'Mark resolution',
      passwordHash: 'e2e-only-not-a-real-password-hash', passwordChangedAt: new Date(),
    } })
    const audit = new AuditService()
    const lookup = new DictionaryLookupService(prisma)
    return {
      prisma, actor, context: { actorUserId: actor.id, requestId: randomUUID() },
      commands: new NumberingCommandService(prisma, audit, new NumberingQueryService(prisma)),
      resolver: new PurchaseShippingMarkResolverService(prisma, lookup),
      bindings: new PurchaseShippingMarksService(prisma, lookup, audit),
      async dispose() { await prisma.onModuleDestroy(); await database.dispose() },
    }
  }
  catch (error) { await prisma.onModuleDestroy(); await database.dispose(); throw error }
}

async function readOnlyFacts(prisma: PrismaService) {
  const [periods, ledger, audits] = await Promise.all([
    prisma.numberingPeriodState.count(), prisma.numberingIssuance.count(), prisma.auditEvent.count(),
  ])
  return { periods, ledger, audits }
}

describe('purchase shipping mark active config with real PostgreSQL', () => {
  jest.setTimeout(60_000)

  it('returns only ACTIVE ordered config through draft, publish and disable without issuing or reserving', async () => {
    const fixture = await createFixture()
    const { prisma, commands, resolver, context } = fixture
    try {
      const read = () => resolver.read({ productMode: 'CUSTOM' })
      expect(await read()).toMatchObject({ availability: 'RULE_MISSING', activeConfig: null })
      const created = await commands.create(context, {
        ruleCode: 'CUSTOM_MARK', purpose: 'SHIPPING_MARK', name: 'Current custom mark',
        resetPolicy: ACTIVE_CONFIG.resetPolicy, segments: ACTIVE_CONFIG.segments,
      })
      // 未发布草稿有完整配置，但采购摘要不得把它当作生效配置。
      expect(await read()).toMatchObject({ activeRevision: null, activeConfig: null, resolutionToken: null })
      const published = await commands.publish(context, created.id, { expectedVersion: created.version, draftRevision: 1 })
      expect(await read()).toMatchObject({ availability: 'RULE_DISABLED', activeRevision: 1, activeConfig: ACTIVE_CONFIG, resolutionToken: null })
      const enabled = await commands.enable(context, created.id, { expectedVersion: published.version })
      const available = await read()
      expect(available).toMatchObject({ availability: 'AVAILABLE', activeRevision: 1, activeConfig: ACTIVE_CONFIG })
      const draft = await commands.update(context, created.id, {
        expectedVersion: enabled.version, resetPolicy: NEXT_CONFIG.resetPolicy, segments: NEXT_CONFIG.segments,
      })
      const beforeDraftRead = await readOnlyFacts(prisma)
      expect(await read()).toEqual(available)
      expect(await readOnlyFacts(prisma)).toEqual(beforeDraftRead)
      const republished = await commands.publish(context, created.id, { expectedVersion: draft.version, draftRevision: 2 })
      const revised = await read()
      expect(revised).toMatchObject({ availability: 'AVAILABLE', activeRevision: 2, activeConfig: NEXT_CONFIG })
      expect(revised.resolutionToken).not.toBe(available.resolutionToken)

      const dictionary = await prisma.dictionaryType.findUniqueOrThrow({ where: { code: 'service_provider.supplier' } })
      await prisma.dictionaryItem.create({ data: { dictionaryTypeId: dictionary.id, value: 'CONFIG_SUPPLIER', label: 'Config supplier', enabled: true } })
      await prisma.dictionaryType.update({ where: { id: dictionary.id }, data: { enabled: true } })
      await fixture.bindings.save(context, 'CONFIG_SUPPLIER', { ruleId: created.id, expectedVersion: 0 })
      const beforeCatalogRead = await readOnlyFacts(prisma)
      expect(await resolver.read({ productMode: 'CATALOG', supplierValue: 'CONFIG_SUPPLIER' }))
        .toMatchObject({ matchSource: 'SUPPLIER_BINDING', activeRevision: 2, activeConfig: NEXT_CONFIG })
      expect(await readOnlyFacts(prisma)).toEqual(beforeCatalogRead)
      await commands.disable(context, created.id, { expectedVersion: republished.version })
      const beforeDisabledRead = await readOnlyFacts(prisma)
      expect(await read()).toMatchObject({ availability: 'RULE_DISABLED', activeRevision: 2, activeConfig: NEXT_CONFIG, resolutionToken: null })
      expect(await readOnlyFacts(prisma)).toEqual({ ...beforeDisabledRead, periods: 0, ledger: 0 })
    }
    finally { await fixture.dispose() }
  })

  it('does not expose the active BUSINESS config when CUSTOM_MARK has the wrong purpose', async () => {
    const fixture = await createFixture()
    const { prisma, commands, resolver, context } = fixture
    try {
      const created = await commands.create(context, {
        ruleCode: 'CUSTOM_MARK', purpose: 'BUSINESS', name: 'Business rule',
        resetPolicy: NEXT_CONFIG.resetPolicy, segments: NEXT_CONFIG.segments,
      })
      const published = await commands.publish(context, created.id, { expectedVersion: created.version, draftRevision: 1 })
      await commands.enable(context, created.id, { expectedVersion: published.version })
      const before = await readOnlyFacts(prisma)
      expect(await resolver.read({ productMode: 'CUSTOM' }))
        .toMatchObject({ availability: 'WRONG_PURPOSE', activeRevision: 1, activeConfig: null, resolutionToken: null })
      expect(await readOnlyFacts(prisma)).toEqual(before)
    }
    finally { await fixture.dispose() }
  })
})
