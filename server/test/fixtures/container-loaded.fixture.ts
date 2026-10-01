import { Prisma } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/infrastructure/database/prisma.service'

/**
 * 关联即已装柜：数据库触发器要求装柜明细落库前必须存在装柜事实。
 * 直接写库的用例（对账、运营侧读取）用它补齐事实；服务端写入路径由 container-load-fact 负责，两者语义一致。
 */
export async function markShipmentsContainerLoaded(
  client: PrismaService | Prisma.TransactionClient,
  shipmentIds: readonly string[],
  actorUserId: string,
): Promise<void> {
  const ids = [...new Set(shipmentIds)].sort()
  if (!ids.length) return
  await client.$executeRaw(Prisma.sql`
    UPDATE purchase_order_parts
       SET loaded_at = clock_timestamp(), loaded_by_id = ${actorUserId}::uuid, loaded_recorded_at = clock_timestamp()
     WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) AND loaded_at IS NULL`)
}
