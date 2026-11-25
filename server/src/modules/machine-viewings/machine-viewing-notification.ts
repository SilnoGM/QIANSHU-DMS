import type { Prisma } from '../../generated/prisma/client'
import {
  machineViewingMachineTypeLabel,
  machineViewingPeriodLabel,
  machineViewingSiteLabel,
  machineViewingStatusLabel,
} from '../notifications/notification-display-labels'
import {
  renderNotificationTemplate,
  type NotificationTemplateVariable,
} from '../notifications/notification-template.renderer'
import type { SystemNotificationService } from '../notifications/system-notification.service'
import type { SystemNotificationPublishResult } from '../notifications/notification.types'
import {
  formatMachineViewingDate,
  shanghaiCalendarDate,
} from './machine-viewing.logic'

export const MACHINE_VIEWING_NOTIFICATION_TIME_MINUTES = 8 * 60 + 30

export interface MachineViewingNoticeAppointment {
  readonly id: string
  readonly appointmentNo: string
  readonly appointmentDate: Date
  readonly period: string
  readonly hour: number | null
  readonly site: string
  readonly machineType: string
  readonly customerName: string
  readonly customerPhone: string | null
  readonly contactPerson: string
  readonly scheduleRevision: number
}

export interface MachineViewingManualNotificationText {
  readonly title: string | null
  readonly body: string
}

/** 手动文案不可用属于可预期业务失败，由服务层翻译为 422。 */
export class MachineViewingNotificationTextUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MachineViewingNotificationTextUnavailableError'
  }
}

function shanghaiDateKey(now: Date): string {
  const parts = shanghaiCalendarDate(now)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function isMachineViewingToday(appointmentDate: Date, now: Date): boolean {
  return formatMachineViewingDate(appointmentDate) === shanghaiDateKey(now)
}

/** 08:30 之前不发送当天的批量通知；之后 any time 都允许补跑。 */
export function isMachineViewingNotificationTimeReached(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).formatToParts(now)
  const hour = Number(parts.find(part => part.type === 'hour')?.value)
  const minute = Number(parts.find(part => part.type === 'minute')?.value)
  return Number.isSafeInteger(hour) && Number.isSafeInteger(minute)
    && hour * 60 + minute >= MACHINE_VIEWING_NOTIFICATION_TIME_MINUTES
}

/** 通知文案统一用「今日 / M月D日 + 时段 + 可选小时」。 */
export function formatMachineViewingNoticeTime(
  appointmentDate: Date,
  period: string,
  hour: number | null,
  now: Date,
): string {
  const dateKey = formatMachineViewingDate(appointmentDate)
  const [, monthText, dayText] = dateKey.split('-')
  const month = Number(monthText)
  const day = Number(dayText)
  const dateLabel = isMachineViewingToday(appointmentDate, now)
    ? '今日'
    : `${month}月${day}日`
  const hourLabel = hour === null ? '' : ` ${hour}点`
  return `${dateLabel} ${machineViewingPeriodLabel(period)}${hourLabel}`
}

export function appointmentNotificationDedupeKey(id: string, revision: number): string {
  return `machine-viewing-notified:${id}:r${revision}`
}

export function rescheduleNotificationDedupeKey(id: string, revision: number): string {
  return `machine-viewing-rescheduled:${id}:r${revision}`
}

export function appointmentNotificationVariables(
  appointment: MachineViewingNoticeAppointment,
): Readonly<Record<string, string | number | null>> {
  return {
    appointmentDate: formatMachineViewingDate(appointment.appointmentDate),
    appointmentNo: appointment.appointmentNo,
    contactPerson: appointment.contactPerson,
    customerName: appointment.customerName,
    customerPhone: appointment.customerPhone ?? '—',
    hour: appointment.hour,
    machineType: machineViewingMachineTypeLabel(appointment.machineType),
    period: machineViewingPeriodLabel(appointment.period),
    site: machineViewingSiteLabel(appointment.site),
    status: machineViewingStatusLabel('PENDING_APPOINTMENT'),
  }
}

export function rescheduleNotificationVariables(
  previous: MachineViewingNoticeAppointment,
  next: MachineViewingNoticeAppointment,
  now: Date,
): Readonly<Record<string, string | number | null>> {
  return {
    appointmentNo: next.appointmentNo,
    appointmentTime: formatMachineViewingNoticeTime(next.appointmentDate, next.period, next.hour, now),
    contactPerson: next.contactPerson,
    customerName: next.customerName,
    machineType: machineViewingMachineTypeLabel(next.machineType),
    previousAppointmentTime: formatMachineViewingNoticeTime(
      previous.appointmentDate,
      previous.period,
      previous.hour,
      now,
    ),
    site: machineViewingSiteLabel(next.site),
  }
}

async function isNotificationAccepted(
  transaction: Prisma.TransactionClient,
  result: SystemNotificationPublishResult,
): Promise<boolean> {
  const notification = await transaction.notification.findUnique({
    where: { id: result.notificationId },
    select: { status: true },
  })
  return notification !== null
    && (notification.status === 'PENDING'
      || notification.status === 'COMPLETED'
      || notification.status === 'PARTIAL')
}

export async function publishAppointmentNotification(
  transaction: Prisma.TransactionClient,
  notifications: SystemNotificationService,
  appointment: MachineViewingNoticeAppointment,
  now: Date,
  requestedByUserId?: string,
): Promise<boolean> {
  const result = await notifications.publish({
    eventType: 'MACHINE_VIEWING_APPOINTMENT_CREATED',
    source: { type: 'MACHINE_VIEWING_APPOINTMENT', id: appointment.id },
    target: { kind: 'ROLE', roleCodes: ['purchasing_staff'] },
    templateKey: 'operations.machine-viewing.created',
    variables: appointmentNotificationVariables(appointment),
    dedupeKey: appointmentNotificationDedupeKey(appointment.id, appointment.scheduleRevision),
    priority: 'NORMAL',
    ...(requestedByUserId === undefined ? {} : { requestedByUserId }),
  }, { transaction, now })
  return isNotificationAccepted(transaction, result)
}

export async function publishRescheduleNotification(
  transaction: Prisma.TransactionClient,
  notifications: SystemNotificationService,
  previous: MachineViewingNoticeAppointment,
  next: MachineViewingNoticeAppointment,
  now: Date,
  requestedByUserId?: string,
): Promise<boolean> {
  const result = await notifications.publish({
    eventType: 'MACHINE_VIEWING_APPOINTMENT_RESCHEDULED',
    source: { type: 'MACHINE_VIEWING_APPOINTMENT', id: next.id },
    target: { kind: 'ROLE', roleCodes: ['purchasing_staff'] },
    templateKey: 'operations.machine-viewing.rescheduled',
    variables: rescheduleNotificationVariables(previous, next, now),
    dedupeKey: rescheduleNotificationDedupeKey(next.id, next.scheduleRevision),
    priority: 'NORMAL',
    ...(requestedByUserId === undefined ? {} : { requestedByUserId }),
  }, { transaction, now })
  return isNotificationAccepted(transaction, result)
}

function parseTemplateVariables(value: Prisma.JsonValue): NotificationTemplateVariable[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(item => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }
    const record = item as Record<string, unknown>
    if (typeof record.name !== 'string' || record.name.length === 0) {
      return []
    }
    return [{
      name: record.name,
      required: record.required === true,
      sensitive: record.sensitive === true,
      ...(typeof record.maxLength === 'number' ? { maxLength: record.maxLength } : {}),
    }]
  })
}

/**
 * 手动标记只生成可复制的文案，不发布通知；优先取站内模板标题和企业微信纯文本正文。
 */
export async function renderManualAppointmentNotificationText(
  transaction: Prisma.TransactionClient,
  appointment: MachineViewingNoticeAppointment,
): Promise<MachineViewingManualNotificationText> {
  const templates = await transaction.notificationTemplate.findMany({
    where: {
      key: 'operations.machine-viewing.created',
      channel: { in: ['IN_APP', 'WECOM'] },
      enabled: true,
    },
    select: {
      bodyTemplate: true,
      channel: true,
      linkUrlTemplate: true,
      maxLength: true,
      titleTemplate: true,
      variables: true,
    },
  })
  const inApp = templates.find(template => template.channel === 'IN_APP')
  const wecom = templates.find(template => template.channel === 'WECOM')
  const bodyTemplate = wecom ?? inApp
  if (bodyTemplate === undefined) {
    throw new MachineViewingNotificationTextUnavailableError('看机预约通知模板不可用')
  }
  const variables = appointmentNotificationVariables(appointment)
  const body = renderNotificationTemplate({
    body: bodyTemplate.bodyTemplate,
    linkUrlTemplate: bodyTemplate.linkUrlTemplate,
    variables,
    allowed: parseTemplateVariables(bodyTemplate.variables),
    allowSensitive: true,
    maxLength: bodyTemplate.maxLength,
  })
  if (!body.ok) {
    throw new MachineViewingNotificationTextUnavailableError(body.message)
  }
  let title: string | null = null
  if (inApp?.titleTemplate) {
    const renderedTitle = renderNotificationTemplate({
      body: inApp.titleTemplate,
      variables,
      allowed: parseTemplateVariables(inApp.variables),
      allowSensitive: true,
      maxLength: inApp.maxLength,
    })
    if (!renderedTitle.ok) {
      throw new MachineViewingNotificationTextUnavailableError(renderedTitle.message)
    }
    title = renderedTitle.content
  }
  return { title, body: body.content }
}
