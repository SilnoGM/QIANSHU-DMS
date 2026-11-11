import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schema = readFileSync(resolve(serverRoot, 'prisma/schema.prisma'), 'utf8')
const foundation = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261106160000_notification_center_foundation/migration.sql'),
  'utf8',
)
const permissions = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261106161000_notification_center_permissions/migration.sql'),
  'utf8',
)
const audit = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261106162000_notification_center_audit_events/migration.sql'),
  'utf8',
)
const inbox = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261108100000_notification_inbox_items/migration.sql'),
  'utf8',
)
const businessLinks = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261108110000_notification_inbox_business_links/migration.sql'),
  'utf8',
)
const bindingAvatar = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261109100000_assistant_binding_wechat_avatar/migration.sql'),
  'utf8',
)
const recordIndexes = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261111140000_notification_record_query_indexes/migration.sql'),
  'utf8',
)
const notificationNumber = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261111150000_notification_number/migration.sql'),
  'utf8',
)
const constants = readFileSync(
  resolve(serverRoot, 'src/modules/access-control/permission.constants.ts'),
  'utf8',
)

const PERMISSION_CODES = [
  'notification-template:read',
  'notification-template:update',
  'notification-policy:read',
  'notification-policy:update',
  'notification-record:read',
  'notification-record:manage',
  'assistant-channel:read',
  'assistant-channel:update',
  'assistant-account:read',
  'assistant-account:operate',
  'assistant-binding:read',
  'assistant-binding:manage',
  'assistant-target:read',
  'assistant-target:manage',
  'assistant-delivery:resend',
] as const

const AUDIT_EVENTS = [
  'NOTIFICATION_TEMPLATE_UPDATED',
  'NOTIFICATION_POLICY_UPDATED',
  'NOTIFICATION_CANCELLED',
  'ASSISTANT_CHANNEL_UPDATED',
  'ASSISTANT_CHANNEL_ENABLED',
  'ASSISTANT_CHANNEL_DISABLED',
  'ASSISTANT_ACCOUNT_LOGIN_STARTED',
  'ASSISTANT_ACCOUNT_LOGGED_IN',
  'ASSISTANT_ACCOUNT_LOGGED_OUT',
  'ASSISTANT_ACCOUNT_RECONNECTED',
  'ASSISTANT_BINDING_CREATED',
  'ASSISTANT_BINDING_VERIFIED',
  'ASSISTANT_BINDING_REVOKED',
  'ASSISTANT_BINDING_INVALIDATED',
  'ASSISTANT_DELIVERY_RESENT',
] as const

function block(kind: 'model' | 'enum', name: string): string {
  const match = schema.match(new RegExp(`${kind} ${name} \\{[\\s\\S]*?\\n\\}`, 'u'))
  if (match === null) throw new Error(`${kind} ${name} missing`)
  return match[0]
}

describe('notification center database contract', () => {
  it('declares the seven enums with snake_case storage names', () => {
    for (const [name, map] of [
      ['NotificationChannel', 'notification_channel'],
      ['NotificationPriority', 'notification_priority'],
      ['NotificationStatus', 'notification_status'],
      ['NotificationTargetMode', 'notification_target_mode'],
      ['AssistantAccountStatus', 'assistant_account_status'],
      ['AssistantBindingStatus', 'assistant_binding_status'],
      ['AssistantDeliveryStatus', 'assistant_delivery_status'],
    ] as const) {
      expect(block('enum', name)).toContain(`@@map("${map}")`)
    }
    expect(schema).not.toContain('NotificationTemplateKind')
  })

  it('declares the phase-1 tables plus the in-app inbox', () => {
    for (const name of [
      'Notification',
      'NotificationTemplate',
      'NotificationChannelPolicy',
      'NotificationSettings',
      'NotificationChannelSettings',
      'AssistantAccount',
      'AssistantBinding',
      'AssistantTarget',
      'AssistantDelivery',
      'AssistantDispatchLease',
      'NotificationInboxItem',
    ]) {
      expect(() => block('model', name)).not.toThrow()
    }
    expect(schema).not.toContain('model AssistantCallbackEvent')
  })

  it('creates and seeds the in-app inbox', () => {
    expect(inbox).toContain('CREATE TABLE "notification_inbox_items"')
    expect(inbox).toContain('notification_inbox_items_notification_user_key')
    expect(inbox).toContain('notification_inbox_items_user_archived_created_idx')
    expect(inbox).toContain("VALUES ('IN_APP', true)")
    expect(inbox).toContain("'purchase.review.pending'")
    expect(inbox).toContain("'invoice.review.pending'")
    expect(inbox).toContain("'shipment.arrived'")
  })

  it('adds the binding WeChat avatar snapshot column', () => {
    expect(schema).toContain('wechatAvatarUrl')
    expect(bindingAvatar).toContain('ADD COLUMN "wechat_avatar_url" TEXT')
  })

  it('adds business detail links and their ID variables to the in-app templates', () => {
    expect(businessLinks).toContain("'/qs-operations/purchase/purchase-orders?id={{orderId}}'")
    expect(businessLinks).toContain("'/qs-operations/invoices/records?id={{invoiceRequestId}}'")
    expect(businessLinks).toContain("'/qs-operations/warehouse-transport/warehouse-arrivals?orderId={{orderId}}'")
    expect(businessLinks).toContain('"name":"orderId"')
    expect(businessLinks).toContain('"name":"invoiceRequestId"')
  })

  it('adds record list and per-notification lookup indexes', () => {
    expect(recordIndexes).toContain('notifications_published_idx')
    expect(recordIndexes).toContain('notifications_status_published_idx')
    expect(recordIndexes).toContain('notification_inbox_items_notification_idx')
    expect(recordIndexes).toContain('assistant_deliveries_notification_idx')
  })

  it('binds new notifications to the NOTIFICATION_NO numbering rule', () => {
    const notificationModel = schema.match(/model Notification \{([\s\S]*?)\n\}/u)?.[1] ?? ''
    expect(notificationModel).toContain('notificationNo')
    expect(notificationModel).toContain('@map("notification_no") @db.VarChar(64)')
    expect(notificationModel).toContain('numberingIssuanceId')
    expect(notificationModel).toContain('notifications_number_key')
    expect(notificationModel).toContain('notifications_numbering_issuance_id_key')
    expect(schema).toMatch(/model NumberingIssuance \{[\s\S]*?notification Notification\?/u)

    expect(notificationNumber).toContain('ADD COLUMN "notification_no" VARCHAR(64)')
    expect(notificationNumber).toContain('ADD COLUMN "numbering_issuance_id" UUID')
    expect(notificationNumber).toContain('"notifications_number_key" UNIQUE ("notification_no")')
    expect(notificationNumber).toContain('"notifications_numbering_issuance_id_key"')
    expect(notificationNumber).toContain('"notifications_number_format_check"')
    expect(notificationNumber).toContain(`CHECK ("notification_no" IS NULL OR "notification_no" ~ '^NTF/[0-9]{8}-[0-9]{6}$')`)
    expect(notificationNumber).toContain(`'NOTIFICATION_NO'`)
    expect(notificationNumber).toContain(`'NTF'`)
    expect(notificationNumber).toContain(`'YYYYMMDD'`)
    expect(notificationNumber).toContain(
      `75b357194ff2ee76a33a43bedb272b64e95eb174fd9cb33b9a8f48f23ca29c97`,
    )
    expect(notificationNumber).toContain('"status" = \'ENABLED\'')
  })

  it('adds exclusive delivery targets, partial unique indexes and seeds', () => {
    expect(foundation).toContain('assistant_deliveries_target_exclusive_check')
    expect(foundation).toContain('assistant_deliveries_notification_recipient_key')
    expect(foundation).toContain('WHERE "recipient_user_id" IS NOT NULL')
    expect(foundation).toContain('assistant_deliveries_notification_target_key')
    expect(foundation).toContain('WHERE "target_id" IS NOT NULL')
    expect(foundation).toContain('notification_channel_policies_channel_shape_check')
    expect(foundation).toContain('notification_settings_retention_check')
    expect(foundation).toContain('INSERT INTO "notification_channel_settings"')
    expect(foundation).toContain("'ASSISTANT'")
    expect(foundation).toContain('INSERT INTO "assistant_dispatch_leases"')
  })

  it('seeds the fifteen permissions and grants system_admin', () => {
    for (const code of PERMISSION_CODES) {
      expect(constants).toContain(`'${code}'`)
      expect(permissions).toContain(`'${code}'`)
    }
    expect(permissions).toContain('WHERE role."code" = \'system_admin\'')
  })

  it('adds the fifteen audit events', () => {
    for (const event of AUDIT_EVENTS) {
      expect(schema).toContain(`  ${event}`)
      expect(audit).toContain(`ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS '${event}'`)
    }
  })
})
