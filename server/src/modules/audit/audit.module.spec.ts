import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuditQueryService } from './audit-query.service'
import { AuditController } from './audit.controller'
import { AuditModule } from './audit.module'

describe('AuditModule metadata', () => {
  it('registers only the read API and its Prisma dependency', () => {
    expect(Reflect.getMetadata('imports', AuditModule)).toEqual([
      PrismaModule,
    ])
    expect(Reflect.getMetadata('controllers', AuditModule)).toEqual([
      AuditController,
    ])
    expect(Reflect.getMetadata('providers', AuditModule)).toEqual([
      AuditQueryService,
    ])
  })
})
