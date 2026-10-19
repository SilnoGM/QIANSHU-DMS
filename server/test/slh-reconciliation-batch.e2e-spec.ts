import { createHash, randomUUID } from 'node:crypto'
import request from 'supertest'
import type { SlhBillDto } from '../src/modules/slh-bills/slh-bill.dto'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { PAYMENT_FEE_RATE, resolveSettlementAmounts } from '../src/modules/slh-reconciliation-batches/slh-reconciliation-settlement.logic'
import { createSlhBillFixture } from './fixtures/slh-bill-xlsx.fixture'
import { markShipmentsContainerLoaded } from './fixtures/container-loaded.fixture'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = ['slh-bills:read', 'slh-bills:create', 'slh-bills:reconcile']
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const BASE = '/api/slh-reconciliation-batches'
const BATCH_RULE_CODE = 'SLH_RECON_BATCH_NO'
const BATCH_CONSUMER_CODE = 'SLH_RECON_BATCH.CREATE'

interface BillOption {
  blockReason: string | null
  id: string
  reconcilableLineCount: number
  reconcilableLineIds: string[]
  reasons: Array<{ code: string, count: number }>
  selectable: boolean
  slhBillNo: string
}

interface BillOptionPage {
  counts: { blocked: number, selectable: number }
  items: BillOption[]
  page: number
  pageSize: number
  total: number
}

interface BatchDetail {
  batchNo: string
  bill: { lineCount: number, reconciliationStatus: string, slhBillNo: string }
  completedAt: string | null
  id: string
  memberCount: number
  members: Array<{
    codAmountTwd: string | null
    id: string
    lineId: string
    matchedContainerBatchName: string
    matchedLoadingItemId: string
    matchedLoadingItemLineNumber: number
    matchedLoadingItem: { shipmentNo: string | null }
    matchSource: string
    reconciliationStatus: string
    purchaseOrder: {
      id: string
      orderNo: string
      orderStatus: string
      purchaseTotalAmount: string
      depositDueAmount: string
      balanceDueAmount: string
      paidAmount: string
      outstandingAmount: string
      creatorDisplayName: string
      fulfillmentStatus: string
      paymentStatus: string
      shippingMarkText: string | null
      supplier: { source: string, value: string | null, label: string, known: boolean | null }
    } | null
    salesOrder: {
      id: string
      orderNo: string
      orderStatus: string
      currencyCode: string
      customerName: string
      customerPhone: string
      customerFullAddress: string
      agreedTotalAmount: string
      depositDueAmount: string
      balanceDueAmount: string
      receivedAmount: string
      outstandingAmount: string
      fulfillmentStatus: string
      paymentStatus: string
      issuerDisplayName: string
    } | null
    reconciledAt: string | null
  }>
  reconciledMemberCount: number
  status: string
}

/**
 * 对账批次的接口边界。
 *
 * 读路径三条：候选账单（旧口径，保留）、可选/不可选分组（弹窗数据来源）、静默算
 * 「当前可核对」（账单列表的列）；写路径两条：创建（重跑匹配、比对范围、冻结成员）与完成。
 * 逐行核对与匹配预览已随本次重构删除，路由不存在。
 *
 * 覆盖单测看不到的一层：真实 PostgreSQL 上的编号身份触发器、占用规则、
 * 匹配作用域（只匹配未对账行）与「冻结成员 → 结束 → 再发起」这条业务闭环。
 */
describe('slh reconciliation batches with isolated PostgreSQL', () => {
  jest.setTimeout(180_000)
  let h: PackagingCostHarness
  let browser: request.Agent
  let outsider: request.Agent
  let pending: SlhBillDto
  let completed: SlhBillDto
  let occupied: SlhBillDto
  let superseded: SlhBillDto
  let replacement: SlhBillDto
  let unmatchable: SlhBillDto
  let batchRuleId = ''
  let batchRuleVersion = 0
  const unknownId = '00000000-0000-4000-8000-000000000001'
  const idempotencyKeyA = randomUUID()
  const idempotencyKeyB = randomUUID()
  const errorCode = (response: request.Response) => (response.body as { code: string }).code
  const createBatch = (billId: string, key: string, reconcilableLineIds?: string[]) => browser
    .post(BASE).set(packagingHeaders).set('Idempotency-Key', key)
    .send(reconcilableLineIds === undefined ? { billId } : { billId, reconcilableLineIds })
  const selectableBills = (group: 'BLOCKED' | 'SELECTABLE', query: Record<string, unknown> = {}) => browser
    .get(`${BASE}/selectable-bills`).query({ group, pageSize: 100, ...query })
  const reconcilableCounts = (billIds: string[]) => browser
    .post(`${BASE}/reconcilable-counts`).set(packagingHeaders).send({ billIds })

  async function importBill(name: string, fixture: Buffer = createSlhBillFixture(), supersedesBillId: string | null = null): Promise<SlhBillDto> {
    const staged = await browser.post('/api/slh-bills/source-file-uploads').set(packagingHeaders)
      .field('mediaType', 'DOCUMENT')
      .attach('file', fixture, { filename: `${name}.xlsx`, contentType: XLSX_MIME })
    if (staged.status !== 201) throw new Error(`upload responded ${staged.status}: ${JSON.stringify(staged.body)}`)
    const created = await browser.post('/api/slh-bills').set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({
        mediaAssetId: (staged.body as { mediaAssetId: string }).mediaAssetId,
        billName: name, billMonth: '2026-01', remark: null, manualForeignUnitsPerCny: null,
        supersedesBillId, duplicateAcknowledged: true,
      })
    if (created.status !== 201) throw new Error(`bill create responded ${created.status}: ${JSON.stringify(created.body)}`)
    return created.body as SlhBillDto
  }

  /** 「凭证不可改」触发器只放行 reconciled_at，其余列不动就能把整张账单标记为已对账。 */
  async function reconcileAllLines(billId: string): Promise<void> {
    await h.prisma.slhBillLine.updateMany({ where: { billId }, data: { reconciledAt: new Date() } })
  }

  async function unreconciledLineIds(billId: string): Promise<string[]> {
    const lines = await h.prisma.slhBillLine.findMany({
      where: { billId, reconciledAt: null }, select: { id: true }, orderBy: { lineNumber: 'asc' },
    })
    return lines.map(line => line.id)
  }

  /**
   * 完成批次会把账单代收回填为销售收款，回填要求「账单代收合计 ≤ 订单实际待收款」。
   * 夹具默认订单总额 10 元远小于账单代收，这里统一放宽成大额（金流费用随之变大，
   * 相关断言按 1,000,000 ÷ 5.2 × 0.007 = 1346.15 更新）；超收/收齐等边界由专项用例另行构造。
   */
  const WIDE_SALES_TOTAL = '1000000.00'
  async function widenSalesTotal(salesOrderId: string, total = WIDE_SALES_TOTAL): Promise<void> {
    // 订单小计与有效行合计是一对延迟约束触发器：行与订单必须同事务改写，提交时才校验；
    // 本 spec 的销售单都是单行订单，直接把唯一有效行改到同一总额。
    await h.prisma.$transaction(async (tx) => {
      const lines = await tx.salesOrderLine.findMany({ where: { salesOrderId, removedAt: null }, select: { id: true, quantity: true } })
      const [line] = lines
      if (line === undefined || lines.length !== 1) throw new Error(`widenSalesTotal expects a single active line, got ${lines.length}`)
      // 行总额必须等于单价 × 数量（CHECK 约束）：改总额时同步改单价。
      await tx.salesOrderLine.update({
        where: { id: line.id },
        data: { lineTotalAmount: total, actualUnitPriceAmount: (Number(total) / line.quantity).toFixed(2) },
      })
      await tx.salesOrder.update({
        where: { id: salesOrderId },
        data: { lineSubtotalAmount: total, agreedTotalAmount: total, depositDueAmount: '0', balanceDueAmount: total },
      })
    })
  }

  /** 系统汇率：结算与完成都从系统来源取台币汇率。 */
  async function setSystemRate(value: string): Promise<void> {
    const currency = await h.prisma.currency.findUniqueOrThrow({ where: { code: 'TWD' }, select: { id: true } })
    await h.prisma.exchangeRate.upsert({
      where: { currencyId: currency.id },
      create: { currencyId: currency.id, foreignUnitsPerCny: value },
      update: { foreignUnitsPerCny: value },
    })
  }

  /** 按成员行的账单金额回表重算六个金额并提交结算（与结算服务的重算口径一致）。 */
  async function settleMemberFromBillLine(batchId: string, member: BatchDetail['members'][number]): Promise<void> {
    const line = await h.prisma.slhBillLine.findUniqueOrThrow({
      where: { id: member.lineId },
      select: { codAmountTwd: true, ntdSurchargeAmountTwd: true, payableAmountCny: true },
    })
    const amounts = resolveSettlementAmounts({
      codAmountTwd: line.codAmountTwd?.toFixed(2) ?? null,
      ntdSurchargeAmountTwd: line.ntdSurchargeAmountTwd?.toFixed(2) ?? null,
      payableAmountCny: line.payableAmountCny?.toFixed(2) ?? null,
      salesAmount: WIDE_SALES_TOTAL, rate: '5.2000', paymentFeeRate: PAYMENT_FEE_RATE,
    })
    await browser.post(`${BASE}/${batchId}/settlements`).set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({ batchLineId: member.id, rateSource: 'SYSTEM', rate: '5.2000', amounts }).expect(201)
  }

  /** 把所有未核对的成员补齐结算：完成批次要求全部已核对。 */
  async function settleAllMembers(batchId: string): Promise<void> {
    const detail = (await browser.get(`${BASE}/${batchId}`).expect(200)).body as BatchDetail
    for (const member of detail.members.filter(entry => entry.reconciliationStatus === 'PENDING')) {
      await settleMemberFromBillLine(batchId, member)
    }
  }

  /** 直接落一条进行中批次：编号必须来自真实派发台账，否则身份触发器拒绝。 */
  async function createInProgressBatch(billId: string): Promise<void> {
    await h.prisma.$transaction(async (tx) => {
      const issuance = await h.fixture.numbering.generateScopedInTransaction(tx, {
        ruleCode: BATCH_RULE_CODE, consumerCode: BATCH_CONSUMER_CODE,
        idempotencyKey: randomUUID(), requestFingerprint: 'a'.repeat(64),
      })
      await tx.slhReconciliationBatch.create({
        data: {
          billId, batchNo: issuance.number, numberingIssuanceId: issuance.issuanceId,
          creationRequestKeyHash: Buffer.from(randomUUID().replaceAll('-', ''), 'hex'),
          creationPayloadHash: Buffer.alloc(32, 2),
          createdById: h.fixture.actor.id, updatedById: h.fixture.actor.id,
        },
      })
    })
  }

  /** 柜次与装柜明细直接落库：本用例只验证对账侧的读取与匹配，柜次自身流程已有专项测试。 */
  async function createContainer(containerBatchName: string, loadingDate: string, rows: Array<{ mark: string | null, shipmentId: string }>) {
    await h.prisma.$transaction(async (tx) => {
      const issuance = await h.fixture.numbering.generateScopedInTransaction(tx, {
        ruleCode: 'CONTAINER_BATCH_NO', consumerCode: 'CONTAINER_BATCH.CREATE',
        idempotencyKey: randomUUID(), requestFingerprint: 'c'.repeat(64),
      })
      const batch = await tx.containerBatch.create({
        data: {
          containerBatchNo: issuance.number, numberingIssuanceId: issuance.issuanceId,
          containerBatchName, loadingDate: new Date(`${loadingDate}T00:00:00.000Z`), sequenceInDay: 1,
          warehouseValue: TEST_DESTINATION_WAREHOUSE, creationRequestKey: randomUUID(), creationPayloadHash: 'd'.repeat(64),
          createdById: h.fixture.actor.id, updatedById: h.fixture.actor.id,
        },
        select: { id: true },
      })
      // 关联即已装柜：直接落库的用例必须补齐装柜事实，否则关联会被触发器拒绝。
      await markShipmentsContainerLoaded(tx, rows.map(row => row.shipmentId), h.fixture.actor.id)
      for (const [index, row] of rows.entries()) {
        await tx.containerLoadingItem.create({
          data: {
            containerBatchId: batch.id, shipmentId: row.shipmentId, lineNumber: index + 1,
            creationRequestKey: randomUUID(), creationPayloadHash: 'e'.repeat(64),
            goodsName: '测试装柜货品', packageCount: 1, oceanShippingMarkText: row.mark,
            createdById: h.fixture.actor.id, updatedById: h.fixture.actor.id,
          },
        })
      }
    })
  }

  beforeAll(async () => {
    // 与账单导入用例同款：xlsx 的真实类型检测必须走原生 Node，不能在 Jest 沙箱里伪造 MIME。
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    browser = (await h.browserWithPermissions(permissions)).browser
    outsider = (await h.browserWithPermissions(['slh-bills:read'])).browser
    // 迁移不代替管理员建规则：账单编号、柜次编号与批次编号都必须先存在并启用。
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    for (const rule of [
      { ruleCode: 'CONTAINER_BATCH_NO', name: '柜次编号', resetPolicy: 'NEVER' as const, segments: [{ type: 'FIXED' as const, value: 'CB' }, { type: 'SEQUENCE' as const, width: 8, startValue: '1', step: '1' }] },
      { ruleCode: 'CTN_BILL_NO', name: '海运账单编号', resetPolicy: 'YEARLY' as const, segments: [{ type: 'FIXED' as const, value: 'CBILL' }, { type: 'SEPARATOR' as const, value: '/' as const }, { type: 'DATE' as const, format: 'YYYYMM' as const }, { type: 'SEPARATOR' as const, value: '-' as const }, { type: 'SEQUENCE' as const, width: 2, startValue: '1', step: '1' }] },
      { ruleCode: BATCH_RULE_CODE, name: '顺联航对账批次编号', resetPolicy: 'MONTHLY' as const, segments: [{ type: 'FIXED' as const, value: 'SRB' }, { type: 'SEPARATOR' as const, value: '-' as const }, { type: 'DATE' as const, format: 'YYYYMM' as const }, { type: 'SEPARATOR' as const, value: '-' as const }, { type: 'SEQUENCE' as const, width: 3, startValue: '1', step: '1' }] },
    ]) {
      const ruleRecord = await h.fixture.numberingCommands.create(context, { ...rule, purpose: 'BUSINESS' })
      const published = await h.fixture.numberingCommands.publish(context, ruleRecord.id, { expectedVersion: ruleRecord.version, draftRevision: 1 })
      const enabled = await h.fixture.numberingCommands.enable(context, ruleRecord.id, { expectedVersion: published.version })
      if (rule.ruleCode === BATCH_RULE_CODE) {
        batchRuleId = enabled.id
        batchRuleVersion = enabled.version
      }
    }

    pending = await importBill('对账候选-待对账')
    completed = await importBill('对账候选-已对账完成')
    await reconcileAllLines(completed.id)
    occupied = await importBill('对账候选-占用中')
    await createInProgressBatch(occupied.id)
    superseded = await importBill('对账候选-将被取代')
    replacement = await importBill('对账候选-取代者', createSlhBillFixture(), superseded.id)
    // 柜号与唛头都推不出月日：这张账单永远没有可核对的行。
    unmatchable = await importBill('对账候选-无可核对行', createSlhBillFixture({
      rows: [
        { B: '46002', C: '待定', D: '千树贸易', E: 'WG-0078-0072', F: 'AAA-BBB', G: '农用四轮微耕机', H: '1', I: 'CTN', K: 'KGS', R: '0', U: '0', W: '2000', X: '补 卸货费2000NT', Y: '测试收货人一' },
        { B: '46024', C: '待定', D: '千树贸易', E: 'WG-0102-0092', F: 'CCC-DDD', G: '农用履带旋耕机', H: '1', I: 'CTN', J: '885', K: 'KGS', L: '215', M: '137', N: '113', O: '117.545380703489', P: '5', Q: '5', R: '4425', S: '30', T: '100', U: '4555', V: '129000', W: '6000', X: '重货费100 偏遠費6000NT', Y: '测试收货人二' },
        { B: '46038', C: '待定', D: '千树贸易', E: 'ZY202449875559（中通快运）', F: 'EEE-FFF', G: '腳手架', H: '1', I: 'CTN', J: '213', K: 'KGS', L: '190', M: '92', N: '63', O: '39', P: '5', Q: '30', R: '1170', T: '100', U: '1270', X: '重货费100', Y: '测试收货人三' },
      ],
    }))

    // 三行账单各指向一个柜次（柜号名称路径），同一货件不能跨柜次，因此每柜各用自己的合格货件。
    for (const [name, date, mark] of [
      ['1211-01柜', '2025-12-11', 'J-121125'],
      ['0102-01柜', '2026-01-02', 'L-010229'],
      ['0116柜', '2026-01-16', 'L-011652'],
    ] as const) {
      const shipment = await h.shipment({ salesLinked: true, ownerUserId: h.fixture.actor.id })
      if (shipment.source === null) throw new Error('sales linked shipment must create a sales order')
      // 完成批次会把账单代收回填为销售收款：订单总额必须覆盖账单代收（夹具默认 10 元，统一放宽）。
      await widenSalesTotal(shipment.source.id)
      await createContainer(name, date, [{ mark, shipmentId: shipment.part.id }])
    }

    // 完成批次要逐行入账，先备好系统汇率；销售出单人的资金账户与比例必须先存在，否则完成会被阻断。
    await setSystemRate('5.2000')
    await h.setupFunds('30')
  })
  afterAll(async () => { await h?.dispose() })

  it('候选账单：只保留生效中且仍有未对账行、又没有进行中批次的账单', async () => {
    const response = await browser.get(`${BASE}/candidates`).query({ pageSize: 100 }).expect(200)
    const page = response.body as { items: Array<{ id: string, reconciliationStatus: string, supersededById: string | null }>, total: number }
    const ids = page.items.map(item => item.id)
    // 候选只看「还有未对账的行」，不要求这些行现在能匹配上：unmatchable 也在候选里。
    expect(ids).toEqual(expect.arrayContaining([pending.id, replacement.id, unmatchable.id]))
    expect(ids).not.toContain(completed.id)
    expect(ids).not.toContain(occupied.id)
    expect(ids).not.toContain(superseded.id)
    expect(page.total).toBe(3)
    // 候选集里的对账状态只可能是「未对账 / 部分对账」。
    expect(page.items.every(item => item.reconciliationStatus === 'PENDING' || item.reconciliationStatus === 'PARTIAL')).toBe(true)
    expect(page.items.every(item => item.supersededById === null)).toBe(true)
  })

  it('候选账单支持关键词检索与分页，且总数与列表同口径', async () => {
    const byKeyword = (await browser.get(`${BASE}/candidates`).set(packagingHeaders).query({ keyword: pending.slhBillNo }).expect(200)).body as { items: Array<{ id: string }>, total: number }
    expect(byKeyword.items.map(item => item.id)).toEqual([pending.id])
    expect(byKeyword.total).toBe(1)

    const firstPage = (await browser.get(`${BASE}/candidates`).query({ page: 1, pageSize: 1 }).expect(200)).body as { items: Array<{ id: string }>, total: number, page: number, pageSize: number }
    const secondPage = (await browser.get(`${BASE}/candidates`).query({ page: 2, pageSize: 1 }).expect(200)).body as { items: Array<{ id: string }>, total: number }
    expect([firstPage.page, firstPage.pageSize, firstPage.total]).toEqual([1, 1, 3])
    expect(firstPage.items).toHaveLength(1)
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id)
  })

  it('可选账单分组：两组同时给计数，可选的带可核对行数，不可选的带原因', async () => {
    const selectable = (await selectableBills('SELECTABLE').expect(200)).body as BillOptionPage
    expect(selectable.counts).toEqual({ selectable: 2, blocked: 3 })
    expect(selectable.total).toBe(2)
    expect(selectable.items.map(item => item.id).sort()).toEqual([pending.id, replacement.id].sort())
    const pendingOption = selectable.items.find(item => item.id === pending.id)!
    expect(pendingOption.selectable).toBe(true)
    expect(pendingOption.blockReason).toBeNull()
    expect(pendingOption.reasons).toEqual([])
    expect(pendingOption.reconcilableLineCount).toBe(3)
    // 可核对行 id 与库里「未对账行」逐一对上：弹窗据此发起创建并在服务端比对范围。
    expect(pendingOption.reconcilableLineIds.sort()).toEqual((await unreconciledLineIds(pending.id)).sort())

    const blocked = (await selectableBills('BLOCKED').expect(200)).body as BillOptionPage
    expect(blocked.counts).toEqual({ selectable: 2, blocked: 3 })
    expect(blocked.total).toBe(3)
    expect(blocked.items.map(item => item.id).sort()).toEqual([completed.id, occupied.id, unmatchable.id].sort())
    const reasonOf = (id: string) => blocked.items.find(item => item.id === id)
    expect(reasonOf(occupied.id)?.blockReason).toBe('IN_PROGRESS_BATCH')
    expect(reasonOf(completed.id)?.blockReason).toBe('NO_UNRECONCILED_LINES')
    const unmatchableOption = reasonOf(unmatchable.id)!
    expect(unmatchableOption.blockReason).toBe('NO_RECONCILABLE_LINES')
    expect(unmatchableOption.reconcilableLineCount).toBe(0)
    expect(unmatchableOption.reconcilableLineIds).toEqual([])
    // 原因汇总按码聚合：这张账单的三行柜号都解析不出月日。
    expect(unmatchableOption.reasons).toEqual([{ code: 'INVALID_CONTAINER_NAME', count: 3 }])
    expect(blocked.items.every(item => item.selectable === false)).toBe(true)
    // 已被取代的账单两组都不出现（不属于「可选」，也不该出现在不可选里）。
    expect([...selectable.items, ...blocked.items].map(item => item.id)).not.toContain(superseded.id)
  })

  it('可选账单关键词：命中的账单单独成组，计数随关键词收窄', async () => {
    const byKeyword = (await selectableBills('SELECTABLE', { keyword: pending.slhBillNo }).expect(200)).body as BillOptionPage
    expect(byKeyword.total).toBe(1)
    expect(byKeyword.items.map(item => item.id)).toEqual([pending.id])
    expect(byKeyword.counts).toEqual({ selectable: 1, blocked: 0 })

    const blockedByKeyword = (await selectableBills('BLOCKED', { keyword: unmatchable.slhBillNo }).expect(200)).body as BillOptionPage
    expect(blockedByKeyword.counts).toEqual({ selectable: 0, blocked: 1 })
    expect(blockedByKeyword.items.map(item => item.id)).toEqual([unmatchable.id])
  })

  it('静默算：批量返回可核对行数、未冻结行数、行 id 与占用该账单的进行中批次，无批次时为 null', async () => {
    const response = await reconcilableCounts([pending.id, unmatchable.id, occupied.id]).expect(200)
    const items = (response.body as {
      items: Array<{
        billId: string
        reconcilableLineCount: number
        unfrozenLineCount: number
        reconcilableLineIds: string[]
        inProgressBatchId: string | null
        inProgressBatchNo: string | null
        reasons: Array<{ code: string, count: number }>
      }>
    }).items
    expect(items.map(item => item.billId).sort()).toEqual([pending.id, unmatchable.id, occupied.id].sort())
    const pendingCounts = items.find(item => item.billId === pending.id)!
    expect(pendingCounts.reconcilableLineCount).toBe(3)
    expect(pendingCounts.reconcilableLineIds.sort()).toEqual((await unreconciledLineIds(pending.id)).sort())
    expect(pendingCounts.reasons).toEqual([])
    // 没有被进行中批次冻结任何行：未冻结行数＝可核对行数。
    expect(pendingCounts.unfrozenLineCount).toBe(3)
    // 没有进行中批次：批次身份双 null，账单列表据此给「开始对账」。
    expect([pendingCounts.inProgressBatchId, pendingCounts.inProgressBatchNo]).toEqual([null, null])
    const unmatchableCounts = items.find(item => item.billId === unmatchable.id)!
    expect(unmatchableCounts.reconcilableLineCount).toBe(0)
    expect(unmatchableCounts.unfrozenLineCount).toBe(0)
    expect(unmatchableCounts.reconcilableLineIds).toEqual([])
    expect([unmatchableCounts.inProgressBatchId, unmatchableCounts.inProgressBatchNo]).toEqual([null, null])
    expect(unmatchableCounts.reasons).toEqual([{ code: 'INVALID_CONTAINER_NAME', count: 3 }])
    // 占用中但一个成员都没冻结（本例的批次是直接落库的）：匹配行仍在，
    // 「未冻结」只反映冻结了多少行，不反映这一账单此刻能不能新建批次（那由弹窗的可选分组定）；
    // 但占用它的批次身份必须给出来，账单列表才有条件显示「继续对账」。
    const occupiedBatch = await h.prisma.slhReconciliationBatch.findFirstOrThrow({
      where: { billId: occupied.id, completedAt: null }, select: { id: true, batchNo: true },
    })
    const occupiedCounts = items.find(item => item.billId === occupied.id)!
    expect([occupiedCounts.reconcilableLineCount, occupiedCounts.unfrozenLineCount]).toEqual([3, 3])
    expect([occupiedCounts.inProgressBatchId, occupiedCounts.inProgressBatchNo]).toEqual([occupiedBatch.id, occupiedBatch.batchNo])

    // 已对账完成的账单没有未对账行：0 行、无原因（没有"不能核对的行"可言）。
    const noLines = (await reconcilableCounts([completed.id]).expect(200)).body as { items: Array<{ reconcilableLineCount: number, unfrozenLineCount: number, inProgressBatchId: string | null, reasons: unknown[] }> }
    expect(noLines.items[0].reconcilableLineCount).toBe(0)
    expect(noLines.items[0].unfrozenLineCount).toBe(0)
    expect(noLines.items[0].inProgressBatchId).toBeNull()
    expect(noLines.items[0].reasons).toEqual([])
  })

  it('静默算入参校验：空数组与非法主键在业务前被拒', async () => {
    expect(errorCode(await reconcilableCounts([]).expect(422))).toBe('VALIDATION_FAILED')
    expect(errorCode(await reconcilableCounts(['not-a-uuid']).expect(422))).toBe('VALIDATION_FAILED')
    expect(errorCode(await browser.post(`${BASE}/reconcilable-counts`).set(packagingHeaders).send({}).expect(422))).toBe('VALIDATION_FAILED')
  })

  it('已删除的匹配预览与逐行核对路由不再存在，且不落数据', async () => {
    const before = {
      batches: await h.prisma.slhReconciliationBatch.count(),
      members: await h.prisma.slhReconciliationBatchLine.count(),
    }
    // 路由不存在：框架级 404，不是契约里声明的业务错误码。
    await browser.post(`${BASE}/match-preview`).set(packagingHeaders).send({ billId: pending.id }).expect(404)
    await browser.post(`${BASE}/${unknownId}/reconcile`).set(packagingHeaders).send({ lineIds: [unknownId] }).expect(404)
    expect({
      batches: await h.prisma.slhReconciliationBatch.count(),
      members: await h.prisma.slhReconciliationBatchLine.count(),
    }).toEqual(before)
  })

  it('批次详情读取：返回批次头与账单摘要，未知主键 404，缺权限 403', async () => {
    const occupiedBatch = await h.prisma.slhReconciliationBatch.findFirstOrThrow({ where: { billId: occupied.id }, select: { id: true, batchNo: true } })
    const detail = (await browser.get(`${BASE}/${occupiedBatch.id}`).expect(200)).body as BatchDetail
    expect(detail.batchNo).toBe(occupiedBatch.batchNo)
    // 直接落库的批次没有成员行：老批次的成员为空是合法状态，页面要能显示空清单。
    expect([detail.status, detail.memberCount, detail.reconciledMemberCount]).toEqual(['IN_PROGRESS', 0, 0])
    expect(detail.members).toEqual([])
    expect(detail.bill.slhBillNo).toBe(occupied.slhBillNo)
    expect(detail.bill.lineCount).toBeGreaterThan(0)
    expect(['PENDING', 'PARTIAL']).toContain(detail.bill.reconciliationStatus)

    expect(errorCode(await browser.get(`${BASE}/${unknownId}`).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
    await outsider.get(`${BASE}/${occupiedBatch.id}`).expect(403)
  })

  it('权限与会话边界仍在：未登录 401，缺少 reconcile 权限 403', async () => {
    await request(h.app.getHttpServer()).get(BASE).expect(401)
    await outsider.get(BASE).expect(403)
    await outsider.get(`${BASE}/candidates`).expect(403)
    await outsider.get(`${BASE}/selectable-bills`).query({ group: 'SELECTABLE' }).expect(403)
    await outsider.post(`${BASE}/reconcilable-counts`).set(packagingHeaders).send({ billIds: [pending.id] }).expect(403)
    await outsider.post(BASE).set(packagingHeaders).set('Idempotency-Key', randomUUID()).send({ billId: pending.id }).expect(403)
    await outsider.post(`${BASE}/${unknownId}/complete`).set(packagingHeaders).send({}).expect(403)
  })

  it('创建批次：编号来自派发台账、冻结成员行、写审计事件，可选集随即排除该账单', async () => {
    const response = await createBatch(pending.id, idempotencyKeyA).expect(201)
    const batch = response.body as BatchDetail
    // 形状跟随本用例夹具的规则（月度 `SRB-{YYYYMM}-{SEQ:3}`），并与派发台账逐字比对。
    expect(batch.batchNo).toMatch(/^SRB-\d{6}-\d{3}$/u)
    expect([batch.status, batch.completedAt]).toEqual(['IN_PROGRESS', null])
    expect(batch.bill.slhBillNo).toBe(pending.slhBillNo)
    // 创建即冻结：三行都可核对 → 三个成员，且每行都带上匹配依据与柜次行号。
    const lineIds = await unreconciledLineIds(pending.id)
    expect([batch.memberCount, batch.reconciledMemberCount]).toEqual([3, 0])
    expect(batch.members.map(member => member.lineId).sort()).toEqual([...lineIds].sort())
    expect(batch.members.every(member => member.matchSource === 'NAME')).toBe(true)
    expect(batch.members.every(member => member.reconciledAt === null)).toBe(true)
    expect(batch.members.every(member => member.matchedContainerBatchName.length > 0 && member.matchedLoadingItemLineNumber > 0)).toBe(true)
    expect(batch.members.every(member => member.matchedLoadingItemId.length > 0)).toBe(true)

    const row = await h.prisma.slhReconciliationBatch.findUniqueOrThrow({
      where: { id: batch.id }, select: { numberingIssuanceId: true, creationPayloadHash: true },
    })
    const issuance = await h.prisma.numberingIssuance.findUniqueOrThrow({
      where: { id: row.numberingIssuanceId }, select: { generatedNumber: true, consumerCode: true, ruleId: true },
    })
    expect(issuance.generatedNumber).toBe(batch.batchNo)
    expect(issuance.consumerCode).toBe(BATCH_CONSUMER_CODE)
    const rule = await h.prisma.numberingRule.findUniqueOrThrow({ where: { id: issuance.ruleId }, select: { ruleCode: true } })
    expect(rule.ruleCode).toBe(BATCH_RULE_CODE)
    expect(row.creationPayloadHash).toHaveLength(32)

    // 成员行真的落库了，且只落「这一批冻结的那几行」。
    const members = await h.prisma.slhReconciliationBatchLine.findMany({ where: { batchId: batch.id }, select: { lineId: true, matchSource: true } })
    expect(members.map(member => member.lineId).sort()).toEqual([...lineIds].sort())
    expect(members.every(member => member.matchSource === 'NAME')).toBe(true)

    const audit = await h.prisma.auditEvent.findFirst({
      where: { eventType: 'SLH_RECONCILIATION_BATCH_CREATED', targetId: batch.id }, select: { metadata: true },
    })
    expect(audit?.metadata).toMatchObject({ batchNo: batch.batchNo, slhBillNo: pending.slhBillNo, memberCount: 3 })

    // 该账单已被占用：候选集与可选分组都不再包含它。
    const candidates = (await browser.get(`${BASE}/candidates`).query({ pageSize: 100 }).expect(200)).body as { items: Array<{ id: string }> }
    expect(candidates.items.map(item => item.id)).not.toContain(pending.id)
    const selectable = (await selectableBills('SELECTABLE').expect(200)).body as BillOptionPage
    expect(selectable.counts).toEqual({ selectable: 1, blocked: 4 })
    expect(selectable.items.map(item => item.id)).not.toContain(pending.id)

    // 冻结后的两个数字：匹配得上的行不变，未冻结（＝当前可核对列显示）的行归零。
    const frozen = (await reconcilableCounts([pending.id]).expect(200)).body as { items: Array<{ reconcilableLineCount: number, unfrozenLineCount: number }> }
    expect([frozen.items[0].reconcilableLineCount, frozen.items[0].unfrozenLineCount]).toEqual([3, 0])
  })

  it('来源摘要随详情返回：装柜行带出货件号，采购与销售口径与各自域一致', async () => {
    const batchRow = await h.prisma.slhReconciliationBatch.findFirstOrThrow({
      where: { billId: pending.id, completedAt: null }, select: { id: true },
    })
    const detail = (await browser.get(`${BASE}/${batchRow.id}`).expect(200)).body as BatchDetail
    expect(detail.members).toHaveLength(3)

    for (const member of detail.members) {
      // 装柜行：货件号来自这一行匹配到的货件。
      expect(member.matchedLoadingItem.shipmentNo).toBeTruthy()
      // 采购来源：金额两位小数人民币；供应商沿用采购域的解析口径。
      // 本夹具的采购单是自定义供应商文案，字典供应商的标签解析由采购域既有用例覆盖。
      expect(member.purchaseOrder?.purchaseTotalAmount).toMatch(/^\d+\.\d{2}$/u)
      expect(member.purchaseOrder?.supplier).toMatchObject({
        source: 'CUSTOM_TEXT', value: null, label: 'Custom supplier',
      })
      // 夹具金额为 10 元含 0 定金 / 10 尾款：逐项对齐能挡住字段错配。
      expect(member.purchaseOrder?.depositDueAmount).toBe('0.00')
      expect(member.purchaseOrder?.balanceDueAmount).toBe('10.00')
      expect(member.purchaseOrder?.paymentStatus).toBe('UNPAID')
      // 夹具没有付款记录：实际已付款为 0，实际未付款等于采购金额。
      // 有付款（含作废）一侧的口径由采购域覆盖：付款必须走应付与资金过账，直接插入付款行会被
      // purchase_order_payments_identity_trigger 拒绝，所以不在这里另造一份。
      expect(member.purchaseOrder?.paidAmount).toBe('0.00')
      expect(member.purchaseOrder?.outstandingAmount).toBe('10.00')
      // 采购人＝采购订单的创建人（夹具由原子性用例的账号建单）。
      expect(member.purchaseOrder?.creatorDisplayName).toBe('Mark atomicity')
      expect(['ORDERED', 'PREPARING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'SIGNED']).toContain(member.purchaseOrder?.fulfillmentStatus)
      // 销售来源：四位小数订单币种金额，字段口径与销售域一致。
      expect(member.salesOrder).toMatchObject({ customerName: '包装客户', currencyCode: 'TWD', orderStatus: 'CONFIRMED' })
      expect(member.salesOrder?.agreedTotalAmount).toMatch(/^\d+\.\d{2}$/u)
      expect(member.salesOrder?.customerPhone).toBe('12345678')
      expect(member.salesOrder?.customerFullAddress).toBe('国家省份城市测试地址')
      expect(member.salesOrder?.depositDueAmount).toBe('0.00')
      expect(member.salesOrder?.balanceDueAmount).toBe(WIDE_SALES_TOTAL)
      // 夹具没有收款记录：实际已收款为 0，实际待收款等于约定总额（与销售域同一处累加口径）。
      expect(member.salesOrder?.receivedAmount).toBe('0.00')
      expect(member.salesOrder?.outstandingAmount).toBe(WIDE_SALES_TOTAL)
      expect(member.salesOrder?.paymentStatus).toBe('UNPAID')
      expect(member.salesOrder?.issuerDisplayName).toBeTruthy()
      expect(['PENDING', 'PREPARING', 'LAND_TRANSIT', 'WAREHOUSE_ARRIVED', 'SEA_TRANSIT', 'SIGNED']).toContain(member.salesOrder?.fulfillmentStatus)
    }

    // 链路逐条对齐数据库事实：成员匹配行 → 货件 → 采购订单 → 销售订单。
    const memberRows = await h.prisma.slhReconciliationBatchLine.findMany({
      where: { batchId: batchRow.id },
      select: {
        lineId: true,
        matchedLoadingItem: {
          select: {
            shipment: {
              select: {
                shipmentNo: true,
                purchaseOrder: {
                  select: { id: true, orderNo: true, salesOrder: { select: { id: true, orderNo: true } } },
                },
              },
            },
          },
        },
      },
    })
    const expectedByLineId = new Map(memberRows.map(row => [row.lineId, row.matchedLoadingItem.shipment]))
    for (const member of detail.members) {
      const expected = expectedByLineId.get(member.lineId)
      expect(expected).toBeTruthy()
      expect(member.matchedLoadingItem.shipmentNo).toBe(expected?.shipmentNo)
      expect(member.purchaseOrder?.id).toBe(expected?.purchaseOrder.id)
      expect(member.purchaseOrder?.orderNo).toBe(expected?.purchaseOrder.orderNo)
      expect(member.salesOrder?.id).toBe(expected?.purchaseOrder.salesOrder?.id)
      expect(member.salesOrder?.orderNo).toBe(expected?.purchaseOrder.salesOrder?.orderNo)
    }
  })

  it('幂等：同键重放返回同一批次，同一键换账单被拒，非法键在业务前被拒', async () => {
    const replay = await createBatch(pending.id, idempotencyKeyA).expect(201)
    const first = await h.prisma.slhReconciliationBatch.findFirstOrThrow({ where: { billId: pending.id }, select: { id: true } })
    expect((replay.body as { id: string }).id).toBe(first.id)
    // 重放不重新冻结成员：仍是同一条批次、同一组成员。
    expect((replay.body as BatchDetail).members).toHaveLength(3)
    expect(await h.prisma.slhReconciliationBatch.count({ where: { billId: pending.id } })).toBe(1)
    expect(await h.prisma.slhReconciliationBatchLine.count({ where: { batchId: first.id } })).toBe(3)

    // 同一个键换一张账单 ⇒ 意图变了，必须拒绝而不是静默复用。
    expect(errorCode(await createBatch(replacement.id, idempotencyKeyA).expect(409))).toBe('SLH_RECON_BATCH_IDEMPOTENCY_CONFLICT')
    // 非法幂等键（非规范 UUID v4）在进入业务前就被拒。
    expect(errorCode(await createBatch(replacement.id, 'not-a-uuid').expect(422))).toBe('VALIDATION_FAILED')
  })

  it('范围比对：可核对行集合不一致时拒绝创建，一致时按该集合冻结成员', async () => {
    const lineIds = await unreconciledLineIds(replacement.id)
    // 少一行：柜次数据结构变化后可能出现，必须让用户重看而不是静默少核对。
    expect(errorCode(await createBatch(replacement.id, randomUUID(), lineIds.slice(0, 2)).expect(409))).toBe('SLH_RECON_BATCH_SCOPE_CHANGED')
    // 多一行（伪造主键）同样算范围变化。
    expect(errorCode(await createBatch(replacement.id, randomUUID(), [...lineIds, unknownId]).expect(409))).toBe('SLH_RECON_BATCH_SCOPE_CHANGED')
    // 不一致的请求不留下任何批次。
    expect(await h.prisma.slhReconciliationBatch.count({ where: { billId: replacement.id } })).toBe(0)

    const created = (await createBatch(replacement.id, idempotencyKeyB, lineIds).expect(201)).body as BatchDetail
    expect(created.memberCount).toBe(3)
    expect(created.members.map(member => member.lineId).sort()).toEqual([...lineIds].sort())
    // 已被这一步占用：再一次创建走占用冲突，而不是范围比对。
    expect(errorCode(await createBatch(replacement.id, randomUUID(), lineIds).expect(409))).toBe('SLH_RECON_BATCH_CONFLICT')
  })

  it('准入：占用中、无未对账行、无可核对行、被取代与未知账单都挡在创建之前', async () => {
    expect(errorCode(await createBatch(pending.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_CONFLICT')
    expect(errorCode(await createBatch(occupied.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_CONFLICT')
    expect(errorCode(await createBatch(completed.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_NO_LINES_TO_RECONCILE')
    // 有未对账的行、但一行都匹配不上：同样没有可核对的活。
    expect(errorCode(await createBatch(unmatchable.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_NO_LINES_TO_RECONCILE')
    expect(errorCode(await createBatch(superseded.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_CONFLICT')
    expect(errorCode(await createBatch(unknownId, randomUUID()).expect(404))).toBe('SLH_BILL_NOT_FOUND')
  })

  it('创建批次断言销售单币种为台币：非台币订单在创建口被拒', async () => {
    // 柜次身份是「入仓仓库 + 装柜日期 + 当日序号」：日期在用例之间必须互不重复。
    const date = '2026-03-11'
    const containerBatchName = '0311-01柜'
    const mark = 'M-031126'
    const shipment = await h.shipment({ salesLinked: true })
    if (shipment.source === null) throw new Error('sales linked shipment must create a sales order')
    await widenSalesTotal(shipment.source.id)
    await createContainer(containerBatchName, date, [{ mark, shipmentId: shipment.part.id }])
    const bill = await importBill(`入账-${containerBatchName}`, createSlhBillFixture({
      rows: [{
        B: String(Math.round((Date.parse(`${date}T00:00:00.000Z`) - Date.UTC(1899, 11, 30)) / 86_400_000)),
        C: containerBatchName, D: '千树贸易', E: 'WG-0311-0001', F: mark,
        G: '农用四轮微耕机', H: '1', I: 'CTN', R: '1000', U: '1000', V: '52000', W: '0', X: '币种测试', Y: '测试收货人一',
      }],
    }))

    // 非台币销售单：顺联航对账按 1:1 回填台币代收，必须挡在创建之前。
    await h.prisma.salesOrder.update({ where: { id: shipment.source.id }, data: { currencyCode: 'MYR' } })
    expect(errorCode(await createBatch(bill.id, randomUUID()).expect(409))).toBe('SLH_RECON_SALES_CURRENCY_UNSUPPORTED')
    // 改回台币后可正常创建：断言只拦非台币，不误伤。
    await h.prisma.salesOrder.update({ where: { id: shipment.source.id }, data: { currencyCode: 'TWD' } })
    expect((await createBatch(bill.id, randomUUID()).expect(201)).body as BatchDetail).toMatchObject({ memberCount: 1 })
  })

  it('完成批次：先补齐全部核对、解除占用、成员保持冻结、写审计事件，重复完成被拒，释放后可再次发起', async () => {
    const batchId = (await h.prisma.slhReconciliationBatch.findFirstOrThrow({ where: { billId: replacement.id, completedAt: null }, select: { id: true } })).id
    // 完成前必须全部已核对：先把三个成员逐行结算（账单金额由回表重算，不硬编码）。
    expect(errorCode(await browser.post(`${BASE}/${batchId}/complete`).set(packagingHeaders).send({}).expect(409))).toBe('SLH_RECON_BATCH_UNRECONCILED_MEMBERS')
    await settleAllMembers(batchId)
    const completedBatch = (await browser.post(`${BASE}/${batchId}/complete`).set(packagingHeaders).send({}).expect(200)).body as BatchDetail
    expect(completedBatch.status).toBe('COMPLETED')
    expect(completedBatch.completedAt).not.toBeNull()
    // 完成不解除成员冻结：这批核对过哪些行是历史事实。
    expect(completedBatch.memberCount).toBe(3)
    expect(completedBatch.members).toHaveLength(3)
    const audit = await h.prisma.auditEvent.findFirst({
      where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', targetId: batchId }, select: { id: true },
    })
    expect(audit).not.toBeNull()

    expect(errorCode(await browser.post(`${BASE}/${batchId}/complete`).set(packagingHeaders).send({}).expect(409))).toBe('SLH_RECON_BATCH_NOT_IN_PROGRESS')

    // 结束之后占用解除：再次发起不再被「进行中」阻挡；全部行已核对，已没有可核对的活。
    expect(errorCode(await createBatch(replacement.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_NO_LINES_TO_RECONCILE')
    // 核对完的账单不再是候选（候选要求至少一行未对账），可核对/未冻结计数都归零。
    const candidates = (await browser.get(`${BASE}/candidates`).query({ pageSize: 100 }).expect(200)).body as { items: Array<{ id: string }> }
    expect(candidates.items.map(item => item.id)).not.toContain(replacement.id)
    const released = (await reconcilableCounts([replacement.id]).expect(200)).body as { items: Array<{ reconcilableLineCount: number, unfrozenLineCount: number }> }
    expect([released.items[0].reconcilableLineCount, released.items[0].unfrozenLineCount]).toEqual([0, 0])
  })

  it('批次列表：默认只看进行中，状态与关键词筛选、分页与总数同口径', async () => {
    const inProgressCount = await h.prisma.slhReconciliationBatch.count({ where: { completedAt: null } })
    const completedCount = await h.prisma.slhReconciliationBatch.count({ where: { completedAt: { not: null } } })
    const totalCount = inProgressCount + completedCount
    expect(inProgressCount).toBeGreaterThan(0)
    expect(completedCount).toBeGreaterThan(0)

    // 默认（不传状态）＝只看进行中，与页面「进页面先看还没收工的活」一致。
    const defaultList = (await browser.get(BASE).query({ pageSize: 100 }).expect(200)).body as { items: Array<{ status: string, memberCount: number, reconciledMemberCount: number, createdByDisplayName: string, bill: { lineCount: number, reconciledLineCount: number } }>, total: number }
    expect(defaultList.total).toBe(inProgressCount)
    expect(defaultList.items.every(item => item.status === 'IN_PROGRESS')).toBe(true)
    // 列表项自带页面要用的进度与账单摘要字段。
    expect(defaultList.items.every(item => typeof item.memberCount === 'number' && typeof item.reconciledMemberCount === 'number')).toBe(true)
    expect(defaultList.items.every(item => typeof item.bill.lineCount === 'number' && typeof item.bill.reconciledLineCount === 'number')).toBe(true)
    expect(defaultList.items.every(item => item.createdByDisplayName.length > 0)).toBe(true)

    const completedList = (await browser.get(BASE).query({ status: 'COMPLETED', pageSize: 100 }).expect(200)).body as { items: Array<{ status: string }>, total: number }
    expect(completedList.total).toBe(completedCount)
    expect(completedList.items.every(item => item.status === 'COMPLETED')).toBe(true)

    const allList = (await browser.get(BASE).query({ status: 'all', pageSize: 100 }).expect(200)).body as { total: number }
    expect(allList.total).toBe(totalCount)

    // 关键词：批次编号命中唯一一条；账单编号命中该账单下的全部批次。
    // 完成批次现在要求整批全部已核对，replacement 的批次已结束、不再有进行中的批次。
    const replacementBatch = await h.prisma.slhReconciliationBatch.findFirstOrThrow({ where: { billId: replacement.id }, select: { batchNo: true } })
    const byBatchNo = (await browser.get(BASE).query({ status: 'all', keyword: replacementBatch.batchNo }).expect(200)).body as { items: Array<{ batchNo: string }>, total: number }
    expect(byBatchNo.total).toBe(1)
    expect(byBatchNo.items[0].batchNo).toBe(replacementBatch.batchNo)

    const replacementBatchCount = await h.prisma.slhReconciliationBatch.count({ where: { billId: replacement.id } })
    const byBillNo = (await browser.get(BASE).query({ status: 'all', keyword: replacement.slhBillNo }).expect(200)).body as { items: Array<{ bill: { slhBillNo: string } }>, total: number }
    expect(byBillNo.total).toBe(replacementBatchCount)
    expect(byBillNo.items.every(item => item.bill.slhBillNo === replacement.slhBillNo)).toBe(true)

    // 分页：列表长度受 pageSize 限制，总数始终是整个结果集。
    const paged = (await browser.get(BASE).query({ status: 'all', page: 1, pageSize: 1 }).expect(200)).body as { items: unknown[], total: number, page: number, pageSize: number }
    expect([paged.page, paged.pageSize, paged.total]).toEqual([1, 1, totalCount])
    expect(paged.items).toHaveLength(1)
  })

  describe('确认结算', () => {
    /** 系统汇率在测试库里保持零值或没有行，这里显式给台币一条可用汇率（口径与 dev 一致）。 */
    const setSystemRate = async (value: string) => {
      const currency = await h.prisma.currency.findUniqueOrThrow({ where: { code: 'TWD' }, select: { id: true } })
      await h.prisma.exchangeRate.upsert({
        where: { currencyId: currency.id },
        create: { currencyId: currency.id, foreignUnitsPerCny: value },
        update: { foreignUnitsPerCny: value },
      })
    }
    const settle = (batchId: string, key: string, body: Record<string, unknown>) => browser
      .post(`${BASE}/${batchId}/settlements`).set(packagingHeaders).set('Idempotency-Key', key).send(body)
    const pendingBatch = async () => (await h.prisma.slhReconciliationBatch.findFirstOrThrow({
      where: { billId: pending.id, completedAt: null }, select: { id: true },
    })).id
    const memberByCod = async (batchId: string, codAmountTwd: string) => {
      const detail = (await browser.get(`${BASE}/${batchId}`).expect(200)).body as BatchDetail
      const member = detail.members.find(entry => entry.codAmountTwd === codAmountTwd)
      if (member === undefined) throw new Error(`member with cod ${codAmountTwd} not found`)
      return member
    }
    /** 夹具里每柜一个销售订单；beforeAll 统一把它们放宽为 WIDE_SALES_TOTAL（TWD），覆盖账单代收。 */
    const payload = (batchLineId: string, amounts: Record<string, string | null>) => ({
      batchLineId, rateSource: 'SYSTEM', rate: '5.2000', amounts,
    })
    /** 结算金额由调用方给定（用于制造不一致场景）；金流费用随汇率变化，按服务端同一口径复算。 */
    const fullPayload = (batchLineId: string, rateSource: string, rate: string, settlementAmountCny: string) => {
      const { paymentFeeAmountCny } = resolveSettlementAmounts({
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
        salesAmount: WIDE_SALES_TOTAL, rate, paymentFeeRate: PAYMENT_FEE_RATE,
      })
      return {
        batchLineId, rateSource, rate,
        amounts: {
          codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
          settlementAmountCny, salesAmount: WIDE_SALES_TOTAL, paymentFeeAmountCny,
        },
      }
    }

    it('写入结算结果：标记成员行与账单行、写审计事件，金额按「金额 + 币种」成对落库', async () => {
      await setSystemRate('5.2000')
      const batchId = await pendingBatch()
      const member = await memberByCod(batchId, '129000.00')
      const response = await settle(batchId, randomUUID(), payload(member.id, {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
        settlementAmountCny: '19098.85', salesAmount: WIDE_SALES_TOTAL, paymentFeeAmountCny: '1346.15',
      })).expect(201)
      expect(response.body).toMatchObject({
        batchLineId: member.id, status: 'ACTIVE', rateSource: 'SYSTEM', paymentFeeRate: '0.007',
      })

      const row = await h.prisma.slhReconciliationSettlement.findFirstOrThrow({ where: { batchLineId: member.id } })
      expect(row).toMatchObject({
        status: 'ACTIVE', rateSource: 'SYSTEM',
        slhBillNo: pending.slhBillNo,
        codAmountCurrency: 'TWD', ntdSurchargeCurrency: 'TWD',
        payableCurrency: 'CNY', settlementCurrency: 'CNY', paymentFeeCurrency: 'CNY', salesCurrency: 'TWD',
        shippingMarkText: 'L-010229', warehouseReceiptReference: 'WG-0102-0092', containerBatchNo: '0102-01柜',
      })
      expect(row.salesOrderNo.startsWith('PKG-SO-')).toBe(true)
      expect(row.codAmountTwd?.toFixed(2)).toBe('129000.00')
      expect(row.settlementAmountCny?.toFixed(2)).toBe('19098.85')
      expect(row.paymentFeeAmountCny?.toFixed(2)).toBe('1346.15')
      expect(row.foreignUnitsPerCny.toFixed(4)).toBe('5.2000')

      // 首次核对才写留痕：成员行与账单行都要被标记，批次进度随之变化，切换器读到的行状态变成已对账。
      const memberRow = await h.prisma.slhReconciliationBatchLine.findUniqueOrThrow({ where: { id: member.id }, select: { reconciledAt: true, reconciledById: true } })
      expect(memberRow.reconciledAt).not.toBeNull()
      // 核对人就是这次写入的记录人（浏览器会话身份，不假设等于夹具账号）。
      expect(memberRow.reconciledById).toBe(row.createdById)
      const lineRow = await h.prisma.slhBillLine.findUniqueOrThrow({ where: { id: member.lineId }, select: { reconciledAt: true } })
      expect(lineRow.reconciledAt).not.toBeNull()
      const detail = (await browser.get(`${BASE}/${batchId}`).expect(200)).body as BatchDetail
      expect(detail.reconciledMemberCount).toBe(1)
      expect(detail.members.find(entry => entry.id === member.id)?.reconciliationStatus).toBe('RECONCILED')

      const audit = await h.prisma.auditEvent.findFirst({
        where: { eventType: 'SLH_BILL_LINES_RECONCILED', targetId: (response.body as { id: string }).id }, select: { metadata: true },
      })
      expect(audit?.metadata).toMatchObject({ batchLineId: member.id, rateSource: 'SYSTEM', settlementAmountCny: '19098.85' })
    })

    it('界面值与重算不一致、汇率变化、来源不可用都在写库前被拒，且不落数据', async () => {
      const batchId = await pendingBatch()
      const member = await memberByCod(batchId, '129000.00')
      const before = await h.prisma.slhReconciliationSettlement.count()

      const mismatch = await settle(batchId, randomUUID(), payload(member.id, {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
        settlementAmountCny: '19098.86', salesAmount: WIDE_SALES_TOTAL, paymentFeeAmountCny: '1346.15',
      })).expect(409)
      expect(errorCode(mismatch)).toBe('SLH_RECON_SETTLEMENT_MISMATCH')
      expect((mismatch.body as { message: string }).message).toContain('结算金额')

      const rateChanged = await settle(batchId, randomUUID(), fullPayload(member.id, 'SYSTEM', '5.1000', '19098.85')).expect(409)
      expect(errorCode(rateChanged)).toBe('SLH_RECON_SETTLEMENT_RATE_CHANGED')

      // 台币汇率行被删掉（没有可用汇率）：来源不可用必须失败关闭。
      const twd = await h.prisma.currency.findUniqueOrThrow({ where: { code: 'TWD' }, select: { id: true } })
      await h.prisma.exchangeRate.deleteMany({ where: { currencyId: twd.id } })
      const unavailable = await settle(batchId, randomUUID(), payload(member.id, {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
        settlementAmountCny: '19098.85', salesAmount: WIDE_SALES_TOTAL, paymentFeeAmountCny: '1346.15',
      })).expect(409)
      expect(errorCode(unavailable)).toBe('SLH_RECON_SETTLEMENT_RATE_UNAVAILABLE')
      await setSystemRate('5.2000')

      expect(await h.prisma.slhReconciliationSettlement.count()).toBe(before)
    })

    it('相同数据被拒、不同数据取代旧记录、同键重放只落一条', async () => {
      const batchId = await pendingBatch()
      const member = await memberByCod(batchId, '129000.00')

      // 与当前有效记录完全相同的口径 ⇒ 拒绝，不写库。
      const unchanged = await settle(batchId, randomUUID(), payload(member.id, {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
        settlementAmountCny: '19098.85', salesAmount: WIDE_SALES_TOTAL, paymentFeeAmountCny: '1346.15',
      })).expect(409)
      expect(errorCode(unchanged)).toBe('SLH_RECON_SETTLEMENT_UNCHANGED')

      // 换汇率来源 ⇒ 口径变了：旧记录失效、新记录有效，同一行始终只剩一条有效。
      const key = randomUUID()
      const changed = await settle(batchId, key, fullPayload(member.id, 'EMBEDDED', '4.8000', '21070.00')).expect(201)
      expect(changed.body).toMatchObject({ status: 'ACTIVE', rateSource: 'EMBEDDED' })
      const rows = await h.prisma.slhReconciliationSettlement.findMany({
        where: { batchLineId: member.id }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true },
      })
      expect(rows).toHaveLength(2)
      expect(rows.map(row => row.status)).toEqual(['SUPERSEDED', 'ACTIVE'])
      expect(rows[1]?.id).toBe((changed.body as { id: string }).id)

      // 同键重放：返回同一条记录且不新增行；同键换载荷被拒。
      const replay = await settle(batchId, key, fullPayload(member.id, 'EMBEDDED', '4.8000', '21070.00')).expect(201)
      expect((replay.body as { id: string }).id).toBe((changed.body as { id: string }).id)
      expect(await h.prisma.slhReconciliationSettlement.count({ where: { batchLineId: member.id } })).toBe(2)

      const reused = await settle(batchId, key, fullPayload(member.id, 'SYSTEM', '5.2000', '19098.85')).expect(409)
      expect(errorCode(reused)).toBe('SLH_RECON_SETTLEMENT_KEY_REUSED')

      // 重新结算不刷新「首次核对时刻」：留痕仍是第一次写入时的值。
      const reconciled = await h.prisma.slhReconciliationBatchLine.findUniqueOrThrow({ where: { id: member.id }, select: { reconciledAt: true } })
      expect(reconciled.reconciledAt).not.toBeNull()
      const detail = (await browser.get(`${BASE}/${batchId}`).expect(200)).body as BatchDetail
      expect(detail.reconciledMemberCount).toBe(1)
      // 数据行不可删：直接删库被触发器拒绝。
      await expect(h.prisma.$executeRaw`DELETE FROM slh_reconciliation_settlements`).rejects.toThrow(/immutable/u)
    })

    it('核对记录列表：按成员行倒序给出完整留痕，跨批次成员与未知批次都 404', async () => {
      const batchId = await pendingBatch()
      const member = await memberByCod(batchId, '129000.00')
      const detail = (await browser.get(`${BASE}/${batchId}`).expect(200)).body as BatchDetail
      // 夹具里另一行不涉及代收货款：它没有确认过，用来验空列表。
      const untouched = detail.members.find(entry => entry.codAmountTwd === null)
      if (untouched === undefined) {
        throw new Error('fixture member without COD not found')
      }

      const page = (await browser.get(`${BASE}/${batchId}/settlements`).query({ batchLineId: member.id }).expect(200))
        .body as { items: Array<Record<string, unknown>> }
      // 该行已确认过两次（SYSTEM 与 EMBEDDED）：最新的在最前，且只有一条有效。
      expect(page.items).toHaveLength(2)
      expect(page.items.map(item => item.status)).toEqual(['ACTIVE', 'SUPERSEDED'])
      expect(page.items.map(item => item.rateSource)).toEqual(['EMBEDDED', 'SYSTEM'])
      expect(page.items[0]).toMatchObject({
        foreignUnitsPerCny: '4.8000',
        paymentFeeRate: '0.007',
        settlementAmountCny: '21070.00',
        settlementCurrency: 'CNY',
        codAmountTwd: '129000.00',
        codAmountCurrency: 'TWD',
        salesAmount: WIDE_SALES_TOTAL,
        salesCurrency: 'TWD',
        slhBillNo: pending.slhBillNo,
        containerBatchNo: '0102-01柜',
        shippingMarkText: 'L-010229',
        warehouseReceiptReference: 'WG-0102-0092',
      })
      expect(typeof page.items[0]?.createdByDisplayName).toBe('string')
      expect(typeof page.items[0]?.createdAt).toBe('string')

      // 还没确认过的行返回空列表；不属于该批次的成员行与未知批次都按 404 拒绝。
      const empty = (await browser.get(`${BASE}/${batchId}/settlements`).query({ batchLineId: untouched.id }).expect(200))
        .body as { items: unknown[] }
      expect(empty.items).toEqual([])
      expect(errorCode(await browser.get(`${BASE}/${batchId}/settlements`).query({ batchLineId: unknownId }).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
      expect(errorCode(await browser.get(`${BASE}/${unknownId}/settlements`).query({ batchLineId: member.id }).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
      expect((await outsider.get(`${BASE}/${batchId}/settlements`).query({ batchLineId: member.id })).status).toBe(403)
      expect(errorCode(await browser.get(`${BASE}/${batchId}/settlements`).query({ batchLineId: 'not-a-uuid' }).expect(422))).toBe('VALIDATION_FAILED')
    })

    it('权限、批次归属与完成状态都在写库前把关', async () => {
      const batchId = await pendingBatch()
      const member = await memberByCod(batchId, '129000.00')
      const body = fullPayload(member.id, 'SYSTEM', '5.2000', '19098.85')

      // 缺少 reconcile 权限：403；批次或成员不存在：404；非法幂等键：422。
      expect((await outsider.post(`${BASE}/${batchId}/settlements`).set(packagingHeaders).set('Idempotency-Key', randomUUID()).send(body)).status).toBe(403)
      expect(errorCode(await settle(unknownId, randomUUID(), body).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
      expect(errorCode(await settle(batchId, randomUUID(), { ...body, batchLineId: unknownId }).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
      expect(errorCode(await settle(batchId, 'not-a-uuid', body).expect(422))).toBe('VALIDATION_FAILED')

      // 批次完成后不能再确认结算：完成门禁要求全部已核对，先把剩余成员补齐再完成。
      await settleAllMembers(batchId)
      const rowsBefore = await h.prisma.slhReconciliationSettlement.count()
      await browser.post(`${BASE}/${batchId}/complete`).set(packagingHeaders).send({}).expect(200)
      const completed = await settle(batchId, randomUUID(), body).expect(409)
      expect(errorCode(completed)).toBe('SLH_RECON_BATCH_NOT_IN_PROGRESS')
      expect(await h.prisma.slhReconciliationSettlement.count()).toBe(rowsBefore)
    })
  })

  describe('完成批次入账', () => {
    /** 系统汇率按用例显式给定：结算与金流费用都从这来源取值。 */
    const setSystemRate = async (value: string) => {
      const currency = await h.prisma.currency.findUniqueOrThrow({ where: { code: 'TWD' }, select: { id: true } })
      await h.prisma.exchangeRate.upsert({
        where: { currencyId: currency.id },
        create: { currencyId: currency.id, foreignUnitsPerCny: value },
        update: { foreignUnitsPerCny: value },
      })
    }

    /** 账单「装柜日期」列是 Excel 日期序列号，匹配时它是年份的唯一来源。 */
    const excelSerial = (date: string) => String(Math.round((Date.parse(`${date}T00:00:00.000Z`) - Date.UTC(1899, 11, 30)) / 86_400_000))

    /**
     * 一张独立账单 + 独立柜次：入账用例要精确控制每行的单据金额与资金归属人。
     * 柜次身份是「入仓仓库 + 装柜日期 + 当日序号」，因此同名次日必须换日期；
     * 账单柜号列里的月日、当日序号与唛头都要落在同一个日期上，匹配才成立。
     */
    async function preparedBatch(suffix: string, options: {
      issuerUserId?: string
      payableAmountCny: string | null
      codAmountTwd: string | null
      surchargeNtd?: string
    }): Promise<{ batchId: string, memberId: string }> {
      const date = `2026-03-${suffix}`
      const containerBatchName = `03${suffix}-01柜`
      const mark = `M-03${suffix}26`
      const shipment = await h.shipment({ salesLinked: true, ownerUserId: options.issuerUserId ?? h.fixture.actor.id })
      if (shipment.source === null) throw new Error('sales linked shipment must create a sales order')
      // 完成批次会把账单代收回填为销售收款：订单总额必须覆盖账单代收，统一放宽为大额。
      await widenSalesTotal(shipment.source.id)
      await createContainer(containerBatchName, date, [{ mark, shipmentId: shipment.part.id }])
      const bill = await importBill(`入账-${containerBatchName}`, createSlhBillFixture({
        rows: [{
          B: excelSerial(date), C: containerBatchName, D: '千树贸易', E: `WG-03${suffix}-0001`, F: mark,
          G: '农用四轮微耕机', H: '1', I: 'CTN',
          // 行级勾稽 payable = 运费 + 代收手续费 + 附加费 是数据库硬约束：整笔放进运费列。
          // 金额全为 null 表示「本行不涉及」——用于零流水的完成用例；不涉及代收时也不带 NTD 杂费。
          ...(options.payableAmountCny === null ? {} : { R: options.payableAmountCny, U: options.payableAmountCny }),
          ...(options.codAmountTwd === null ? {} : { V: options.codAmountTwd, W: options.surchargeNtd ?? '6000' }),
          X: '入账测试', Y: '测试收货人一',
        }],
      }))
      const created = (await createBatch(bill.id, randomUUID()).expect(201)).body as BatchDetail
      const [member] = created.members
      if (member === undefined) throw new Error('batch has no member')
      return { batchId: created.id, memberId: member.id }
    }

    /** 结算金额与金流费用都由同一口径复算，避免在用例里硬编码中间值。 */
    const settleWith = async (batchId: string, memberId: string, rate: string, amounts: { codAmountTwd: string | null, ntdSurchargeAmountTwd: string | null, payableAmountCny: string | null }) => {
      const resolved = resolveSettlementAmounts({ ...amounts, salesAmount: WIDE_SALES_TOTAL, rate, paymentFeeRate: PAYMENT_FEE_RATE })
      const response = await browser.post(`${BASE}/${batchId}/settlements`).set(packagingHeaders).set('Idempotency-Key', randomUUID())
        .send({ batchLineId: memberId, rateSource: 'SYSTEM', rate, amounts: resolved }).expect(201)
      return response.body as { id: string }
    }

    /** 成员行背后的销售订单主键：回填相关断言都用它回查。 */
    const salesOrderIdOfMember = async (memberId: string): Promise<string> => {
      const row = await h.prisma.slhReconciliationBatchLine.findUniqueOrThrow({
        where: { id: memberId },
        select: { matchedLoadingItem: { select: { shipment: { select: { purchaseOrder: { select: { salesOrderId: true } } } } } } },
      })
      const salesOrderId = row.matchedLoadingItem.shipment?.purchaseOrder?.salesOrderId
      if (salesOrderId === null || salesOrderId === undefined) throw new Error('member has no sales order')
      return salesOrderId
    }

    /** 销售单详情需要 sales-orders:read：核对域会话只有 slh-bills 权限，另开一个只读会话。 */
    let salesOrderReader: request.Agent | null = null
    const salesOrderDetail = async (salesOrderId: string): Promise<Record<string, unknown>> => {
      salesOrderReader ??= (await h.browserWithPermissions(['sales-orders:read'])).browser
      return (await salesOrderReader.get(`/api/sales-orders/${salesOrderId}`).expect(200)).body as Record<string, unknown>
    }

    it('归属人没有资金账户时阻断完成：批次保持进行中、无资金流水、无完成审计', async () => {
      // 新用户只有登录身份，没有资金账户：它作为销售出单人时完成必须被阻断。
      const stranded = await h.browserWithPermissions(['slh-bills:read'])
      const prepared = await preparedBatch('01', {
        issuerUserId: stranded.user.id, payableAmountCny: '4555', codAmountTwd: '129000',
      })
      await setSystemRate('5.2000')
      await settleWith(prepared.batchId, prepared.memberId, '5.2000', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      })
      const batchesBefore = await h.prisma.fundPostingBatch.count()
      const blocked = await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(409)
      expect(errorCode(blocked)).toBe('SLH_RECON_BATCH_POSTING_ACCOUNT_UNAVAILABLE')
      expect((blocked.body as { message: string }).message).toContain('资金账户')

      // 阻断是整批回滚：批次仍进行中，也没有完成审计与任何资金流水。
      const batch = await h.prisma.slhReconciliationBatch.findUniqueOrThrow({ where: { id: prepared.batchId }, select: { completedAt: true } })
      expect(batch.completedAt).toBeNull()
      expect(await h.prisma.fundPostingBatch.count()).toBe(batchesBefore)
      expect(await h.prisma.auditEvent.count({ where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', targetId: prepared.batchId } })).toBe(0)
      // 同一批次补好账户后可以正常完成。
      await h.app.get(FundAccountCommandService).createUserAccount(
        { actorUserId: h.fixture.actor.id, requestId: randomUUID() },
        { userId: stranded.user.id, userShareRate: '30' },
      )
      const completed = (await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(200)).body as BatchDetail
      expect(completed.status).toBe('COMPLETED')
    })

    it('金流费用入账：绑定结算记录与批次编号，结算金额为 0 时跳过该笔', async () => {
      const prepared = await preparedBatch('02', { payableAmountCny: '10000', codAmountTwd: '52000', surchargeNtd: '0' })
      await setSystemRate('5.2000')
      // (52000 − 0) ÷ 5.2 − 10000 = 0.00：结算金额为零，这一笔跳过，只剩金流费用。
      const settlement = await settleWith(prepared.batchId, prepared.memberId, '5.2000', {
        codAmountTwd: '52000.00', ntdSurchargeAmountTwd: '0.00', payableAmountCny: '10000.00',
      })
      const row = await h.prisma.slhReconciliationSettlement.findUniqueOrThrow({ where: { id: settlement.id } })
      expect(row.settlementAmountCny?.toFixed(2)).toBe('0.00')
      expect(row.paymentFeeAmountCny?.toFixed(2)).toBe('1346.15')

      await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(200)
      // 费用按销售单入账：用销售单主键回查，账单行的结算记录只在 metadata 里留痕。
      const postings = await h.prisma.fundPostingBatch.findMany({
        where: { businessId: row.salesOrderId }, include: { entries: true }, orderBy: { consumerCode: 'asc' },
      })
      expect(postings.map(entry => entry.consumerCode)).toEqual(['SLH_BILL_FINANCE_SETTLEMENT.FEE'])
      const [fee] = postings
      if (fee === undefined) throw new Error('fee posting missing')
      expect(fee).toMatchObject({
        businessSourceCodeSnapshot: 'SLH_BILL_FINANCE_SETTLEMENT',
        postingTypeCodeSnapshot: 'FULL_FLOW_PAYMENT_FEE',
        businessCategorySnapshot: 'COST',
        // 费用按销售单入账：业务身份是销售单（编号），不是账单行。
        businessId: row.salesOrderId,
        businessNo: row.salesOrderNo,
        userId: h.fixture.actor.id,
      })
      expect(fee.businessAmount.toFixed(2)).toBe('1346.15')
      // 幂等键按销售单推导：同一销售单的费用只会入一次，重放也恢复同一笔。
      expect(Buffer.from(fee.idempotencyKeyHash).equals(createHash('sha256').update(`${row.salesOrderId}:FEE`).digest())).toBe(true)
      expect(fee.metadata).toMatchObject({ slhReconciliationBatchId: prepared.batchId, slhReconciliationSettlementId: settlement.id })
      // 用户 30%（403.845 按 HALF_UP 进到 403.85）与公司尾差各一笔，费用恒为出账。
      expect(fee.entries.map(entry => [entry.accountTarget, entry.direction, entry.amount.toFixed(2)]).sort()).toEqual([
        ['COMPANY', 'DEBIT', '942.30'], ['USER', 'DEBIT', '403.85'],
      ])
    })

    it('结算为正时用户与公司按比例分账并贷记，结算为负时两腿都出账', async () => {
      const prepared = await preparedBatch('03', { payableAmountCny: '4555', codAmountTwd: '129000' })
      await setSystemRate('5.2000')
      const settlement = await settleWith(prepared.batchId, prepared.memberId, '5.2000', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      })
      const row = await h.prisma.slhReconciliationSettlement.findUniqueOrThrow({ where: { id: settlement.id } })
      expect(row.settlementAmountCny?.toFixed(2)).toBe('19098.85')

      const account = await h.prisma.fundAccount.findFirstOrThrow({ where: { userId: h.fixture.actor.id }, select: { id: true, balance: true } })
      const company = await h.prisma.fundAccount.findFirstOrThrow({ where: { ownerType: 'COMPANY' }, select: { id: true, balance: true } })
      await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(200)

      // 结算金额挂在账单行（业务身份＝结算记录），费用挂在销售单：两类流水的身份不同，各查一次。
      const postings = await h.prisma.fundPostingBatch.findMany({
        where: { OR: [{ businessId: settlement.id }, { businessId: row.salesOrderId }] }, include: { entries: true },
      })
      expect(postings.map(entry => entry.consumerCode).sort()).toEqual([
        'SLH_BILL_FINANCE_SETTLEMENT.FEE', 'SLH_BILL_FINANCE_SETTLEMENT.RECONCILE',
      ])
      const reconcile = postings.find(entry => entry.consumerCode === 'SLH_BILL_FINANCE_SETTLEMENT.RECONCILE')!
      expect(reconcile).toMatchObject({
        postingTypeCodeSnapshot: 'ORDER_SETTLEMENT', businessCategorySnapshot: 'REVENUE',
        userId: h.fixture.actor.id,
      })
      // 19098.85 的 30% 归用户、尾差归公司，收入恒为贷记。
      const reconcileEntries = reconcile.entries.map(entry => [entry.accountTarget, entry.direction, entry.amount.toFixed(2)]).sort()
      expect(reconcileEntries).toEqual([
        ['COMPANY', 'CREDIT', '13369.19'], ['USER', 'CREDIT', '5729.66'],
      ])
      expect(reconcileEntries.reduce((sum, entry) => sum + Number(entry[2]), 0).toFixed(2)).toBe('19098.85')

      // 余额真的动了：用户与公司各自「结算分账贷记 − 金流费用分账借记」。
      // 金流费用 1346.15 按 30% 分账：用户借记 403.85（403.845 按 HALF_UP 进位）、公司承接尾差 942.30。
      const userAfter = await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: account.id }, select: { balance: true } })
      const companyAfter = await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: company.id }, select: { balance: true } })
      expect(userAfter.balance.minus(account.balance).toFixed(2)).toBe('5325.81')
      expect(companyAfter.balance.minus(company.balance).toFixed(2)).toBe('12426.89')

      // 批次审计只留标量事实：多笔入账只记数量，逐笔关联走资金侧的 business_id 回查。
      const audit = await h.prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', targetId: prepared.batchId }, select: { metadata: true },
      })
      expect((audit.metadata as { fundPostingCount: number })).toMatchObject({ fundPostingCount: 2 })

      // 负结算金额：两腿都出账，金额取绝对值。
      const negative = await preparedBatch('04', { payableAmountCny: '60000', codAmountTwd: '129000' })
      const negativeSettlement = await settleWith(negative.batchId, negative.memberId, '5.2000', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '60000.00',
      })
      const negativeRow = await h.prisma.slhReconciliationSettlement.findUniqueOrThrow({ where: { id: negativeSettlement.id } })
      expect(negativeRow.settlementAmountCny?.toFixed(2)).toBe('-36346.15')
      await browser.post(`${BASE}/${negative.batchId}/complete`).set(packagingHeaders).send({}).expect(200)
      const negativePosting = await h.prisma.fundPostingBatch.findFirstOrThrow({
        where: { businessId: negativeSettlement.id, consumerCode: 'SLH_BILL_FINANCE_SETTLEMENT.RECONCILE' }, include: { entries: true },
      })
      expect(negativePosting.businessAmount.toFixed(2)).toBe('-36346.15')
      expect(negativePosting.entries.map(entry => [entry.accountTarget, entry.direction, entry.amount.toFixed(2)]).sort()).toEqual([
        ['COMPANY', 'DEBIT', '25442.30'], ['USER', 'DEBIT', '10903.85'],
      ])
    })

    it('金流费用为零时只入结算，金额全零的核对不产生流水', async () => {
      const prepared = await preparedBatch('05', { payableAmountCny: '4555', codAmountTwd: '129000' })
      // 汇率放大后 1,000,000 ÷ 2,000,000 × 0.007 量化为 0.00：金流费用为零，这一笔跳过。
      await setSystemRate('2000000.00')
      const settlement = await settleWith(prepared.batchId, prepared.memberId, '2000000.00', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      })
      const row = await h.prisma.slhReconciliationSettlement.findUniqueOrThrow({ where: { id: settlement.id } })
      expect(row.paymentFeeAmountCny?.toFixed(2)).toBe('0.00')
      // (129000 − 6000) ÷ 2000000 − 4555 = −4554.94。
      expect(row.settlementAmountCny?.toFixed(2)).toBe('-4554.94')

      await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(200)
      const postings = await h.prisma.fundPostingBatch.findMany({ where: { businessId: settlement.id }, select: { consumerCode: true } })
      expect(postings.map(entry => entry.consumerCode)).toEqual(['SLH_BILL_FINANCE_SETTLEMENT.RECONCILE'])

      // 金额全为零的核对（本行不涉及代收也不涉及应付，汇率下费用也量化为 0.00）：完成不产生任何资金流水。
      const zeroAmount = await preparedBatch('06', { payableAmountCny: null, codAmountTwd: null })
      await settleWith(zeroAmount.batchId, zeroAmount.memberId, '2000000.00', {
        codAmountTwd: null, ntdSurchargeAmountTwd: null, payableAmountCny: null,
      })
      const before = await h.prisma.fundPostingBatch.count()
      await browser.post(`${BASE}/${zeroAmount.batchId}/complete`).set(packagingHeaders).send({}).expect(200)
      expect(await h.prisma.fundPostingBatch.count()).toBe(before)
      const audit = await h.prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', targetId: zeroAmount.batchId }, select: { metadata: true },
      })
      expect((audit.metadata as { fundPostingBatchId: string | null, fundPostingCount: number }))
        .toMatchObject({ fundPostingBatchId: null, fundPostingCount: 0 })
      await setSystemRate('5.2000')
    })

    it('完成回填代收货款收款：字段口径与来源固定，收齐且已签收时订单自动完成', async () => {
      await setSystemRate('5.2000')
      const prepared = await preparedBatch('07', { payableAmountCny: '4555', codAmountTwd: '129000' })
      const settlement = await settleWith(prepared.batchId, prepared.memberId, '5.2000', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      })
      const salesOrderId = await salesOrderIdOfMember(prepared.memberId)
      // 订单总额压到恰好等于本行账单代收：回填后应「已付清」；履约置为已签收，验证自动推进。
      await widenSalesTotal(salesOrderId, '129000.00')
      await h.prisma.salesOrder.update({ where: { id: salesOrderId }, data: { fulfillmentStatus: 'SIGNED' } })

      await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(200)

      const settlementRow = await h.prisma.slhReconciliationSettlement.findUniqueOrThrow({ where: { id: settlement.id } })
      const reconcileBatch = await h.prisma.fundPostingBatch.findFirstOrThrow({
        where: { businessId: settlement.id, consumerCode: 'SLH_BILL_FINANCE_SETTLEMENT.RECONCILE' },
        select: { id: true },
      })
      const payment = await h.prisma.salesOrderPayment.findFirstOrThrow({
        where: { salesOrderId, origin: 'COD_SETTLEMENT' },
      })
      expect(payment).toMatchObject({
        origin: 'COD_SETTLEMENT', paymentType: 'COD_BALANCE', paymentMethod: 'BILL_COD_SETTLEMENT',
        remark: 'COD代收货款顺联航账单结算',
        // 溯源锚点是产生它的结算记录；而 RECONCILE 入账批次「有则绑」。
        slhReconciliationSettlementId: settlement.id,
        fundPostingBatchId: reconcileBatch.id,
        // 回填不经汇率（台币 1:1），也没有作废入口。
        voidedAt: null, voidReason: null, exchangeRateId: null, foreignUnitsPerCnySnapshot: null,
      })
      expect(payment.amount.toFixed(2)).toBe('129000.00')
      expect(payment.receivedAt.toISOString()).toBe(settlementRow.createdAt.toISOString())

      // 付款状态由回填驱动：收齐即已付清；订单被本批次覆盖且没有其它进行中的批次，
      // 按口径 R3 一步推进到已完成（「进待对账」与「完成」在同一次重评里完成）。
      const order = await h.prisma.salesOrder.findUniqueOrThrow({ where: { id: salesOrderId }, select: { paymentStatus: true, orderStatus: true } })
      expect(order).toMatchObject({ paymentStatus: 'PAID', orderStatus: 'COMPLETED' })
      const history = await h.prisma.salesOrderStatusHistory.findFirst({
        where: { salesOrderId, dimension: 'PAYMENT', toStatus: 'PAID' }, select: { reason: true },
      })
      expect(history?.reason).toContain('结算回填代收货款')
      const completedHistory = await h.prisma.salesOrderStatusHistory.findFirst({
        where: { salesOrderId, dimension: 'ORDER', toStatus: 'COMPLETED' }, select: { reason: true },
      })
      expect(completedHistory?.reason).toBe('订单对账已完成，系统自动完成订单')

      const audit = await h.prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', targetId: prepared.batchId }, select: { metadata: true },
      })
      expect(audit.metadata).toMatchObject({ backfilledPaymentCount: 1, autoCompletedOrderCount: 1 })

      // 收款详情契约：代收回填没有凭证文件，详情接口仍返回 200，origin 与类型可见、voucher 为空；
      // 订单已完成，不再有停留原因。
      const detail = await salesOrderDetail(salesOrderId) as {
        completionHold: unknown
        payments: Array<{ origin: string, paymentType: string, voucher: unknown }>
      }
      expect(detail.completionHold).toBeNull()
      const dto = detail.payments.find(entry => entry.origin === 'COD_SETTLEMENT')
      expect(dto).toMatchObject({ origin: 'COD_SETTLEMENT', paymentType: 'COD_BALANCE', voucher: null })
    })

    it('手工入口不能把订单置为已完成：已完成只由系统在对账完成后自动推进', async () => {
      const updater = (await h.browserWithPermissions(['sales-orders:update'])).browser
      const shipment = await h.shipment({ salesLinked: true, ownerUserId: h.fixture.actor.id })
      if (shipment.source === null) throw new Error('sales linked shipment must create a sales order')
      // 即便已签收，手工置为已完成也要被拒：该状态是派生态，只由自动状态服务推进
      // （付款状态不动：订单的付款状态必须与实收一致，数据库触发器会核对）。
      await h.prisma.salesOrder.update({
        where: { id: shipment.source.id },
        data: { orderStatus: 'PENDING_RECONCILIATION', fulfillmentStatus: 'SIGNED' },
      })
      const rejected = await updater.patch(`/api/sales-orders/${shipment.source.id}/order-status`)
        .set(packagingHeaders).send({ toStatus: 'COMPLETED', reason: '手工完成' }).expect(422)
      expect(errorCode(rejected)).toBe('SALES_ORDER_COMPLETION_IS_AUTOMATIC')
      expect(await h.prisma.salesOrder.findUniqueOrThrow({
        where: { id: shipment.source.id }, select: { orderStatus: true },
      })).toEqual({ orderStatus: 'PENDING_RECONCILIATION' })
    })

    it('停留原因的读侧口径：非待对账不下发，未收齐时先报「等待收齐款项」，列表与详情一致', async () => {
      const shipment = await h.shipment({ salesLinked: true, ownerUserId: h.fixture.actor.id })
      if (shipment.source === null) throw new Error('sales linked shipment must create a sales order')
      const salesOrderId = shipment.source.id
      const reader = (await h.browserWithPermissions(['sales-orders:read'])).browser
      const detailOf = async () => {
        return (await reader.get(`/api/sales-orders/${salesOrderId}`).expect(200)).body as {
          orderStatus: string
          completionHold: unknown
        }
      }

      // 已确认订单没有停留原因。
      expect((await detailOf()).completionHold).toBeNull()

      // 待对账但未收齐：付清前置先于对账完备性（收款被作废后的回退形态）。
      await h.prisma.salesOrder.update({
        where: { id: salesOrderId },
        data: { orderStatus: 'PENDING_RECONCILIATION', fulfillmentStatus: 'SIGNED' },
      })
      expect(await detailOf()).toMatchObject({
        orderStatus: 'PENDING_RECONCILIATION',
        completionHold: { reason: 'PAYMENT_INCOMPLETE', pendingBatchCount: 0, unreconciledMemberCount: 0 },
      })

      // 列表口径与详情一致。
      const orderNo = (await h.prisma.salesOrder.findUniqueOrThrow({
        where: { id: salesOrderId }, select: { orderNo: true },
      })).orderNo
      const list = (await reader.get('/api/sales-orders').query({ keyword: orderNo, pageSize: 50 }).expect(200)).body as {
        items: Array<{ id: string, completionHold: unknown }>
      }
      expect(list.items.find(item => item.id === salesOrderId)?.completionHold).toEqual({
        reason: 'PAYMENT_INCOMPLETE', pendingBatchCount: 0, unreconciledMemberCount: 0,
      })
    })

    it('多批次覆盖：仍有批次进行中时订单停留在待对账，全部结束后才自动完成', async () => {
      await setSystemRate('5.2000')
      // 一条货件装柜时拆成四个唛头：甲行承载代收货款、乙丙两行不涉及金额、
      // 丁行留到订单完成之后再建批次，验证「已完成订单仍可继续对账」。
      const date = '2026-03-16'
      const containerBatchName = '0316-01柜'
      const marks = ['M-031601', 'M-031602', 'M-031603', 'M-031604']
      const shipment = await h.shipment({ salesLinked: true, ownerUserId: h.fixture.actor.id })
      if (shipment.source === null) throw new Error('sales linked shipment must create a sales order')
      const salesOrderId = shipment.source.id
      // 订单总额压到恰好等于甲账单代收：甲批次完成后回填即可收齐。
      await widenSalesTotal(salesOrderId, '129000.00')
      await h.prisma.salesOrder.update({ where: { id: salesOrderId }, data: { fulfillmentStatus: 'SIGNED' } })
      await createContainer(containerBatchName, date, marks.map(mark => ({ mark, shipmentId: shipment.part.id })))
      const codRow = {
        B: excelSerial(date), C: containerBatchName, D: '千树贸易', E: 'WG-0316-0001', F: marks[0],
        G: '农用四轮微耕机', H: '1', I: 'CTN',
        R: '4555', U: '4555', V: '129000', W: '6000', X: '入账测试', Y: '测试收货人一',
      }
      const plainRowOf = (mark: string, index: number) => ({
        B: excelSerial(date), C: containerBatchName, D: '千树贸易', E: `WG-0316-000${index + 1}`, F: mark,
        G: '农用四轮微耕机', H: '1', I: 'CTN', X: '入账测试', Y: '测试收货人一',
      })
      const firstBill = await importBill(`入账-${containerBatchName}-甲`, createSlhBillFixture({ rows: [codRow] }))
      const secondBill = await importBill(`入账-${containerBatchName}-乙`, createSlhBillFixture({ rows: [plainRowOf(marks[1], 1)] }))
      const thirdBill = await importBill(`入账-${containerBatchName}-丙`, createSlhBillFixture({ rows: [plainRowOf(marks[2], 2)] }))
      const firstBatch = (await createBatch(firstBill.id, randomUUID()).expect(201)).body as BatchDetail
      const secondBatch = (await createBatch(secondBill.id, randomUUID()).expect(201)).body as BatchDetail
      const thirdBatch = (await createBatch(thirdBill.id, randomUUID()).expect(201)).body as BatchDetail
      const [firstMember] = firstBatch.members
      const [secondMember] = secondBatch.members
      const [thirdMember] = thirdBatch.members
      if (firstMember === undefined || secondMember === undefined || thirdMember === undefined) {
        throw new Error('batch has no member')
      }

      const reader = (await h.browserWithPermissions(['sales-orders:read'])).browser
      const readOrder = async () => {
        return (await reader.get(`/api/sales-orders/${salesOrderId}`).expect(200)).body as {
          orderStatus: string
          completionHold: unknown
        }
      }
      // 服务端按订单约定总额重算结算金额：这里的 salesAmount 必须与订单当前总额一致，
      // 否则接口按「与重算结果不一致」拒绝。
      const settleFromOrderTotal = async (
        batchId: string,
        memberId: string,
        rate: string,
        amounts: { codAmountTwd: string | null, ntdSurchargeAmountTwd: string | null, payableAmountCny: string | null },
      ) => {
        const resolved = resolveSettlementAmounts({
          ...amounts, salesAmount: '129000.00', rate, paymentFeeRate: PAYMENT_FEE_RATE,
        })
        await browser.post(`${BASE}/${batchId}/settlements`).set(packagingHeaders).set('Idempotency-Key', randomUUID())
          .send({ batchLineId: memberId, rateSource: 'SYSTEM', rate, amounts: resolved }).expect(201)
      }
      const settlementOfPlainMember = (batchId: string, memberId: string) => settleFromOrderTotal(
        batchId,
        memberId,
        '5.2000',
        // 不涉及任何金额：结算金额为 0，费用由「按销售单只入一次」的去重挡住。
        { codAmountTwd: null, ntdSurchargeAmountTwd: null, payableAmountCny: null },
      )
      const completedAuditOf = (batchId: string) => h.prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', targetId: batchId }, select: { metadata: true },
      })

      // 甲批次先核对并完成：代收回填让订单收齐，但乙丙批次仍在进行中 → 按口径 R3 停在待对账。
      await settleFromOrderTotal(firstBatch.id, firstMember.id, '5.2000', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      })
      await browser.post(`${BASE}/${firstBatch.id}/complete`).set(packagingHeaders).send({}).expect(200)
      expect(await h.prisma.salesOrder.findUniqueOrThrow({
        where: { id: salesOrderId }, select: { paymentStatus: true, orderStatus: true },
      })).toMatchObject({ paymentStatus: 'PAID', orderStatus: 'PENDING_RECONCILIATION' })
      expect(await readOrder()).toMatchObject({
        orderStatus: 'PENDING_RECONCILIATION',
        completionHold: { reason: 'RECONCILIATION_IN_PROGRESS', pendingBatchCount: 2, unreconciledMemberCount: 2 },
      })
      // 本次完成没有自动完成订单：审计里的自动完成计数为 0。
      expect((await completedAuditOf(firstBatch.id)).metadata).toMatchObject({ autoCompletedOrderCount: 0 })

      // 乙批次核对完成后只剩「批次未结束」：批次计数保留，未核对行数减到丙批次那一行。
      await settlementOfPlainMember(secondBatch.id, secondMember.id)
      expect((await readOrder()).completionHold).toEqual({
        reason: 'RECONCILIATION_IN_PROGRESS', pendingBatchCount: 2, unreconciledMemberCount: 1,
      })
      // 乙批次结束但丙批次仍在进行中：订单继续停在待对账。
      await browser.post(`${BASE}/${secondBatch.id}/complete`).set(packagingHeaders).send({}).expect(200)
      expect(await readOrder()).toMatchObject({
        orderStatus: 'PENDING_RECONCILIATION',
        completionHold: { reason: 'RECONCILIATION_IN_PROGRESS', pendingBatchCount: 1, unreconciledMemberCount: 1 },
      })

      // 全部批次结束：口径 R3 自动完成，停留原因清空，状态历史留痕。
      await settlementOfPlainMember(thirdBatch.id, thirdMember.id)
      await browser.post(`${BASE}/${thirdBatch.id}/complete`).set(packagingHeaders).send({}).expect(200)
      expect(await readOrder()).toMatchObject({ orderStatus: 'COMPLETED', completionHold: null })
      const completedHistory = await h.prisma.salesOrderStatusHistory.findFirst({
        where: { salesOrderId, dimension: 'ORDER', toStatus: 'COMPLETED' }, select: { reason: true },
      })
      expect(completedHistory?.reason).toBe('订单对账已完成，系统自动完成订单')
      expect((await completedAuditOf(thirdBatch.id)).metadata).toMatchObject({ autoCompletedOrderCount: 1 })

      // 已完成订单之后仍可继续对账：新建批次、核对并完成，订单状态保持已完成、
      // 不会被重评回退，停留原因仍为空，自动完成计数为 0。
      const trailingBill = await importBill(`入账-${containerBatchName}-丁`, createSlhBillFixture({ rows: [plainRowOf(marks[3], 3)] }))
      const trailingBatch = (await createBatch(trailingBill.id, randomUUID()).expect(201)).body as BatchDetail
      const [trailingMember] = trailingBatch.members
      if (trailingMember === undefined) throw new Error('batch has no member')
      await settlementOfPlainMember(trailingBatch.id, trailingMember.id)
      await browser.post(`${BASE}/${trailingBatch.id}/complete`).set(packagingHeaders).send({}).expect(200)
      expect(await readOrder()).toMatchObject({ orderStatus: 'COMPLETED', completionHold: null })
      expect((await completedAuditOf(trailingBatch.id)).metadata).toMatchObject({ autoCompletedOrderCount: 0 })
    })

    it('代收超收：相关行退回未核对、结算作废并拒绝完成，修复后可重新核对完成', async () => {
      await setSystemRate('5.2000')
      const prepared = await preparedBatch('08', { payableAmountCny: '4555', codAmountTwd: '129000' })
      const settlement = await settleWith(prepared.batchId, prepared.memberId, '5.2000', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      })
      const salesOrderId = await salesOrderIdOfMember(prepared.memberId)
      const memberRow = await h.prisma.slhReconciliationBatchLine.findUniqueOrThrow({ where: { id: prepared.memberId }, select: { lineId: true } })

      // 订单总额压回夹具原值（10 元）：账单代收远超实际待收款＝超收，完成必须退回。
      await widenSalesTotal(salesOrderId, '10.00')
      const rejected = await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(409)
      expect(errorCode(rejected)).toBe('SLH_RECON_SETTLEMENT_COD_OVERCOLLECTED')
      const message = (rejected.body as { message: string }).message
      expect(message).toContain('已退回重新核对')
      expect(message).toContain('129000.00')
      expect(message).toContain('10.00')

      // 重置：成员行与账单行退回未核对、结算记录作废、批次保持进行中、没有入账也没有回填。
      expect(await h.prisma.slhReconciliationBatchLine.findUniqueOrThrow({
        where: { id: prepared.memberId }, select: { reconciledAt: true, reconciledById: true },
      })).toEqual({ reconciledAt: null, reconciledById: null })
      expect((await h.prisma.slhBillLine.findUniqueOrThrow({ where: { id: memberRow.lineId }, select: { reconciledAt: true } })).reconciledAt).toBeNull()
      expect((await h.prisma.slhReconciliationSettlement.findUniqueOrThrow({ where: { id: settlement.id }, select: { status: true } })).status).toBe('SUPERSEDED')
      expect((await h.prisma.slhReconciliationBatch.findUniqueOrThrow({ where: { id: prepared.batchId }, select: { completedAt: true } })).completedAt).toBeNull()
      expect(await h.prisma.fundPostingBatch.count({ where: { businessId: settlement.id } })).toBe(0)
      expect(await h.prisma.salesOrderPayment.count({ where: { salesOrderId, origin: 'COD_SETTLEMENT' } })).toBe(0)
      expect(await h.prisma.auditEvent.count({
        where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETION_REJECTED', targetId: prepared.batchId },
      })).toBe(1)
      const detail = (await browser.get(`${BASE}/${prepared.batchId}`).expect(200)).body as BatchDetail
      expect(detail.reconciledMemberCount).toBe(0)
      expect(detail.members[0]?.reconciliationStatus).toBe('PENDING')

      // 修复金额后重新核对（作废的记录留在核对记录里）→ 完成成功且只回填一笔。
      await widenSalesTotal(salesOrderId)
      await settleAllMembers(prepared.batchId)
      expect(await h.prisma.slhReconciliationSettlement.count({ where: { batchLineId: prepared.memberId } })).toBe(2)
      await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(200)
      expect(await h.prisma.salesOrderPayment.count({ where: { salesOrderId, origin: 'COD_SETTLEMENT' } })).toBe(1)
    })

    it('少收不拦截：回填只写实收，订单停留部分付款并保留未收余额', async () => {
      await setSystemRate('5.2000')
      const prepared = await preparedBatch('09', { payableAmountCny: '4555', codAmountTwd: '129000' })
      await settleWith(prepared.batchId, prepared.memberId, '5.2000', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      })
      const salesOrderId = await salesOrderIdOfMember(prepared.memberId)
      // 总额比账单代收多 2000：回填只写实收，差额留给直付渠道追收。
      await widenSalesTotal(salesOrderId, '131000.00')
      await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(200)
      expect((await h.prisma.salesOrderPayment.findFirstOrThrow({
        where: { salesOrderId, origin: 'COD_SETTLEMENT' }, select: { amount: true },
      })).amount.toFixed(2)).toBe('129000.00')
      expect(await h.prisma.salesOrder.findUniqueOrThrow({
        where: { id: salesOrderId }, select: { paymentStatus: true, orderStatus: true },
      })).toMatchObject({ paymentStatus: 'PARTIALLY_PAID', orderStatus: 'CONFIRMED' })
      const detail = await salesOrderDetail(salesOrderId) as {
        amounts: { receivedAmount: string, outstandingAmount: string }
      }
      expect(detail).toMatchObject({ amounts: { receivedAmount: '129000.00', outstandingAmount: '2000.00' } })
    })

    it('完成门禁：整批未全部核对时拒绝完成，补齐后可完成', async () => {
      await setSystemRate('5.2000')
      // 柜次身份是「入仓仓库 + 装柜日期 + 当日序号」：日期在用例之间必须互不重复。
      const date = '2026-03-12'
      const containerBatchName = '0312-01柜'
      const marks = ['M-031226', 'M-031227']
      const shipment = await h.shipment({ salesLinked: true })
      if (shipment.source === null) throw new Error('sales linked shipment must create a sales order')
      await widenSalesTotal(shipment.source.id)
      await createContainer(containerBatchName, date, marks.map(mark => ({ mark, shipmentId: shipment.part.id })))
      const bill = await importBill(`入账-${containerBatchName}`, createSlhBillFixture({
        rows: marks.map((mark, index) => ({
          B: excelSerial(date), C: containerBatchName, D: '千树贸易', E: `WG-0312-000${index + 1}`, F: mark,
          G: '农用四轮微耕机', H: '1', I: 'CTN',
          R: String(1000 * (index + 1)), U: String(1000 * (index + 1)),
          V: '52000', W: '0', X: '入账测试', Y: '测试收货人一',
        })),
      }))
      const created = (await createBatch(bill.id, randomUUID()).expect(201)).body as BatchDetail
      expect(created.memberCount).toBe(2)
      const [first, second] = created.members
      if (first === undefined || second === undefined) throw new Error('batch members missing')

      // 只核对一行：完成必须被门禁拒绝，且批次保持进行中、无任何入账。
      await settleMemberFromBillLine(created.id, first)
      const blocked = await browser.post(`${BASE}/${created.id}/complete`).set(packagingHeaders).send({}).expect(409)
      expect(errorCode(blocked)).toBe('SLH_RECON_BATCH_UNRECONCILED_MEMBERS')
      expect((await h.prisma.slhReconciliationBatch.findUniqueOrThrow({ where: { id: created.id }, select: { completedAt: true } })).completedAt).toBeNull()

      await settleMemberFromBillLine(created.id, second)
      await browser.post(`${BASE}/${created.id}/complete`).set(packagingHeaders).send({}).expect(200)
    })

    it('并发完成串行化：同一批次的两次完成只成功一次，回填只有一笔', async () => {
      await setSystemRate('5.2000')
      const prepared = await preparedBatch('10', { payableAmountCny: '4555', codAmountTwd: '129000' })
      await settleWith(prepared.batchId, prepared.memberId, '5.2000', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      })
      const responses = await Promise.all([
        browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}),
        browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}),
      ])
      expect(responses.map(response => response.status).sort()).toEqual([200, 409])
      const failed = responses.find(response => response.status === 409)
      if (failed === undefined) throw new Error('expected one rejected completion')
      expect(errorCode(failed)).toBe('SLH_RECON_BATCH_NOT_IN_PROGRESS')
      const salesOrderId = await salesOrderIdOfMember(prepared.memberId)
      expect(await h.prisma.salesOrderPayment.count({ where: { salesOrderId, origin: 'COD_SETTLEMENT' } })).toBe(1)
    })

    it('伪造来源合规形状被数据库拒绝：consumer 与业务类型必须严格配对', async () => {
      const source = await h.prisma.fundBusinessSource.findUniqueOrThrow({ where: { code: 'SLH_BILL_FINANCE_SETTLEMENT' }, select: { id: true } })
      const orderSettlement = await h.prisma.fundPostingType.findUniqueOrThrow({ where: { code: 'ORDER_SETTLEMENT' }, select: { id: true, name: true, businessCategory: true, currentRuleVersionId: true } })
      const paymentFee = await h.prisma.fundPostingType.findUniqueOrThrow({ where: { code: 'FULL_FLOW_PAYMENT_FEE' }, select: { id: true, name: true, businessCategory: true, currentRuleVersionId: true } })
      const base = {
        batchNo: `SLHFAKE${Date.now()}`, kind: 'BUSINESS' as const,
        postingTypeId: orderSettlement.id, postingTypeCodeSnapshot: 'ORDER_SETTLEMENT', postingTypeNameSnapshot: orderSettlement.name,
        businessCategorySnapshot: orderSettlement.businessCategory, businessSourceId: source.id,
        businessSourceCodeSnapshot: 'SLH_BILL_FINANCE_SETTLEMENT', businessSourceNameSnapshot: '顺联航账单财务结算',
        ruleVersionId: orderSettlement.currentRuleVersionId!, ruleRevisionSnapshot: 1, userId: h.fixture.actor.id,
        businessAmount: '100.00', userShareRateSnapshot: '30', companyShareRateSnapshot: '70',
        businessId: randomUUID(), summary: '伪造入账', consumerCode: 'SLH_BILL_FINANCE_SETTLEMENT.FEE',
        idempotencyKeyHash: createHash('sha256').update(randomUUID()).digest(),
        requestFingerprintHash: createHash('sha256').update(randomUUID()).digest(),
        actorUserId: h.fixture.actor.id, requestId: randomUUID(), businessOccurredAt: new Date(),
      }
      // 编号身份守卫先于业务形状 CHECK 执行；伪造行也必须先有一条匹配的
      // fund 发号台账，才能继续验证 SLH 来源形状被数据库拒绝。
      const fundRule = await h.prisma.numberingRule.findUniqueOrThrow({
        where: { ruleCode: 'FUND_POSTING_BATCH_NO' },
        include: { versions: { where: { status: 'ACTIVE' }, take: 1, select: { id: true } } },
      })
      const periodKey = new Date().toISOString().slice(0, 4)
      await h.prisma.numberingPeriodState.upsert({
        where: { ruleId_periodKey: { ruleId: fundRule.id, periodKey } },
        update: {},
        create: { ruleId: fundRule.id, periodKey },
      })
      const fundIssuance = await h.prisma.numberingIssuance.create({
        data: {
          ruleId: fundRule.id,
          ruleVersionId: fundRule.versions[0].id,
          periodKey,
          generatedNumber: base.batchNo,
          consumerCode: 'FUND_POSTING',
          idempotencyKeyHash: createHash('sha256').update(randomUUID()).digest(),
          requestFingerprintHash: createHash('sha256').update(randomUUID()).digest(),
        },
        select: { id: true },
      })
      const forged = { ...base, numberingIssuanceId: fundIssuance.id }
      // .FEE 必须配 FULL_FLOW_PAYMENT_FEE；换成 ORDER_SETTLEMENT 直接被 CHECK 拒绝。
      await expect(h.prisma.fundPostingBatch.create({ data: forged }))
        .rejects.toThrow(/fund_posting_batches_slh_bill_settlement_shape_check/u)
      // .FEE 也不能是非正金额。
      await expect(h.prisma.fundPostingBatch.create({ data: {
        ...forged, postingTypeId: paymentFee.id, postingTypeCodeSnapshot: 'FULL_FLOW_PAYMENT_FEE',
        postingTypeNameSnapshot: paymentFee.name, businessCategorySnapshot: paymentFee.businessCategory,
        ruleVersionId: paymentFee.currentRuleVersionId!, businessAmount: '-1.00',
      } })).rejects.toThrow(/fund_posting_batches_slh_bill_settlement_shape_check/u)
      // 归属人缺失同样被拒（资金归属人是销售出单人，不能为空）。
      await expect(h.prisma.fundPostingBatch.create({ data: { ...forged, userId: null, userShareRateSnapshot: null, companyShareRateSnapshot: null } }))
        .rejects.toThrow(/fund_posting_batches_slh_bill_settlement_shape_check/u)
      expect(await h.prisma.fundPostingBatch.count({ where: { businessSourceCodeSnapshot: 'SLH_BILL_FINANCE_SETTLEMENT', businessId: base.businessId } })).toBe(0)
    })
  })

  describe('金流费用按销售单计一次', () => {
    /** 结算与费用都从系统汇率取值，和其他入账用例同口径。 */
    const setSystemRate = async (value: string) => {
      const currency = await h.prisma.currency.findUniqueOrThrow({ where: { code: 'TWD' }, select: { id: true } })
      await h.prisma.exchangeRate.upsert({
        where: { currencyId: currency.id },
        create: { currencyId: currency.id, foreignUnitsPerCny: value },
        update: { foreignUnitsPerCny: value },
      })
    }
    /** 账单「装柜日期」列是 Excel 序列号：年份与柜号/唛头里的月日一起定位柜次。 */
    const excelSerial = (date: string) => String(Math.round((Date.parse(`${date}T00:00:00.000Z`) - Date.UTC(1899, 11, 30)) / 86_400_000))

    /**
     * 一条货件在装柜时被拆成三个唛头（同一柜次、同一个货件、三行装柜明细）。
     * 账单拆成两张：前两个唛头一张、第三个唛头一张——两条账单行的匹配链是**同一个销售单**。
     * 完成批次要求整批全部已核对，跨批次的重复收费只能靠两张账单来构造。
     */
    async function splitShipmentBills(): Promise<{ firstBillId: string, secondBillId: string }> {
      // 柜次身份是「入仓仓库 + 装柜日期 + 当日序号」：日期在用例之间必须互不重复。
      const date = '2026-03-13'
      const containerBatchName = '0313-01柜'
      const marks = ['M-031301', 'M-031302', 'M-031303']
      const shipment = await h.shipment({ salesLinked: true })
      if (shipment.source === null) throw new Error('sales linked shipment must create a sales order')
      // 完成批次会把账单代收回填为销售收款：订单总额必须覆盖账单代收。
      await widenSalesTotal(shipment.source.id)
      await createContainer(containerBatchName, date, marks.map(mark => ({ mark, shipmentId: shipment.part.id })))
      const row = (mark: string, index: number) => ({
        B: excelSerial(date), C: containerBatchName, D: '千树贸易', E: `WG-0313-000${index + 1}`, F: mark,
        G: '农用四轮微耕机', H: '1', I: 'CTN',
        // 行级勾稽 payable = 运费 + 代收手续费 + 附加费：整笔放进运费列。
        R: String(1000 * (index + 1)), U: String(1000 * (index + 1)),
        V: '52000', W: '0', X: '入账测试', Y: '测试收货人一',
      })
      const first = await importBill(`入账-${containerBatchName}-甲`, createSlhBillFixture({ rows: [row(marks[0], 0), row(marks[1], 1)] }))
      const second = await importBill(`入账-${containerBatchName}-乙`, createSlhBillFixture({ rows: [row(marks[2], 2)] }))
      return { firstBillId: first.id, secondBillId: second.id }
    }

    /** 逐行写结算：(52000 − 0) ÷ 5.2 = 10000，减去各行应付后就是各行的结算金额；费用三行相同。 */
    async function settleLine(batchId: string, memberId: string, payable: number): Promise<{ id: string }> {
      const amounts = resolveSettlementAmounts({
        codAmountTwd: '52000.00', ntdSurchargeAmountTwd: '0.00', payableAmountCny: `${payable}.00`,
        salesAmount: WIDE_SALES_TOTAL, rate: '5.2000', paymentFeeRate: PAYMENT_FEE_RATE,
      })
      const response = await browser.post(`${BASE}/${batchId}/settlements`).set(packagingHeaders).set('Idempotency-Key', randomUUID())
        .send({ batchLineId: memberId, rateSource: 'SYSTEM', rate: '5.2000', amounts }).expect(201)
      return response.body as { id: string }
    }
    const feePostings = (salesOrderId: string) => h.prisma.fundPostingBatch.findMany({
      where: { businessSourceCodeSnapshot: 'SLH_BILL_FINANCE_SETTLEMENT', consumerCode: 'SLH_BILL_FINANCE_SETTLEMENT.FEE', businessId: salesOrderId },
      select: { businessNo: true, businessAmount: true, metadata: true },
    })

    it('同一销售单的两行只入一笔费用，费用身份挂在销售单上；跨批次也不重复', async () => {
      const { firstBillId, secondBillId } = await splitShipmentBills()
      await setSystemRate('5.2000')

      // 第一轮：甲账单的两行一起核对并完成。
      const firstBatch = (await createBatch(firstBillId, randomUUID()).expect(201)).body as BatchDetail
      expect(firstBatch.memberCount).toBe(2)
      const [firstLine, secondLine] = firstBatch.members
      const firstSettlement = await settleLine(firstBatch.id, firstLine.id, 1000)
      const secondSettlement = await settleLine(firstBatch.id, secondLine.id, 2000)
      const salesOrder = await h.prisma.slhReconciliationSettlement.findUniqueOrThrow({
        where: { id: firstSettlement.id }, select: { salesOrderId: true, salesOrderNo: true },
      })
      await browser.post(`${BASE}/${firstBatch.id}/complete`).set(packagingHeaders).send({}).expect(200)

      // 结算金额逐行入账（两行各一笔），费用只入一笔且业务身份是销售单。
      const reconcile = await h.prisma.fundPostingBatch.findMany({
        where: { businessId: { in: [firstSettlement.id, secondSettlement.id] }, consumerCode: 'SLH_BILL_FINANCE_SETTLEMENT.RECONCILE' },
        select: { businessAmount: true },
      })
      expect(reconcile.map(row => row.businessAmount.toFixed(2)).sort()).toEqual(['8000.00', '9000.00'])
      const firstFees = await feePostings(salesOrder.salesOrderId)
      expect(firstFees).toHaveLength(1)
      expect(firstFees[0]).toMatchObject({ businessNo: salesOrder.salesOrderNo })
      expect(firstFees[0].businessAmount.toFixed(2)).toBe('1346.15')
      // 触发它的是本轮第一条核对：费用属于销售单，但要能从这里回查到是哪一行把它带进来的。
      expect(firstFees[0].metadata).toMatchObject({
        slhReconciliationSettlementId: firstSettlement.id,
        slhReconciliationSalesOrderNo: salesOrder.salesOrderNo,
      })

      // 第二轮：同一销售单的第三个唛头在乙账单单独开一批完成（成员行 id 属于新批次，不能用上一批的）。
      const secondBatch = (await createBatch(secondBillId, randomUUID()).expect(201)).body as BatchDetail
      expect(secondBatch.memberCount).toBe(1)
      const thirdSettlement = await settleLine(secondBatch.id, secondBatch.members[0].id, 3000)
      await browser.post(`${BASE}/${secondBatch.id}/complete`).set(packagingHeaders).send({}).expect(200)

      // 第三行的结算金额照常入账，费用不再重复：整个销售单始终只有一笔。
      expect(await h.prisma.fundPostingBatch.count({
        where: { businessId: thirdSettlement.id, consumerCode: 'SLH_BILL_FINANCE_SETTLEMENT.RECONCILE' },
      })).toBe(1)
      expect(await feePostings(salesOrder.salesOrderId)).toHaveLength(1)
    })
  })

  it('取号不可用：停用编号规则后创建被拒，且不留下批次与派发记录', async () => {
    const freshBill = await importBill('对账-取号失败')
    const before = {
      batches: await h.prisma.slhReconciliationBatch.count(),
      issuances: await h.prisma.numberingIssuance.count(),
    }
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const disabled = await h.fixture.numberingCommands.disable(context, batchRuleId, { expectedVersion: batchRuleVersion })

    expect(errorCode(await createBatch(freshBill.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_NUMBERING_UNAVAILABLE')
    expect({
      batches: await h.prisma.slhReconciliationBatch.count(),
      issuances: await h.prisma.numberingIssuance.count(),
    }).toEqual(before)

    // 交还环境：本用例是最后一个，仍把规则恢复启用，避免影响后续可能的断言。
    await h.fixture.numberingCommands.enable(context, batchRuleId, { expectedVersion: disabled.version })
  })
})
