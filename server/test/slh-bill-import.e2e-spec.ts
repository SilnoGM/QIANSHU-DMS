import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { SlhBillDto, SlhBillStatusCountsDto } from '../src/modules/slh-bills/slh-bill.dto'
import { createSlhBillFixture } from './fixtures/slh-bill-xlsx.fixture'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'

const permissions = ['slh-bills:read', 'slh-bills:create']

/**
 * 账单导入的端到端回归。
 *
 * 这里覆盖的是纯函数单测与契约快照都看不到的一层：DTO 校验元数据。
 * 全局 ValidationPipe 开了 whitelist + forbidNonWhitelisted，请求 DTO 上漏一个
 * class-validator 装饰器就会把该字段当成多余字段拒掉（曾经 mediaAssetId 就是这样），
 * 而 OpenAPI 快照只看 @ApiProperty，完全看不出问题。
 */
describe('slh bill import with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness, browser: ReturnType<typeof request.agent>

  const upload = async (bytes: Buffer) => {
    const response = await browser.post('/api/slh-bills/source-file-uploads').set(packagingHeaders)
      .field('mediaType', 'DOCUMENT')
      .attach('file', bytes, { filename: '待签收返款账单.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    if (response.status !== 201) throw new Error(`upload responded ${response.status}: ${JSON.stringify(response.body)}`)
    return response.body as { mediaAssetId: string }
  }

  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    browser = (await h.browserWithPermissions(permissions)).browser
    // 账单编号由既有规则派发，运行前必须存在且启用；迁移不代替管理员建规则。
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const rule = await h.fixture.numberingCommands.create(context, {
      ruleCode: 'CTN_BILL_NO', purpose: 'BUSINESS', name: '海运账单编号', resetPolicy: 'YEARLY',
      segments: [
        { type: 'FIXED', value: 'CBILL' },
        { type: 'SEPARATOR', value: '/' },
        { type: 'DATE', format: 'YYYYMM' },
        { type: 'SEPARATOR', value: '-' },
        { type: 'SEQUENCE', width: 2, startValue: '1', step: '1' },
      ],
    })
    const published = await h.fixture.numberingCommands.publish(context, rule.id, { expectedVersion: rule.version, draftRevision: 1 })
    await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })
  })
  afterAll(async () => { await h?.dispose() })

  it('stages the source file and returns a parse preview without persisting', async () => {
    const staged = await upload(createSlhBillFixture())
    expect(staged.mediaAssetId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)

    const response = await browser.post('/api/slh-bills/import-preview').set(packagingHeaders).send({ mediaAssetId: staged.mediaAssetId })
    if (response.status !== 200) throw new Error(`import-preview responded ${response.status}: ${JSON.stringify(response.body)}`)
    expect(response.body).toMatchObject({
      periodStart: '2025-12-11',
      periodEnd: '2026-01-16',
      lineCount: 3,
      containerBatchCount: 3,
      // 复算与账单一致：没有任何差异或告警。
      findings: [],
      systemForeignUnitsPerCny: null,
    })
    // 小计三值用于与明细累加逐项对比。
    expect((response.body as { reported: unknown }).reported).toMatchObject({
      subtotalPayableAmountCny: '5825.00',
      subtotalCodAmountTwd: '129000.00',
      subtotalNtdSurchargeAmountTwd: '8000.00',
    })
    expect((response.body as { lines: unknown[] }).lines).toHaveLength(3)
    // 默认归档信息由服务端推导：名称取文件名，月份取期间结束月。
    expect(response.body).toMatchObject({ suggestedBillName: '待签收返款账单', suggestedBillMonth: '2026-01' })
    // 预览不落库。
    expect(await h.prisma.slhBill.count()).toBe(0)
  })

  it('rejects a request without the media asset id', async () => {
    await browser.post('/api/slh-bills/import-preview').set(packagingHeaders).send({}).expect(422)
  })

  it('requires a bill name and month on import', async () => {
    const staged = await upload(createSlhBillFixture())
    await browser.post('/api/slh-bills').set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({ mediaAssetId: staged.mediaAssetId }).expect(422)
    await browser.post('/api/slh-bills').set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({ billMonth: '2026-13', billName: '非法月份', mediaAssetId: staged.mediaAssetId }).expect(422)
  })

  it('imports the bill with the dispatched number and a frozen embedded rate', async () => {
    const staged = await upload(createSlhBillFixture())
    const created = (await browser.post('/api/slh-bills').set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({ billMonth: '2026-01', billName: '一月对账单', mediaAssetId: staged.mediaAssetId, remark: '首次导入' }).expect(201)).body as SlhBillDto
    expect(created.slhBillNo).toMatch(/^CBILL\/\d{6}-\d{2}$/u)
    // 名称与月份是入库时填的归档信息，与编号里的派发月无关。
    expect(created).toMatchObject({ billName: '一月对账单', billMonth: '2026-01', remark: '首次导入' })
    expect(created).toMatchObject({
      periodStart: '2025-12-11', periodEnd: '2026-01-16', lineCount: 3, containerBatchCount: 3,
      freightTotalAmountCny: '5595.00', codHandlingTotalAmountCny: '30.00', surchargeTotalAmountCny: '200.00',
      payableTotalAmountCny: '5825.00', codTotalAmountTwd: '129000.00', ntdSurchargeTotalAmountTwd: '8000.00',
      reportedNetAmountTwd: '121000.00',
    })
    // 账单公式自带除数 4.8，因此汇率来源是嵌入式，不读系统汇率。
    expect(created.rate).toMatchObject({ source: 'EMBEDDED', foreignUnitsPerCny: '4.800000000000' })
    // 自报值与差异快照都要能读回来，详情页据此做同样的对比。
    expect(created.reported).toMatchObject({
      subtotalPayableAmountCny: '5825.00', subtotalCodAmountTwd: '129000.00', subtotalNtdSurchargeAmountTwd: '8000.00',
      payableAmountCny: '-5825.00', netAmountTwd: '25208.33', netAmountFormula: '=(V17-W17)/4.8',
    })
    expect(created.findings).toEqual([])

    const lines = (await browser.get(`/api/slh-bills/${created.id}/lines`).expect(200)).body as { items: unknown[], total: number }
    expect(lines.total).toBe(3)

    // 重复导入先被期间与柜号集合拦下，尚未勾选确认时不应该建第二张账单。
    const duplicate = (await browser.post('/api/slh-bills').set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({ billMonth: '2026-01', billName: '另一张单', mediaAssetId: staged.mediaAssetId }).expect(409)).body as { code: string }
    expect(duplicate.code).toBe('SLH_BILL_DUPLICATE_PERIOD')

    // 勾选确认后放行期间重复，但名称仍受唯一约束：返回字段级冲突让弹窗就地提示。
    const taken = (await browser.post('/api/slh-bills').set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({ billMonth: '2026-01', billName: '一月对账单', duplicateAcknowledged: true, mediaAssetId: staged.mediaAssetId }).expect(409)).body as { code: string, fieldErrors: Record<string, string[]> }
    expect(taken.code).toBe('SLH_BILL_NAME_TAKEN')
    expect(taken.fieldErrors.billName?.length).toBeGreaterThan(0)
    expect(await h.prisma.slhBill.count()).toBe(1)
  })

  /**
   * 对账状态：明细行二态由该行的对账时刻决定，账单三态由已对账行数汇总派生，
   * 同时守住「凭证不可改」的窄例外——只有对账时刻能改，别的列与删除仍然被拒。
   */
  it('derives the reconciliation status from reconciled lines and keeps the rest of the evidence immutable', async () => {
    const bill = await h.prisma.slhBill.findFirstOrThrow({ include: { lines: { orderBy: { lineNumber: 'asc' } } } })
    const firstLine = bill.lines[0]
    const listStatus = async () => {
      const page = (await browser.get('/api/slh-bills').expect(200)).body as { items: Array<{ id: string, reconciliationStatus: string }> }
      return page.items.find(item => item.id === bill.id)?.reconciliationStatus ?? null
    }
    const lineStatuses = async () => {
      const page = (await browser.get(`/api/slh-bills/${bill.id}/lines`).expect(200)).body as { items: Array<{ reconciliationStatus: string }> }
      return page.items.map(item => item.reconciliationStatus)
    }

    // 一条都没对：账单未对账，三行明细都是未对账。
    expect(await listStatus()).toBe('PENDING')
    expect(await lineStatuses()).toEqual(['PENDING', 'PENDING', 'PENDING'])

    // 只对一行：账单变部分对账，该行变已对账。
    await h.prisma.slhBillLine.update({ data: { reconciledAt: new Date('2026-09-27T02:00:00.000Z') }, where: { id: firstLine.id } })
    expect(await listStatus()).toBe('PARTIAL')
    expect(await lineStatuses()).toEqual(['RECONCILED', 'PENDING', 'PENDING'])

    // 全部对完：对账完成。
    await h.prisma.slhBillLine.updateMany({ data: { reconciledAt: new Date('2026-09-27T03:00:00.000Z') }, where: { billId: bill.id, reconciledAt: null } })
    expect(await listStatus()).toBe('COMPLETED')

    // 例外只开对账时刻：改别的列与删除都被触发器拒绝，且拒绝后数据保持原样。
    await expect(h.prisma.slhBillLine.update({ data: { goodsName: '改过的货名' }, where: { id: firstLine.id } }))
      .rejects.toThrow(/SLH bill evidence is immutable/u)
    await expect(h.prisma.slhBillLine.delete({ where: { id: firstLine.id } }))
      .rejects.toThrow(/SLH bill evidence is immutable/u)
    const untouched = await h.prisma.slhBillLine.findUniqueOrThrow({ select: { goodsName: true }, where: { id: firstLine.id } })
    expect(untouched.goodsName).toBe(firstLine.goodsName)

    // 退回未对账：三态完全是派生值，清掉对账时刻就回到未对账。
    await h.prisma.slhBillLine.updateMany({ data: { reconciledAt: null }, where: { billId: bill.id } })
    expect(await listStatus()).toBe('PENDING')
  })

  /**
   * 两块工具栏的计数：账单状态与对账状态各一组，各自忽略自己那一维、保留另一维。
   * 计数与列表必须同源，否则切换工具栏后数字与点进去看到的行数会对不上。
   */
  it('counts bills per state and per reconciliation status for both toolbars', async () => {
    const bill = await h.prisma.slhBill.findFirstOrThrow({ include: { lines: { orderBy: { lineNumber: 'asc' } } } })
    const counts = async (query = '') => (await browser.get(`/api/slh-bills/status-counts${query}`).expect(200)).body as SlhBillStatusCountsDto
    const total = async (query: string) => ((await browser.get(`/api/slh-bills?${query}`).expect(200)).body as { total: number }).total

    // 一条都没对：状态计数只有这一张生效中，对账计数只有未对账。
    expect((await counts()).states).toEqual([
      { count: 1, value: 'active' },
      { count: 0, value: 'superseded' },
      { count: 1, value: 'all' },
    ])
    expect((await counts()).reconciliationStatuses).toEqual([
      { count: 1, value: 'all' },
      { count: 1, value: 'PENDING' },
      { count: 0, value: 'PARTIAL' },
      { count: 0, value: 'COMPLETED' },
    ])
    // 选中项的计数与列表 total 一致。
    expect(await total('reconciliationStatus=PENDING')).toBe(1)
    expect(await total('reconciliationStatus=COMPLETED')).toBe(0)

    // 对一行：对账计数把这张从"未对账"挪到"部分对账"，列表筛选同步。
    await h.prisma.slhBillLine.update({ data: { reconciledAt: new Date('2026-09-27T02:00:00.000Z') }, where: { id: bill.lines[0].id } })
    expect((await counts()).reconciliationStatuses).toEqual([
      { count: 1, value: 'all' },
      { count: 0, value: 'PENDING' },
      { count: 1, value: 'PARTIAL' },
      { count: 0, value: 'COMPLETED' },
    ])
    expect(await total('reconciliationStatus=PARTIAL')).toBe(1)
    expect(await total('reconciliationStatus=PENDING')).toBe(0)

    // 对面那块工具栏的计数仍然成立：只筛对账状态时，账单状态计数照旧。
    expect((await counts('?reconciliationStatus=PARTIAL')).states).toEqual([
      { count: 1, value: 'active' },
      { count: 0, value: 'superseded' },
      { count: 1, value: 'all' },
    ])
    // 反过来筛账单状态时，对账计数跟着变化（这就是"忽略自己、保留对方"的口径）。
    expect((await counts('?state=superseded')).reconciliationStatuses).toEqual([
      { count: 0, value: 'all' },
      { count: 0, value: 'PENDING' },
      { count: 0, value: 'PARTIAL' },
      { count: 0, value: 'COMPLETED' },
    ])

    // 全部对完：对账完成。
    await h.prisma.slhBillLine.updateMany({ data: { reconciledAt: new Date('2026-09-27T03:00:00.000Z') }, where: { billId: bill.id, reconciledAt: null } })
    expect((await counts()).reconciliationStatuses).toEqual([
      { count: 1, value: 'all' },
      { count: 0, value: 'PENDING' },
      { count: 0, value: 'PARTIAL' },
      { count: 1, value: 'COMPLETED' },
    ])
    expect(await total('reconciliationStatus=COMPLETED')).toBe(1)

    await h.prisma.slhBillLine.updateMany({ data: { reconciledAt: null }, where: { billId: bill.id } })
  })
})
