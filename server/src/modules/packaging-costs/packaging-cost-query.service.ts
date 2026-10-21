import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  PERSON_REFERENCE_SELECT,
  toNullablePersonReference,
  type PersonReferenceRow,
} from '../../infrastructure/database/person-reference'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../access-control/data-scope.service'
import { PackagingPaymentProfileService } from '../payment-recipients/packaging-payment-profile.service'
import type { PaymentRecipientAccountDto } from '../payment-recipients/payment-recipient.dto'
import { purchaseOrderPartScopeWhere } from '../purchase-orders/purchase-order-access'
import { packagingCostScopeWhere } from './packaging-cost-access'
import { PackagingCostStatusDto, PackagingCostVendorDto, type PackagingCostShipmentContextDto, type PackagingCostListQueryDto, type PackagingCostRequestDto, type PackagingCostRequestPageDto, type PackagingCostRequestSummaryDto } from './packaging-cost.dto'
import { packagingCostFailure } from './packaging-cost.normalizer'

const person = { select: PERSON_REFERENCE_SELECT }
const image = { select: { id: true, mimeType: true, originalFilename: true } }
const include = { owner: person, submittedBy: person, paidBy: person, packagingImage: image, quotationImage: image, paymentVoucher: image } satisfies Prisma.PackagingCostRequestInclude
const summarySelect = {
  id: true, version: true, packagingTypeName: true, packagingVendor: true, amount: true, currencyCode: true, status: true,
  submittedBy: person, submittedAt: true, paidBy: person, paidAt: true, remark: true,
} satisfies Prisma.PackagingCostRequestSelect
function toPackagingPerson(value: PersonReferenceRow) {
  const reference = toNullablePersonReference(value)!
  return { id: reference.id, name: reference.displayName, avatarUrl: reference.avatarUrl }
}

function mapSummary(row: Prisma.PackagingCostRequestGetPayload<{ select: typeof summarySelect }>): PackagingCostRequestSummaryDto {
  return {
    id: row.id, version: row.version, packagingTypeName: row.packagingTypeName, packagingVendor: row.packagingVendor as PackagingCostVendorDto,
    amount: row.amount.toFixed(2), currencyCode: 'CNY', status: row.status as PackagingCostStatusDto,
    submittedBy: toPackagingPerson(row.submittedBy), submittedAt: row.submittedAt.toISOString(),
    paidBy: row.paidBy ? toPackagingPerson(row.paidBy) : null, paidAt: row.paidAt?.toISOString() ?? null, remark: row.remark,
  }
}
function map(row: Prisma.PackagingCostRequestGetPayload<{ include: typeof include }>): PackagingCostRequestDto {
  const who = (value: PersonReferenceRow) => toPackagingPerson(value)
  const evidence = (value: { id: string, mimeType: string | null, originalFilename: string }) => ({ mediaAssetId: value.id, mimeType: value.mimeType!, originalFilename: value.originalFilename })
  return {
    paymentRecipientProfile: null, paymentReceipt: row.status === 'PAID' ? { recipient: row.recipientSnapshot as unknown as PaymentRecipientAccountDto | null, voucher: row.paymentVoucher ? evidence(row.paymentVoucher) : null, remark: row.paymentRemark } : null,
    id: row.id, shipmentId: row.shipmentId, shipmentNo: row.shipmentNo, shippingMarkText: row.shippingMarkText,
    purchaseOrderId: row.purchaseOrderId, purchaseOrderNo: row.purchaseOrderNo, salesOrderId: row.salesOrderId, salesOrderNo: row.salesOrderNo,
    owner: who(row.owner), packagingType: row.packagingType, packagingTypeName: row.packagingTypeName, packagingVendor: row.packagingVendor as PackagingCostVendorDto,
    amount: row.amount.toFixed(2), currencyCode: 'CNY', remark: row.remark, status: row.status as PackagingCostStatusDto,
    submittedBy: who(row.submittedBy), submittedAt: row.submittedAt.toISOString(), paidBy: row.paidBy ? who(row.paidBy) : null,
    paidAt: row.paidAt?.toISOString() ?? null, version: row.version, packagingImage: evidence(row.packagingImage), quotationImage: evidence(row.quotationImage),
  }
}
@Injectable()
export class PackagingCostQueryService {
  constructor(private readonly prisma: PrismaService, private readonly recipients: PackagingPaymentProfileService, private readonly dataScope: DataScopeService = dataScopeFallback()) {}
  async shipmentContext(shipmentId: string, actorUserId: string = resolveDataScopeActor()): Promise<PackagingCostShipmentContextDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    const shipment = await this.prisma.purchaseOrderPart.findFirst({ where: { id: shipmentId, ...purchaseOrderPartScopeWhere(scope, actorUserId) }, select: {
      shipmentNo: true, shippingMarkText: true, status: true, shippedAt: true, warehouseReceivedAt: true,
      purchaseOrder: { select: { orderNo: true, orderStatus: true, salesOrder: { select: { orderNo: true, issuer: { select: PERSON_REFERENCE_SELECT } } } } },
    } })
    // SELF 下不能通过上下文接口探测他人货件；ALL 保持原有可诊断的空上下文。
    if (!shipment && scope === 'SELF') return packagingCostFailure('PURCHASE_ORDER_PART_NOT_FOUND', '货件不存在', 404)
    const sale = shipment?.purchaseOrder.salesOrder
    const unavailableReason = !shipment || shipment.status !== 'ACTIVE' || !shipment.shippedAt || !shipment.warehouseReceivedAt || !shipment.shipmentNo || !shipment.shippingMarkText || !['CONFIRMED', 'COMPLETED'].includes(shipment.purchaseOrder.orderStatus)
      ? 'invalidShipment' : !sale ? 'noSalesSource' : null
    // 提报权限只允许核对当前货件的历史摘要，不借此开放付款资料、截图或其他货件记录。
    // SELF 下历史摘要同样按费用归属人收窄，不能借可见货件读取他人提报。
    const existingRequests = shipment ? await this.prisma.packagingCostRequest.findMany({
      where: { shipmentId, ...packagingCostScopeWhere(scope, actorUserId) }, select: summarySelect, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    }) : []
    return { shipmentId, shipmentNo: shipment?.shipmentNo ?? null, shippingMarkText: shipment?.shippingMarkText ?? null, purchaseOrderNo: shipment?.purchaseOrder.orderNo ?? null,
      salesOrderNo: sale?.orderNo ?? null, owner: sale ? toPackagingPerson(sale.issuer) : null,
      existingRequests: existingRequests.map(mapSummary), eligible: unavailableReason === null, unavailableReason }
  }
  async getSummaryById(id: string, client: Pick<Prisma.TransactionClient, 'packagingCostRequest'> = this.prisma): Promise<PackagingCostRequestSummaryDto> {
    const row = await client.packagingCostRequest.findUnique({ where: { id }, select: summarySelect })
    if (!row) return packagingCostFailure('PACKAGING_COST_NOT_FOUND', '打木架提报不存在', 404)
    return mapSummary(row)
  }
  async getById(id: string, actorUserId: string = resolveDataScopeActor()): Promise<PackagingCostRequestDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    const row = await this.prisma.packagingCostRequest.findFirst({ where: { id, ...packagingCostScopeWhere(scope, actorUserId) }, include })
    if (!row) return packagingCostFailure('PACKAGING_COST_NOT_FOUND', '打木架提报不存在', 404)
    return { ...map(row), paymentRecipientProfile: await this.recipients.getForRequest(this.prisma, row) }
  }
  async list(input: PackagingCostListQueryDto, actorUserId: string = resolveDataScopeActor()): Promise<PackagingCostRequestPageDto> {
    const page = input.page ?? 1, pageSize = input.pageSize ?? 20, keyword = input.keyword?.trim()
    const scope = await this.dataScope.resolve(actorUserId)
    const common: Prisma.PackagingCostRequestWhereInput = keyword ? { OR: ['shipmentNo', 'shippingMarkText', 'purchaseOrderNo', 'salesOrderNo'].map(field => ({ [field]: { contains: keyword, mode: 'insensitive' } })) } : {}
    // 数据范围同时约束列表、分页总数与状态数量，SELF 下不能借计数推断他人提报。
    const scoped: Prisma.PackagingCostRequestWhereInput = { ...common, ...packagingCostScopeWhere(scope, actorUserId) }
    const where = { ...scoped, ...(input.status ? { status: input.status } : {}) }
    // 列表、分页总数及两个视图数量使用同一个快照，付款中的并发变更不会造成数量错位。
    return this.prisma.$transaction(async tx => {
      const [rows, total, pending, paid] = await Promise.all([
        tx.packagingCostRequest.findMany({ where, include, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
        tx.packagingCostRequest.count({ where }),
        tx.packagingCostRequest.count({ where: { ...scoped, status: 'PENDING_PAYMENT' } }),
        tx.packagingCostRequest.count({ where: { ...scoped, status: 'PAID' } }),
      ])
      return { items: await Promise.all(rows.map(async row => ({ ...map(row), paymentRecipientProfile: await this.recipients.getForRequest(tx, row) }))), total, page, pageSize, statusCounts: { PENDING_PAYMENT: pending, PAID: paid } }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }
}
