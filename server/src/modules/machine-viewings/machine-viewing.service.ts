import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { AuditEventType } from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { AuditService } from '../audit/audit.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import {
  MACHINE_VIEWING_NO_CONSUMER_CODE,
  MACHINE_VIEWING_NO_RULE_CODE,
} from './machine-viewing.contract'
import type { CreateMachineViewingDto, MachineViewingDto } from './machine-viewing.dto'
import {
  MACHINE_VIEWING_ERROR_CODES,
  machineViewingFailure,
  mapMachineViewingError,
} from './machine-viewing.errors'
import {
  hashMachineViewingNumberFingerprint,
  hashMachineViewingRequestKey,
  MachineViewingValidationError,
  normalizeMachineViewingCreate,
  requireMachineViewingRequestKey,
  sameMachineViewingPayload,
  type NormalizedMachineViewingCreate,
} from './machine-viewing.logic'
import { MachineViewingQueryService } from './machine-viewing-query.service'

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

@Injectable()
export class MachineViewingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: MachineViewingQueryService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingGeneratorService,
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
        return await this.requireDto(transaction, created.id)
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
