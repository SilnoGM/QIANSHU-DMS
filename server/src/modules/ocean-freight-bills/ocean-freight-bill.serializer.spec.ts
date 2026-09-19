import { Prisma, type OceanFreightBill, type OceanFreightBillLine } from '../../generated/prisma/client'
import { serializeBill, serializeBillLine } from './ocean-freight-bill.serializer'

describe('ocean freight decimal response', () => {
  it('keeps very small rates and source volumes in fixed decimal notation', () => {
    const dates = { createdAt: new Date(), updatedAt: new Date() }
    const bill = serializeBill({ ...dates, twdPerCny: new Prisma.Decimal('0.000000000001') } as OceanFreightBill)
    expect(bill.twdPerCny).toBe('0.000000000001')
    const line = serializeBillLine({ ...dates, lineType: 'NORMAL', reportedVolumeCai: new Prisma.Decimal('0.00000001') } as OceanFreightBillLine)
    expect(line.reportedVolumeCai).toBe('0.00000001')
  })
  it('preserves all stored precision when comparing source and calculated volume', () => {
    const line = serializeBillLine({ createdAt: new Date(), updatedAt: new Date(), lineType: 'NORMAL',
      volumeCai: new Prisma.Decimal('12.88272063'), reportedVolumeCai: new Prisma.Decimal('9999999999999999.12345678'),
    } as OceanFreightBillLine)
    expect(line.volumeDifferenceCai).toBe('-9999999999999986.24073615')
  })
})
