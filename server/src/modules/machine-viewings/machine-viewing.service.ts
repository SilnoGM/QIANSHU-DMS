import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { AuditEventType } from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { AuditService } from '../audit/audit.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { noopSystemNotifications } from '../notifications/noop-system-notification'
import { SystemNotificationService } from '../notifications/system-notification.service'
import {
  machineViewingMachineTypeLabel,
  machineViewingPeriodLabel,
  machineViewingSiteLabel,
  machineViewingStatusLabel,
} from '../notifications/notification-display-labels'
import {
  MACHINE_VIEWING_EDITABLE_STATUS_VALUES,
  MACHINE_VIEWING_NO_CONSUMER_CODE,
  MACHINE_VIEWING_NO_RULE_CODE,
} from './machine-viewing.contract'
import type {
  CreateMachineViewingDto,
  MachineViewingDto,
  MachineViewingStatusTransitionDto,
  UpdateMachineViewingDto,
} from './machine-viewing.dto'
import {
  MACHINE_VIEWING_ERROR_CODES,
  machineViewingFailure,
  mapMachineViewingError,
} from './machine-viewing.errors'
import {
  formatMachineViewingDate,
  hashMachineViewingNumberFingerprint,
  hashMachineViewingRequestKey,
  MachineViewingValidationError,
  machineViewingChangeEntries,
  normalizeMachineViewingCreate,
  normalizeMachineViewingStatusTransition,
  normalizeMachineViewingUpdate,
  requireMachineViewingRequestKey,
  resolveMachineViewingTransition,
  sameMachineViewingPayload,
  type NormalizedMachineViewingCreate,
} from './machine-viewing.logic'
import {
  MachineViewingQueryService,
  resolveMachineViewingViewer,
  type MachineViewingViewer,
} from './machine-viewing-query.service'

export interface MachineViewingCommandContext {
  readonly actorUserId: string
  readonly requestId: string
}

function translateValidation(error: unknown): never {
  if (error instanceof MachineViewingValidationError) {
    machineViewingFailure(MACHINE_VIEWING_ERROR_CODES.VALIDATION_FAILED, error.message)
  }
  throw error
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function requireMachineViewingId(value: string): string {
  if (!UUID_V4_PATTERN.test(value)) {
    machineViewingFailure(MACHINE_VIEWING_ERROR_CODES.VALIDATION_FAILED, '看机预约 ID 无效')
  }
  return value.toLowerCase()
}

/** 编辑与状态流转都要锁行，且 SELF 范围下「他人预约」与「不存在」返回同一个 404。 */
function scopeSql(viewer: MachineViewingViewer): Prisma.Sql {
  return viewer.canViewAll
    ? Prisma.sql``
    : Prisma.sql`AND "created_by_user_id" = CAST(${viewer.actorUserId} AS uuid)`
}

const EDITABLE_SELECT = {
  id: true,
  appointmentNo: true,
  site: true,
  machineType: true,
  appointmentDate: true,
  period: true,
  hour: true,
  customerName: true,
  customerPhone: true,
  contactPerson: true,
  status: true,
  feedback: true,
} satisfies Prisma.MachineViewingAppointmentSelect

@Injectable()
export class MachineViewingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: MachineViewingQueryService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingGeneratorService,
    private readonly notifications: SystemNotificationService = noopSystemNotifications,
  ) {}

  async create(
    context: MachineViewingCommandContext,
    input: CreateMachineViewingDto,
    idempotencyKey: unknown,
    now: Date = new Date(),
  ): Promise<MachineViewingDto> {
    let requestKey: string
    let normalized: NormalizedMachineViewingCreate
    try {
      requestKey = requireMachineViewingRequestKey(idempotencyKey)
      normalized = normalizeMachineViewingCreate(input, now)
    }
    catch (error) {
      translateValidation(error)
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        await transaction.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${['machine-viewing.create:', context.actorUserId, ':', requestKey].join('')}, 0)
          )
        `)
        const requestKeyHash = hashMachineViewingRequestKey(requestKey)
        const previous = await transaction.machineViewingAppointment.findUnique({
          where: { createdByUserId_requestKeyHash: { createdByUserId: context.actorUserId, requestKeyHash } },
          select: {
            id: true,
            site: true,
            machineType: true,
            appointmentDate: true,
            period: true,
            hour: true,
            customerName: true,
            customerPhone: true,
            contactPerson: true,
          },
        })
        if (previous !== null) {
          if (!sameMachineViewingPayload(previous, normalized)) {
            machineViewingFailure(
              MACHINE_VIEWING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
              '同一个提交标识已用于不同的看机预约',
              409,
            )
          }
          return await this.requireDto(transaction, previous.id)
        }

        const appointmentDate = normalized.appointmentDate.toISOString().slice(0, 10)
        const issuance = await this.numbering.generateScopedInTransaction(transaction, {
          ruleCode: MACHINE_VIEWING_NO_RULE_CODE,
          consumerCode: MACHINE_VIEWING_NO_CONSUMER_CODE,
          idempotencyKey: [context.actorUserId, ':', requestKey].join(''),
          requestFingerprint: hashMachineViewingNumberFingerprint({
            actorUserId: context.actorUserId,
            site: normalized.site,
            machineType: normalized.machineType,
            appointmentDate,
            period: normalized.period,
            hour: normalized.hour,
            customerName: normalized.customerName,
            customerPhone: normalized.customerPhone,
            contactPerson: normalized.contactPerson,
            requestKey,
          }),
        })
        const created = await transaction.machineViewingAppointment.create({
          data: {
            appointmentNo: issuance.number,
            numberingIssuanceId: issuance.issuanceId,
            site: normalized.site,
            machineType: normalized.machineType,
            appointmentDate: normalized.appointmentDate,
            period: normalized.period,
            hour: normalized.hour,
            customerName: normalized.customerName,
            customerPhone: normalized.customerPhone,
            contactPerson: normalized.contactPerson,
            createdByUserId: context.actorUserId,
            requestKeyHash,
          },
          select: { id: true },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.MACHINE_VIEWING_APPOINTMENT_CREATED,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'MACHINE_VIEWING_APPOINTMENT',
          targetId: created.id,
          metadata: {
            appointmentNo: issuance.number,
            site: normalized.site,
            machineType: normalized.machineType,
            appointmentDate,
            period: normalized.period,
            hour: normalized.hour,
            customerName: normalized.customerName,
          },
        })
        await this.notifications.publish({
          eventType: 'MACHINE_VIEWING_APPOINTMENT_CREATED',
          source: { type: 'MACHINE_VIEWING_APPOINTMENT', id: created.id },
          target: { kind: 'ROLE', roleCodes: ['purchasing_staff'] },
          templateKey: 'operations.machine-viewing.created',
          variables: {
            appointmentDate,
            appointmentNo: issuance.number,
            contactPerson: normalized.contactPerson,
            customerName: normalized.customerName,
            customerPhone: normalized.customerPhone ?? '—',
            hour: normalized.hour ?? null,
            machineType: machineViewingMachineTypeLabel(normalized.machineType),
            period: machineViewingPeriodLabel(normalized.period),
            site: machineViewingSiteLabel(normalized.site),
            status: machineViewingStatusLabel('PENDING_APPOINTMENT'),
          },
          dedupeKey: `machine-viewing-created:${created.id}`,
          priority: 'NORMAL',
          requestedByUserId: context.actorUserId,
        }, { transaction })
        return await this.requireDto(transaction, created.id)
      }, { timeout: 30_000 })
    }
    catch (error) {
      return mapMachineViewingError(error)
    }
  }

  /**
   * 编辑预约内容：预约编号、提交人、提交时间都不可变；日期由前端传完整值，
   * 服务端只负责校验真实日期与今年/明年范围，避免二次推断年份。
   */
  async update(
    context: MachineViewingCommandContext,
    rawId: string,
    input: UpdateMachineViewingDto,
    now: Date = new Date(),
  ): Promise<MachineViewingDto> {
    const id = requireMachineViewingId(rawId)
    let normalized: NormalizedMachineViewingCreate
    try {
      normalized = normalizeMachineViewingUpdate(input, now)
    }
    catch (error) {
      translateValidation(error)
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const viewer = await resolveMachineViewingViewer(transaction, context.actorUserId)
        await transaction.$queryRaw(Prisma.sql`
          SELECT "id" FROM "machine_viewing_appointments"
          WHERE "id" = ${id}::uuid ${scopeSql(viewer)}
          FOR UPDATE
        `)
        const previous = await transaction.machineViewingAppointment.findFirst({
          where: {
            id,
            ...(viewer.canViewAll ? {} : { createdByUserId: viewer.actorUserId }),
          },
          select: EDITABLE_SELECT,
        })
        if (previous === null) {
          machineViewingFailure(MACHINE_VIEWING_ERROR_CODES.NOT_FOUND, '看机预约不存在', 404)
        }
        if (!(MACHINE_VIEWING_EDITABLE_STATUS_VALUES as readonly string[]).includes(previous.status)) {
          machineViewingFailure(MACHINE_VIEWING_ERROR_CODES.STATE_CHANGED, '当前状态不允许编辑预约', 409)
        }
        const changes = machineViewingChangeEntries(previous, normalized)
        const changedFields = changes.map(entry => entry.field)
        if (changedFields.length === 0) {
          return await this.requireDto(transaction, id)
        }
        // 审计元数据只接受标量：把每个变化拍平成 `previousX` / `x` 两个键，
        // 既保留前后值，又不触发结构化元数据的白名单限制。
        const changeMetadata: Record<string, string | null> = {}
        for (const entry of changes) {
          const suffix = `${entry.field.charAt(0).toUpperCase()}${entry.field.slice(1)}`
          changeMetadata[`previous${suffix}`] = entry.from
          changeMetadata[entry.field] = entry.to
        }

        await transaction.machineViewingAppointment.update({
          where: { id },
          data: {
            site: normalized.site,
            machineType: normalized.machineType,
            appointmentDate: normalized.appointmentDate,
            period: normalized.period,
            hour: normalized.hour,
            customerName: normalized.customerName,
            customerPhone: normalized.customerPhone,
            contactPerson: normalized.contactPerson,
          },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.MACHINE_VIEWING_APPOINTMENT_UPDATED,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'MACHINE_VIEWING_APPOINTMENT',
          targetId: id,
          metadata: {
            appointmentNo: previous.appointmentNo,
            changedFields: changedFields.join(','),
            status: previous.status,
            appointmentDate: formatMachineViewingDate(normalized.appointmentDate),
            ...changeMetadata,
          },
        })
        return await this.requireDto(transaction, id)
      }, { timeout: 30_000 })
    }
    catch (error) {
      return mapMachineViewingError(error)
    }
  }

  /**
   * 状态流转与反馈录入共用同一入口：同一状态重复提交按幂等处理，已反馈允许
   * 原地修改反馈；取消原因只进审计，不写入反馈字段。
   */
  async transition(
    context: MachineViewingCommandContext,
    rawId: string,
    input: MachineViewingStatusTransitionDto,
  ): Promise<MachineViewingDto> {
    const id = requireMachineViewingId(rawId)
    let normalized: ReturnType<typeof normalizeMachineViewingStatusTransition>
    try {
      normalized = normalizeMachineViewingStatusTransition(input)
    }
    catch (error) {
      translateValidation(error)
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const viewer = await resolveMachineViewingViewer(transaction, context.actorUserId)
        await transaction.$queryRaw(Prisma.sql`
          SELECT "id" FROM "machine_viewing_appointments"
          WHERE "id" = ${id}::uuid ${scopeSql(viewer)}
          FOR UPDATE
        `)
        const previous = await transaction.machineViewingAppointment.findFirst({
          where: {
            id,
            ...(viewer.canViewAll ? {} : { createdByUserId: viewer.actorUserId }),
          },
          select: EDITABLE_SELECT,
        })
        if (previous === null) {
          machineViewingFailure(MACHINE_VIEWING_ERROR_CODES.NOT_FOUND, '看机预约不存在', 404)
        }

        const action = resolveMachineViewingTransition(previous.status, normalized.status)
        if (action === 'NOOP') {
          return await this.requireDto(transaction, id)
        }
        if (action === 'INVALID') {
          machineViewingFailure(MACHINE_VIEWING_ERROR_CODES.STATE_CHANGED, '当前状态不能流转到目标状态', 409)
        }

        if (action === 'FEEDBACK_EDIT') {
          if (previous.feedback === normalized.feedback) {
            return await this.requireDto(transaction, id)
          }
          await transaction.machineViewingAppointment.update({
            where: { id },
            data: { feedback: normalized.feedback },
          })
          await this.audit.record(transaction, {
            eventType: AuditEventType.MACHINE_VIEWING_APPOINTMENT_UPDATED,
            outcome: 'SUCCESS',
            actorType: 'USER',
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            targetType: 'MACHINE_VIEWING_APPOINTMENT',
            targetId: id,
            metadata: {
              appointmentNo: previous.appointmentNo,
              changedFields: 'feedback',
              status: previous.status,
              feedback: normalized.feedback,
            },
          })
          return await this.requireDto(transaction, id)
        }

        await transaction.machineViewingAppointment.update({
          where: { id },
          data: normalized.status === 'FEEDBACK_GIVEN'
            ? { status: normalized.status, feedback: normalized.feedback }
            : { status: normalized.status },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.MACHINE_VIEWING_APPOINTMENT_STATUS_CHANGED,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'MACHINE_VIEWING_APPOINTMENT',
          targetId: id,
          metadata: {
            appointmentNo: previous.appointmentNo,
            fromStatus: previous.status,
            toStatus: normalized.status,
            ...(normalized.feedback === null ? {} : { feedback: normalized.feedback }),
            ...(normalized.cancelReason === null ? {} : { cancelReason: normalized.cancelReason }),
          },
        })
        return await this.requireDto(transaction, id)
      }, { timeout: 30_000 })
    }
    catch (error) {
      return mapMachineViewingError(error)
    }
  }

  private async requireDto(transaction: Prisma.TransactionClient, id: string): Promise<MachineViewingDto> {
    const dto = await this.queries.findById(transaction, id)
    if (dto === null) {
      machineViewingFailure(MACHINE_VIEWING_ERROR_CODES.INTERNAL_ERROR, '看机预约写入后无法读取', 500)
    }
    return dto
  }
}
