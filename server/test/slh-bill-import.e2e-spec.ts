import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { SlhBillDto } from '../src/modules/slh-bills/slh-bill.dto'
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
    // 预览不落库。
    expect(await h.prisma.slhBill.count()).toBe(0)
  })

  it('rejects a request without the media asset id', async () => {
    await browser.post('/api/slh-bills/import-preview').set(packagingHeaders).send({}).expect(422)
  })

  it('imports the bill with the dispatched number and a frozen embedded rate', async () => {
    const staged = await upload(createSlhBillFixture())
    const created = (await browser.post('/api/slh-bills').set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({ mediaAssetId: staged.mediaAssetId }).expect(201)).body as SlhBillDto
    expect(created.slhBillNo).toMatch(/^CBILL\/\d{6}-\d{2}$/u)
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

    // 明细行在数据库层不可改不可删，重复导入必须命中同一张账单。
    const replay = (await browser.post('/api/slh-bills').set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({ mediaAssetId: staged.mediaAssetId }).expect(409)).body as { code: string }
    expect(replay.code).toBe('SLH_BILL_DUPLICATE_PERIOD')
  })
})
