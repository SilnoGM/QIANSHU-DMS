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
import { SalesOrderAddOnQueryService } from '../src/modules/sales-orders/sales-order-add-on-query.service'
import { SalesOrderAddOnService } from '../src/modules/sales-orders/sales-order-add-on.service'
import { SalesOrderCommandService } from '../src/modules/sales-orders/sales-order-command.service'
import { SalesOrderMutationService } from '../src/modules/sales-orders/sales-order-mutation.service'
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
    username: 'sales_add_on_api_e2e',
    displayName: '销售加购 API E2E',
    mustChangePassword: false,
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
    lastActivityAt: new Date('2026-09-02T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-09-03T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-10-02T00:00:00.000Z'),
  })
  next()
}

describe('Sales order add-on HTTP permission boundary', () => {
  let application: INestApplication | undefined
  let grantedPermissions: string[]

  beforeAll(async () => {
    grantedPermissions = ['purchase-orders:create', 'sales-orders:update']

    @Module({
      controllers: [SalesOrdersController],
      providers: [{
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
        provide: SalesOrderAddOnQueryService,
        useValue: {
          context: jest.fn().mockResolvedValue({ salesOrder: { id: SALES_ORDER_ID } }),
          productOptions: jest.fn().mockResolvedValue({
            items: [], page: 1, pageSize: 20, total: 0,
          }),
        },
      }, {
        provide: SalesOrderAddOnService,
        useValue: { appendLines: jest.fn() },
      }, {
        provide: APP_GUARD,
        useClass: PermissionGuard,
      }],
    })
    class SalesOrderAddOnApiTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [SalesOrderAddOnApiTestModule],
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
    grantedPermissions = ['purchase-orders:create', 'sales-orders:update']
  })

  function requireApplication(): INestApplication {
    if (!application) throw new Error('Sales order add-on test app is unavailable')
    return application
  }

  const readRequests = [
    () => request(requireApplication().getHttpServer())
      .get(`/api/sales-orders/${SALES_ORDER_ID}/add-on-context`),
    () => request(requireApplication().getHttpServer())
      .get(`/api/sales-orders/${SALES_ORDER_ID}/add-on-product-options`)
      .query({ supplierValue: 'SUPPLIER_E2E' }),
  ]

  it.each([
    ['purchase permission missing', ['sales-orders:update']],
    ['sales update permission missing', ['purchase-orders:create']],
  ] as const)('returns 403 from every add-on endpoint when %s', async (
    _scenario,
    permissions,
  ) => {
    grantedPermissions = [...permissions]

    for (const createReadRequest of readRequests) {
      await createReadRequest()
        .expect(403)
        .expect(({ body }) => {
          expect(body).toMatchObject({ code: 'FORBIDDEN' })
        })
    }

    await request(requireApplication().getHttpServer())
      .post(`/api/sales-orders/${SALES_ORDER_ID}/add-on-lines`)
      .send({})
      .expect(403)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'FORBIDDEN' })
      })
  })
})
