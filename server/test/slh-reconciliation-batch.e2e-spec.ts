import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { SlhBillDto } from '../src/modules/slh-bills/slh-bill.dto'
import { createSlhBillFixture } from './fixtures/slh-bill-xlsx.fixture'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'

const permissions = ['slh-bills:read', 'slh-bills:create', 'slh-bills:reconcile']
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const BASE = '/api/slh-reconciliation-batches'
const BATCH_RULE_CODE = 'SLH_RECON_BATCH_NO'
const BATCH_CONSUMER_CODE = 'SLH_RECON_BATCH.CREATE'

/**
 * 对账批次的接口边界。
 *
 * 冻结期间解冻的唯一读路径是「候选账单」——「新建对账批次」弹窗的数据来源：
 * 生效中 + 至少一行未对账 + 没有进行中的批次（被取代、已对账、占用中的都必须排除）。
 * 其余六个接口仍是空壳：批次列表返回空集合，写接口返回契约声明的 404 且不落数据。
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
  let batchRuleId = ''
  let batchRuleVersion = 0
  const unknownId = '00000000-0000-4000-8000-000000000001'
  const idempotencyKeyA = randomUUID()
  const idempotencyKeyB = randomUUID()
  const errorCode = (response: request.Response) => (response.body as { code: string }).code
  const createBatch = (billId: string, key: string) => browser
    .post(BASE).set(packagingHeaders).set('Idempotency-Key', key).send({ billId })

  async function importBill(name: string, supersedesBillId: string | null = null): Promise<SlhBillDto> {
    const staged = await browser.post('/api/slh-bills/source-file-uploads').set(packagingHeaders)
      .field('mediaType', 'DOCUMENT')
      .attach('file', createSlhBillFixture(), { filename: `${name}.xlsx`, contentType: XLSX_MIME })
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

  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    browser = (await h.browserWithPermissions(permissions)).browser
    outsider = (await h.browserWithPermissions(['slh-bills:read'])).browser
    // 迁移不代替管理员建规则：账单编号与批次编号都必须先存在并启用。
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    for (const rule of [
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
    replacement = await importBill('对账候选-取代者', superseded.id)
  })
  afterAll(async () => { await h?.dispose() })

  it('候选账单：只保留生效中且仍有未对账行、又没有进行中批次的账单', async () => {
    const response = await browser.get(`${BASE}/candidates`).query({ pageSize: 100 }).expect(200)
    const page = response.body as { items: Array<{ id: string, reconciliationStatus: string, supersededById: string | null }>, total: number }
    const ids = page.items.map(item => item.id)
    expect(ids).toEqual(expect.arrayContaining([pending.id, replacement.id]))
    expect(ids).not.toContain(completed.id)
    expect(ids).not.toContain(occupied.id)
    expect(ids).not.toContain(superseded.id)
    expect(page.total).toBe(2)
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
    expect([firstPage.page, firstPage.pageSize, firstPage.total]).toEqual([1, 1, 2])
    expect(firstPage.items).toHaveLength(1)
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id)
  })

  it('仍为空壳的接口：批次列表空集合；未知批次与未实现的写路径返回契约声明的 404 且不落数据', async () => {
    const list = await browser.get(BASE).expect(200)
    expect(list.body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
    const before = {
      batches: await h.prisma.slhReconciliationBatch.count(),
      members: await h.prisma.slhReconciliationBatchLine.count(),
    }
    expect(errorCode(await browser.get(`${BASE}/${unknownId}`).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
    expect(errorCode(await browser.post(`${BASE}/${unknownId}/reconcile`).set(packagingHeaders).send({ lineIds: [unknownId] }).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
    expect(errorCode(await browser.post(`${BASE}/match-preview`).set(packagingHeaders).send({ billId: unknownId }).expect(404))).toBe('SLH_BILL_NOT_FOUND')
    expect({
      batches: await h.prisma.slhReconciliationBatch.count(),
      members: await h.prisma.slhReconciliationBatchLine.count(),
    }).toEqual(before)
  })

  it('批次详情读取：返回批次头与账单摘要，未知主键 404，缺权限 403', async () => {
    const occupiedBatch = await h.prisma.slhReconciliationBatch.findFirstOrThrow({ where: { billId: occupied.id }, select: { id: true, batchNo: true } })
    const detail = (await browser.get(`${BASE}/${occupiedBatch.id}`).expect(200)).body as {
      batchNo: string, status: string, memberCount: number, reconciledMemberCount: number,
      members: unknown[], bill: { slhBillNo: string, lineCount: number, reconciliationStatus: string }
    }
    expect(detail.batchNo).toBe(occupiedBatch.batchNo)
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
    await outsider.post(BASE).set(packagingHeaders).set('Idempotency-Key', randomUUID()).send({ billId: pending.id }).expect(403)
    await outsider.post(`${BASE}/${unknownId}/complete`).set(packagingHeaders).send({}).expect(403)
  })

  it('创建批次头：编号来自派发台账、写审计事件，候选集随即排除该账单', async () => {
    const response = await createBatch(pending.id, idempotencyKeyA).expect(201)
    const batch = response.body as {
      id: string, batchNo: string, status: string, memberCount: number, reconciledMemberCount: number,
      members: unknown[], completedAt: string | null, bill: { slhBillNo: string }
    }
    // 形状跟随本用例夹具的规则（月度 `SRB-{YYYYMM}-{SEQ:3}`），并与派发台账逐字比对。
    expect(batch.batchNo).toMatch(/^SRB-\d{6}-\d{3}$/u)
    expect([batch.status, batch.memberCount, batch.reconciledMemberCount, batch.completedAt]).toEqual(['IN_PROGRESS', 0, 0, null])
    expect(batch.bill.slhBillNo).toBe(pending.slhBillNo)
    expect(batch.members).toEqual([])

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

    const audit = await h.prisma.auditEvent.findFirst({
      where: { eventType: 'SLH_RECONCILIATION_BATCH_CREATED', targetId: batch.id }, select: { metadata: true },
    })
    expect(audit?.metadata).toMatchObject({ batchNo: batch.batchNo, slhBillNo: pending.slhBillNo })

    // 该账单已被占用：候选集不再包含它。
    const candidates = (await browser.get(`${BASE}/candidates`).query({ pageSize: 100 }).expect(200)).body as { items: Array<{ id: string }> }
    expect(candidates.items.map(item => item.id)).not.toContain(pending.id)
  })

  it('幂等：同键重放返回同一批次，同一键换账单被拒，非法键在业务前被拒', async () => {
    const replay = await createBatch(pending.id, idempotencyKeyA).expect(201)
    const first = await h.prisma.slhReconciliationBatch.findFirstOrThrow({ where: { billId: pending.id }, select: { id: true } })
    expect((replay.body as { id: string }).id).toBe(first.id)
    expect(await h.prisma.slhReconciliationBatch.count({ where: { billId: pending.id } })).toBe(1)

    // 同一个键换一张账单 ⇒ 意图变了，必须拒绝而不是静默复用。
    expect(errorCode(await createBatch(replacement.id, idempotencyKeyA).expect(409))).toBe('SLH_RECON_BATCH_IDEMPOTENCY_CONFLICT')
    // 非法幂等键（非规范 UUID v4）在进入业务前就被拒。
    expect(errorCode(await createBatch(replacement.id, 'not-a-uuid').expect(422))).toBe('VALIDATION_FAILED')
  })

  it('占用与准入：占用中、无未对账行、被取代与未知账单都挡在创建之前', async () => {
    expect(errorCode(await createBatch(pending.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_CONFLICT')
    expect(errorCode(await createBatch(occupied.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_CONFLICT')
    expect(errorCode(await createBatch(completed.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_NO_LINES_TO_RECONCILE')
    expect(errorCode(await createBatch(superseded.id, randomUUID()).expect(409))).toBe('SLH_RECON_BATCH_CONFLICT')
    expect(errorCode(await createBatch(unknownId, randomUUID()).expect(404))).toBe('SLH_BILL_NOT_FOUND')
  })

  it('完成批次：解除占用、写审计事件，重复完成被拒，释放后可再次发起', async () => {
    const created = await createBatch(replacement.id, idempotencyKeyB).expect(201)
    const batchId = (created.body as { id: string }).id

    const completed = (await browser.post(`${BASE}/${batchId}/complete`).set(packagingHeaders).send({}).expect(200)).body as {
      status: string, completedAt: string | null, completedByDisplayName: string | null
    }
    expect(completed.status).toBe('COMPLETED')
    expect(completed.completedAt).not.toBeNull()
    expect(completed.completedByDisplayName).toBeTruthy()
    const audit = await h.prisma.auditEvent.findFirst({
      where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', targetId: batchId }, select: { id: true },
    })
    expect(audit).not.toBeNull()

    expect(errorCode(await browser.post(`${BASE}/${batchId}/complete`).set(packagingHeaders).send({}).expect(409))).toBe('SLH_RECON_BATCH_NOT_IN_PROGRESS')

    // 结束之后账单重新变成候选，可以再次发起对账。
    const candidates = (await browser.get(`${BASE}/candidates`).query({ pageSize: 100 }).expect(200)).body as { items: Array<{ id: string }> }
    expect(candidates.items.map(item => item.id)).toContain(replacement.id)
    await createBatch(replacement.id, randomUUID()).expect(201)
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
