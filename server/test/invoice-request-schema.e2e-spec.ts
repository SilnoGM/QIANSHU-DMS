import { randomBytes, randomUUID } from 'node:crypto'

import { Client } from 'pg'

import {
  insertInvoiceDocumentAsset,
  insertInvoiceRequest,
  insertInvoiceRequestIssuance,
  insertInvoiceRequestLine,
  insertStatusHistory,
  insertUser,
} from './fixtures/invoice-request.fixture'

/**
 * 隔离的 PostgreSQL 上验证开票申请的状态机、可编辑性、留痕与媒体引用不变量。
 *
 * 每条语句都以内联字面量传给 client.query（不做任何字符串拼接或变量转发），
 * 业务值一律走 $N 参数；savepoint 名固定，因此也不需要动态拼接。
 */

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for Invoice Request Schema E2E tests')
  return value
}

function readDatabaseError(error: unknown): {
  readonly code?: unknown
  readonly constraint?: unknown
} {
  if (typeof error !== 'object' || error === null) return {}
  return {
    code: Reflect.get(error, 'code'),
    constraint: Reflect.get(error, 'constraint'),
  }
}

async function expectDatabaseRejection(
  client: Client,
  action: () => Promise<unknown>,
  expectedCode: '22P02' | '23505' | '23514',
  expectedConstraint: string,
  flushDeferred = false,
): Promise<void> {
  await client.query('SAVEPOINT expected_invoice_rejection')

  try {
    await action()
    if (flushDeferred) {
      // 延迟约束触发器只在事务边界执行；测试用 SET CONSTRAINTS 提前触发，
      // 才能在同一外层回滚事务内覆盖多个正反例。
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    }
  }
  catch (error) {
    const databaseError = readDatabaseError(error)
    await client.query('ROLLBACK TO SAVEPOINT expected_invoice_rejection')
    await client.query('RELEASE SAVEPOINT expected_invoice_rejection')
    await client.query('SET CONSTRAINTS ALL DEFERRED')
    expect(databaseError.code).toBe(expectedCode)
    expect(databaseError.constraint).toBe(expectedConstraint)
    return
  }

  await client.query('ROLLBACK TO SAVEPOINT expected_invoice_rejection')
  await client.query('RELEASE SAVEPOINT expected_invoice_rejection')
  await client.query('SET CONSTRAINTS ALL DEFERRED')
  throw new Error('Expected database constraint ' + expectedConstraint + ' to reject input')
}

describe('invoice request schema constraints with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: requireDatabaseUrl() })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  it('declares the request status and action enums and appends the audit events', async () => {
    const statuses = await client.query<{ value: string }>(
      'SELECT unnest(enum_range(NULL::"invoice_request_status"))::text AS value',
    )
    expect(statuses.rows.map(row => row.value)).toEqual([
      'PENDING_REVIEW',
      'RETURNED',
      'NOTIFIED',
      'ISSUED',
      'SETTLED',
      'CANCELLED',
    ])

    const actions = await client.query<{ value: string }>(
      'SELECT unnest(enum_range(NULL::"invoice_request_action"))::text AS value',
    )
    expect(actions.rows.map(row => row.value)).toEqual([
      'SUBMIT',
      'RESUBMIT',
      'RETURN',
      'NOTIFY',
      'UPLOAD_DOCUMENT',
      'SETTLE',
      'CANCEL',
    ])

    const auditEvents = await client.query<{ value: string }>(
      'SELECT unnest(enum_range(NULL::"audit_event_type"))::text AS value',
    )
    expect(auditEvents.rows.map(row => row.value).filter(value => value.startsWith('INVOICE_REQUEST_'))).toEqual([
      'INVOICE_REQUEST_CREATED',
      'INVOICE_REQUEST_RESUBMITTED',
      'INVOICE_REQUEST_RETURNED',
      'INVOICE_REQUEST_NOTIFIED',
      'INVOICE_REQUEST_DOCUMENT_UPLOADED',
      'INVOICE_REQUEST_SETTLED',
      'INVOICE_REQUEST_CANCELLED',
    ])
  })

  it('enforces the lifecycle transitions, column whitelists and line editability', async () => {
    await client.query('BEGIN')
    try {
      const actorUserId = await insertUser(client, 'lifecycle')
      const { requestId, invoiceNo } = await insertInvoiceRequest(client, { actorUserId })
      await insertInvoiceRequestLine(client, { lineNo: 1, requestId, unitPrice: 90_000 })
      await insertInvoiceRequestLine(client, { lineNo: 2, requestId, unitPrice: 180_000 })

      // 非法跳转：审核中不能直接进「已开出邮寄」
      await expectDatabaseRejection(
        client,
        () => client.query('UPDATE "invoice_requests" SET "status" = $2 WHERE "id" = $1', [requestId, 'ISSUED']),
        '23514',
        'invoice_requests_transition_check',
      )
      // 借流转改写业务字段：审核中不能改抬头
      await expectDatabaseRejection(
        client,
        () => client.query(
          'UPDATE "invoice_requests" SET "status" = $2, "notified_at" = CURRENT_TIMESTAMP, "notified_by_user_id" = $3, "buyer_name" = $4 WHERE "id" = $1',
          [requestId, 'NOTIFIED', actorUserId, '改过的抬头股份有限公司'],
        ),
        '23514',
        'invoice_requests_immutable_columns_check',
      )
      // 审核中不动状态改业务字段同样被拒
      await expectDatabaseRejection(
        client,
        () => client.query('UPDATE "invoice_requests" SET "buyer_name" = $2 WHERE "id" = $1', [requestId, '改过的抬头股份有限公司']),
        '23514',
        'invoice_requests_transition_check',
      )
      await expectDatabaseRejection(
        client,
        () => client.query('DELETE FROM "invoice_requests" WHERE "id" = $1', [requestId]),
        '23514',
        'invoice_requests_no_delete_check',
      )
      // 统编形状与金额勾稽
      await expectDatabaseRejection(
        client,
        () => insertInvoiceRequest(client, { actorUserId, buyerTaxId: '8969737' }),
        '23514',
        'invoice_requests_buyer_check',
      )
      await expectDatabaseRejection(
        client,
        () => insertInvoiceRequest(client, { actorUserId, salesAmount: 0, taxAmount: 0, totalAmount: 0 }),
        '23514',
        'invoice_requests_amount_check',
      )
      await expectDatabaseRejection(
        client,
        () => insertInvoiceRequest(client, { actorUserId, totalAmount: 999_999 }),
        '23514',
        'invoice_requests_amount_check',
      )
      // 编号身份：单号与派发台账不一致
      await expectDatabaseRejection(
        client,
        async () => {
          const other = await insertInvoiceRequestIssuance(client, randomBytes(32))
          await insertInvoiceRequest(client, {
            actorUserId,
            invoiceNo: 'INV/20261014-9999',
            numberingIssuanceId: other.numberingIssuanceId,
          })
        },
        '23514',
        'invoice_requests_number_identity_check',
      )
      // 插入即终态：只允许以审核中落库
      await expectDatabaseRejection(
        client,
        async () => {
          const issuance = await insertInvoiceRequestIssuance(client, randomBytes(32))
          await client.query(
            'INSERT INTO "invoice_requests" ("id", "invoice_no", "numbering_issuance_id", "status", "buyer_name", "buyer_tax_id", "sales_amount", "tax_amount", "total_amount", "recipient_name", "recipient_phone", "recipient_address", "last_submitted_at", "request_key_hash", "created_by_id") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, $13, $14)',
            [
              randomUUID(),
              issuance.invoiceNo,
              issuance.numberingIssuanceId,
              'NOTIFIED',
              '正苗工程股份有限公司',
              '89697375',
              100,
              5,
              105,
              '林采榛',
              '0912345678',
              '新北市林口區公園路203號',
              randomBytes(32),
              actorUserId,
            ],
          )
        },
        '23514',
        'invoice_requests_initial_status_check',
      )
      // 明细行：行内勾稽与行号上限
      await expectDatabaseRejection(
        client,
        () => insertInvoiceRequestLine(client, { lineNo: 3, requestId, amount: 1, quantity: 1, unitPrice: 90_000 }),
        '23514',
        'invoice_request_lines_amount_check',
      )
      await expectDatabaseRejection(
        client,
        () => insertInvoiceRequestLine(client, { lineNo: 6, requestId }),
        '23514',
        'invoice_request_lines_line_no_check',
      )
      // 明细行：审核中不可改、不可删
      await expectDatabaseRejection(
        client,
        () => client.query('UPDATE "invoice_request_lines" SET "amount" = $2 WHERE "request_id" = $1 AND "line_no" = 1', [requestId, 1]),
        '23514',
        'invoice_request_lines_edit_status_check',
      )
      await expectDatabaseRejection(
        client,
        () => client.query('DELETE FROM "invoice_request_lines" WHERE "request_id" = $1 AND "line_no" = 1', [requestId]),
        '23514',
        'invoice_request_lines_edit_status_check',
      )

      // 正例：退回
      await client.query(
        'UPDATE "invoice_requests" SET "status" = $2, "returned_at" = CURRENT_TIMESTAMP, "returned_by_user_id" = $3, "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
        [requestId, 'RETURNED', actorUserId],
      )

      // 退回态里，改业务字段但不重提同样被拒：业务字段只能随 RETURNED → PENDING_REVIEW 一起写
      await expectDatabaseRejection(
        client,
        () => client.query('UPDATE "invoice_requests" SET "buyer_name" = $2 WHERE "id" = $1', [requestId, '退回态里偷偷改']),
        '23514',
        'invoice_requests_transition_check',
      )

      // 正例：重提时业务字段与状态在一条语句里一起写；明细行先在退回态改完
      await client.query(
        'UPDATE "invoice_request_lines" SET "unit_price" = $3, "amount" = $4 WHERE "request_id" = $1 AND "line_no" = $2',
        [requestId, 2, 180_000, 180_000],
      )
      await client.query('DELETE FROM "invoice_request_lines" WHERE "request_id" = $1 AND "line_no" = $2', [requestId, 2])
      await insertInvoiceRequestLine(client, { lineNo: 2, requestId, quantity: 2, unitPrice: 90_000 })
      await client.query(
        'UPDATE "invoice_requests" SET "status" = $2, "last_submitted_at" = CURRENT_TIMESTAMP, "buyer_name" = $3, "sales_amount" = $4, "tax_amount" = $5, "total_amount" = $6, "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
        [requestId, 'PENDING_REVIEW', '正苗工程(股)公司', 270_000, 13_500, 283_500],
      )

      // 正例：审核并通知
      await client.query(
        'UPDATE "invoice_requests" SET "status" = $2, "notified_at" = CURRENT_TIMESTAMP, "notified_by_user_id" = $3, "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
        [requestId, 'NOTIFIED', actorUserId],
      )
      const notified = await client.query<{ status: string }>(
        'SELECT "status"::text AS status FROM "invoice_requests" WHERE "id" = $1',
        [requestId],
      )
      expect(notified.rows[0].status).toBe('NOTIFIED')

      // 通知之后业务字段彻底冻结
      await expectDatabaseRejection(
        client,
        () => client.query('UPDATE "invoice_requests" SET "buyer_name" = $2 WHERE "id" = $1', [requestId, '再改一次']),
        '23514',
        'invoice_requests_transition_check',
      )

      // 正例：上传照片（引用必须 READY，延迟校验在事务边界放行）
      const documentAssetId = await insertInvoiceDocumentAsset(client, actorUserId)
      await client.query(
        'UPDATE "invoice_requests" SET "status" = $2, "document_media_asset_id" = $3, "document_uploaded_at" = CURRENT_TIMESTAMP, "document_uploaded_by_user_id" = $4, "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
        [requestId, 'ISSUED', documentAssetId, actorUserId],
      )
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('SET CONSTRAINTS ALL DEFERRED')

      // 结算形状：已开出邮寄进结算必须一次写齐入账列
      await expectDatabaseRejection(
        client,
        () => client.query('UPDATE "invoice_requests" SET "status" = $2 WHERE "id" = $1', [requestId, 'SETTLED']),
        '23514',
        'invoice_requests_status_shape_check',
      )
      // 取消形状：必须带原因
      await expectDatabaseRejection(
        client,
        () => client.query('UPDATE "invoice_requests" SET "status" = $2 WHERE "id" = $1', [requestId, 'CANCELLED']),
        '23514',
        'invoice_requests_status_shape_check',
      )

      // 正例：从「已开出邮寄」取消，照片作为票面证据保留
      await client.query(
        'UPDATE "invoice_requests" SET "status" = $2, "cancelled_at" = CURRENT_TIMESTAMP, "cancelled_by_user_id" = $3, "cancel_reason" = $4, "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
        [requestId, 'CANCELLED', actorUserId, '客户取消'],
      )
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('SET CONSTRAINTS ALL DEFERRED')
      const cancelled = await client.query<{ documentMediaAssetId: string | null; status: string }>(
        'SELECT "status"::text AS status, "document_media_asset_id" AS "documentMediaAssetId" FROM "invoice_requests" WHERE "id" = $1',
        [requestId],
      )
      expect(cancelled.rows[0]).toEqual({ documentMediaAssetId: documentAssetId, status: 'CANCELLED' })

      // 终态不可变
      await expectDatabaseRejection(
        client,
        () => client.query('UPDATE "invoice_requests" SET "cancel_reason" = $2 WHERE "id" = $1', [requestId, '改原因']),
        '23514',
        'invoice_requests_terminal_immutable_check',
      )

      // 照片就绪校验：在「已通知开票」上传时，引用未就绪资产被拒；
      // 用途不对的 READY 资产同样被拒（两条都落在同一个延迟约束名上）。
      const mediaRejectionCases: readonly { purpose?: string; ready?: boolean }[] = [
        { ready: false },
        { purpose: 'PAYMENT_RECIPIENT_QR' },
      ]
      for (const assetOptions of mediaRejectionCases) {
        await expectDatabaseRejection(
          client,
          async () => {
            const fresh = await insertInvoiceRequest(client, { actorUserId })
            await client.query(
              'UPDATE "invoice_requests" SET "status" = $2, "notified_at" = CURRENT_TIMESTAMP, "notified_by_user_id" = $3, "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
              [fresh.requestId, 'NOTIFIED', actorUserId],
            )
            const assetId = await insertInvoiceDocumentAsset(client, actorUserId, assetOptions)
            await client.query(
              'UPDATE "invoice_requests" SET "status" = $2, "document_media_asset_id" = $3, "document_uploaded_at" = CURRENT_TIMESTAMP, "document_uploaded_by_user_id" = $4, "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
              [fresh.requestId, 'ISSUED', assetId, actorUserId],
            )
          },
          '23514',
          'invoice_requests_document_ready_check',
          true,
        )
      }

      // 取消的单保留单号：编号不回滚
      const numbers = await client.query<{ count: number }>(
        'SELECT count(*)::integer AS count FROM "numbering_issuances" WHERE "generated_number" = $1',
        [invoiceNo],
      )
      expect(numbers.rows[0].count).toBe(1)
    }
    finally {
      await client.query('ROLLBACK')
    }
  })

  it('keeps the status history append-only and shape-constrained', async () => {
    await client.query('BEGIN')
    try {
      const actorUserId = await insertUser(client, 'history')
      const { requestId } = await insertInvoiceRequest(client, { actorUserId })

      await insertStatusHistory(client, {
        action: 'SUBMIT',
        actorUserId,
        fromStatus: null,
        requestId,
        toStatus: 'PENDING_REVIEW',
      })

      // 退回必须带原因
      await expectDatabaseRejection(
        client,
        () => insertStatusHistory(client, {
          action: 'RETURN',
          actorUserId,
          fromStatus: 'PENDING_REVIEW',
          requestId,
          toStatus: 'RETURNED',
        }),
        '23514',
        'invoice_request_status_history_reason_check',
      )
      // 动作与流转不匹配
      await expectDatabaseRejection(
        client,
        () => insertStatusHistory(client, {
          action: 'NOTIFY',
          actorUserId,
          fromStatus: 'RETURNED',
          requestId,
          toStatus: 'NOTIFIED',
        }),
        '23514',
        'invoice_request_status_history_transition_shape_check',
      )

      const historyId = await insertStatusHistory(client, {
        action: 'RETURN',
        actorUserId,
        fromStatus: 'PENDING_REVIEW',
        reason: '统编写错了',
        requestId,
        toStatus: 'RETURNED',
      })
      await expectDatabaseRejection(
        client,
        () => client.query('UPDATE "invoice_request_status_history" SET "reason" = $2 WHERE "id" = $1', [historyId, '改原因']),
        '23514',
        'invoice_request_history_immutable_check',
      )
      await expectDatabaseRejection(
        client,
        () => client.query('DELETE FROM "invoice_request_status_history" WHERE "id" = $1', [historyId]),
        '23514',
        'invoice_request_history_immutable_check',
      )
    }
    finally {
      await client.query('ROLLBACK')
    }
  })

  it('rejects a READY invoice document that is no longer referenced', async () => {
    await client.query('BEGIN')
    try {
      const actorUserId = await insertUser(client, 'media')

      // 激活为 READY 时没有任何领域引用，延迟到事务边界的就绪校验必须拒绝
      await expectDatabaseRejection(
        client,
        () => insertInvoiceDocumentAsset(client, actorUserId),
        '23514',
        'media_assets_ready_reference_check',
        true,
      )
    }
    finally {
      await client.query('ROLLBACK')
    }
  })
})
