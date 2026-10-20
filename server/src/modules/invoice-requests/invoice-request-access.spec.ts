import type { Prisma } from '../../generated/prisma/client'
import { resolveInvoiceRequestViewer } from './invoice-request-access'

function reader(found: { userId: string } | null) {
  const findFirst = jest.fn().mockResolvedValue(found)
  return {
    findFirst,
    value: {
      userRole: { findFirst },
    } as unknown as Pick<Prisma.TransactionClient, 'userRole'>,
  }
}

describe('resolveInvoiceRequestViewer', () => {
  it('marks a read-all or global-all holder as a cross-submitter manager', async () => {
    const fixture = reader({ userId: 'actor' })
    await expect(resolveInvoiceRequestViewer(fixture.value, 'actor'))
      .resolves.toEqual({ actorUserId: 'actor', canManageOthers: true })
    const query = (fixture.findFirst.mock.calls as unknown[][])[0]?.[0] as {
      where: { role: { permissions: { some: { permission: { code: { in: string[] } } } } } }
    }
    expect(query.where.role.permissions.some.permission.code.in).toEqual([
      'invoice-requests:read-all',
      'data-scope:all',
    ])
  })

  it('keeps a viewer without either permission on the owner-only default', async () => {
    const fixture = reader(null)
    await expect(resolveInvoiceRequestViewer(fixture.value, 'actor'))
      .resolves.toEqual({ actorUserId: 'actor', canManageOthers: false })
  })
})
