import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Client } from 'pg'
import request from 'supertest'
import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { AuditService } from '../src/modules/audit/audit.service'
import type { ShippingMarkBindingPageDto, ShippingMarkOptionsPageDto } from '../src/modules/purchase-shipping-marks/shipping-mark-binding.dto'
import { createIsolatedNumberingDatabase, IsolatedNumberingPrismaService, type IsolatedNumberingDatabase } from './numbering-e2e-database'

const headers = { Origin: 'http://127.0.0.1:9000', 'X-Qianshu-CSRF': '1', 'Sec-Fetch-Site': 'same-origin' }
const endpoint = '/api/purchase-shipping-mark-bindings'

/** 仅使用根隔离入口提供的临时库；独立 schema 允许验证永久编号账本不被配置操作触碰。 */
describe('shipping mark binding HTTP and PostgreSQL contract', () => {
  jest.setTimeout(90_000)
  let database: IsolatedNumberingDatabase
  let app: INestApplication
  let prisma: PrismaService
  let client: Client
  let originalUrl: string | undefined
  let admin: ReturnType<typeof request.agent>
  let reader: ReturnType<typeof request.agent>
  let outsider: ReturnType<typeof request.agent>
  let actorId: string
  let supplierTypeId: string
  let ruleId: string
  let secondRuleId: string

  beforeAll(async () => {
    originalUrl = process.env.DATABASE_URL
    database = await createIsolatedNumberingDatabase()
    client = new Client({ connectionString: database.databaseUrl })
    await client.connect()
    await client.query(readFileSync(resolve(__dirname, '../prisma/migrations/20260906090104_supplier_shipping_mark_rule_bindings/migration.sql'), 'utf8'))
    process.env.DATABASE_URL = database.databaseUrl
    const { AppModule } = await import('../src/app.module')
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(new IsolatedNumberingPrismaService(database)).compile()
    app = module.createNestApplication()
    configureApplication(app, { nodeEnvironment: 'test' })
    await app.init()
    prisma = app.get(PrismaService)
    const passwordProvider = app.get(PasswordProvider)

    async function login(roleCode?: string) {
      const username = `mark-${randomUUID()}`
      const password = `Mark-${randomUUID().slice(0, 12)}`
      const user = await prisma.user.create({ data: { username, usernameNormalized: username, displayName: '绑定测试', passwordHash: await passwordProvider.hash(password), passwordChangedAt: new Date(), profile: { create: {} } } })
      if (roleCode) {
        const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } })
        await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } })
      }
      const browser = request.agent(app.getHttpServer())
      await browser.post('/api/auth/login').set(headers).send({ username, password }).expect(200)
      return { user, browser }
    }
    const readPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'purchase-shipping-marks:read' } })
    await prisma.role.create({ data: { code: 'mark_reader', name: '绑定只读测试', permissions: { create: { permissionId: readPermission.id } } } })
    const administrator = await login('system_admin')
    actorId = administrator.user.id
    admin = administrator.browser
    reader = (await login('mark_reader')).browser
    outsider = (await login()).browser
    const dictionary = await prisma.dictionaryType.create({ data: {
      code: 'service_provider.supplier', name: '供应商', enabled: false,
      items: { create: ['SUPPLIER_A', 'SUPPLIER_B', 'SUPPLIER_C', 'SUPPLIER_DISABLED'].map((value, index) => ({ value, label: `测试供应商${index}`, enabled: index < 3 })) },
    } })
    supplierTypeId = dictionary.id
    await prisma.dictionaryType.update({ where: { id: dictionary.id }, data: { enabled: true } })

    async function createRule(code: string) {
      const created = await admin.post('/api/numbering-rules').set(headers).send({ ruleCode: code, name: code, purpose: 'SHIPPING_MARK', resetPolicy: 'NEVER', segments: [{ type: 'SEQUENCE', width: 4, startValue: '1', step: '1' }] }).expect(201)
      const body = created.body as { id: string, version: number }
      const published = await admin.post(`/api/numbering-rules/${body.id}/publish`).set(headers).send({ expectedVersion: body.version, draftRevision: 1 }).expect(200)
      await admin.post(`/api/numbering-rules/${body.id}/enable`).set(headers).send({ expectedVersion: (published.body as { version: number }).version }).expect(200)
      return body.id
    }
    ruleId = await createRule('WGJ_MARK')
    secondRuleId = await createRule('CUSTOM_MARK')
  })

  afterAll(async () => {
    await app?.close()
    await client?.end()
    await database?.dispose()
    if (originalUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalUrl
  })

  it('lists all suppliers including unbound/disabled, fixed custom rule and authenticated permission boundaries', async () => {
    await request(app.getHttpServer()).get(endpoint).expect(401)
    await outsider.get(endpoint).expect(403)
    const response = await reader.get(endpoint).query({ page: 1, pageSize: 2 }).expect(200)
    const body = response.body as ShippingMarkBindingPageDto
    expect(body.total).toBe(4)
    expect(body.items).toHaveLength(2)
    expect(body.items.every(row => row.version === 0 && row.availability === 'UNBOUND')).toBe(true)
    expect(body.customRule).toMatchObject({ availability: 'AVAILABLE', rule: { ruleCode: 'CUSTOM_MARK' } })
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['x-request-id']).toBeTruthy()
    await reader.put(`${endpoint}/SUPPLIER_A`).set(headers).send({ ruleId, expectedVersion: 0 }).expect(403)
    await admin.put(`${endpoint}/SUPPLIER_A`).send({ ruleId, expectedVersion: 0 }).expect(403)
    await admin.put(`${endpoint}/SUPPLIER_A`).set(headers).send({ ruleId, expectedVersion: 0, supplierId: actorId }).expect(422)
    await admin.get(endpoint).query({ pageSize: 101 }).expect(422)
    const disabled = (await admin.get(endpoint).query({ keyword: 'SUPPLIER_DISABLED' }).expect(200)).body as ShippingMarkBindingPageDto
    expect(disabled.items[0].availability).toBe('SUPPLIER_UNAVAILABLE')
  })

  it('sets and rebinds without consuming a number; same rule can serve multiple suppliers', async () => {
    const before = await client.query('SELECT (SELECT count(*)::int FROM numbering_period_states) AS states, (SELECT count(*)::int FROM numbering_issuances) AS issuances')
    await admin.put(`${endpoint}/SUPPLIER_A`).set(headers).send({ ruleId, expectedVersion: 0 }).expect(200)
    await admin.put(`${endpoint}/SUPPLIER_B`).set(headers).send({ ruleId, expectedVersion: 0 }).expect(200)
    const rows = (await admin.get(endpoint).query({ bindingStatus: 'BOUND' }).expect(200)).body as ShippingMarkBindingPageDto
    expect(rows.total).toBe(2)
    expect(rows.items.every(row => row.rule?.id === ruleId)).toBe(true)
    const changed = await admin.put(`${endpoint}/SUPPLIER_A`).set(headers).send({ ruleId: secondRuleId, expectedVersion: 1 }).expect(200)
    expect(changed.body).toMatchObject({ version: 2, rule: { id: secondRuleId } })
    await admin.put(`${endpoint}/SUPPLIER_A`).set(headers).send({ ruleId, expectedVersion: 1 }).expect(409)
    const noop = await admin.put(`${endpoint}/SUPPLIER_A`).set(headers).send({ ruleId: secondRuleId, expectedVersion: 2 }).expect(200)
    expect(noop.body).toMatchObject({ version: 2 })
    const events = await prisma.auditEvent.findMany({ where: { targetType: 'shipping_mark_binding', targetId: 'SUPPLIER_A' }, orderBy: { occurredAt: 'asc' } })
    expect(events).toHaveLength(2)
    expect(events[1].metadata).toMatchObject({ previousRuleId: ruleId, ruleId: secondRuleId, version: 2 })
    expect((await client.query('SELECT (SELECT count(*)::int FROM numbering_period_states) AS states, (SELECT count(*)::int FROM numbering_issuances) AS issuances')).rows).toEqual(before.rows)
    await prisma.dictionaryItem.update({ where: { dictionaryTypeId_value: { dictionaryTypeId: supplierTypeId, value: 'SUPPLIER_A' } }, data: { label: '重命名供应商' } })
    const renamed = (await admin.get(endpoint).query({ keyword: '重命名供应商' }).expect(200)).body as ShippingMarkBindingPageDto
    expect(renamed.items[0]).toMatchObject({ supplierValue: 'SUPPLIER_A', version: 2, rule: { id: secondRuleId } })
  })

  it('uses a primary key and optimistic version to resolve concurrent first bindings', async () => {
    const results = await Promise.all([ruleId, secondRuleId].map(id => admin.put(`${endpoint}/SUPPLIER_C`).set(headers).send({ ruleId: id, expectedVersion: 0 })))
    expect(results.map(result => result.status).sort()).toEqual([200, 409])
    expect(await prisma.supplierShippingMarkRuleBinding.count({ where: { supplierValue: 'SUPPLIER_C' } })).toBe(1)
  })

  it('rolls back a rebind when audit persistence fails and never exposes the driver error', async () => {
    const before = await prisma.supplierShippingMarkRuleBinding.findUniqueOrThrow({ where: { supplierValue: 'SUPPLIER_B' } })
    const failure = jest.spyOn(app.get(AuditService), 'record').mockRejectedValueOnce(new Error('private-driver-diagnostic'))
    try {
      const response = await admin.put(`${endpoint}/SUPPLIER_B`).set(headers).send({ ruleId: secondRuleId, expectedVersion: before.version }).expect(500)
      expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' })
      expect(JSON.stringify(response.body)).not.toContain('private-driver-diagnostic')
      expect(await prisma.supplierShippingMarkRuleBinding.findUniqueOrThrow({ where: { supplierValue: 'SUPPLIER_B' } })).toEqual(before)
    }
    finally {
      failure.mockRestore()
    }
  })

  it('rejects unavailable rules/suppliers, preserves disabled bindings and validates DB identity/purpose', async () => {
    await admin.put(`${endpoint}/SUPPLIER_DISABLED`).set(headers).send({ ruleId, expectedVersion: 0 }).expect(409)
    await admin.put(`${endpoint}/missing-supplier`).set(headers).send({ ruleId, expectedVersion: 0 }).expect(409)
    const business = await prisma.numberingRule.create({ data: { ruleCode: 'BUSINESS', purpose: 'BUSINESS', name: '业务' } })
    await admin.put(`${endpoint}/SUPPLIER_B`).set(headers).send({ ruleId: business.id, expectedVersion: 1 }).expect(409)
    await expect(client.query('UPDATE supplier_shipping_mark_rule_bindings SET rule_id = $1 WHERE supplier_value = $2', [business.id, 'SUPPLIER_B'])).rejects.toMatchObject({ code: '23514', constraint: 'shipping_mark_binding_purpose_check' })
    await expect(client.query("UPDATE supplier_shipping_mark_rule_bindings SET supplier_value = 'different' WHERE supplier_value = 'SUPPLIER_B'" )).rejects.toMatchObject({ code: '23514', constraint: 'shipping_mark_binding_identity_check' })
    await expect(client.query("UPDATE supplier_shipping_mark_rule_bindings SET version = 0 WHERE supplier_value = 'SUPPLIER_B'" )).rejects.toMatchObject({ code: '23514' })
    await expect(client.query('INSERT INTO supplier_shipping_mark_rule_bindings(supplier_value,rule_id,created_by_user_id,updated_by_user_id) VALUES ($1,$2,$3,$3)', ['not-a-supplier', ruleId, actorId])).rejects.toMatchObject({ code: '23514', constraint: 'shipping_mark_binding_supplier_check' })
    const rule = await prisma.numberingRule.findUniqueOrThrow({ where: { id: ruleId } })
    await admin.post(`/api/numbering-rules/${ruleId}/disable`).set(headers).send({ expectedVersion: rule.version }).expect(200)
    const unavailable = (await admin.get(endpoint).query({ keyword: 'SUPPLIER_B' }).expect(200)).body as ShippingMarkBindingPageDto
    expect(unavailable.items[0]).toMatchObject({ version: 1, availability: 'RULE_DISABLED', rule: { id: ruleId } })
    await admin.put(`${endpoint}/SUPPLIER_B`).set(headers).send({ ruleId, expectedVersion: 1 }).expect(409)
    const options = (await admin.get(`${endpoint}/rule-options`).expect(200)).body as ShippingMarkOptionsPageDto
    expect(options.items.map(item => item.id)).toEqual([secondRuleId])
    await prisma.dictionaryType.update({ where: { id: supplierTypeId }, data: { enabled: false } })
    expect(((await admin.get(endpoint).expect(200)).body as ShippingMarkBindingPageDto).items.every(row => row.availability === 'SUPPLIER_UNAVAILABLE')).toBe(true)
  })
})
