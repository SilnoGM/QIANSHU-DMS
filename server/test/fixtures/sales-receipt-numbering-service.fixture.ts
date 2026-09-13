import { randomUUID } from 'node:crypto'
import type { PrismaService } from '../../src/infrastructure/database/prisma.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import { NumberingCommandService } from '../../src/modules/numbering/numbering-command.service'
import { NumberingQueryService } from '../../src/modules/numbering/numbering-query.service'

/** 仅在套件隔离库配置规则；已有规则无论启停都不改写，便于验证不可用状态。 */
export async function ensureReceiptNumberingRule(prisma: PrismaService, actorUserId: string) {
  const existing = await prisma.numberingRule.findUnique({ where: { ruleCode: 'SALES_COLLECTION' } })
  if (existing) return existing
  const service = new NumberingCommandService(prisma, new AuditService(), new NumberingQueryService(prisma))
  const context = { actorUserId, requestId: randomUUID() }
  const created = await service.create(context, {
    ruleCode: 'SALES_COLLECTION', name: '销售收款测试编号', purpose: 'BUSINESS', resetPolicy: 'NEVER',
    segments: [{ type: 'FIXED', value: 'SC' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }],
  })
  const published = await service.publish(context, created.id, { expectedVersion: created.version, draftRevision: 1 })
  await service.enable(context, created.id, { expectedVersion: published.version })
  return prisma.numberingRule.findUniqueOrThrow({ where: { id: created.id } })
}
