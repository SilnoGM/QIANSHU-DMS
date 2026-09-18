import type { PrismaService } from '../src/infrastructure/database/prisma.service'

export const TEST_DESTINATION_WAREHOUSE = 'E2E-MAINLAND'
export const OTHER_DESTINATION_WAREHOUSE = 'E2E-SECOND'

/** 仓库条目属于用户配置数据；隔离测试显式创建有效字典，不依赖生产数据或迁移预填。 */
export async function ensureDestinationWarehouseDictionary(prisma: PrismaService) {
  const type = await prisma.dictionaryType.upsert({
    where: { code: 'mainland.warehouse' },
    create: { code: 'mainland.warehouse', name: '大陆仓库', enabled: false },
    update: {},
  })
  for (const [value, label] of [[TEST_DESTINATION_WAREHOUSE, '大陆测试仓库'], [OTHER_DESTINATION_WAREHOUSE, '第二测试仓库']]) {
    await prisma.dictionaryItem.upsert({
      where: { dictionaryTypeId_value: { dictionaryTypeId: type.id, value } },
      create: { dictionaryTypeId: type.id, value, label, enabled: true },
      update: { label, enabled: true },
    })
  }
  return prisma.dictionaryType.update({ where: { id: type.id }, data: { enabled: true } })
}

export function destinationWarehouses(partIds: readonly string[], warehouseValue = TEST_DESTINATION_WAREHOUSE) {
  return partIds.map(partId => ({ partId, warehouseValue }))
}
