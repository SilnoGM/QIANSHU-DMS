import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ShipmentOwnershipParityService } from './shipment-ownership-parity.service'

const SALES_ORDER_ID = '00000000-0000-4000-8000-000000000401'

describe('ShipmentOwnershipParityService', () => {
  it('reports missing, owner and state differences while counting matches', async () => {
    const prisma = {
      purchaseOrderPart: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'matched',
            status: 'ACTIVE',
            purchaseOrder: { purchaseType: 'SALES_LINKED', salesOrderId: SALES_ORDER_ID },
            ownershipCurrent: { ownerType: 'SALES_ORDER', ownerSalesOrderId: SALES_ORDER_ID, state: 'ACTIVE' },
          },
          {
            id: 'missing',
            status: 'ACTIVE',
            purchaseOrder: { purchaseType: 'SALES_LINKED', salesOrderId: SALES_ORDER_ID },
            ownershipCurrent: null,
          },
          {
            id: 'owner-mismatch',
            status: 'ACTIVE',
            purchaseOrder: { purchaseType: 'SALES_LINKED', salesOrderId: SALES_ORDER_ID },
            ownershipCurrent: { ownerType: 'COMPANY', ownerSalesOrderId: null, state: 'ACTIVE' },
          },
          {
            id: 'state-mismatch',
            status: 'CANCELLED',
            purchaseOrder: { purchaseType: 'SALES_LINKED', salesOrderId: SALES_ORDER_ID },
            ownershipCurrent: { ownerType: 'SALES_ORDER', ownerSalesOrderId: SALES_ORDER_ID, state: 'ACTIVE' },
          },
        ]),
      },
    } as unknown as PrismaService

    const result = await new ShipmentOwnershipParityService(prisma).run(10)

    expect(result.total).toBe(4)
    expect(result.matched).toBe(1)
    expect(result.differences).toBe(3)
    expect(result.samples.map(sample => sample.kind)).toEqual(['MISSING', 'OWNER', 'STATE'])
  })

  it('treats STOCK parts as COMPANY ownership', async () => {
    const prisma = {
      purchaseOrderPart: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'stock',
          status: 'ACTIVE',
          purchaseOrder: { purchaseType: 'STOCK', salesOrderId: null },
          ownershipCurrent: { ownerType: 'COMPANY', ownerSalesOrderId: null, state: 'ACTIVE' },
        }]),
      },
    } as unknown as PrismaService

    const result = await new ShipmentOwnershipParityService(prisma).run(10)

    expect(result).toEqual({ total: 1, matched: 1, differences: 0, samples: [] })
  })
})
