import { randomUUID } from 'node:crypto'

import request from 'supertest'

import type { ContainerBatchDto, ContainerLoadingItemDto } from '../src/modules/container-batches/container-batch.dto'
import type { ContainerSourceFileDto } from '../src/modules/container-batches/container-source-file.dto'
import type { PurchaseCorrectionContextDto, PurchaseCorrectionResultDto } from '../src/modules/purchase-orders/corrections/purchase-correction.dto'
import { createOceanXlsxFixture } from './fixtures/ocean-freight-xlsx.fixture'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { createReviewMutations } from './purchase-shipping-mark-atomicity.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = [
  'data-scope:all',
  'purchase-orders:read',
  'purchase-orders:payment',
  'purchase-orders:correction',
  'container-batches:read',
  'container-batches:create',
  'container-batches:update',
]
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describe('purchase chain correction over isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness
  let browser: ReturnType<typeof request.agent>
  let actorUserId: string
  let sequence = 30
  const post = (url: string, body: object) => browser.post(url).set(packagingHeaders).set('Idempotency-Key', randomUUID()).send(body)
  const reference = async <T>(url: string): Promise<T> => (await browser.get(url).expect(200)).body as T
  const upload = async (bytes: Buffer) => (await browser.post('/api/container-batches/source-file-uploads').set(packagingHeaders)
    .field('mediaType', 'DOCUMENT').attach('file', bytes, { filename: '装柜资料.xlsx', contentType: mime }).expect(201)).body as ContainerSourceFileDto
  async function batch(name = `0917-${String(++sequence).padStart(2, '0')}柜`) {
    const source = await upload(createOceanXlsxFixture())
    return (await post('/api/container-batches', { containerBatchName: name, warehouseValue: TEST_DESTINATION_WAREHOUSE, sourceFileId: source.mediaAssetId }).expect(201)).body as ContainerBatchDto
  }
  async function item(parentId: string, extra: object) {
    const parent = await reference<ContainerBatchDto>(`/api/container-batches/${parentId}`)
    return (await post(`/api/container-batches/${parentId}/items`, { expectedVersion: parent.version, goodsName: '履带', packageCount: 10, ...extra }).expect(201)).body as ContainerLoadingItemDto
  }
  const contextOf = (salesOrderId: string) => reference<PurchaseCorrectionContextDto>(`/api/purchase-order-corrections/context/${salesOrderId}`)
  const partFacts = (partId: string) => h.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: partId }, select: {
    status: true, shippedAt: true, warehouseReceivedAt: true, loadedAt: true, deliveredAt: true,
  } })
  async function attachDeliveryReceipt(salesOrderId: string): Promise<string> {
    return h.prisma.$transaction(async (transaction) => {
      const asset = await transaction.mediaAsset.create({ data: {
        mediaType: 'DOCUMENT', status: 'READY', originalFilename: 'delivery-receipt.pdf',
        objectKey: `assets/test/${randomUUID()}.pdf`, mimeType: 'application/pdf',
        sizeBytes: 3n, checksumSha256: 'a'.repeat(64), createdByUserId: actorUserId,
      } })
      const document = await transaction.salesOrderDocument.create({ data: {
        salesOrderId, mediaAssetId: asset.id, documentType: 'DELIVERY_RECEIPT',
        createdByUserId: actorUserId,
      } })
      return document.id
    })
  }
  async function markSigned(salesOrderId: string, partId: string): Promise<void> {
    await h.prisma.$executeRaw`
      UPDATE purchase_order_parts
      SET delivered_at = now(), delivered_by_id = ${actorUserId}::uuid, delivered_recorded_at = now()
      WHERE id = ${partId}::uuid
    `
    await h.prisma.salesOrder.update({ where: { id: salesOrderId }, data: {
      fulfillmentStatus: 'SIGNED', version: { increment: 1 },
    } })
  }
  let fundsSetup: Promise<unknown> | undefined
  async function payBalance(orderId: string) {
    fundsSetup ??= h.setupFunds()
    await fundsSetup
    const payable = await h.prisma.purchaseOrderPayable.findFirstOrThrow({
      where: { purchaseOrderId: orderId, paymentType: 'BALANCE' },
    })
    const profile = await h.prisma.paymentRecipientProfile.findUniqueOrThrow({
      where: { purchaseOrderId: orderId },
      include: { accounts: true },
    })
    const account = profile.accounts[0]
    const voucher = await h.prisma.mediaAsset.create({ data: {
      mediaType: 'IMAGE', status: 'UPLOADING', uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER',
      purchasePayableUploadId: payable.id, objectKey: `assets/${randomUUID()}.png`,
      originalFilename: 'payment.png', mimeType: 'image/png', sizeBytes: 1n,
      checksumSha256: '0'.repeat(64), width: 1, height: 1, createdByUserId: actorUserId,
      uploadExpiresAt: new Date(Date.now() + 3_600_000),
    } })
    await createReviewMutations(h.fixture).payPayable(
      { actorUserId, requestId: randomUUID() },
      payable.id,
      {
        expectedVersion: payable.version,
        paymentMethod: 'BANK_TRANSFER',
        recipientAccountId: account.id,
        recipientProfileVersion: profile.version,
        voucher: { mediaAssetId: voucher.id },
      },
      randomUUID(),
    )
    return h.prisma.purchaseOrderPayment.findFirstOrThrow({
      where: { payableId: payable.id, voidedAt: null },
    })
  }

  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    const session = await h.browserWithPermissions(permissions)
    browser = session.browser
    actorUserId = session.user.id
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const rule = await h.fixture.numberingCommands.create(context, {
      ruleCode: 'CONTAINER_BATCH_NO', purpose: 'BUSINESS', name: '柜次', resetPolicy: 'NEVER',
      segments: [{ type: 'FIXED', value: 'CB' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }],
    })
    const published = await h.fixture.numberingCommands.publish(context, rule.id, { expectedVersion: rule.version, draftRevision: 1 })
    await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })
  })
  afterAll(async () => { await h?.dispose() })

  it('returns an unsigned loaded sales order to pending purchase and keeps history', async () => {
    const shipment = await h.shipment({ salesLinked: true })
    const payment = await payBalance(shipment.order.id)
    const salesOrderId = shipment.source!.id
    const parent = await batch()
    await item(parent.id, { shipmentId: shipment.part.id })

    expect((await h.prisma.salesOrder.findUniqueOrThrow({ where: { id: salesOrderId } })).fulfillmentStatus).toBe('SEA_TRANSIT')
    const context = await contextOf(salesOrderId)
    expect(context.canApply).toBe(true)
    expect(context.blockers).toEqual([])
    expect(context.purchaseOrders).toHaveLength(1)
    expect(context.containerItems).toHaveLength(1)
    expect(context.containerItems[0].shipmentId).toBe(shipment.part.id)
    expect(context.containerItems[0].shipmentNo).toBe(shipment.part.shipmentNo)
    expect(context.payments).toEqual([expect.objectContaining({ id: payment.id, amount: '10.00' })])
    expect(context.totalPaymentAmount).toBe('10.00')

    const requestKey = randomUUID()
    const applyBody = {
      salesOrderId,
      expectedSalesOrderVersion: context.version,
      purchaseOrders: context.purchaseOrders.map(purchase => ({
        purchaseOrderId: purchase.id,
        expectedVersion: purchase.version,
      })),
      reason: '误建采购链，实际应为寄仓调货',
      confirmOrderNo: context.salesOrderNo,
    }
    const applyResponse = await browser.post('/api/purchase-order-corrections')
      .set(packagingHeaders)
      .set('Idempotency-Key', requestKey)
      .send(applyBody)
      .expect(200)
    const result = applyResponse.body as PurchaseCorrectionResultDto

    expect(result).toMatchObject({
      salesOrderId,
      salesOrderNo: context.salesOrderNo,
      fulfillmentStatus: 'PENDING',
      cancelledPurchaseOrders: [{ id: shipment.order.id }],
      reversedPayments: [expect.objectContaining({ id: payment.id, amount: '10.00' })],
      totalReversedAmount: '10.00',
    })

    const order = await h.prisma.salesOrder.findUniqueOrThrow({ where: { id: salesOrderId } })
    expect(order.orderStatus).toBe('CONFIRMED')
    expect(order.fulfillmentStatus).toBe('PENDING')
    const purchase = await h.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: shipment.order.id } })
    expect(purchase.orderStatus).toBe('CANCELLED')
    expect(purchase.fulfillmentStatus).toBe('PREPARING')
    expect(await partFacts(shipment.part.id)).toEqual({
      status: 'CANCELLED',
      shippedAt: null,
      warehouseReceivedAt: null,
      loadedAt: null,
      deliveredAt: null,
    })
    const loadingItem = await h.prisma.containerLoadingItem.findFirstOrThrow({ where: { containerBatchId: parent.id } })
    expect(loadingItem.shipmentId).toBeNull()
    expect(await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: parent.id }, select: { containerBatchNo: true } })).toMatchObject({ containerBatchNo: expect.any(String) as unknown })
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: parent.id } })).toBe(1)
    expect(await h.prisma.shipmentOwnershipCurrent.findUniqueOrThrow({ where: { shipmentId: shipment.part.id } })).toMatchObject({
      state: 'VOIDED',
      ownerType: 'SALES_ORDER',
      ownerSalesOrderId: salesOrderId,
    })
    expect(await h.prisma.purchaseChainCorrection.count({ where: { salesOrderId, appliedAt: { not: null } } })).toBe(1)
    const voided = await h.prisma.purchaseOrderPayment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(voided.voidedAt).not.toBeNull()
    expect(voided.fundReversalBatchId).not.toBeNull()
    expect(await h.prisma.fundPostingBatch.count({
      where: { id: voided.fundReversalBatchId!, kind: 'REVERSAL' },
    })).toBe(1)
    expect(await h.prisma.purchaseOrderPayable.count({
      where: { purchaseOrderId: shipment.order.id, closedAt: null },
    })).toBe(0)
    expect(await h.prisma.auditEvent.count({
      where: { eventType: 'PURCHASE_ORDER_CORRECTION_APPLIED', targetId: salesOrderId, actorUserId },
    })).toBe(1)

    // 同一请求重放返回同一纠正；不同内容使用同一 key 被拒绝。
    const replay = await browser.post('/api/purchase-order-corrections')
      .set(packagingHeaders)
      .set('Idempotency-Key', requestKey)
      .send(applyBody)
      .expect(200)
    expect(replay.body).toEqual(result)
    const conflict = await browser.post('/api/purchase-order-corrections')
      .set(packagingHeaders)
      .set('Idempotency-Key', requestKey)
      .send({ ...applyBody, reason: '不同的纠正原因' })
      .expect(409)
    expect(conflict.body as { code: string }).toMatchObject({ code: 'PURCHASE_CORRECTION_IDEMPOTENCY_CONFLICT' })
  })

  it('rejects direct fact clearing without an in-progress correction record', async () => {
    const shipment = await h.shipment({ salesLinked: true })
    const parent = await batch()
    await item(parent.id, { shipmentId: shipment.part.id })
    await expect(h.prisma.$executeRaw`
      UPDATE purchase_order_parts
      SET shipped_at = NULL, shipped_by_id = NULL, shipment_recorded_at = NULL, shipment_remark = NULL,
          warehouse_received_at = NULL, warehouse_received_by_id = NULL, warehouse_recorded_at = NULL, warehouse_remark = NULL
      WHERE id = ${shipment.part.id}::uuid
    `).rejects.toThrow(/Purchase part configuration is immutable/u)
    expect((await partFacts(shipment.part.id)).shippedAt).not.toBeNull()
  })

  it('corrects a signed order and detaches its receipt back to pending purchase', async () => {
    const shipment = await h.shipment({ salesLinked: true })
    const salesOrderId = shipment.source!.id
    const payment = await payBalance(shipment.order.id)
    const parent = await batch()
    await item(parent.id, { shipmentId: shipment.part.id })
    const receiptId = await attachDeliveryReceipt(salesOrderId)
    await markSigned(salesOrderId, shipment.part.id)

    const context = await contextOf(salesOrderId)
    expect(context.canApply).toBe(true)
    expect(context.signed).toBe(true)
    expect(context.deliveryReceipts).toEqual([expect.objectContaining({ id: receiptId })])
    expect(context.salesPaymentCount).toBe(0)
    expect(context.settlementCount).toBe(0)
    expect(context.containerItems).toEqual([
      expect.objectContaining({ action: 'DELETE', shipmentNo: shipment.part.shipmentNo }),
    ])
    expect(context.payments).toEqual([expect.objectContaining({ id: payment.id, amount: '10.00' })])

    const applyBody = {
      salesOrderId,
      expectedSalesOrderVersion: context.version,
      purchaseOrders: context.purchaseOrders.map(purchase => ({
        purchaseOrderId: purchase.id,
        expectedVersion: purchase.version,
      })),
      reason: '误建采购链，实际应为寄仓调货',
      confirmOrderNo: context.salesOrderNo,
    }
    const result = (await browser.post('/api/purchase-order-corrections')
      .set(packagingHeaders)
      .set('Idempotency-Key', randomUUID())
      .send(applyBody)
      .expect(200)).body as PurchaseCorrectionResultDto

    expect(result).toMatchObject({
      signed: true,
      fulfillmentStatus: 'PENDING',
      detachedDeliveryReceipts: [{ id: receiptId }],
      deletedContainerItems: [expect.objectContaining({ action: 'DELETE', shipmentNo: shipment.part.shipmentNo })],
      reversedPayments: [expect.objectContaining({ id: payment.id, amount: '10.00' })],
      totalReversedAmount: '10.00',
    })

    const order = await h.prisma.salesOrder.findUniqueOrThrow({ where: { id: salesOrderId } })
    expect(order.orderStatus).toBe('CONFIRMED')
    expect(order.fulfillmentStatus).toBe('PENDING')
    const purchase = await h.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: shipment.order.id } })
    expect(purchase.orderStatus).toBe('CANCELLED')
    expect(purchase.fulfillmentStatus).toBe('PREPARING')
    expect(await partFacts(shipment.part.id)).toEqual({
      status: 'CANCELLED',
      shippedAt: null,
      warehouseReceivedAt: null,
      loadedAt: null,
      deliveredAt: null,
    })
    expect(await h.prisma.salesOrderDocument.findUniqueOrThrow({ where: { id: receiptId } })).toMatchObject({
      detachedAt: expect.any(Date) as unknown,
      detachedByUserId: actorUserId,
    })
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: parent.id } })).toBe(0)
    expect(await h.prisma.auditEvent.count({
      where: { eventType: 'SALES_ORDER_DOCUMENT_DETACHED', targetId: receiptId },
    })).toBe(1)
    expect(await h.prisma.salesOrderStatusHistory.count({
      where: { salesOrderId, dimension: 'FULFILLMENT', fromStatus: 'SIGNED', toStatus: 'PENDING' },
    })).toBe(1)
  })
})
