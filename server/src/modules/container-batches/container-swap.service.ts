import { createHash } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma, type Prisma as PrismaTypes } from '../../generated/prisma/client'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { normalizeClaimProductName } from '../shipment-storage/product-match'
import { ShipmentOwnershipService, type ShipmentOwnershipEntry } from '../shipment-ownership/shipment-ownership.service'
import type { ContainerCommandContext } from './container-batch.normalizer'
import { containerFailure, containerUuid } from './container-batch.normalizer'
import type {
  ContainerSwapContextDto,
  ContainerSwapErrorDto,
  ContainerSwapLineDto,
  ContainerSwapRequestDto,
  ContainerSwapResultDto,
  ContainerSwapShipmentDto,
} from './container-swap.dto'
import {
  deriveSwapUuid,
  hashSwapPayload,
  mergeSwapText,
  normalizeContainerSwapRequest,
  type NormalizedContainerSwapLine,
  type NormalizedContainerSwapRequest,
} from './container-swap.normalizer'

const SWAP_PART_SELECT = {
  id: true,
  shipmentNo: true,
  partNumber: true,
  shippingMarkText: true,
  status: true,
  loadedAt: true,
  deliveredAt: true,
  purchaseOrderId: true,
  purchaseOrder: { select: { id: true, orderNo: true, orderStatus: true } },
  ownershipCurrent: {
    select: {
      ownerType: true,
      ownerSalesOrderId: true,
      state: true,
      ownerSalesOrder: {
        select: {
          id: true,
          orderNo: true,
          customerName: true,
          issuerUserId: true,
          orderStatus: true,
          fulfillmentStatus: true,
        },
      },
    },
  },
  items: {
    select: {
      quantity: true,
      line: {
        select: {
          id: true,
          lineType: true,
          productId: true,
          productNameSnapshot: true,
          sourceSalesOrderLineId: true,
          sourceSalesOrderLine: { select: { productId: true, productNameSnapshot: true } },
        },
      },
    },
  },
  containerLoadingItems: {
    orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      containerBatchId: true,
      lineNumber: true,
      version: true,
      goodsName: true,
      oceanShippingMarkText: true,
      recipientName: true,
      recipientPhone: true,
      recipientAddress: true,
      codAmountTwd: true,
      remark: true,
      containerBatch: { select: { id: true, containerBatchNo: true, containerBatchName: true } },
    },
  },
} as const satisfies Prisma.PurchaseOrderPartSelect

const SWAP_ORDER_LINE_SELECT = {
  id: true,
  salesOrderId: true,
  lineType: true,
  productId: true,
  productNameSnapshot: true,
  quantity: true,
} as const satisfies Prisma.SalesOrderLineSelect

type SwapPart = Prisma.PurchaseOrderPartGetPayload<{ select: typeof SWAP_PART_SELECT }>
type SwapOrderLine = Prisma.SalesOrderLineGetPayload<{ select: typeof SWAP_ORDER_LINE_SELECT }>
type SwapLine = SwapPart['containerLoadingItems'][number]
type SwapReadClient = Pick<
  PrismaTypes.TransactionClient,
  | 'purchaseOrderPart'
  | 'salesOrderLine'
  | 'salesOrderDocument'
  | 'shipmentStorageRecord'
  | 'shipmentStorageClaimRequest'
  | 'slhReconciliationSettlement'
  | 'slhReconciliationBatchLine'
  | 'packagingCostRequest'
>

interface SwapError {
  readonly code: string
  readonly message: string
}

interface SwapAfterValues {
  readonly recipientName: string | null
  readonly recipientPhone: string | null
  readonly recipientAddress: string | null
  readonly remark: string | null
}

const CONFLICT_CODES = new Set([
  'CONTAINER_SWAP_LINE_CHANGED',
  'CONTAINER_SWAP_STATE_CHANGED',
  'CONTAINER_SWAP_IDEMPOTENCY_CONFLICT',
])

function swapError(code: string, message: string): SwapError {
  return { code, message }
}

function ownerOf(part: SwapPart) {
  return part.ownershipCurrent?.ownerType === 'SALES_ORDER'
    && part.ownershipCurrent.state === 'ACTIVE'
    ? part.ownershipCurrent.ownerSalesOrder
    : null
}

function orderLineKey(line: SwapOrderLine): string | null {
  if (line.lineType === 'CATALOG') {
    return line.productId === null ? null : `catalog:${line.productId}`
  }
  const name = normalizeClaimProductName(line.productNameSnapshot)
  return name === '' ? null : `custom:${name}`
}

/**
 * 货件条目的产品身份按其来源销售行识别；采购行名称只在历史缺少来源行时兜底。
 * 这样 CUSTOM 产品的采购名称与销售名称不一致时不会误判。
 */
function shipmentItemKey(item: SwapPart['items'][number]): string | null {
  const line = item.line
  if (line.lineType === 'CATALOG') {
    const productId = line.productId ?? line.sourceSalesOrderLine?.productId ?? null
    return productId === null ? null : `catalog:${productId}`
  }
  const name = line.sourceSalesOrderLine?.productNameSnapshot ?? line.productNameSnapshot
  const normalized = normalizeClaimProductName(name)
  return normalized === '' ? null : `custom:${normalized}`
}

function quantityMap(
  entries: readonly { readonly key: string | null, readonly quantity: number }[],
): { readonly map: Map<string, number>, readonly invalid: boolean } {
  const map = new Map<string, number>()
  let invalid = false
  for (const entry of entries) {
    if (entry.key === null) {
      invalid = true
      continue
    }
    map.set(entry.key, (map.get(entry.key) ?? 0) + entry.quantity)
  }
  return { map, invalid }
}

function sameQuantityMap(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  if (left.size !== right.size) return false
  for (const [key, quantity] of left) {
    if (right.get(key) !== quantity) return false
  }
  return true
}

function shipmentLabel(part: SwapPart): string {
  return `货件 ${part.shipmentNo ?? `#${part.partNumber}`}`
}

function partLabel(part: SwapPart, side: '左侧' | '右侧'): string {
  return `${shipmentLabel(part)}（${side}）`
}

function quantitySummary(entries: readonly { readonly name: string, readonly quantity: number }[]): string {
  const quantities = new Map<string, number>()
  for (const entry of entries) {
    const name = entry.name.trim() || '未命名产品'
    quantities.set(name, (quantities.get(name) ?? 0) + entry.quantity)
  }
  return [...quantities.entries()].map(([name, quantity]) => `${name}×${quantity}`).join('、') || '无明细'
}

function mergeAfterValues(source: readonly SwapLine[]): SwapAfterValues {
  return {
    recipientName: mergeSwapText(source.map(line => line.recipientName), 128, '、'),
    recipientPhone: mergeSwapText(source.map(line => line.recipientPhone), 128, '、'),
    recipientAddress: mergeSwapText(source.map(line => line.recipientAddress), 2_000, '\n'),
    remark: mergeSwapText(source.map(line => line.remark), 2_000, '\n'),
  }
}

function lineSignature(lines: readonly SwapLine[]): string {
  return lines.map(line => `${line.id}:${line.containerBatchId}`).sort().join('|')
}

function assertLineSet(
  inputLines: readonly NormalizedContainerSwapLine[],
  part: SwapPart,
): void {
  const expected = new Set(part.containerLoadingItems.map(line => line.id))
  if (inputLines.length !== expected.size || inputLines.some(line => !expected.has(line.loadingItemId))) {
    containerFailure(
      'CONTAINER_SWAP_LINE_CHANGED',
      '装柜明细已变化，请刷新后重新核对',
      HttpStatus.CONFLICT,
    )
  }
}

function assertVersions(
  inputLines: readonly NormalizedContainerSwapLine[],
  part: SwapPart,
): void {
  const inputById = new Map(inputLines.map(line => [line.loadingItemId, line]))
  for (const line of part.containerLoadingItems) {
    if (inputById.get(line.id)?.expectedVersion !== line.version) {
      containerFailure(
        'CONTAINER_SWAP_LINE_CHANGED',
        '装柜明细已更新，请刷新后重新提交',
        HttpStatus.CONFLICT,
      )
    }
  }
}

function throwFirstError(errors: readonly SwapError[]): void {
  const error = errors[0]
  if (error === undefined) return
  throw new ApiException(
    CONFLICT_CODES.has(error.code) ? HttpStatus.CONFLICT : HttpStatus.UNPROCESSABLE_ENTITY,
    error.code,
    error.message,
  )
}

function mapPersistence(error: unknown): never {
  if (error instanceof ApiException) throw error
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505', 'P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
    containerFailure('CONTAINER_SWAP_STATE_CHANGED', '资料已变化或正在处理，请刷新后重试', HttpStatus.CONFLICT)
  }
  throw error
}

@Injectable()
export class ContainerSwapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
    private readonly audit: AuditService,
    private readonly ownership: ShipmentOwnershipService,
  ) {}

  async getContext(rawLeftShipmentId: unknown, rawRightShipmentId: unknown): Promise<ContainerSwapContextDto> {
    const leftShipmentId = containerUuid(rawLeftShipmentId)
    const rightShipmentId = containerUuid(rawRightShipmentId)
    if (leftShipmentId === rightShipmentId) {
      return containerFailure('VALIDATION_FAILED', '两件货件不能相同')
    }
    const { left, right } = await this.loadPair(this.prisma, leftShipmentId, rightShipmentId)
    const errors = await this.evaluate(this.prisma, left, right)
    return this.toContext(left, right, errors)
  }

  async swap(
    context: ContainerCommandContext,
    input: ContainerSwapRequestDto,
    key: unknown,
  ): Promise<ContainerSwapResultDto> {
    const normalized = normalizeContainerSwapRequest(input)
    const swapKey = containerUuid(key)
    const leftEventKey = deriveSwapUuid(swapKey, 'ownership:left')
    const rightEventKey = deriveSwapUuid(swapKey, 'ownership:right')
    const leftPayload = this.ownershipPayload(swapKey, normalized, 'left')
    const rightPayload = this.ownershipPayload(swapKey, normalized, 'right')
    const expectedHashes = new Map([
      [leftEventKey, createHash('sha256').update(JSON.stringify(leftPayload), 'utf8').digest()],
      [rightEventKey, createHash('sha256').update(JSON.stringify(rightPayload), 'utf8').digest()],
    ])

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        await this.authorize(transaction, context.actorUserId)
        await transaction.$queryRaw(
          Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`container.swap:${context.actorUserId}:${swapKey}`}, 0))`,
        )

        const replayed = await this.replayResult(
          transaction,
          context.actorUserId,
          swapKey,
          [leftEventKey, rightEventKey],
          expectedHashes,
          normalized,
        )
        if (replayed !== null) return replayed

        const initial = await this.loadPair(
          transaction,
          normalized.leftShipmentId,
          normalized.rightShipmentId,
        )
        assertLineSet(normalized.leftLines, initial.left)
        assertLineSet(normalized.rightLines, initial.right)

        await this.lockResources(transaction, initial.left, initial.right)

        const locked = await this.loadPair(
          transaction,
          normalized.leftShipmentId,
          normalized.rightShipmentId,
        )
        if (
          lineSignature(initial.left.containerLoadingItems) !== lineSignature(locked.left.containerLoadingItems)
          || lineSignature(initial.right.containerLoadingItems) !== lineSignature(locked.right.containerLoadingItems)
        ) {
          containerFailure(
            'CONTAINER_SWAP_LINE_CHANGED',
            '装柜明细的柜次关联已变化，请刷新后重试',
            HttpStatus.CONFLICT,
          )
        }
        assertLineSet(normalized.leftLines, locked.left)
        assertLineSet(normalized.rightLines, locked.right)
        assertVersions(normalized.leftLines, locked.left)
        assertVersions(normalized.rightLines, locked.right)

        const errors = await this.evaluate(transaction, locked.left, locked.right)
        throwFirstError(errors)

        // 先冻结两侧当前值，再统一写入，避免先改左边导致右边读到已换后的值。
        const leftAfter = mergeAfterValues(locked.right.containerLoadingItems)
        const rightAfter = mergeAfterValues(locked.left.containerLoadingItems)
        const leftCod = this.codByLine(normalized.leftLines)
        const rightCod = this.codByLine(normalized.rightLines)

        const changedLineCount = await this.applyLineChanges(transaction, context, swapKey, locked.left, locked.right, {
          leftAfter,
          rightAfter,
          leftCod,
          rightCod,
        })

        const leftOwner = ownerOf(locked.left)
        const rightOwner = ownerOf(locked.right)
        if (leftOwner === null || rightOwner === null) {
          containerFailure('CONTAINER_SWAP_STATE_CHANGED', '货件归属已变化，请刷新后重试', HttpStatus.CONFLICT)
        }
        const entries = [
          {
            shipmentId: locked.left.id,
            ownerType: 'SALES_ORDER',
            ownerSalesOrderId: rightOwner.id,
            reason: 'OTHER',
            actorUserId: context.actorUserId,
            requestKey: leftEventKey,
            payload: leftPayload,
          },
          {
            shipmentId: locked.right.id,
            ownerType: 'SALES_ORDER',
            ownerSalesOrderId: leftOwner.id,
            reason: 'OTHER',
            actorUserId: context.actorUserId,
            requestKey: rightEventKey,
            payload: rightPayload,
          },
        ] satisfies ShipmentOwnershipEntry[]
        entries.sort((left, right) => left.shipmentId.localeCompare(right.shipmentId))
        await this.ownership.recordMany(transaction, entries)

        for (const [part, previousOwner, nextOwner, counterpart] of [
          [locked.left, leftOwner.id, rightOwner.id, locked.right.id],
          [locked.right, rightOwner.id, leftOwner.id, locked.left.id],
        ] as const) {
          await this.audit.record(transaction, {
            eventType: 'SHIPMENT_OWNERSHIP_RELEASED',
            outcome: 'SUCCESS',
            actorType: 'USER',
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            targetType: 'PURCHASE_ORDER_PART',
            targetId: part.id,
            metadata: {
              action: 'SWAP',
              counterpartShipmentId: counterpart,
              nextOwnerSalesOrderId: nextOwner,
              note: normalized.note,
              previousOwnerSalesOrderId: previousOwner,
              swapRequestKey: swapKey,
            },
          })
        }

        return {
          leftShipmentId: locked.left.id,
          rightShipmentId: locked.right.id,
          changedLineCount,
          replayed: false,
        }
      }, { timeout: 30_000 })
    }
    catch (error) {
      return mapPersistence(error)
    }
  }

  private ownershipPayload(
    swapKey: string,
    input: NormalizedContainerSwapRequest,
    side: 'left' | 'right',
  ): Record<string, unknown> {
    const lineInputs = side === 'left' ? input.leftLines : input.rightLines
    return {
      format: 'shipment-ownership.swap.v1',
      swapRequestKey: swapKey,
      shipmentId: side === 'left' ? input.leftShipmentId : input.rightShipmentId,
      counterpartShipmentId: side === 'left' ? input.rightShipmentId : input.leftShipmentId,
      note: input.note,
      requestedLines: [...lineInputs]
        .sort((left, right) => left.loadingItemId.localeCompare(right.loadingItemId))
        .map(line => ({
          loadingItemId: line.loadingItemId,
          expectedVersion: line.expectedVersion,
          codAmountTwd: line.codAmountTwd,
        })),
    }
  }

  private async replayResult(
    transaction: PrismaTypes.TransactionClient,
    actorUserId: string,
    swapKey: string,
    keys: readonly string[],
    expectedHashes: ReadonlyMap<string, Buffer>,
    input: NormalizedContainerSwapRequest,
  ): Promise<ContainerSwapResultDto | null> {
    const events = await transaction.shipmentOwnershipEvent.findMany({
      where: { actorUserId, requestKey: { in: [...keys] } },
      select: { requestKey: true, payloadHash: true },
    })
    if (events.length === 0) return null
    if (events.length !== keys.length) {
      containerFailure(
        'CONTAINER_SWAP_IDEMPOTENCY_CONFLICT',
        '该提交标识已用于不同的货物对换，请重新操作',
        HttpStatus.CONFLICT,
      )
    }
    for (const event of events) {
      const expected = expectedHashes.get(event.requestKey)
      if (expected === undefined || !Buffer.from(event.payloadHash).equals(expected)) {
        containerFailure(
          'CONTAINER_SWAP_IDEMPOTENCY_CONFLICT',
          '该提交标识已用于不同的货物对换，请重新操作',
          HttpStatus.CONFLICT,
        )
      }
    }
    const changeKeys = [
      ...input.leftLines.map(line => deriveSwapUuid(swapKey, `change:recipient:${line.loadingItemId}`)),
      ...input.leftLines.map(line => deriveSwapUuid(swapKey, `change:cod:${line.loadingItemId}`)),
      ...input.rightLines.map(line => deriveSwapUuid(swapKey, `change:recipient:${line.loadingItemId}`)),
      ...input.rightLines.map(line => deriveSwapUuid(swapKey, `change:cod:${line.loadingItemId}`)),
    ]
    const changed = await transaction.containerLoadingItemChange.findMany({
      where: { actorUserId, requestKey: { in: changeKeys } },
      select: { loadingItemId: true },
    })
    return {
      leftShipmentId: input.leftShipmentId,
      rightShipmentId: input.rightShipmentId,
      changedLineCount: new Set(changed.map(row => row.loadingItemId)).size,
      replayed: true,
    }
  }

  private codByLine(lines: readonly NormalizedContainerSwapLine[]): Map<string, string | null> {
    return new Map(lines.map(line => [line.loadingItemId, line.codAmountTwd]))
  }

  private async applyLineChanges(
    transaction: PrismaTypes.TransactionClient,
    context: ContainerCommandContext,
    swapKey: string,
    left: SwapPart,
    right: SwapPart,
    values: {
      readonly leftAfter: SwapAfterValues
      readonly rightAfter: SwapAfterValues
      readonly leftCod: ReadonlyMap<string, string | null>
      readonly rightCod: ReadonlyMap<string, string | null>
    },
  ): Promise<number> {
    let changedLineCount = 0
    const affectedBatches = new Set<string>()
    for (const [part, after, codByLine] of [
      [left, values.leftAfter, values.leftCod],
      [right, values.rightAfter, values.rightCod],
    ] as const) {
      for (const line of part.containerLoadingItems) {
        const nextCod = codByLine.get(line.id)
        if (nextCod === undefined) {
          containerFailure(
            'CONTAINER_SWAP_LINE_CHANGED',
            '装柜明细已变化，请刷新后重新核对',
            HttpStatus.CONFLICT,
          )
        }
        const currentCod = line.codAmountTwd?.toFixed(2) ?? null
        const recipientChanged = line.recipientName !== after.recipientName
          || line.recipientPhone !== after.recipientPhone
          || line.recipientAddress !== after.recipientAddress
          || line.remark !== after.remark
        const codChanged = currentCod !== nextCod
        if (!recipientChanged && !codChanged) continue
        changedLineCount += 1
        affectedBatches.add(line.containerBatchId)

        let currentVersion = line.version
        if (recipientChanged) {
          const updated = await transaction.containerLoadingItem.update({
            where: { id: line.id },
            data: {
              recipientName: after.recipientName,
              recipientPhone: after.recipientPhone,
              recipientAddress: after.recipientAddress,
              remark: after.remark,
              version: { increment: 1 },
              updatedById: context.actorUserId,
            },
            select: { version: true },
          })
          const change = await transaction.containerLoadingItemChange.create({
            data: {
              loadingItemId: line.id,
              kind: 'RECIPIENT',
              beforeData: {
                recipientName: line.recipientName,
                recipientPhone: line.recipientPhone,
                recipientAddress: line.recipientAddress,
                remark: line.remark,
              },
              afterData: {
                recipientName: after.recipientName,
                recipientPhone: after.recipientPhone,
                recipientAddress: after.recipientAddress,
                remark: after.remark,
              },
              previousVersion: currentVersion,
              version: updated.version,
              requestKey: deriveSwapUuid(swapKey, `change:recipient:${line.id}`),
              payloadHash: hashSwapPayload({
                format: 'container.swap.line.v1',
                swapRequestKey: swapKey,
                loadingItemId: line.id,
                kind: 'RECIPIENT',
                expectedVersion: currentVersion,
                before: {
                  recipientName: line.recipientName,
                  recipientPhone: line.recipientPhone,
                  recipientAddress: line.recipientAddress,
                  remark: line.remark,
                },
                after,
              }),
              actorUserId: context.actorUserId,
            },
            select: { id: true },
          })
          await this.audit.record(transaction, {
            eventType: 'CONTAINER_LOADING_ITEM_UPDATED',
            outcome: 'SUCCESS',
            actorType: 'USER',
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            targetType: 'CONTAINER_LOADING_ITEM',
            targetId: line.id,
            metadata: {
              changeId: change.id,
              containerBatchId: line.containerBatchId,
              kind: 'RECIPIENT',
              previousVersion: currentVersion,
              swapRequestKey: swapKey,
              version: updated.version,
            },
          })
          currentVersion = updated.version
        }
        if (codChanged) {
          const updated = await transaction.containerLoadingItem.update({
            where: { id: line.id },
            data: {
              codAmountTwd: nextCod === null ? null : new Prisma.Decimal(nextCod),
              version: { increment: 1 },
              updatedById: context.actorUserId,
            },
            select: { version: true },
          })
          const change = await transaction.containerLoadingItemChange.create({
            data: {
              loadingItemId: line.id,
              kind: 'COD',
              beforeData: { codAmountTwd: currentCod },
              afterData: { codAmountTwd: nextCod },
              previousVersion: currentVersion,
              version: updated.version,
              requestKey: deriveSwapUuid(swapKey, `change:cod:${line.id}`),
              payloadHash: hashSwapPayload({
                format: 'container.swap.line.v1',
                swapRequestKey: swapKey,
                loadingItemId: line.id,
                kind: 'COD',
                expectedVersion: currentVersion,
                before: { codAmountTwd: currentCod },
                after: { codAmountTwd: nextCod },
              }),
              actorUserId: context.actorUserId,
            },
            select: { id: true },
          })
          await this.audit.record(transaction, {
            eventType: 'CONTAINER_LOADING_ITEM_UPDATED',
            outcome: 'SUCCESS',
            actorType: 'USER',
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            targetType: 'CONTAINER_LOADING_ITEM',
            targetId: line.id,
            metadata: {
              changeId: change.id,
              containerBatchId: line.containerBatchId,
              kind: 'COD',
              previousVersion: currentVersion,
              swapRequestKey: swapKey,
              version: updated.version,
            },
          })
        }
      }
    }
    for (const batchId of affectedBatches) {
      await transaction.containerBatch.update({
        where: { id: batchId },
        data: { version: { increment: 1 }, updatedById: context.actorUserId },
      })
    }
    return changedLineCount
  }

  private async loadPair(
    client: Pick<PrismaTypes.TransactionClient, 'purchaseOrderPart'>,
    leftShipmentId: string,
    rightShipmentId: string,
  ): Promise<{ readonly left: SwapPart, readonly right: SwapPart }> {
    const rows = await client.purchaseOrderPart.findMany({
      where: { id: { in: [leftShipmentId, rightShipmentId] } },
      select: SWAP_PART_SELECT,
    })
    const left = rows.find(row => row.id === leftShipmentId)
    const right = rows.find(row => row.id === rightShipmentId)
    if (left === undefined || right === undefined) {
      return containerFailure('CONTAINER_SWAP_SHIPMENT_NOT_FOUND', '货件不存在', HttpStatus.NOT_FOUND)
    }
    return { left, right }
  }

  private async evaluate(
    client: SwapReadClient,
    left: SwapPart,
    right: SwapPart,
  ): Promise<SwapError[]> {
    const errors: SwapError[] = []
    const push = (code: string, message: string) => errors.push(swapError(code, message))

    for (const [side, part] of [['左侧', left], ['右侧', right]] as const) {
      const label = partLabel(part, side)
      if (part.status !== 'ACTIVE') push('CONTAINER_SWAP_NOT_ALLOWED', `${label}尚未生效或已取消（当前状态：${part.status}）`)
      if (part.loadedAt === null) push('CONTAINER_SWAP_NOT_ALLOWED', `${label}尚未装柜`)
      if (part.deliveredAt !== null) push('CONTAINER_SWAP_NOT_ALLOWED', `${label}已签收，签收后不能对换`)
      if (part.containerLoadingItems.length === 0) push('CONTAINER_SWAP_NOT_ALLOWED', `${label}没有装柜明细`)
      if (part.containerLoadingItems.length > 0) {
        const batchIds = new Set(part.containerLoadingItems.map(line => line.containerBatchId))
        if (batchIds.size > 1) push('CONTAINER_SWAP_STATE_CHANGED', `${label}关联了多个柜次（${batchIds.size} 个），无法对换`)
      }
      const owner = ownerOf(part)
      if (owner === null) {
        push('CONTAINER_SWAP_NOT_ALLOWED', `${label}当前没有销售单归属（当前归属类型：${part.ownershipCurrent?.ownerType ?? '无'}）`)
      }
      else {
        if (owner.orderStatus !== 'CONFIRMED') push('CONTAINER_SWAP_NOT_ALLOWED', `${label}的销售单 ${owner.orderNo} 不是已确认状态（当前：${owner.orderStatus}）`)
        if (owner.fulfillmentStatus !== 'SEA_TRANSIT') push('CONTAINER_SWAP_NOT_ALLOWED', `${label}的销售单 ${owner.orderNo} 不在海运在途阶段（当前：${owner.fulfillmentStatus}；要求 SEA_TRANSIT）`)
      }
      if (part.purchaseOrder.orderStatus === 'CANCELLED') push('CONTAINER_SWAP_NOT_ALLOWED', `${label}的采购单 ${part.purchaseOrder.orderNo} 已取消`)
    }

    const leftOwner = ownerOf(left)
    const rightOwner = ownerOf(right)
    if (leftOwner !== null && rightOwner !== null && leftOwner.id === rightOwner.id) {
      push('CONTAINER_SWAP_NOT_ALLOWED', `两件货件属于同一张销售单 ${leftOwner.orderNo}，无需对换`)
    }

    const ownerIds = [...new Set([leftOwner?.id, rightOwner?.id].filter((id): id is string => id !== undefined))]
    const orderLines = ownerIds.length === 0
      ? []
      : await client.salesOrderLine.findMany({
          where: { salesOrderId: { in: ownerIds }, removedAt: null },
          select: SWAP_ORDER_LINE_SELECT,
        })

    const leftOrderLines = leftOwner === null ? [] : orderLines.filter(line => line.salesOrderId === leftOwner.id)
    const rightOrderLines = rightOwner === null ? [] : orderLines.filter(line => line.salesOrderId === rightOwner.id)
    const leftOrderMap = quantityMap(leftOrderLines.map(line => ({ key: orderLineKey(line), quantity: line.quantity })))
    const rightOrderMap = quantityMap(rightOrderLines.map(line => ({ key: orderLineKey(line), quantity: line.quantity })))
    const leftShipmentMap = quantityMap(left.items.map(item => ({ key: shipmentItemKey(item), quantity: item.quantity })))
    const rightShipmentMap = quantityMap(right.items.map(item => ({ key: shipmentItemKey(item), quantity: item.quantity })))

    const leftOwnerNo = leftOwner?.orderNo ?? '—'
    const rightOwnerNo = rightOwner?.orderNo ?? '—'
    const leftOrderSummary = quantitySummary(leftOrderLines.map(line => ({
      name: line.productNameSnapshot,
      quantity: line.quantity,
    })))
    const rightOrderSummary = quantitySummary(rightOrderLines.map(line => ({
      name: line.productNameSnapshot,
      quantity: line.quantity,
    })))
    const leftShipmentSummary = quantitySummary(left.items.map(item => ({
      name: item.line.sourceSalesOrderLine?.productNameSnapshot ?? item.line.productNameSnapshot,
      quantity: item.quantity,
    })))
    const rightShipmentSummary = quantitySummary(right.items.map(item => ({
      name: item.line.sourceSalesOrderLine?.productNameSnapshot ?? item.line.productNameSnapshot,
      quantity: item.quantity,
    })))

    if (leftOrderLines.length === 0) push('CONTAINER_SWAP_PRODUCT_MISMATCH', `左侧销售单 ${leftOwnerNo} 没有销售明细`)
    if (rightOrderLines.length === 0) push('CONTAINER_SWAP_PRODUCT_MISMATCH', `右侧销售单 ${rightOwnerNo} 没有销售明细`)
    if (left.items.length === 0) push('CONTAINER_SWAP_PRODUCT_MISMATCH', `${partLabel(left, '左侧')}没有产品分配`)
    if (right.items.length === 0) push('CONTAINER_SWAP_PRODUCT_MISMATCH', `${partLabel(right, '右侧')}没有产品分配`)
    if (leftOrderMap.invalid || rightOrderMap.invalid) {
      push('CONTAINER_SWAP_PRODUCT_INVALID', `销售明细缺少产品标识（左侧销售单 ${leftOwnerNo} / 右侧销售单 ${rightOwnerNo}），无法核对产品`)
    }
    if (leftShipmentMap.invalid || rightShipmentMap.invalid) {
      push('CONTAINER_SWAP_PRODUCT_INVALID', `货件产品分配缺少产品标识（${partLabel(left, '左侧')} / ${partLabel(right, '右侧')}），无法核对产品`)
    }
    if (!leftOrderMap.invalid && !rightOrderMap.invalid && !leftShipmentMap.invalid && !rightShipmentMap.invalid) {
      if (!sameQuantityMap(leftOrderMap.map, rightOrderMap.map)) {
        push('CONTAINER_SWAP_PRODUCT_MISMATCH', `两张销售单的产品/数量不一致：左侧销售单 ${leftOwnerNo} ${leftOrderSummary}；右侧销售单 ${rightOwnerNo} ${rightOrderSummary}`)
      }
      if (!sameQuantityMap(leftShipmentMap.map, rightShipmentMap.map)) {
        push('CONTAINER_SWAP_PRODUCT_MISMATCH', `两件货件的产品/数量不一致：${partLabel(left, '左侧')} ${leftShipmentSummary}；${partLabel(right, '右侧')} ${rightShipmentSummary}`)
      }
      if (!sameQuantityMap(leftShipmentMap.map, rightOrderMap.map)) {
        push('CONTAINER_SWAP_PRODUCT_MISMATCH', `${partLabel(left, '左侧')}的产品/数量与右侧销售单 ${rightOwnerNo} 不一致：${leftShipmentSummary}；右侧销售单 ${rightOrderSummary}`)
      }
      if (!sameQuantityMap(rightShipmentMap.map, leftOrderMap.map)) {
        push('CONTAINER_SWAP_PRODUCT_MISMATCH', `${partLabel(right, '右侧')}的产品/数量与左侧销售单 ${leftOwnerNo} 不一致：${rightShipmentSummary}；左侧销售单 ${leftOrderSummary}`)
      }
    }

    if (ownerIds.length > 0) {
      const receiptCount = await client.salesOrderDocument.count({
        where: {
          salesOrderId: { in: ownerIds },
          documentType: 'DELIVERY_RECEIPT',
          detachedAt: null,
        },
      })
      const ownerOrderLabels = [leftOwner?.orderNo, rightOwner?.orderNo]
        .filter((value): value is string => value !== undefined)
        .join('、')
      if (receiptCount > 0) push('CONTAINER_SWAP_NOT_ALLOWED', `销售单已有有效签收单（${ownerOrderLabels || '相关销售单'}），签收后不能对换`)
    }

    const shipmentIds = [left.id, right.id]
    const storage = await client.shipmentStorageRecord.findMany({
      where: {
        shipmentId: { in: shipmentIds },
        status: { in: ['IN_STORAGE', 'RESERVED', 'CLAIMED'] },
      },
      select: { shipmentId: true, status: true },
    })
    if (storage.length > 0) {
      const statusLabels: Record<string, string> = {
        IN_STORAGE: '寄仓中',
        RESERVED: '已预留',
        CLAIMED: '已调货',
      }
      const labels = storage.map(row => (
        `${shipmentLabel(row.shipmentId === left.id ? left : right)}（${statusLabels[row.status] ?? row.status}）`
      )).join('、')
      push('CONTAINER_SWAP_NOT_ALLOWED', `存在寄仓或已调货记录：${labels}；这些货件不能对换`)
    }

    const pendingClaim = await client.shipmentStorageClaimRequest.findFirst({
      where: { status: 'PENDING', storageRecord: { shipmentId: { in: shipmentIds } } },
      select: { id: true, storageRecord: { select: { shipmentId: true } } },
    })
    if (pendingClaim !== null) {
      const pendingPart = pendingClaim.storageRecord.shipmentId === left.id ? left : right
      push('CONTAINER_SWAP_NOT_ALLOWED', `${shipmentLabel(pendingPart)}存在进行中的调货申请，不能对换`)
    }

    const loadingItemIds = [...left.containerLoadingItems, ...right.containerLoadingItems].map(line => line.id)
    const partByLineId = new Map<string, SwapPart>()
    for (const line of left.containerLoadingItems) partByLineId.set(line.id, left)
    for (const line of right.containerLoadingItems) partByLineId.set(line.id, right)
    const settlement = await client.slhReconciliationSettlement.findFirst({
      where: { loadingItemId: { in: loadingItemIds }, status: 'ACTIVE' },
      select: { id: true, loadingItemId: true },
    })
    if (settlement !== null) {
      const settledPart = settlement.loadingItemId ? partByLineId.get(settlement.loadingItemId) : undefined
      push('CONTAINER_SWAP_SETTLED', `${settledPart ? shipmentLabel(settledPart) : '货件'}的账单已结算，不能对换`)
    }

    const reconciliationMember = await client.slhReconciliationBatchLine.findFirst({
      where: { matchedLoadingItemId: { in: loadingItemIds } },
      select: { id: true, matchedLoadingItemId: true },
    })
    if (reconciliationMember !== null) {
      const reconciledPart = reconciliationMember.matchedLoadingItemId
        ? partByLineId.get(reconciliationMember.matchedLoadingItemId)
        : undefined
      push('CONTAINER_SWAP_RECONCILING', `${reconciledPart ? shipmentLabel(reconciledPart) : '货件'}已进入对账批次（含已完成未结算），不能对换`)
    }

    const pendingPackaging = await client.packagingCostRequest.count({
      where: { shipmentId: { in: shipmentIds }, status: 'PENDING_PAYMENT' },
    })
    if (pendingPackaging > 0) push('CONTAINER_SWAP_PACKAGING_UNPAID', `存在 ${pendingPackaging} 条待付款的包装费，请先结清`)

    return errors
  }

  private toContext(
    left: SwapPart,
    right: SwapPart,
    errors: SwapError[],
  ): ContainerSwapContextDto {
    const contextErrors: ContainerSwapErrorDto[] = [...errors]
    const leftAfter = this.safeAfterValues(right.containerLoadingItems, contextErrors)
    const rightAfter = this.safeAfterValues(left.containerLoadingItems, contextErrors)
    return {
      left: this.shipmentDto(left, leftAfter),
      right: this.shipmentDto(right, rightAfter),
      errors: contextErrors,
      canSwap: contextErrors.length === 0,
    }
  }

  private safeAfterValues(source: readonly SwapLine[], errors: ContainerSwapErrorDto[]): SwapAfterValues {
    try {
      return mergeAfterValues(source)
    }
    catch (error) {
      if (error instanceof ApiException) {
        errors.push({ code: error.code, message: error.publicMessage })
        return { recipientName: null, recipientPhone: null, recipientAddress: null, remark: null }
      }
      throw error
    }
  }

  private shipmentDto(part: SwapPart, after: SwapAfterValues): ContainerSwapShipmentDto {
    const owner = ownerOf(part)
    const batch = part.containerLoadingItems[0]?.containerBatch ?? null
    return {
      id: part.id,
      shipmentNo: part.shipmentNo,
      shippingMark: part.shippingMarkText,
      purchaseOrderId: part.purchaseOrder.id,
      purchaseOrderNo: part.purchaseOrder.orderNo,
      salesOrderId: owner?.id ?? null,
      salesOrderNo: owner?.orderNo ?? null,
      customerName: owner?.customerName ?? null,
      containerBatchId: batch?.id ?? null,
      containerBatchNo: batch?.containerBatchNo ?? null,
      containerBatchName: batch?.containerBatchName ?? null,
      items: part.items.map(item => ({
        lineType: item.line.lineType,
        productId: item.line.productId ?? item.line.sourceSalesOrderLine?.productId ?? null,
        productName: item.line.sourceSalesOrderLine?.productNameSnapshot ?? item.line.productNameSnapshot,
        quantity: item.quantity,
      })),
      containerLoadingItems: part.containerLoadingItems.map(line => this.lineDto(line, after)),
    }
  }

  private lineDto(line: SwapLine, after: SwapAfterValues): ContainerSwapLineDto {
    return {
      id: line.id,
      containerBatchId: line.containerBatchId,
      lineNumber: line.lineNumber,
      version: line.version,
      goodsName: line.goodsName,
      oceanShippingMarkText: line.oceanShippingMarkText,
      recipientName: line.recipientName,
      recipientPhone: line.recipientPhone,
      recipientAddress: line.recipientAddress,
      codAmountTwd: line.codAmountTwd?.toFixed(2) ?? null,
      remark: line.remark,
      afterRecipientName: after.recipientName,
      afterRecipientPhone: after.recipientPhone,
      afterRecipientAddress: after.recipientAddress,
      afterRemark: after.remark,
    }
  }

  private async authorize(
    transaction: PrismaTypes.TransactionClient,
    actorUserId: string,
  ): Promise<void> {
    containerUuid(actorUserId)
    const user = await transaction.user.findUnique({ where: { id: actorUserId }, select: { status: true } })
    const permissions = await this.access.getPermissionCodesInTransaction(transaction, actorUserId)
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(permissions, ['container-batches:update'])) {
      containerFailure('FORBIDDEN', '没有货物对换的权限', HttpStatus.FORBIDDEN)
    }
  }

  private async lockResources(
    transaction: PrismaTypes.TransactionClient,
    left: SwapPart,
    right: SwapPart,
  ): Promise<void> {
    const lines = [...left.containerLoadingItems, ...right.containerLoadingItems]
    await this.lockIds(transaction, 'container_batches', [...new Set(lines.map(line => line.containerBatchId))].sort())
    await this.lockIds(transaction, 'container_loading_items', [...new Set(lines.map(line => line.id))].sort())
    await this.lockIds(transaction, 'purchase_orders', [...new Set([left.purchaseOrderId, right.purchaseOrderId])].sort())
    const ownerIds = [left.ownershipCurrent?.ownerSalesOrderId, right.ownershipCurrent?.ownerSalesOrderId]
      .filter((id): id is string => typeof id === 'string')
      .sort()
    await this.lockIds(transaction, 'sales_orders', [...new Set(ownerIds)])
    await this.lockIds(transaction, 'purchase_order_parts', [left.id, right.id].sort())
  }

  private async lockIds(
    transaction: PrismaTypes.TransactionClient,
    table: 'container_batches' | 'container_loading_items' | 'purchase_orders' | 'sales_orders' | 'purchase_order_parts',
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return
    const idList = Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))
    // 表名来自有限联合类型且每个分支都是静态 SQL；ID 始终通过参数绑定。
    switch (table) {
      case 'container_batches':
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM container_batches WHERE id IN (${idList}) ORDER BY id FOR UPDATE`)
        return
      case 'container_loading_items':
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM container_loading_items WHERE id IN (${idList}) ORDER BY id FOR UPDATE`)
        return
      case 'purchase_orders':
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM purchase_orders WHERE id IN (${idList}) ORDER BY id FOR UPDATE`)
        return
      case 'sales_orders':
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM sales_orders WHERE id IN (${idList}) ORDER BY id FOR UPDATE`)
        return
      case 'purchase_order_parts':
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM purchase_order_parts WHERE id IN (${idList}) ORDER BY id FOR UPDATE`)
    }
  }
}
