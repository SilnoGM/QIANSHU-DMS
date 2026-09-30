import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { SlhBillDto } from '../src/modules/slh-bills/slh-bill.dto'
import { SlhBillLineReconciliationStatusDto, SlhBillReconciliationStatusDto } from '../src/modules/slh-bills/slh-bill.dto'
import type { SlhReconciliationBatchDetailDto, SlhReconciliationBatchPageDto, SlhReconciliationBatchPreviewDto } from '../src/modules/slh-reconciliation-batches/slh-reconciliation-batch.dto'
import { SlhReconciliationBatchStatusDto } from '../src/modules/slh-reconciliation-batches/slh-reconciliation-batch.dto'
import { createSlhBillFixture } from './fixtures/slh-bill-xlsx.fixture'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = ['slh-bills:read', 'slh-bills:create', 'slh-bills:reconcile']
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * 对账批次的端到端回归。
 *
 * 覆盖单测与契约快照看不到的一层：真实 PostgreSQL 上的编号身份触发器、
 * 占用规则、匹配作用域（只匹配未对账行）、核对复检的整批拒绝，
 * 以及「结束本轮 → 再发起下一轮」这条业务闭环。
 */
describe('slh reconciliation batches with isolated PostgreSQL', () => {
  jest.setTimeout(180_000)
  let h: PackagingCostHarness
  let browser: request.Agent
  let outsider: request.Agent
  let billA: SlhBillDto, billB: SlhBillDto, billC: SlhBillDto
  const items = new Map<string, string>()
  const shipments = new Map<string, string>()
  const batchIds = new Map<string, string>()

  async function importBill(name: string, fixture: Buffer): Promise<SlhBillDto> {
    const staged = await browser.post('/api/slh-bills/source-file-uploads').set(packagingHeaders)
      .field('mediaType', 'DOCUMENT')
      .attach('file', fixture, { filename: `${name}.xlsx`, contentType: XLSX_MIME })
    if (staged.status !== 201) throw new Error(`upload responded ${staged.status}: ${JSON.stringify(staged.body)}`)
    const created = await browser.post('/api/slh-bills').set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({
        mediaAssetId: (staged.body as { mediaAssetId: string }).mediaAssetId,
        billName: name, billMonth: '2026-01', remark: null, manualForeignUnitsPerCny: null,
        supersedesBillId: null, duplicateAcknowledged: true,
      })
    if (created.status !== 201) throw new Error(`bill create responded ${created.status}: ${JSON.stringify(created.body)}`)
    return created.body as SlhBillDto
  }

  /** 柜次与装柜明细直接落库：本用例只验证对账侧的读取与匹配，柜次自身流程已有专项测试。 */
  async function createContainer(containerBatchName: string, loadingDate: string, rows: Array<{ key: string, mark: string | null, shipmentId: string | null }>) {
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
      batchIds.set(containerBatchName, batch.id)
      for (const [index, row] of rows.entries()) {
        const item = await tx.containerLoadingItem.create({
          data: {
            containerBatchId: batch.id, shipmentId: row.shipmentId, lineNumber: index + 1,
            creationRequestKey: randomUUID(), creationPayloadHash: 'e'.repeat(64),
            goodsName: '测试装柜货品', packageCount: 1, oceanShippingMarkText: row.mark,
            createdById: h.fixture.actor.id, updatedById: h.fixture.actor.id,
          },
          select: { id: true },
        })
        items.set(row.key, item.id)
      }
    })
  }

  const createBatch = (billId: string, key = randomUUID(), previewLineIds?: string[]) => browser
    .post('/api/slh-reconciliation-batches').set(packagingHeaders).set('Idempotency-Key', key)
    .send(previewLineIds === undefined ? { billId } : { billId, previewLineIds })
  const reconcile = (batchId: string, lineIds: string[]) => browser
    .post(`/api/slh-reconciliation-batches/${batchId}/reconcile`).set(packagingHeaders).send({ lineIds })
  const complete = (batchId: string) => browser
    .post(`/api/slh-reconciliation-batches/${batchId}/complete`).set(packagingHeaders).send({})
  const preview = (billId: string) => browser
    .post('/api/slh-reconciliation-batches/match-preview').set(packagingHeaders).send({ billId })
  const errorCode = (response: request.Response) => (response.body as { code: string }).code

  beforeAll(async () => {
    // 与账单导入用例同款：xlsx 的真实类型检测必须走原生 Node，不能在 Jest 沙箱里伪造 MIME。
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    browser = (await h.browserWithPermissions(permissions)).browser
    outsider = (await h.browserWithPermissions(['slh-bills:read'])).browser
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    // 迁移不代替管理员建规则：账单编号与批次编号都必须先存在并启用。
    for (const rule of [
      { ruleCode: 'CONTAINER_BATCH_NO', name: '柜次编号', resetPolicy: 'NEVER' as const, segments: [{ type: 'FIXED' as const, value: 'CB' }, { type: 'SEQUENCE' as const, width: 8, startValue: '1', step: '1' }] },
      { ruleCode: 'CTN_BILL_NO', name: '海运账单编号', resetPolicy: 'YEARLY' as const, segments: [{ type: 'FIXED' as const, value: 'CBILL' }, { type: 'SEPARATOR' as const, value: '/' as const }, { type: 'DATE' as const, format: 'YYYYMM' as const }, { type: 'SEPARATOR' as const, value: '-' as const }, { type: 'SEQUENCE' as const, width: 2, startValue: '1', step: '1' }] },
      { ruleCode: 'SLH_RECON_BATCH_NO', name: '顺联航对账批次编号', resetPolicy: 'MONTHLY' as const, segments: [{ type: 'FIXED' as const, value: 'SRB' }, { type: 'SEPARATOR' as const, value: '-' as const }, { type: 'DATE' as const, format: 'YYYYMM' as const }, { type: 'SEPARATOR' as const, value: '-' as const }, { type: 'SEQUENCE' as const, width: 3, startValue: '1', step: '1' }] },
    ]) {
      const ruleRecord = await h.fixture.numberingCommands.create(context, { ...rule, purpose: 'BUSINESS' })
      const published = await h.fixture.numberingCommands.publish(context, ruleRecord.id, { expectedVersion: ruleRecord.version, draftRevision: 1 })
      await h.fixture.numberingCommands.enable(context, ruleRecord.id, { expectedVersion: published.version })
    }

    billA = await importBill('对账测试账单A', createSlhBillFixture())
    billB = await importBill('对账测试账单B', createSlhBillFixture())
    // 第三张账单把柜号写成无法解析的文本：只能靠唛头里的月日定位柜次。
    billC = await importBill('对账测试账单C', createSlhBillFixture({
      rows: [
        { B: '46002', C: '1211-01柜', D: '千树贸易', E: 'WG-0078-0072', F: 'J-121125', G: '农用四轮微耕机', H: '1', I: 'CTN', K: 'KGS', R: '0', U: '0', W: '2000', X: '补 卸货费2000NT', Y: '测试收货人一' },
        { B: '46024', C: '0102-01柜', D: '千树贸易', E: 'WG-0102-0092', F: 'L-010229', G: '农用履带旋耕机', H: '1', I: 'CTN', J: '885', K: 'KGS', L: '215', M: '137', N: '113', O: '117.545380703489', P: '5', Q: '5', R: '4425', S: '30', T: '100', U: '4555', V: '129000', W: '6000', X: '重货费100 偏遠費6000NT', Y: '测试收货人二' },
        { B: '46038', C: '待定', D: '千树贸易', E: 'ZY202449875559（中通快运）', F: 'L-011652', G: '腳手架', H: '1', I: 'CTN', J: '213', K: 'KGS', L: '190', M: '92', N: '63', O: '39', P: '5', Q: '30', R: '1170', T: '100', U: '1270', X: '重货费100', Y: '测试收货人三' },
      ],
    }))

    // 同一货件不能跨柜次，因此每个柜次各用自己的合格货件。
    for (const [key, name, date, mark] of [
      ['1211', '1211-01柜', '2025-12-11', 'J-121125'],
      ['0102', '0102-01柜', '2026-01-02', 'L-010229'],
      ['0116', '0116柜', '2026-01-16', 'L-011652'],
    ] as const) {
      const shipmentForContainer = await h.shipment({ salesLinked: true, ownerUserId: h.fixture.actor.id })
      shipments.set(key, shipmentForContainer.part.id)
      await createContainer(name, date, [{ key, mark, shipmentId: shipmentForContainer.part.id }])
    }
  })
  afterAll(async () => { await h?.dispose() })

  it('匹配预览按柜号名称定位，跨年的每一行各取自己的装柜年份', async () => {
    const response = await preview(billA.id).expect(200)
    const body = response.body as SlhReconciliationBatchPreviewDto
    expect(body.matched).toHaveLength(3)
    expect(body.unmatched).toHaveLength(0)
    expect(body.matched.map(line => [line.containerBatchNameText, line.matchedContainerBatchName, line.matchSource])).toEqual([
      ['1211-01柜', '1211-01柜', 'NAME'],
      ['0102-01柜', '0102-01柜', 'NAME'],
      ['0116柜', '0116柜', 'NAME'],
    ])
    // 账单自身状态不受预览影响。
    expect(body.bill.reconciliationStatus).toBe('PENDING')
    expect(body.bill.lineCount).toBe(3)
  })

  it('柜号无法解析时用唛头里的月日定位柜次，并标记匹配来源为推断', async () => {
    const response = await preview(billC.id).expect(200)
    const body = response.body as SlhReconciliationBatchPreviewDto
    const inferred = body.matched.find(line => line.containerBatchNameText === '待定')
    expect(inferred).toMatchObject({ matchedContainerBatchName: '0116柜', matchSource: 'MARK' })
  })

  it('不合格的行给出分层原因，且不影响其余行的匹配', async () => {
    await h.prisma.containerLoadingItem.update({ where: { id: items.get('0116') }, data: { shipmentId: null } })
    const response = await preview(billA.id).expect(200)
    let body = response.body as SlhReconciliationBatchPreviewDto
    expect(body.matched).toHaveLength(2)
    expect(body.unmatched.map(line => line.reason)).toEqual(['SHIPMENT_NOT_MATCHED'])

    await h.prisma.containerLoadingItem.update({ where: { id: items.get('0116') }, data: { oceanShippingMarkText: '别的唛头' } })
    body = (await preview(billA.id).expect(200)).body as SlhReconciliationBatchPreviewDto
    expect(body.unmatched.map(line => line.reason)).toEqual(['MARK_NOT_FOUND_IN_CONTAINER'])

    // 柜次本身定位不到（名称与唛头指向的那一天没有柜次）时给 CONTAINER_NOT_FOUND。
    await h.prisma.containerLoadingItem.update({ where: { id: items.get('0116') }, data: { oceanShippingMarkText: 'L-011652' } })
    await h.prisma.containerBatch.update({ where: { id: batchIds.get('0116柜')! }, data: { loadingDate: new Date('2026-01-20T00:00:00.000Z') } })
    body = (await preview(billA.id).expect(200)).body as SlhReconciliationBatchPreviewDto
    expect(body.unmatched.map(line => line.reason)).toEqual(['CONTAINER_NOT_FOUND'])

    // 复位后三行都可以核对，说明原因只影响命中的那一行。
    await h.prisma.containerBatch.update({ where: { id: batchIds.get('0116柜')! }, data: { loadingDate: new Date('2026-01-16T00:00:00.000Z') } })
    await h.prisma.containerLoadingItem.update({ where: { id: items.get('0116') }, data: { shipmentId: shipments.get('0116')! } })
    expect(((await preview(billA.id).expect(200)).body as SlhReconciliationBatchPreviewDto).matched).toHaveLength(3)
  })

  it('创建批次：派发批次编号、冻结匹配命中的成员行，账单与明细行保持未对账', async () => {
    // 详情必须把柜次那一侧的可比字段一并带出来，否则页面无法逐字段核对。
    await h.prisma.containerLoadingItem.update({
      where: { id: items.get('0102')! },
      data: {
        codAmountTwd: '300.00', grossWeightKg: '315.000', lengthCm: '215.00', widthCm: '137.00', heightCm: '113.00',
        volumeCai: '8.00', reportedVolumeCai: '8.00', recipientName: '测试收货人二', recipientPhone: '0912345678',
        recipientAddress: '台北市測試路 1 號', warehouseReceiptReference: 'WG-0102-0092',
      },
    })
    const created = (await createBatch(billA.id).expect(201)).body as SlhReconciliationBatchDetailDto
    expect(created.batchNo).toMatch(/^SRB-\d{6}-\d{3}$/u)
    expect(created.status).toBe('IN_PROGRESS')
    expect(created.memberCount).toBe(3)
    expect(created.reconciledMemberCount).toBe(0)
    expect(created.members).toHaveLength(3)
    expect(created.members.every(member => member.reconciliationStatus === SlhBillLineReconciliationStatusDto.PENDING && member.reconciledAt === null)).toBe(true)
    // 柜次侧与账单侧同口径落值：金额两位、重量三位、没填的列仍是 null（不涉及），不是 0。
    const matched = created.members.find(member => member.matchedContainerBatchName === '0102-01柜')!
    expect(matched.matchedLoadingItem).toMatchObject({
      codAmountTwd: '300.00', grossWeightKg: '315.000', lengthCm: '215.00', volumeCai: '8.00',
      recipientName: '测试收货人二', recipientPhone: '0912345678', warehouseReceiptReference: 'WG-0102-0092',
    })
    const blank = created.members.find(member => member.matchedContainerBatchName === '1211-01柜')!
    expect(blank.matchedLoadingItem.codAmountTwd).toBeNull()
    // findings 是整张账单的导入快照，不按批次裁剪：页面自己筛出本批次的行，同时报出全账单条数。
    const stored = await h.prisma.slhBill.findUniqueOrThrow({ where: { id: billA.id }, select: { importFindings: true } })
    expect(created.findings).toHaveLength(Array.isArray(stored.importFindings) ? stored.importFindings.length : 0)
    // 建批次不写账单与明细行：账单三态仍是未对账。
    const bill = await h.prisma.slhBill.findUniqueOrThrow({ where: { id: billA.id }, select: { lineCount: true, lines: { select: { reconciledAt: true } } } })
    expect(bill.lines.every(line => line.reconciledAt === null)).toBe(true)
    expect(await h.prisma.auditEvent.count({ where: { eventType: 'SLH_RECONCILIATION_BATCH_CREATED', targetId: created.id } })).toBe(1)
    // 编号身份由触发器兜底：派发台账、消费方与规则必须一致。
    const issuance = await h.prisma.numberingIssuance.findFirstOrThrow({ where: { generatedNumber: created.batchNo }, select: { consumerCode: true } })
    expect(issuance.consumerCode).toBe('SLH_RECON_BATCH.CREATE')
    expect(await h.prisma.slhReconciliationBatch.count({ where: { billId: billA.id } })).toBe(1)
  })

  it('同一账单同时只能有一个进行中的批次，候选账单也随之隐藏', async () => {
    const conflict = await createBatch(billA.id).expect(409)
    expect(errorCode(conflict)).toBe('SLH_RECON_BATCH_CONFLICT')

    const candidates = (await browser.get('/api/slh-reconciliation-batches/candidates').set(packagingHeaders).query({ pageSize: 100 }).expect(200)).body as { items: Array<{ id: string }> }
    expect(candidates.items.map(item => item.id)).not.toContain(billA.id)
    expect(candidates.items.map(item => item.id)).toContain(billB.id)
  })

  it('预览与创建之间的可核对范围变化时拒绝创建，不静默改变范围', async () => {
    const response = await preview(billB.id).expect(200)
    const seen = (response.body as SlhReconciliationBatchPreviewDto).matched.map(line => line.lineId)
    await h.prisma.containerLoadingItem.update({ where: { id: items.get('0116') }, data: { shipmentId: null } })
    const changed = await createBatch(billB.id, randomUUID(), seen).expect(409)
    expect(errorCode(changed)).toBe('SLH_RECON_BATCH_SCOPE_CHANGED')
    expect(await h.prisma.slhReconciliationBatch.count({ where: { billId: billB.id } })).toBe(0)
    await h.prisma.containerLoadingItem.update({ where: { id: items.get('0116') }, data: { shipmentId: shipments.get('0116')! } })
  })

  it('重复提交标识重试返回同一批次，不重复派发编号', async () => {
    const key = randomUUID()
    const first = (await createBatch(billC.id, key).expect(201)).body as SlhReconciliationBatchDetailDto
    const again = await createBatch(billC.id, key)
    if (again.status !== 201) throw new Error(`重试响应 ${again.status}: ${JSON.stringify(again.body)}`)
    expect((again.body as SlhReconciliationBatchDetailDto).id).toBe(first.id)
    expect(await h.prisma.slhReconciliationBatch.count({ where: { billId: billC.id } })).toBe(1)
  })

  it('确认核对写入明细行与成员行的对账时刻，账单三态随之变化', async () => {
    const batch = (await createBatch(billB.id).expect(201)).body as SlhReconciliationBatchDetailDto
    expect(batch.memberCount).toBe(3)
    const [first, second, third] = batch.members

    const reconciled = (await reconcile(batch.id, [first.lineId, second.lineId]).expect(200)).body as SlhReconciliationBatchDetailDto
    expect(reconciled.reconciledMemberCount).toBe(2)
    expect(reconciled.bill.reconciliationStatus).toBe(SlhBillReconciliationStatusDto.PARTIAL)
    expect(reconciled.bill.reconciledLineCount).toBe(2)
    expect(reconciled.members.filter(member => member.reconciledAt !== null).map(member => member.lineNumber)).toEqual([first.lineNumber, second.lineNumber])
    expect(await h.prisma.auditEvent.count({ where: { eventType: 'SLH_BILL_LINES_RECONCILED', targetId: batch.id } })).toBe(1)

    // 核对依据失去合格条件时整批拒绝，且一行都不写。
    await h.prisma.containerLoadingItem.update({ where: { id: items.get('0116') }, data: { shipmentId: null } })
    const rejected = await reconcile(batch.id, [third.lineId]).expect(409)
    expect(errorCode(rejected)).toBe('SLH_RECON_BATCH_LINES_NOT_ELIGIBLE')
    expect((await h.prisma.slhReconciliationBatchLine.findUniqueOrThrow({ where: { id: third.id } })).reconciledAt).toBeNull()
    await h.prisma.containerLoadingItem.update({ where: { id: items.get('0116') }, data: { shipmentId: shipments.get('0116')! } })
    // 已核对过的行不允许重复核对。
    expect(errorCode(await reconcile(batch.id, [first.lineId]).expect(409))).toBe('SLH_RECON_BATCH_LINES_NOT_ELIGIBLE')
  })

  it('结束本次对账允许仍有未核对的行，解除占用后下一轮只匹配未对账的行', async () => {
    const batch = await h.prisma.slhReconciliationBatch.findFirstOrThrow({ where: { billId: billB.id, completedAt: null }, select: { id: true, batchNo: true } })
    const completed = (await complete(batch.id).expect(200)).body as SlhReconciliationBatchDetailDto
    expect(completed.status).toBe(SlhReconciliationBatchStatusDto.COMPLETED)
    expect(completed.completedAt).not.toBeNull()
    expect(completed.reconciledMemberCount).toBe(2)
    expect(completed.memberCount).toBe(3)
    expect(await h.prisma.auditEvent.count({ where: { eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', targetId: batch.id } })).toBe(1)
    expect(errorCode(await complete(batch.id).expect(409))).toBe('SLH_RECON_BATCH_NOT_IN_PROGRESS')
    expect(errorCode(await reconcile(batch.id, [randomUUID()]).expect(409))).toBe('SLH_RECON_BATCH_NOT_IN_PROGRESS')

    // 账单仍未对完 → 候选可见；新批次只冻结剩下那条未对账的行。
    const candidates = (await browser.get('/api/slh-reconciliation-batches/candidates').set(packagingHeaders).query({ pageSize: 100 }).expect(200)).body as { items: Array<{ id: string }> }
    expect(candidates.items.map(item => item.id)).toContain(billB.id)
    const next = (await createBatch(billB.id).expect(201)).body as SlhReconciliationBatchDetailDto
    expect(next.id).not.toBe(batch.id)
    expect(next.batchNo).not.toBe(batch.batchNo)
    expect(next.memberCount).toBe(1)

    const last = next.members[0]
    const finished = (await reconcile(next.id, [last.lineId]).expect(200)).body as SlhReconciliationBatchDetailDto
    expect(finished.bill.reconciliationStatus).toBe(SlhBillReconciliationStatusDto.COMPLETED)
    await complete(next.id).expect(200)
    // 账单对账完成后不再是候选，也无法再开批次。
    const after = (await browser.get('/api/slh-reconciliation-batches/candidates').set(packagingHeaders).query({ pageSize: 100 }).expect(200)).body as { items: Array<{ id: string }> }
    expect(after.items.map(item => item.id)).not.toContain(billB.id)
    expect(errorCode(await createBatch(billB.id).expect(409))).toBe('SLH_RECON_BATCH_NO_LINES_TO_RECONCILE')
  })

  it('批次列表按状态筛选与编号检索，且只对具备 reconcile 权限的用户开放', async () => {
    const list = (await browser.get('/api/slh-reconciliation-batches').set(packagingHeaders).query({ status: 'COMPLETED', pageSize: 100 }).expect(200)).body as SlhReconciliationBatchPageDto
    expect(list.items.every(item => item.status === SlhReconciliationBatchStatusDto.COMPLETED)).toBe(true)
    expect(list.items.some(item => item.bill.id === billB.id)).toBe(true)
    const inProgress = (await browser.get('/api/slh-reconciliation-batches').set(packagingHeaders).query({ status: 'IN_PROGRESS', pageSize: 100 }).expect(200)).body as SlhReconciliationBatchPageDto
    expect(inProgress.items.some(item => item.bill.id === billA.id)).toBe(true)
    expect(inProgress.items.some(item => item.status === SlhReconciliationBatchStatusDto.COMPLETED)).toBe(false)

    const first = inProgress.items[0]
    const searched = (await browser.get('/api/slh-reconciliation-batches').set(packagingHeaders).query({ status: 'all', keyword: first.batchNo, pageSize: 100 }).expect(200)).body as SlhReconciliationBatchPageDto
    expect(searched.items.map(item => item.id)).toEqual([first.id])

    await outsider.get('/api/slh-reconciliation-batches').set(packagingHeaders).expect(403)
    await outsider.post('/api/slh-reconciliation-batches').set(packagingHeaders).set('Idempotency-Key', randomUUID()).send({ billId: billC.id }).expect(403)
  })
})
