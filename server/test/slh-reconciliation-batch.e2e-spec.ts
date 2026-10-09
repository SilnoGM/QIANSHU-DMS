import request from 'supertest'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'

/**
 * 对账功能已整体冻结（重构第一步）：用例只验证接口定义、权限与契约边界仍然成立——
 * 读接口返回空集合，其余接口返回契约声明的 404，且调用不产生任何数据。
 */
describe('slh reconciliation batches (frozen shells) with isolated PostgreSQL', () => {
  jest.setTimeout(180_000)
  let h: PackagingCostHarness
  let browser: request.Agent
  let outsider: request.Agent
  const base = '/api/slh-reconciliation-batches'
  const unknownId = '00000000-0000-4000-8000-000000000001'
  const errorCode = (response: request.Response) => (response.body as { code: string }).code

  beforeAll(async () => {
    h = await createPackagingCostHarness()
    await h.app.listen(0, '127.0.0.1')
    browser = (await h.browserWithPermissions(['slh-bills:reconcile'])).browser
    outsider = (await h.browserWithPermissions(['slh-bills:read'])).browser
  })
  afterAll(async () => { await h?.dispose() })

  it('列表与候选账单返回空集合，分页参数原样回显', async () => {
    const list = await browser.get(base).expect(200)
    expect(list.body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
    const candidates = await browser.get(`${base}/candidates`).query({ page: 2, pageSize: 50 }).expect(200)
    expect(candidates.body).toEqual({ items: [], total: 0, page: 2, pageSize: 50 })
  })

  it('详情与写接口返回契约声明的 404，且不落任何数据', async () => {
    expect(errorCode(await browser.get(`${base}/${unknownId}`).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
    expect(errorCode(await browser.post(`${base}/${unknownId}/reconcile`).set(packagingHeaders).send({ lineIds: [unknownId] }).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
    expect(errorCode(await browser.post(`${base}/${unknownId}/complete`).set(packagingHeaders).send({}).expect(404))).toBe('SLH_RECON_BATCH_NOT_FOUND')
    expect(errorCode(await browser.post(`${base}/match-preview`).set(packagingHeaders).send({ billId: unknownId }).expect(404))).toBe('SLH_BILL_NOT_FOUND')
    expect(errorCode(await browser.post(base).set(packagingHeaders).set('Idempotency-Key', unknownId).send({ billId: unknownId }).expect(404))).toBe('SLH_BILL_NOT_FOUND')
    expect(await h.prisma.slhReconciliationBatch.count()).toBe(0)
    expect(await h.prisma.slhReconciliationBatchLine.count()).toBe(0)
  })

  it('权限与会话边界仍在：未登录 401，缺少 reconcile 权限 403', async () => {
    await request(h.app.getHttpServer()).get(base).expect(401)
    await outsider.get(base).expect(403)
    await outsider.post(`${base}/${unknownId}/complete`).set(packagingHeaders).send({}).expect(403)
  })
})
