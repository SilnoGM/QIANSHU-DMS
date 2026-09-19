import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { FundAccount, Prisma } from '../src/generated/prisma/client'
import { AuditService } from '../src/modules/audit/audit.service'
import type { ContainerBatchDto, ContainerLoadingItemDto } from '../src/modules/container-batches/container-batch.dto'
import { FundPostingApplicationService } from '../src/modules/fund-accounts/application/fund-posting.service'
import { OceanFreightBillCalculationService } from '../src/modules/ocean-freight-bills/ocean-freight-bill-calculation.service'
import type { OceanFreightBillDto, OceanFreightBillLineDto } from '../src/modules/ocean-freight-bills/ocean-freight-bill.dto'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = ['container-batches:read', 'container-batches:create', 'container-batches:update', 'ocean-freight-bills:read', 'ocean-freight-bills:create', 'ocean-freight-bills:update']
const dimensions = { packageCount: 10, lengthCm: '128', widthCm: '19', heightCm: '15', grossWeightKg: '180', reportedVolumeCai: '12.88' }

describe('ocean freight calculations against isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness
  let browser: ReturnType<typeof request.agent>
  let actorId: string
  let fundSpy: jest.SpyInstance
  let fundAccountsBefore: FundAccount[]
  let calculator: OceanFreightBillCalculationService
  const post = (url: string, body: object, key = randomUUID()) => browser.post(url).set(packagingHeaders).set('Idempotency-Key', key).send(body)
  async function createBill(twdPerCny = '4.8') {
    return (await post('/api/ocean-freight-bills', { billName: `Calculation ${randomUUID()}`, twdPerCny }).expect(201)).body as OceanFreightBillDto
  }
  async function createLine(billId: string, input: object = {}) {
    return (await post(`/api/ocean-freight-bills/${billId}/lines`, { lineType: 'NORMAL', goodsName: 'Calculation cargo', ...input }).expect(201)).body as OceanFreightBillLineDto
  }
  async function createCharge(billLineId: string, input: Partial<Prisma.OceanFreightBillChargeUncheckedCreateInput> = {}) {
    return h.prisma.oceanFreightBillCharge.create({ data: {
      billLineId, chargeType: 'FREIGHT', pricingBasis: 'FIXED', currencyCode: 'CNY', chargeNature: 'NORMAL', amount: '0',
      createdById: actorId, updatedById: actorId, ...input,
    } })
  }
  async function recalculate(billId: string, updateParent = true) {
    await h.prisma.$transaction(async tx => {
      await calculator.recalculateInTransaction(tx, billId)
      if (updateParent) await tx.oceanFreightBill.update({ where: { id: billId }, data: { version: { increment: 1 }, updatedById: actorId } })
    })
  }
  async function getBill(id: string) { return (await browser.get(`/api/ocean-freight-bills/${id}`).expect(200)).body as OceanFreightBillDto }

  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    const actor = await h.browserWithPermissions(permissions)
    browser = actor.browser
    actorId = actor.user.id
    for (const [ruleCode, prefix] of [['CONTAINER_BATCH_NO', 'CB'], ['CTN_BILL_NO', 'OFB']]) {
      const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
      const rule = await h.fixture.numberingCommands.create(context, { ruleCode, purpose: 'BUSINESS', name: ruleCode, resetPolicy: 'NEVER',
        segments: [{ type: 'FIXED', value: prefix }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }] })
      const published = await h.fixture.numberingCommands.publish(context, rule.id, { expectedVersion: rule.version, draftRevision: 1 })
      await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })
    }
    calculator = h.app.get(OceanFreightBillCalculationService)
    fundAccountsBefore = await h.prisma.fundAccount.findMany({ orderBy: { id: 'asc' } })
    fundSpy = jest.spyOn(h.app.get(FundPostingApplicationService), 'postBusinessEventInTransaction')
  })
  afterAll(async () => {
    fundSpy?.mockRestore()
    await h?.dispose()
  })

  it('计算装柜整行材积、保留来源差异和整行重量，拒绝伪造派生值及溢出', async () => {
    const batch = (await post('/api/container-batches', { containerBatchName: '0919柜', warehouseValue: TEST_DESTINATION_WAREHOUSE }).expect(201)).body as ContainerBatchDto
    const path = `/api/container-batches/${batch.id}/items`
    const item = (await post(path, { expectedVersion: 1, goodsName: 'Grouped cargo', ...dimensions, oceanShippingMarkText: 'L-010831-01~10' }).expect(201)).body as ContainerLoadingItemDto
    expect(item).toMatchObject({ packageCount: 10, volumeCai: '12.88272063', chargeableVolumeCai: 13, volumeDifferenceCai: '0.00272063', reportedVolumeCai: '12.88000000', grossWeightKg: '180.000' })
    const stored = await h.prisma.containerLoadingItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(stored.volumeCai?.toFixed(8)).toBe('12.88272063')
    expect(stored.grossWeightKg?.toFixed()).toBe('180')
    const missing = (await post(path, { expectedVersion: 2, goodsName: 'Incomplete cargo', packageCount: 1, widthCm: '1' }).expect(201)).body as ContainerLoadingItemDto
    expect(missing).toMatchObject({ volumeCai: null, chargeableVolumeCai: null, volumeDifferenceCai: null })
    const baseline = await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: batch.id } })
    for (const addition of [
      { volumeCai: '99' }, { chargeableVolumeCai: 99 },
      { lengthCm: '999999999999999', widthCm: '999999999999999', heightCm: '999999999999999' },
      { packageCount: 1, lengthCm: '0.001', widthCm: '0.001', heightCm: '0.001' },
    ]) {
      await post(path, { expectedVersion: 3, goodsName: 'Rejected cargo', ...dimensions, ...addition }).expect(422)
    }
    expect(await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: batch.id } })).toEqual(baseline)
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: batch.id } })).toBe(2)
  })

  it('账单新增行返回并保存材积；无费用不制造零合计，未知与伪造值均有明确边界', async () => {
    const bill = await createBill()
    const line = await createLine(bill.id, { ...dimensions, codAmountTwd: '480' })
    expect(line).toMatchObject({ volumeCai: '12.88272063', chargeableVolumeCai: 13, volumeDifferenceCai: '0.00272063', grossWeightKg: '180.000', reportedVolumeCai: '12.88000000', reconciliationStatus: 'UNMATCHED', chargeTotalAmountTwd: null, payableAmountCny: null, returnAmountCny: null })
    const persisted = await h.prisma.oceanFreightBillLine.findUniqueOrThrow({ where: { id: line.id } })
    expect(persisted.volumeCai?.toFixed(8)).toBe('12.88272063')
    expect(await getBill(bill.id)).toMatchObject({ codTotalAmountTwd: '480.00', payableAmountCny: null, returnAmountCny: null })
    const before = await h.prisma.oceanFreightBill.findUniqueOrThrow({ where: { id: bill.id } })
    for (const addition of [
      { netReturnAmountCny: '9' }, { volumeCai: '1' },
      { ...dimensions, lengthCm: '999999999999999', widthCm: '999999999999999', heightCm: '999999999999999' },
      { packageCount: 1, lengthCm: '0.001', widthCm: '0.001', heightCm: '0.001' },
    ]) {
      await post(`/api/ocean-freight-bills/${bill.id}/lines`, { lineType: 'NORMAL', goodsName: 'Rejected', ...addition }).expect(422)
    }
    expect(await h.prisma.oceanFreightBill.findUniqueOrThrow({ where: { id: bill.id } })).toEqual(before)
    expect(await h.prisma.oceanFreightBillLine.count({ where: { billId: bill.id } })).toBe(1)
  })

  it('补费代收先区分未决、历史和本次值，保留来源并约束重试判定', async () => {
    const bill = await createBill()
    const path = `/api/ocean-freight-bills/${bill.id}/lines`
    for (const [meaning, effective] of [[undefined, null], ['HISTORICAL_REFERENCE', '0.00'], ['CURRENT', '1000.00']] as const) {
      const key = randomUUID()
      const input = { lineType: 'ADJUSTMENT', goodsName: 'Supplement', codAmountTwd: '1000', ...(meaning ? { codSourceTreatment: meaning } : {}) }
      const line = (await post(path, input, key).expect(201)).body as OceanFreightBillLineDto
      expect(line).toMatchObject({ codAmountTwd: effective, reportedCodAmountTwd: '1000.00', codSourceTreatment: meaning ?? 'UNRESOLVED' })
      const persisted = await h.prisma.oceanFreightBillLine.findUniqueOrThrow({ where: { id: line.id } })
      expect(persisted.codAmountTwd?.toFixed(2) ?? null).toBe(effective)
      expect(persisted.sourceData).toEqual({ oceanFreightCod: { version: 1, meaning: meaning ?? 'UNRESOLVED', reportedAmountTwd: '1000.00' } })
      await post(path, { ...input, codSourceTreatment: meaning === 'CURRENT' ? 'HISTORICAL_REFERENCE' : 'CURRENT' }, key).expect(409)
    }
    expect(await getBill(bill.id)).toMatchObject({ codTotalAmountTwd: null, returnAmountCny: null })
  })

  it('按真实数据库原始值重算计重、计材、固定、补费及减免费用，重复重算不改变版本', async () => {
    const bill = await createBill()
    const cargo = await createLine(bill.id, { ...dimensions, codAmountTwd: '480' })
    const supplement = await createLine(bill.id, { lineType: 'ADJUSTMENT', codAmountTwd: '0' })
    const volume = await createCharge(cargo.id, { pricingBasis: 'VOLUME', unitPriceAmount: '20', chargeableQuantity: '999', amount: '999' })
    const weight = await createCharge(cargo.id, { pricingBasis: 'WEIGHT', unitPriceAmount: '0.2', chargeableQuantity: '999', amount: '999' })
    await createCharge(cargo.id, { currencyCode: 'TWD', chargeType: 'DELIVERY', amount: '48' })
    await createCharge(cargo.id, { currencyCode: 'TWD', chargeType: 'DELIVERY', chargeNature: 'DEDUCTION', amount: '8', reportedAmount: '-8', remark: 'Delivery deduction' })
    await createCharge(supplement.id, { currencyCode: 'TWD', chargeType: 'DELIVERY', chargeNature: 'SUPPLEMENT', amount: '500', remark: 'Additional delivery' })
    await recalculate(bill.id)
    const storedVolume = await h.prisma.oceanFreightBillCharge.findUniqueOrThrow({ where: { id: volume.id } })
    const storedWeight = await h.prisma.oceanFreightBillCharge.findUniqueOrThrow({ where: { id: weight.id } })
    expect([storedVolume.chargeableQuantity?.toFixed(), storedVolume.amount.toFixed(2)]).toEqual(['13', '260.00'])
    expect([storedWeight.chargeableQuantity?.toFixed(), storedWeight.amount.toFixed(2)]).toEqual(['180', '36.00'])
    const stored = await h.prisma.oceanFreightBillLine.findMany({ where: { billId: bill.id }, orderBy: { lineNumber: 'asc' } })
    expect(stored.map(line => line.netReturnAmountCny?.toFixed(2))).toEqual(['-204.33', '-104.17'])
    expect(await getBill(bill.id)).toMatchObject({ codTotalAmountTwd: '480.00', chargeTotalAmountTwd: '540.00', payableAmountCny: '296.00', returnAmountCny: '-12.50', netReturnAmountCny: '-308.50', roundingDifferenceCny: '0.00' })
    await recalculate(bill.id, false)
    expect(await h.prisma.oceanFreightBillLine.findMany({ where: { billId: bill.id }, orderBy: { lineNumber: 'asc' } })).toEqual(stored)
  })

  it('单条精确大数与整单舍入差额在真实 decimal 列中保持精度', async () => {
    const bill = await createBill('1')
    const line = await createLine(bill.id, { codAmountTwd: '9007199254740993.01' })
    await createCharge(line.id)
    await recalculate(bill.id)
    expect(await getBill(bill.id)).toMatchObject({ codTotalAmountTwd: '9007199254740993.01', returnAmountCny: '9007199254740993.01', netReturnAmountCny: '9007199254740993.01' })
    const rounded = await createBill('2')
    for (let index = 0; index < 3; index += 1) {
      const row = await createLine(rounded.id, { codAmountTwd: '0.01' })
      await createCharge(row.id)
    }
    await recalculate(rounded.id)
    expect(await getBill(rounded.id)).toMatchObject({ returnAmountCny: '0.03', netReturnAmountCny: '0.03', roundingDifferenceCny: '0.01' })
  })

  it('新增行触发整单重算；审计失败回滚费用、已有行派生值、主表和新行', async () => {
    const bill = await createBill()
    const line = await createLine(bill.id, { ...dimensions, codAmountTwd: '480' })
    const charge = await createCharge(line.id, { pricingBasis: 'VOLUME', unitPriceAmount: '20', chargeableQuantity: '999', amount: '999' })
    const facts = async () => ({
      bill: await h.prisma.oceanFreightBill.findUniqueOrThrow({ where: { id: bill.id } }),
      lines: await h.prisma.oceanFreightBillLine.findMany({ where: { billId: bill.id }, orderBy: { lineNumber: 'asc' } }),
      charge: await h.prisma.oceanFreightBillCharge.findUniqueOrThrow({ where: { id: charge.id } }),
    })
    const before = await facts()
    const audit = h.app.get(AuditService), original = audit.record.bind(audit)
    const failure = jest.spyOn(audit, 'record').mockImplementation((tx, event) => event.eventType === 'OCEAN_FREIGHT_BILL_LINE_CREATED'
      ? Promise.reject(new Error('injected calculation audit failure')) : original(tx, event))
    const path = `/api/ocean-freight-bills/${bill.id}/lines`, key = randomUUID()
    const input = { lineType: 'NORMAL', goodsName: 'Next cargo', codAmountTwd: '0' }
    try { await post(path, input, key).expect(500) } finally { failure.mockRestore() }
    expect(await facts()).toEqual(before)
    await post(path, input, key).expect(201)
    const after = await facts()
    expect(after.charge.amount.toFixed(2)).toBe('260.00')
    expect(after.lines[0].netReturnAmountCny?.toFixed(2)).toBe('-160.00')
    expect(after.lines).toHaveLength(2)
    expect(after.bill.version).toBe(before.bill.version + 1)
    expect(after.bill.netReturnAmountCny).toBeNull()
  })

  it('确认行冻结且无账户、资金流水、采购或销售收款副作用', async () => {
    const bill = await createBill()
    const batch = (await post('/api/container-batches', { containerBatchName: '0919-02柜', warehouseValue: TEST_DESTINATION_WAREHOUSE }).expect(201)).body as ContainerBatchDto
    const item = (await post(`/api/container-batches/${batch.id}/items`, { expectedVersion: 1, goodsName: 'Confirmed cargo', packageCount: 1 }).expect(201)).body as ContainerLoadingItemDto
    const line = await createLine(bill.id, { codAmountTwd: '0', loadingItemId: item.id })
    await createCharge(line.id)
    await recalculate(bill.id)
    await h.prisma.oceanFreightBillLine.update({ where: { id: line.id }, data: { reconciliationStatus: 'CONFIRMED', reconciledById: actorId, reconciledAt: new Date() } })
    const before = await h.prisma.oceanFreightBill.findUniqueOrThrow({ where: { id: bill.id } })
    const response = await post(`/api/ocean-freight-bills/${bill.id}/lines`, { lineType: 'NORMAL', goodsName: 'Forbidden after confirmation' }).expect(409)
    expect(response.body as { code: string }).toMatchObject({ code: 'OCEAN_FREIGHT_BILL_STATE_CHANGED' })
    expect(await h.prisma.oceanFreightBill.findUniqueOrThrow({ where: { id: bill.id } })).toEqual(before)
    expect(await h.prisma.oceanFreightBillLine.count({ where: { billId: bill.id } })).toBe(1)
    expect(await h.prisma.fundAccount.findMany({ orderBy: { id: 'asc' } })).toEqual(fundAccountsBefore)
    expect(await h.prisma.fundPostingBatch.count()).toBe(0)
    expect(await h.prisma.fundLedgerEntry.count()).toBe(0)
    expect(await h.prisma.salesOrderPayment.count()).toBe(0)
    expect(await h.prisma.purchaseOrderPayment.count()).toBe(0)
    expect(fundSpy).not.toHaveBeenCalled()
  })
})
