import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  PERSON_REFERENCE_SELECT,
  toPersonReference,
} from '../../infrastructure/database/person-reference'
import { DATA_SCOPE_ALL } from '../access-control/data-scope'
import type {
  MachineViewingDto,
  MachineViewingListQueryDto,
  MachineViewingPageDto,
} from './machine-viewing.dto'
import { formatMachineViewingDate } from './machine-viewing.logic'

const ROW_INCLUDE = {
  createdBy: { select: PERSON_REFERENCE_SELECT },
} satisfies Prisma.MachineViewingAppointmentInclude

type Row = Prisma.MachineViewingAppointmentGetPayload<{ include: typeof ROW_INCLUDE }>

type ViewerReader = Pick<Prisma.TransactionClient, 'userRole'>

/**
 * 操作者可见的预约范围。
 *
 * 权限守卫只保证「能进这个接口」；「运营仅可见本人、采运可见全部」是行级归属，
 * 必须在这层按 `data-scope:all` 判定，客户端无法用查询参数扩大范围。
 */
export interface MachineViewingViewer {
  readonly actorUserId: string
  readonly canViewAll: boolean
}

export async function resolveMachineViewingViewer(
  reader: ViewerReader,
  actorUserId: string,
): Promise<MachineViewingViewer> {
  const grant = await reader.userRole.findFirst({
    where: {
      userId: actorUserId,
      role: { permissions: { some: { permission: { code: DATA_SCOPE_ALL } } } },
    },
    select: { userId: true },
  })
  return { actorUserId, canViewAll: grant !== null }
}

export function toMachineViewingDto(row: Row): MachineViewingDto {
  const person = toPersonReference(row.createdBy)
  return {
    id: row.id,
    appointmentNo: row.appointmentNo,
    site: row.site,
    machineType: row.machineType,
    appointmentDate: formatMachineViewingDate(row.appointmentDate),
    period: row.period,
    hour: row.hour,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    contactPerson: row.contactPerson,
    createdBy: { id: person.id, name: person.displayName, avatarUrl: person.avatarUrl },
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class MachineViewingQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** 归属判定与分页在同一快照内完成，避免权限变更与列表读取之间的可见性裂缝。 */
  async listForActor(actorUserId: string, query: MachineViewingListQueryDto): Promise<MachineViewingPageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    return this.prisma.$transaction(async (transaction) => {
      const viewer = await resolveMachineViewingViewer(transaction, actorUserId)
      const where: Prisma.MachineViewingAppointmentWhereInput = viewer.canViewAll
        ? {}
        : { createdByUserId: viewer.actorUserId }
      const [rows, total] = await Promise.all([
        transaction.machineViewingAppointment.findMany({
          where,
          include: ROW_INCLUDE,
          // 编号含日期前缀与递增序号，倒序即「最新登记在前」；编号唯一，无需额外兜底键。
          orderBy: [{ appointmentNo: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        transaction.machineViewingAppointment.count({ where }),
      ])
      return { items: rows.map(toMachineViewingDto), page, pageSize, total }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }

  async findById(transaction: Prisma.TransactionClient, id: string): Promise<MachineViewingDto | null> {
    const row = await transaction.machineViewingAppointment.findUnique({
      where: { id },
      include: ROW_INCLUDE,
    })
    return row === null ? null : toMachineViewingDto(row)
  }
}
