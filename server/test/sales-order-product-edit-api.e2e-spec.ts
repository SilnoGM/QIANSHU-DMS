import { SalesReceiptService } from '../src/modules/sales-orders/receipts/sales-receipt.service'
import { type INestApplication, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { AccessControlService } from '../src/modules/access-control/access-control.service'
import { attachRequestAuthContext } from '../src/modules/auth/auth-context'
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard'
import { SalesOrderDocumentService } from '../src/modules/sales-orders/documents/sales-order-document.service'
import { SalesOrderProductImageService } from '../src/modules/sales-orders/products/sales-order-product-image.service'
import { SalesOrderCommandService } from '../src/modules/sales-orders/sales-order-command.service'
import { SalesOrderMutationService } from '../src/modules/sales-orders/sales-order-mutation.service'
import { SalesOrderProductEditQueryService } from '../src/modules/sales-orders/sales-order-product-edit-query.service'
import { SalesOrderProductEditService } from '../src/modules/sales-orders/sales-order-product-edit.service'
import { SalesOrderQueryService } from '../src/modules/sales-orders/sales-order-query.service'
import { SalesOrdersController } from '../src/modules/sales-orders/sales-orders.controller'

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const SALES_ORDER_ID = '22222222-2222-4222-8222-222222222222'

function attachTestAuth(
  requestObject: object,
  _response: object,
  next: () => void,
): void {
  attachRequestAuthContext(requestObject, {
    id: '33333333-3333-4333-8333-333333333333',
    userId: ACTOR_ID,
    username: 'sales_product_edit_api_e2e',
    displayName: '销售产品修改 API E2E',
    mustChangePassword: false,
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
    lastActivityAt: new Date('2026-09-02T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-09-03T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-10-02T00:00:00.000Z'),
  })
  next()
}

describe('Sales order product-edit HTTP permission boundary', () => {
  let application: INestApplication | undefined
  let grantedPermissions: string[]

  beforeAll(async () => {
    grantedPermissions = ['sales-orders:update']

    @Module({
      controllers: [SalesOrdersController],
      providers: [
    { provide: SalesReceiptService, useValue: {} },{
        provide: AccessControlService,
        useValue: {
          getPermissionCodes: () => Promise.resolve([...grantedPermissions]),
          hasAll: (granted: readonly string[], required: readonly string[]) => (
            required.every(code => granted.includes(code))
          ),
        },
      }, {
        provide: SalesOrderQueryService,
        useValue: {},
      }, {
        provide: SalesOrderCommandService,
        useValue: {},
      }, {
        provide: SalesOrderMutationService,
        useValue: {},
      }, {
        provide: SalesOrderDocumentService,
        useValue: {},
      }, {
        provide: SalesOrderProductImageService,
        useValue: {},
      }, {
        provide: SalesOrderProductEditQueryService,
        useValue: {
          context: jest.fn().mockResolvedValue({ salesOrder: { id: SALES_ORDER_ID } }),
          productOptions: jest.fn().mockResolvedValue({
            items: [], page: 1, pageSize: 20, total: 0,
          }),
        },
      }, {
        provide: SalesOrderProductEditService,
        useValue: { updateProducts: jest.fn() },
      }, {
        provide: APP_GUARD,
        useClass: PermissionGuard,
      }],
    })
    class SalesOrderProductEditApiTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [SalesOrderProductEditApiTestModule],
    }).compile()
    application = moduleRef.createNestApplication()
    application.use(attachTestAuth)
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
  })

  afterAll(async () => {
    await application?.close()
    application = undefined
  })

  beforeEach(() => {
    grantedPermissions = ['sales-orders:update']
  })

  function requireApplication(): INestApplication {
    if (!application) throw new Error('Sales order product-edit test app is unavailable')
    return application
  }

  it('allows product-edit reads with only sales update permission', async () => {
    await request(requireApplication().getHttpServer())
      .get(`/api/sales-orders/${SALES_ORDER_ID}/product-edit-context`)
      .expect(200)
    await request(requireApplication().getHttpServer())
      .get(`/api/sales-orders/${SALES_ORDER_ID}/product-edit-options?supplierValue=SUPPLIER_E2E`)
      .expect(200)
  })

  it('returns 403 from every product-edit endpoint without sales update permission', async () => {
    grantedPermissions = []

    await request(requireApplication().getHttpServer())
      .get(`/api/sales-orders/${SALES_ORDER_ID}/product-edit-context`)
      .expect(403)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'FORBIDDEN' }))
    await request(requireApplication().getHttpServer())
      .get(`/api/sales-orders/${SALES_ORDER_ID}/product-edit-options?supplierValue=SUPPLIER_E2E`)
      .expect(403)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'FORBIDDEN' }))
    await request(requireApplication().getHttpServer())
      .patch(`/api/sales-orders/${SALES_ORDER_ID}/products`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'FORBIDDEN' }))
  })
})
