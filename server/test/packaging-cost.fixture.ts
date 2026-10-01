import { withDatabaseBusinessClock } from './fixtures/database-business-clock.fixture'
import { createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { FileTypeResult } from 'file-type'
import sharp from 'sharp'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import mediaConfig, { createMediaConfiguration } from '../src/config/media.config'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { FundConfigurationCommandService } from '../src/modules/fund-accounts/application/fund-configuration-command.service'
import { MediaContentValidator } from '../src/modules/media/media-content-validator'
import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderWarehouseReceiptService } from '../src/modules/purchase-orders/warehouse-receipts/purchase-order-warehouse-receipt.service'
import { destinationWarehouses } from './purchase-destination-warehouse.fixture'
import { createAtomicityFixture, createCommands, createReviewMutations, customInput, prepareImageReview } from './purchase-shipping-mark-atomicity.fixture'

export const packagingHeaders = { Origin: 'http://127.0.0.1:9000', 'X-Qianshu-CSRF': '1', 'Sec-Fetch-Site': 'same-origin' }
export const packagingPermissions = ['packaging-costs:create', 'packaging-costs:read', 'packaging-costs:pay']

const runFile = promisify(execFile)
/** Jest 29 的模块沙箱不能加载 ESM-only file-type；由同版本原生 Node 执行真实检测，不伪造 MIME。 */
async function nativeImageProbe(path: string): Promise<FileTypeResult | undefined> {
  const { stdout } = await runFile(process.execPath, ['-e', "require('file-type').fileTypeFromFile(process.argv[1]).then(value => process.stdout.write(JSON.stringify(value ?? null)))", path], {
    cwd: resolve(__dirname, '..'), timeout: 5000, maxBuffer: 4096,
  })
  return (JSON.parse(stdout) as FileTypeResult | null) ?? undefined
}

/** 每套使用既有临时 schema 隔离器，正式迁移与业务守卫保持开启；媒体使用独占目录。 */
export async function createPackagingCostHarness(options: { nativeImageProbe?: boolean } = {}) {
  const fixture = await createAtomicityFixture()
  const mediaRoot = await mkdtemp(join(homedir(), '.qianshu-packaging-media-'))
  let application: INestApplication | undefined
  try {
    const configuration = createMediaConfiguration({ MEDIA_STORAGE_ROOT: mediaRoot })
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(fixture.prisma)
      .overrideProvider(mediaConfig.KEY).useValue(configuration)
    if (options.nativeImageProbe) builder.overrideProvider(MediaContentValidator).useValue(new MediaContentValidator(configuration, { detectFileType: nativeImageProbe }))
    const module = await builder.compile()
    const app = module.createNestApplication()
    application = app
    configureApplication(app, { nodeEnvironment: 'test' })
    await app.init()
    const prisma = fixture.prisma
    const type = await prisma.dictionaryType.create({ data: {
      code: 'warehouse.packaging_type', name: '包装类型', enabled: false,
      items: { create: [
        { value: 'WOODEN_BOX', label: '木箱', enabled: true },
        { value: 'WOODEN_FRAME', label: '木架', enabled: true },
      ] },
    } })
    await prisma.dictionaryType.update({ where: { id: type.id }, data: { enabled: true } })
    const regions: string[] = []
    for (const level of ['COUNTRY_REGION', 'PROVINCE_STATE', 'CITY'] as const) {
      const region = await prisma.region.create({ data: {
        code: `PKG-${level}`, name: `包装${level}`, normalizedName: `包装${level}`,
        administrativeType: level, level, enabled: true, parentId: regions.at(-1),
      } })
      regions.push(region.id)
    }
    const query = new PurchaseOrderQueryService(prisma, new DictionaryLookupService(prisma), createPaymentRecipientFixture(prisma))

    async function browserWithPermissions(codes = packagingPermissions) {
      const username = `packaging_http_${randomUUID()}`
      const password = `P9!${randomBytes(8).toString('hex')}`
      const user = await prisma.user.create({ data: {
        username, usernameNormalized: username, displayName: '包装费用测试用户',
        passwordHash: await app.get(PasswordProvider).hash(password), passwordChangedAt: new Date(),
      } })
      const permissions = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } })
      if (permissions.length !== codes.length) throw new Error('Packaging cost test permissions are missing')
      const role = await prisma.role.create({ data: {
        code: `packaging_http_${randomUUID()}`, name: '包装费用测试权限',
        permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) },
      } })
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } })
      const browser = request.agent(app.getHttpServer())
      await browser.post('/api/auth/login').set(packagingHeaders).send({ username, password }).expect(200)
      return { browser, user, role, credentials: { username, password } }
    }

    /**
     * 一个销售订单可以拆成多个货件：`partCount` 控制货件数，`salesLineQuantity` 控制销售行数量。
     * 两者默认相等（采购与销售数量对齐）；用例要验证「销售行未被完全覆盖」时传更大的 `salesLineQuantity`。
     */
    async function shipment(options: { received?: boolean, salesLinked?: boolean, ownerUserId?: string, partCount?: number, salesLineQuantity?: number } = {}) {
      const input = await customInput(fixture)
      const partCount = options.partCount ?? 1, lineQuantity = options.salesLineQuantity ?? partCount
      const lineAmount = String(10 * lineQuantity)
      const source = options.salesLinked === false ? null : await prisma.salesOrder.create({ data: {
        orderNo: `PKG-SO-${randomUUID()}`, createIdempotencyKeyHash: randomBytes(32),
        createRequestFingerprintHash: randomBytes(32), orderDate: new Date('2026-09-07'),
        issuerUserId: options.ownerUserId ?? fixture.actor.id, currencyCode: 'TWD', customerName: '包装客户', customerPhone: '12345678',
        customerCountryRegionId: regions[0], customerProvinceStateId: regions[1], customerCityId: regions[2],
        customerCountryRegionCodeSnapshot: 'PKG_COUNTRY', customerProvinceStateCodeSnapshot: 'PKG_PROVINCE', customerCityCodeSnapshot: 'PKG_CITY',
        customerCountryRegionNameSnapshot: '国家', customerProvinceStateNameSnapshot: '省份', customerCityNameSnapshot: '城市',
        customerAddressDetail: '测试地址', customerFullAddressSnapshot: '国家省份城市测试地址',
        lineSubtotalAmount: lineAmount, agreedTotalAmount: lineAmount, depositDueAmount: '0', balanceDueAmount: lineAmount,
        orderStatus: 'CONFIRMED', fulfillmentStatus: 'PENDING', paymentStatus: 'UNPAID',
        lines: { create: { lineNumber: 1, lineType: 'CUSTOM', productNameSnapshot: 'Custom item',
          actualUnitPriceAmount: '10', quantity: lineQuantity, lineTotalAmount: lineAmount } },
      }, include: { lines: true } })
      const id = await createCommands(fixture).create(fixture.context(), source === null ? input : {
        ...input, purchaseType: 'SALES_LINKED', salesOrderId: source.id,
        parts: Array.from({ length: partCount }, () => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
        lines: [{ ...input.lines[0], quantity: lineQuantity, sourceSalesOrderLineId: source.lines[0].id }],
        purchaseTotalAmount: lineAmount, balanceDueAmount: lineAmount,
      })
      await createReviewMutations(fixture).review(fixture.context(), id, await prepareImageReview(fixture, id))
      const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { parts: { orderBy: { partNumber: 'asc' } } } })
      const partIds = order.parts.map(part => part.id)
      await withDatabaseBusinessClock(fixture.prisma, async () => new PurchaseOrderFactoryShipmentService(prisma, fixture.audit, fixture.salesProgress, new DictionaryLookupService(prisma))
        .shipPurchaseOrder(fixture.context(), id, { expectedVersion: order.version, partIds, destinationWarehouses: destinationWarehouses(partIds) }))
      if (options.received !== false) {
        await new PurchaseOrderWarehouseReceiptService(prisma, fixture.audit, query)
          .receive(fixture.context(), id, { expectedVersion: (await query.getById(id)).version, partIds })
      }
      const parts = await prisma.purchaseOrderPart.findMany({ where: { id: { in: partIds } }, orderBy: { partNumber: 'asc' } })
      return { part: parts[0], parts, order, source }
    }

    async function upload(browser: ReturnType<typeof request.agent>, extension: 'png' | 'jpeg' | 'webp' = 'png', url = '/api/packaging-cost-requests/images') {
      const buffer = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#c9b39b' } }).toFormat(extension).toBuffer()
      const response = await browser.post(url).set(packagingHeaders)
        .field('mediaType', 'IMAGE').attach('file', buffer, { filename: `evidence.${extension}`, contentType: `image/${extension}` })
      if (response.status !== 201) {
        const error = response.body as { code?: string }
        const asset = await prisma.mediaAsset.findFirst({ where: { originalFilename: `evidence.${extension}` }, orderBy: { createdAt: 'desc' }, select: { failureCode: true } })
        throw new Error(`Packaging image upload returned ${response.status}: ${error.code ?? 'UNKNOWN'} / ${asset?.failureCode ?? 'NO_ASSET_FAILURE'}`)
      }
      const body = response.body as { mediaAssetId: string }
      if (typeof body.mediaAssetId !== 'string') throw new Error('Packaging cost image response is invalid')
      return body.mediaAssetId
    }

    let profileSetup: Promise<void> | undefined
    function ensureProfile() {
      profileSetup ??= (async () => {
        const admin = await browserWithPermissions(['supplier-payment-profiles:read', 'supplier-payment-profiles:update'])
        const qr = await upload(admin.browser, 'png', '/api/payment-recipient-images')
        await admin.browser.put('/api/packaging-payment-profiles/CHENGXIN').set(packagingHeaders).send({ expectedVersion: 0, accounts: [{ paymentMethod: 'ALIPAY', recipientName: '诚信木箱', qrMediaAssetId: qr }] }).expect(200)
      })()
      return profileSetup
    }

    async function input(browser: ReturnType<typeof request.agent>, shipmentId: string) {
      await ensureProfile()
      return {
        shipmentId, packagingType: 'WOODEN_BOX', packagingVendor: 'CHENGXIN' as const, amount: '280.50',
        packagingImageMediaAssetId: await upload(browser), quotationImageMediaAssetId: await upload(browser, 'webp'),
        remark: '已完成包装，请确认付款',
      }
    }

    /** 仅给销售归属人开户；付款人及提报人的账户必须显式创建，避免夹具掩盖扣错人的错误。 */
    async function setupFunds(userShareRate = '30') {
      const context = { actorUserId: fixture.actor.id, requestId: randomUUID() }
      const configurations = app.get(FundConfigurationCommandService)
      let postingType = await prisma.fundPostingType.findUnique({ where: { code: 'WOODEN_PACKING_COST' } })
      if (!postingType) {
        const created = await configurations.createPostingType(context, {
          code: 'WOODEN_PACKING_COST', name: '打木架费用', businessCategory: 'COST', requiresUser: true, amountSignPolicy: 'POSITIVE_ONLY',
          legs: [
            { position: 1, accountTarget: 'USER', directionPolicy: 'DEBIT', amountStrategy: 'USER_SHARE' },
            { position: 2, accountTarget: 'COMPANY', directionPolicy: 'DEBIT', amountStrategy: 'COMPANY_REMAINDER' },
          ],
        })
        const published = await configurations.publishDraftRule(context, { postingTypeId: created.id, draftRuleVersionId: created.draftRule!.id, expectedVersion: created.version })
        await configurations.setPostingTypeEnabled(context, { postingTypeId: created.id, enabled: true, expectedVersion: published.postingType.version })
        postingType = await prisma.fundPostingType.findUniqueOrThrow({ where: { id: created.id } })
      }
      const source = await prisma.fundBusinessSource.findUnique({ where: { code: 'PACKAGING_COST' } })
      if (!source) {
        await configurations.createBusinessSource(context, { code: 'PACKAGING_COST', name: '包装费用付款', enabled: true, allowedPostingTypeIds: [postingType.id] })
      } else {
        const updated = await configurations.updateBusinessSource(context, { businessSourceId: source.id, name: source.name, description: source.description, allowedPostingTypeIds: [postingType.id], expectedVersion: source.version })
        if (!updated.businessSource.enabled) await configurations.setBusinessSourceEnabled(context, { businessSourceId: source.id, enabled: true, expectedVersion: updated.businessSource.version })
      }
      const ownerAccount = await app.get(FundAccountCommandService).createUserAccount(context, { userId: fixture.actor.id, userShareRate })
      return { ownerAccount, postingType }
    }

    return { app, prisma, fixture, mediaRoot, browserWithPermissions, shipment, upload, input, setupFunds, ensureProfile,
      async dispose() { await app.close(); await fixture.dispose(); await rm(mediaRoot, { recursive: true, force: true }) },
    }
  } catch (error) {
    await application?.close()
    await fixture.dispose()
    await rm(mediaRoot, { recursive: true, force: true })
    throw error
  }
}

export type PackagingCostHarness = Awaited<ReturnType<typeof createPackagingCostHarness>>
