import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../src/app.module'
import { AuditEventType } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { ProductAliasService } from '../src/modules/product-aliases/product-alias.service'

jest.setTimeout(60_000)

const PREFIX = 'product_alias_e2e_'

describe('product aliases against PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let service: ProductAliasService
  let userAId: string
  let userBId: string
  let productId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    application = moduleRef.createNestApplication()
    await application.init()
    prisma = application.get(PrismaService)
    service = application.get(ProductAliasService)
    userAId = await createUser('a')
    userBId = await createUser('b')
    const product = await prisma.product.create({
      data: {
        name: '别名 E2E 产品',
        productNo: `${PREFIX}${randomUUID().slice(0, 8)}`,
        status: 'INACTIVE',
        supplierValue: 'TEST',
        createdByUserId: userAId,
      },
      select: { id: true },
    })
    productId = product.id
  })

  afterAll(async () => {
    try {
      await prisma.userProductAlias.deleteMany({ where: { productId } })
      await prisma.auditEvent.deleteMany({ where: { targetId: productId } })
      await prisma.product.deleteMany({ where: { id: productId } })
      await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId].filter(Boolean) } } })
      await application?.close()
    }
    catch {
      // 隔离 CI 数据库会在本次运行后销毁；清理失败不掩盖测试结论。
    }
  })

  async function createUser(label: string): Promise<string> {
    const suffix = randomUUID().replaceAll('-', '')
    const username = `${PREFIX}${label}_${suffix}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: `别名 E2E ${label}`,
        passwordHash: 'not-a-real-hash',
        passwordChangedAt: new Date('2026-01-01T00:00:00.000Z'),
        profile: { create: {} },
      },
      select: { id: true },
    })
    return user.id
  }

  it('stores an alias per user, isolates other users and audits the change', async () => {
    const created = await service.upsert(
      { actorUserId: userAId, requestId: 'alias-e2e-create' },
      productId,
      { alias: '  破碎  机  ' },
    )
    expect(created).toMatchObject({ productId, alias: '破碎 机' })

    const mine = await service.listMine(userAId, { productIds: productId })
    expect(mine.items).toHaveLength(1)
    expect(mine.items[0]).toMatchObject({ productId, alias: '破碎 机' })

    const other = await service.listMine(userBId, { productIds: productId })
    expect(other.items).toEqual([])

    const audit = await prisma.auditEvent.findFirst({
      where: { targetId: productId, eventType: AuditEventType.PRODUCT_ALIAS_UPDATED },
      orderBy: { occurredAt: 'desc' },
      select: { actorUserId: true, metadata: true },
    })
    expect(audit?.actorUserId).toBe(userAId)
    expect(audit?.metadata).toMatchObject({
      productNo: expect.stringContaining(PREFIX) as unknown,
      previousAlias: null,
      alias: '破碎 机',
    })

    expect((await service.resolveForIssuer(userAId, [productId])).get(productId)).toBe('破碎 机')
    expect((await service.resolveForIssuer(userBId, [productId])).has(productId)).toBe(false)
  })

  it('resolves product default aliases independently from personal aliases', async () => {
    await prisma.product.update({
      where: { id: productId },
      data: { defaultAlias: '默认破碎机' },
    })
    expect((await service.resolveDefaults([productId])).get(productId)).toBe('默认破碎机')
    expect((await service.resolveForIssuer(userAId, [productId])).has(productId)).toBe(false)
  })

  it('updates once, then clears and audits the clear', async () => {
    await service.upsert(
      { actorUserId: userAId, requestId: 'alias-e2e-update' },
      productId,
      { alias: '木桌' },
    )
    await service.clear(
      { actorUserId: userAId, requestId: 'alias-e2e-clear' },
      productId,
    )
    expect(await service.listMine(userAId, { productIds: productId })).toEqual({ items: [] })
    expect(await prisma.auditEvent.count({
      where: { targetId: productId, eventType: AuditEventType.PRODUCT_ALIAS_CLEARED },
    })).toBe(1)
  })

  it('enforces the database uniqueness boundary', async () => {
    await prisma.userProductAlias.create({
      data: { productId, userId: userAId, alias: '一' },
    })
    await expect(prisma.userProductAlias.create({
      data: { productId, userId: userAId, alias: '二' },
    })).rejects.toMatchObject({ code: 'P2002' })
    await prisma.userProductAlias.deleteMany({ where: { productId } })
  })
})
