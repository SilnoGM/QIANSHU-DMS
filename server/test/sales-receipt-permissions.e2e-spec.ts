import { randomBytes, randomUUID } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { createReceiptTestDatabase } from './fixtures/receipt-test-database'
import request from 'supertest'
import { Client } from 'pg'
import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { insertFixture, insertRequest } from './fixtures/sales-receipt-schema.fixture'

const headers = { Origin: 'http://127.0.0.1:9000', 'X-Qianshu-CSRF': '1', 'Sec-Fetch-Site': 'same-origin' }

describe('sales receipt HTTP permissions on real PostgreSQL', () => {
  jest.setTimeout(60000)
  let database: Awaited<ReturnType<typeof createReceiptTestDatabase>>
  let app: INestApplication
  let prisma: PrismaService
  let client: Client
  let receiptId: string
  let orderId: string
  beforeAll(async () => {
    database = await createReceiptTestDatabase()
    const module = await Test.createTestingModule({ imports:[AppModule] }).overrideProvider(PrismaService).useValue(new PrismaService(new ConfigService({ DATABASE_URL: database.databaseUrl }))).compile()
    app = module.createNestApplication()
    configureApplication(app,{nodeEnvironment:'test'})
    await app.init()
    prisma = app.get(PrismaService)
    client = new Client({connectionString:database.databaseUrl})
    await client.connect()
    await client.query('BEGIN')
    try { const fixture=await insertFixture(client);orderId=fixture.salesOrderId;receiptId=await insertRequest(client,fixture);await client.query('COMMIT') }
    catch(error){await client.query('ROLLBACK');throw error}
  })
  afterAll(async()=>{await client?.end();await app?.close();await database?.close()})

  async function browserWithPermissions(codes: string[]) {
    const username=`receipt_http_${randomUUID()}`
    const password=`P9!${randomBytes(8).toString('hex')}`
    const user=await prisma.user.create({data:{username,usernameNormalized:username,displayName:'收款权限测试',passwordHash:await app.get(PasswordProvider).hash(password),passwordChangedAt:new Date()}})
    const permissions=await prisma.permission.findMany({where:{code:{in:codes}},select:{id:true}})
    expect(permissions).toHaveLength(codes.length)
    const role=await prisma.role.create({data:{code:`receipt_http_${randomUUID()}`,name:'收款权限测试',permissions:{create:permissions.map(permission=>({permissionId:permission.id}))}}})
    await prisma.userRole.create({data:{userId:user.id,roleId:role.id}})
    const browser=request.agent(app.getHttpServer())
    await browser.post('/api/auth/login').set(headers).send({username,password}).expect(200)
    return {browser,user,role}
  }

  it('denies unauthenticated access and keeps sales reading separate from finance reading',async()=>{
    await request(app.getHttpServer()).get('/api/sales-receipt-requests').expect(401)
    const {browser}=await browserWithPermissions(['sales-orders:read'])
    await browser.get(`/api/sales-orders/${orderId}/receipt-requests`).expect(200)
    await browser.get('/api/sales-receipt-requests').expect(403)
    await browser.get(`/api/sales-orders/${randomUUID()}/receipt-requests/${receiptId}/voucher`).expect(404)
    await browser.post(`/api/sales-receipt-requests/${receiptId}/reject`).set(headers).send({expectedVersion:1,reason:'无审核权'}).expect(403)
  })

  it('finance reading grants neither review, correction, nor generic order/fund management',async()=>{
    const {browser}=await browserWithPermissions(['sales-receipts:read'])
    const response=await browser.get(`/api/sales-receipt-requests/${receiptId}`).expect(200)
    expect(response.headers['x-request-id']).toBeTruthy()
    expect(response.headers['cache-control']).toBe('private, no-store')
    await browser.get(`/api/sales-receipt-requests/${receiptId}/approval-context`).expect(403)
    await browser.post(`/api/sales-orders/${orderId}/payments/${randomUUID()}/void`).set(headers).send({reason:'无纠错权',expectedOrderVersion:1}).expect(403)
    await browser.get(`/api/sales-orders/${orderId}`).expect(403)
    await browser.get('/api/fund-accounts').expect(403)
  })

  it('review can reject without generic order access and revoked permission takes effect on the next request',async()=>{
    const {browser,role}=await browserWithPermissions(['sales-receipts:review'])
    await browser.post(`/api/sales-receipt-requests/${receiptId}/reject`).set(headers).send({expectedVersion:1,reason:'权限测试驳回'}).expect(200)
    await prisma.rolePermission.deleteMany({where:{roleId:role.id}})
    await browser.post(`/api/sales-receipt-requests/${receiptId}/reject`).set(headers).send({expectedVersion:1,reason:'权限测试驳回'}).expect(403)
    expect((await prisma.salesReceiptRequest.findUniqueOrThrow({where:{id:receiptId}})).status).toBe('REJECTED')
  })

  it('old sales payment permission cannot bypass financial review or perform correction',async()=>{
    const {browser}=await browserWithPermissions(['sales-orders:payment','sales-orders:document'])
    const response=await browser.post(`/api/sales-orders/${orderId}/payments`).set(headers).send({paymentType:'DEPOSIT',amount:'1.0000',receivedAt:new Date().toISOString(),paymentMethod:'bank_transfer',voucher:{mediaAssetId:randomUUID()}}).expect(409)
    expect(response.body as unknown).toMatchObject({code:'SALES_ORDER_RECEIPT_REVIEW_REQUIRED'})
    await browser.post(`/api/sales-orders/${orderId}/payments/${randomUUID()}/void`).set(headers).send({reason:'仅销售权限',expectedOrderVersion:1}).expect(403)
  })
})
