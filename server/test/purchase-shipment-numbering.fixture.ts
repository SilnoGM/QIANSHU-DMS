import type { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { NumberingCommandService } from '../src/modules/numbering/numbering-command.service'
import { NumberingQueryService } from '../src/modules/numbering/numbering-query.service'

export async function ensureShipmentNumberingRule(prisma: PrismaService, actorUserId: string) {
  const existing = await prisma.numberingRule.findUnique({ where: { ruleCode: 'SHIPMENT_NO' } })
  if (existing) return existing
  const commands = new NumberingCommandService(prisma, new AuditService(), new NumberingQueryService(prisma))
  const context = { actorUserId, requestId: 'shipment-numbering-fixture' }
  const created = await commands.create(context, {
    ruleCode: 'SHIPMENT_NO', purpose: 'BUSINESS', name: 'Shipment number', resetPolicy: 'NEVER',
    segments: [{ type: 'FIXED', value: 'PKG' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }],
  })
  const published = await commands.publish(context, created.id, { expectedVersion: created.version, draftRevision: 1 })
  return commands.enable(context, created.id, { expectedVersion: published.version })
}
