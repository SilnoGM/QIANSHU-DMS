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
      await createContainer(name, date, [{ mark, shipmentId: shipment.part.id }])
    }

    // 完成批次要逐行入账：销售出单人的资金账户与比例必须先存在，否则完成会被阻断。
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

  it('静默算：批量返回可核对行数、未冻结行数与行 id，无可核对行时给原因汇总', async () => {
    const response = await reconcilableCounts([pending.id, unmatchable.id, occupied.id]).expect(200)
    const items = (response.body as { items: Array<{ billId: string, reconcilableLineCount: number, unfrozenLineCount: number, reconcilableLineIds: string[], reasons: Array<{ code: string, count: number }> }> }).items
    expect(items.map(item => item.billId).sort()).toEqual([pending.id, unmatchable.id, occupied.id].sort())
    const pendingCounts = items.find(item => item.billId === pending.id)!
    expect(pendingCounts.reconcilableLineCount).toBe(3)
    expect(pendingCounts.reconcilableLineIds.sort()).toEqual((await unreconciledLineIds(pending.id)).sort())
    expect(pendingCounts.reasons).toEqual([])
    // 没有被进行中批次冻结任何行：未冻结行数＝可核对行数。
    expect(pendingCounts.unfrozenLineCount).toBe(3)
    const unmatchableCounts = items.find(item => item.billId === unmatchable.id)!
    expect(unmatchableCounts.reconcilableLineCount).toBe(0)
    expect(unmatchableCounts.unfrozenLineCount).toBe(0)
    expect(unmatchableCounts.reconcilableLineIds).toEqual([])
    expect(unmatchableCounts.reasons).toEqual([{ code: 'INVALID_CONTAINER_NAME', count: 3 }])
    // 占用中但一个成员都没冻结（本例的批次是直接落库的）：匹配行仍在，
    // 「未冻结」只反映冻结了多少行，不反映这一账单此刻能不能新建批次（那由弹窗的可选分组定）。
    const occupiedCounts = items.find(item => item.billId === occupied.id)!
    expect([occupiedCounts.reconcilableLineCount, occupiedCounts.unfrozenLineCount]).toEqual([3, 3])

    // 已对账完成的账单没有未对账行：0 行、无原因（没有"不能核对的行"可言）。
    const noLines = (await reconcilableCounts([completed.id]).expect(200)).body as { items: Array<{ reconcilableLineCount: number, unfrozenLineCount: number, reasons: unknown[] }> }
    expect(noLines.items[0].reconcilableLineCount).toBe(0)
    expect(noLines.items[0].unfrozenLineCount).toBe(0)
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
      expect(member.salesOrder?.agreedTotalAmount).toMatch(/^\d+\.\d{4}$/u)
      expect(member.salesOrder?.customerPhone).toBe('12345678')
      expect(member.salesOrder?.customerFullAddress).toBe('国家省份城市测试地址')
      expect(member.salesOrder?.depositDueAmount).toBe('0.0000')
      expect(member.salesOrder?.balanceDueAmount).toBe('10.0000')
      // 夹具没有收款记录：实际已收款为 0，实际待收款等于约定总额（与销售域同一处累加口径）。
      expect(member.salesOrder?.receivedAmount).toBe('0.0000')
      expect(member.salesOrder?.outstandingAmount).toBe('10.0000')
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

  it('完成批次：解除占用、成员保持冻结、写审计事件，重复完成被拒，释放后可再次发起', async () => {
    const batchId = (await h.prisma.slhReconciliationBatch.findFirstOrThrow({ where: { billId: replacement.id, completedAt: null }, select: { id: true } })).id
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

    // 结束之后账单重新变成候选，可再次发起对账；冻结解除后「未冻结行数」回到可核对行数。
    const candidates = (await browser.get(`${BASE}/candidates`).query({ pageSize: 100 }).expect(200)).body as { items: Array<{ id: string }> }
    expect(candidates.items.map(item => item.id)).toContain(replacement.id)
    const released = (await reconcilableCounts([replacement.id]).expect(200)).body as { items: Array<{ reconcilableLineCount: number, unfrozenLineCount: number }> }
    expect([released.items[0].reconcilableLineCount, released.items[0].unfrozenLineCount]).toEqual([3, 3])
    expect((await createBatch(replacement.id, randomUUID()).expect(201)).body as BatchDetail).toMatchObject({ memberCount: 3 })
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
    const replacementBatch = await h.prisma.slhReconciliationBatch.findFirstOrThrow({ where: { billId: replacement.id, completedAt: null }, select: { batchNo: true } })
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
    /** 夹具里每柜一个销售订单，约定总额固定为 10.0000（TWD）。 */
    const payload = (batchLineId: string, amounts: Record<string, string | null>) => ({
      batchLineId, rateSource: 'SYSTEM', rate: '5.200000000000', amounts,
    })
    const fullPayload = (batchLineId: string, rateSource: string, rate: string, settlementAmountCny: string) => ({
      batchLineId, rateSource, rate,
      amounts: {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
        settlementAmountCny, salesAmount: '10.0000', paymentFeeAmountCny: '0.01',
      },
    })

    it('写入结算结果：标记成员行与账单行、写审计事件，金额按「金额 + 币种」成对落库', async () => {
      await setSystemRate('5.200000000000')
      const batchId = await pendingBatch()
      const member = await memberByCod(batchId, '129000.00')
      const response = await settle(batchId, randomUUID(), payload(member.id, {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
        settlementAmountCny: '19098.85', salesAmount: '10.0000', paymentFeeAmountCny: '0.01',
      })).expect(201)
      expect(response.body).toMatchObject({
        batchLineId: member.id, status: 'ACTIVE', rateSource: 'SYSTEM', paymentFeeRate: '0.007000000000',
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
      expect(row.paymentFeeAmountCny?.toFixed(2)).toBe('0.01')
      expect(row.foreignUnitsPerCny.toFixed(12)).toBe('5.200000000000')

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
        settlementAmountCny: '19098.86', salesAmount: '10.0000', paymentFeeAmountCny: '0.01',
      })).expect(409)
      expect(errorCode(mismatch)).toBe('SLH_RECON_SETTLEMENT_MISMATCH')
      expect((mismatch.body as { message: string }).message).toContain('结算金额')

      const rateChanged = await settle(batchId, randomUUID(), fullPayload(member.id, 'SYSTEM', '5.100000000000', '19098.85')).expect(409)
      expect(errorCode(rateChanged)).toBe('SLH_RECON_SETTLEMENT_RATE_CHANGED')

      // 台币汇率行被删掉（没有可用汇率）：来源不可用必须失败关闭。
      const twd = await h.prisma.currency.findUniqueOrThrow({ where: { code: 'TWD' }, select: { id: true } })
      await h.prisma.exchangeRate.deleteMany({ where: { currencyId: twd.id } })
      const unavailable = await settle(batchId, randomUUID(), payload(member.id, {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
        settlementAmountCny: '19098.85', salesAmount: '10.0000', paymentFeeAmountCny: '0.01',
      })).expect(409)
      expect(errorCode(unavailable)).toBe('SLH_RECON_SETTLEMENT_RATE_UNAVAILABLE')
      await setSystemRate('5.200000000000')

      expect(await h.prisma.slhReconciliationSettlement.count()).toBe(before)
    })

    it('相同数据被拒、不同数据取代旧记录、同键重放只落一条', async () => {
      const batchId = await pendingBatch()
      const member = await memberByCod(batchId, '129000.00')

      // 与当前有效记录完全相同的口径 ⇒ 拒绝，不写库。
      const unchanged = await settle(batchId, randomUUID(), payload(member.id, {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
        settlementAmountCny: '19098.85', salesAmount: '10.0000', paymentFeeAmountCny: '0.01',
      })).expect(409)
      expect(errorCode(unchanged)).toBe('SLH_RECON_SETTLEMENT_UNCHANGED')

      // 换汇率来源 ⇒ 口径变了：旧记录失效、新记录有效，同一行始终只剩一条有效。
      const key = randomUUID()
      const changed = await settle(batchId, key, fullPayload(member.id, 'EMBEDDED', '4.800000000000', '21070.00')).expect(201)
      expect(changed.body).toMatchObject({ status: 'ACTIVE', rateSource: 'EMBEDDED' })
      const rows = await h.prisma.slhReconciliationSettlement.findMany({
        where: { batchLineId: member.id }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true },
      })
      expect(rows).toHaveLength(2)
      expect(rows.map(row => row.status)).toEqual(['SUPERSEDED', 'ACTIVE'])
      expect(rows[1]?.id).toBe((changed.body as { id: string }).id)

      // 同键重放：返回同一条记录且不新增行；同键换载荷被拒。
      const replay = await settle(batchId, key, fullPayload(member.id, 'EMBEDDED', '4.800000000000', '21070.00')).expect(201)
      expect((replay.body as { id: string }).id).toBe((changed.body as { id: string }).id)
      expect(await h.prisma.slhReconciliationSettlement.count({ where: { batchLineId: member.id } })).toBe(2)

      const reused = await settle(batchId, key, fullPayload(member.id, 'SYSTEM', '5.200000000000', '19098.85')).expect(409)
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
        foreignUnitsPerCny: '4.800000000000',
        paymentFeeRate: '0.007000000000',
        settlementAmountCny: '21070.00',
        settlementCurrency: 'CNY',
        codAmountTwd: '129000.00',
        codAmountCurrency: 'TWD',
        salesAmount: '10.0000',
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
      const body = fullPayload(member.id, 'SYSTEM', '5.200000000000', '19098.85')
      const rowsBefore = await h.prisma.slhReconciliationSettlement.count()

      // 缺少 reconcile 权限：403；批次或成员不存在：404；非法幂等键：422。
      expect((await outsider.post(`${BASE}/${batchId}/settlements`).set(packagingHeaders).set('Idempotency-Key', randomUUID()).send(body)).status).toBe(403)
      expect(errorCode(await settle(unknownId, randomUUID(), body).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
      expect(errorCode(await settle(batchId, randomUUID(), { ...body, batchLineId: unknownId }).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
      expect(errorCode(await settle(batchId, 'not-a-uuid', body).expect(422))).toBe('VALIDATION_FAILED')

      // 批次完成后不能再确认结算。
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
      payableAmountCny: string
      codAmountTwd: string
      surchargeNtd?: string
    }): Promise<{ batchId: string, memberId: string }> {
      const date = `2026-03-${suffix}`
      const containerBatchName = `03${suffix}-01柜`
      const mark = `M-03${suffix}26`
      const shipment = await h.shipment({ salesLinked: true, ownerUserId: options.issuerUserId ?? h.fixture.actor.id })
      await createContainer(containerBatchName, date, [{ mark, shipmentId: shipment.part.id }])
      const bill = await importBill(`入账-${containerBatchName}`, createSlhBillFixture({
        rows: [{
          B: excelSerial(date), C: containerBatchName, D: '千树贸易', E: `WG-03${suffix}-0001`, F: mark,
          G: '农用四轮微耕机', H: '1', I: 'CTN',
          // 行级勾稽 payable = 运费 + 代收手续费 + 附加费 是数据库硬约束：整笔放进运费列。
          R: options.payableAmountCny, U: options.payableAmountCny,
          V: options.codAmountTwd, W: options.surchargeNtd ?? '6000', X: '入账测试', Y: '测试收货人一',
        }],
      }))
      const created = (await createBatch(bill.id, randomUUID()).expect(201)).body as BatchDetail
      const [member] = created.members
      if (member === undefined) throw new Error('batch has no member')
      return { batchId: created.id, memberId: member.id }
    }

    /** 结算金额与金流费用都由同一口径复算，避免在用例里硬编码中间值。 */
    const settleWith = async (batchId: string, memberId: string, rate: string, amounts: { codAmountTwd: string | null, ntdSurchargeAmountTwd: string | null, payableAmountCny: string | null }) => {
      const resolved = resolveSettlementAmounts({ ...amounts, salesAmount: '10.0000', rate, paymentFeeRate: PAYMENT_FEE_RATE })
      const response = await browser.post(`${BASE}/${batchId}/settlements`).set(packagingHeaders).set('Idempotency-Key', randomUUID())
        .send({ batchLineId: memberId, rateSource: 'SYSTEM', rate, amounts: resolved }).expect(201)
      return response.body as { id: string }
    }

    it('归属人没有资金账户时阻断完成：批次保持进行中、无资金流水、无完成审计', async () => {
      // 新用户只有登录身份，没有资金账户：它作为销售出单人时完成必须被阻断。
      const stranded = await h.browserWithPermissions(['slh-bills:read'])
      const prepared = await preparedBatch('01', {
        issuerUserId: stranded.user.id, payableAmountCny: '4555', codAmountTwd: '129000',
      })
      await setSystemRate('5.200000000000')
      await settleWith(prepared.batchId, prepared.memberId, '5.200000000000', {
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
      await setSystemRate('5.200000000000')
      // (52000 − 0) ÷ 5.2 − 10000 = 0.00：结算金额为零，这一笔跳过，只剩金流费用。
      const settlement = await settleWith(prepared.batchId, prepared.memberId, '5.200000000000', {
        codAmountTwd: '52000.00', ntdSurchargeAmountTwd: '0.00', payableAmountCny: '10000.00',
      })
      const row = await h.prisma.slhReconciliationSettlement.findUniqueOrThrow({ where: { id: settlement.id } })
      expect(row.settlementAmountCny?.toFixed(2)).toBe('0.00')
      expect(row.paymentFeeAmountCny?.toFixed(2)).toBe('0.01')

      await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(200)
      const postings = await h.prisma.fundPostingBatch.findMany({
        where: { businessId: settlement.id }, include: { entries: true }, orderBy: { consumerCode: 'asc' },
      })
      expect(postings.map(entry => entry.consumerCode)).toEqual(['SLH_BILL_FINANCE_SETTLEMENT.FEE'])
      const [fee] = postings
      if (fee === undefined) throw new Error('fee posting missing')
      expect(fee).toMatchObject({
        businessSourceCodeSnapshot: 'SLH_BILL_FINANCE_SETTLEMENT',
        postingTypeCodeSnapshot: 'FULL_FLOW_PAYMENT_FEE',
        businessCategorySnapshot: 'COST',
        businessNo: (await h.prisma.slhReconciliationBatch.findUniqueOrThrow({ where: { id: prepared.batchId }, select: { batchNo: true } })).batchNo,
        userId: h.fixture.actor.id,
      })
      expect(fee.businessAmount.toFixed(2)).toBe('0.01')
      // 幂等键由结算记录推导：同一结算记录重放不会产生第二条流水。
      expect(Buffer.from(fee.idempotencyKeyHash).equals(createHash('sha256').update(`${settlement.id}:FEE`).digest())).toBe(true)
      expect(fee.metadata).toMatchObject({ slhReconciliationBatchId: prepared.batchId, slhReconciliationSettlementId: settlement.id })
      // 用户 30% 的分账量化为 0.00 被省略，公司承接全部尾差；费用恒为出账。
      expect(fee.entries.map(entry => [entry.accountTarget, entry.direction, entry.amount.toFixed(2)])).toEqual([
        ['COMPANY', 'DEBIT', '0.01'],
      ])
    })

    it('结算为正时用户与公司按比例分账并贷记，结算为负时两腿都出账', async () => {
      const prepared = await preparedBatch('03', { payableAmountCny: '4555', codAmountTwd: '129000' })
      await setSystemRate('5.200000000000')
      const settlement = await settleWith(prepared.batchId, prepared.memberId, '5.200000000000', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      })
      const row = await h.prisma.slhReconciliationSettlement.findUniqueOrThrow({ where: { id: settlement.id } })
      expect(row.settlementAmountCny?.toFixed(2)).toBe('19098.85')

      const account = await h.prisma.fundAccount.findFirstOrThrow({ where: { userId: h.fixture.actor.id }, select: { id: true, balance: true } })
      const company = await h.prisma.fundAccount.findFirstOrThrow({ where: { ownerType: 'COMPANY' }, select: { id: true, balance: true } })
      await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(200)

      const postings = await h.prisma.fundPostingBatch.findMany({ where: { businessId: settlement.id }, include: { entries: true } })
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

      // 余额真的动了：用户只拿到结算分账；公司还要在同一次完成里承担 0.01 金流费用。
      const userAfter = await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: account.id }, select: { balance: true } })
      const companyAfter = await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: company.id }, select: { balance: true } })
      expect(userAfter.balance.minus(account.balance).toFixed(2)).toBe('5729.66')
      expect(companyAfter.balance.minus(company.balance).toFixed(2)).toBe('13369.18')

      // 批次审计只留标量事实：多笔入账只记数量，逐笔关联走资金侧的 business_id 回查。
      const audit = await h.prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', targetId: prepared.batchId }, select: { metadata: true },
      })
      expect((audit.metadata as { fundPostingCount: number })).toMatchObject({ fundPostingCount: 2 })

      // 负结算金额：两腿都出账，金额取绝对值。
      const negative = await preparedBatch('04', { payableAmountCny: '60000', codAmountTwd: '129000' })
      const negativeSettlement = await settleWith(negative.batchId, negative.memberId, '5.200000000000', {
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

    it('金流费用为零时只入结算，未确认的行不产生流水', async () => {
      const prepared = await preparedBatch('05', { payableAmountCny: '4555', codAmountTwd: '129000' })
      // 汇率放大后 10 ÷ 2000 × 0.007 量化为 0.00：金流费用为零，这一笔跳过。
      await setSystemRate('2000.000000000000')
      const settlement = await settleWith(prepared.batchId, prepared.memberId, '2000.000000000000', {
        codAmountTwd: '129000.00', ntdSurchargeAmountTwd: '6000.00', payableAmountCny: '4555.00',
      })
      const row = await h.prisma.slhReconciliationSettlement.findUniqueOrThrow({ where: { id: settlement.id } })
      expect(row.paymentFeeAmountCny?.toFixed(2)).toBe('0.00')
      expect(row.settlementAmountCny?.toFixed(2)).toBe('-4493.50')

      await browser.post(`${BASE}/${prepared.batchId}/complete`).set(packagingHeaders).send({}).expect(200)
      const postings = await h.prisma.fundPostingBatch.findMany({ where: { businessId: settlement.id }, select: { consumerCode: true } })
      expect(postings.map(entry => entry.consumerCode)).toEqual(['SLH_BILL_FINANCE_SETTLEMENT.RECONCILE'])

      // 完全没有确认过的行：完成批次不产生任何资金流水。
      const untouched = await preparedBatch('06', { payableAmountCny: '4555', codAmountTwd: '129000' })
      const before = await h.prisma.fundPostingBatch.count()
      await browser.post(`${BASE}/${untouched.batchId}/complete`).set(packagingHeaders).send({}).expect(200)
      expect(await h.prisma.fundPostingBatch.count()).toBe(before)
      const audit = await h.prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', targetId: untouched.batchId }, select: { metadata: true },
      })
      expect((audit.metadata as { fundPostingBatchId: string | null, fundPostingCount: number }))
        .toMatchObject({ fundPostingBatchId: null, fundPostingCount: 0 })
      await setSystemRate('5.200000000000')
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
      // .FEE 必须配 FULL_FLOW_PAYMENT_FEE；换成 ORDER_SETTLEMENT 直接被 CHECK 拒绝。
      await expect(h.prisma.fundPostingBatch.create({ data: base }))
        .rejects.toThrow(/fund_posting_batches_slh_bill_settlement_shape_check/u)
      // .FEE 也不能是非正金额。
      await expect(h.prisma.fundPostingBatch.create({ data: {
        ...base, postingTypeId: paymentFee.id, postingTypeCodeSnapshot: 'FULL_FLOW_PAYMENT_FEE',
        postingTypeNameSnapshot: paymentFee.name, businessCategorySnapshot: paymentFee.businessCategory,
        ruleVersionId: paymentFee.currentRuleVersionId!, businessAmount: '-1.00',
      } })).rejects.toThrow(/fund_posting_batches_slh_bill_settlement_shape_check/u)
      // 归属人缺失同样被拒（资金归属人是销售出单人，不能为空）。
      await expect(h.prisma.fundPostingBatch.create({ data: { ...base, userId: null, userShareRateSnapshot: null, companyShareRateSnapshot: null } }))
        .rejects.toThrow(/fund_posting_batches_slh_bill_settlement_shape_check/u)
      expect(await h.prisma.fundPostingBatch.count({ where: { businessSourceCodeSnapshot: 'SLH_BILL_FINANCE_SETTLEMENT', businessId: base.businessId } })).toBe(0)
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
