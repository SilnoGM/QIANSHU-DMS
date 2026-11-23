import { HttpStatus, Injectable } from '@nestjs/common'
import sharp from 'sharp'

import { ApiException } from '../../../infrastructure/http/api.exception'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../../media/media-storage'
import { MEDIA_CONTENT_SIZE_LIMITS } from '../../media/media-validation'
import {
  calculatePurchaseOrderLineTotal,
  normalizePurchaseOrderReferenceAmount,
  sumPurchaseOrderAmounts,
} from '../domain/purchase-order-decimal'
import { purchaseOrderRuleFailure } from '../domain/purchase-order-errors'
import {
  normalizePriceQuotationSheetRequest,
  type NormalizedPriceQuotationSheetCatalogLine,
  type NormalizedPriceQuotationSheetLine,
  type NormalizedPriceQuotationSheetRequest,
} from './price-quotation-sheet.normalizer'
import { PriceQuotationSheetImageError, type PriceQuotationSheetSnapshot } from './price-quotation-sheet.snapshot'
import { PriceQuotationSheetRenderer } from './price-quotation-sheet-renderer'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const THUMBNAIL_SIZE = 128

interface CatalogProductSnapshot {
  readonly id: string
  readonly name: string
  readonly status: 'DRAFT' | 'ACTIVE' | 'DISABLED'
  readonly supplierValue: string | null
  readonly purchaseCostAmount: { toFixed(decimalPlaces: number): string } | null
  readonly purchaseCostCurrency: string
}

interface ProductImageRow {
  readonly productId: string
  readonly mediaAsset: {
    readonly objectKey: string | null
    readonly sizeBytes: bigint | null
  }
}

export interface PriceQuotationSheetResult {
  readonly buffer: Buffer
  readonly filename: string
}

@Injectable()
export class PriceQuotationSheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
    private readonly delivery: MediaContentDeliveryService,
    private readonly renderer: PriceQuotationSheetRenderer,
  ) {}

  async generate(input: unknown): Promise<PriceQuotationSheetResult> {
    const command = normalizePriceQuotationSheetRequest(input, this.businessToday())
    const supplierName = await this.resolveSupplierName(command)
    const catalogLines = command.lines.filter(
      (line): line is NormalizedPriceQuotationSheetCatalogLine => line.lineType === 'CATALOG',
    )
    const products = await this.loadProducts(catalogLines, command.supplierValue)
    const referenceById = new Map([...products].map(([id, product]) => [
      id,
      normalizePurchaseOrderReferenceAmount(product.purchaseCostAmount!.toFixed(4)),
    ]))
    this.assertReferencePrices(catalogLines, referenceById)
    const images = await this.loadProductImages([...products.keys()])
    const lines = command.lines.map(line => this.toSnapshotLine(
      line,
      products,
      referenceById,
    ))
    const snapshot: PriceQuotationSheetSnapshot = Object.freeze({
      orderDate: command.orderDate,
      supplierName,
      currencyCode: 'CNY',
      referenceTotalAmount: sumPurchaseOrderAmounts(command.lines.map(line => calculatePurchaseOrderLineTotal(
        line.lineType === 'CATALOG'
          ? referenceById.get(line.productId)!
          : line.referencePurchaseUnitPriceAmount,
        line.quantity,
      ))),
      actualTotalAmount: sumPurchaseOrderAmounts(command.lines.map(line => line.lineTotalAmount)),
      lines: Object.freeze(lines),
    })
    try {
      const buffer = await this.renderer.render(snapshot, images)
      return {
        buffer,
        filename: `price-quotation-sheet-${command.orderDate.replaceAll('-', '')}.png`,
      }
    }
    catch (error) {
      if (error instanceof PriceQuotationSheetImageError && error.code === 'PURCHASE_ORDER_IMAGE_TOO_LARGE') {
        return purchaseOrderRuleFailure(
          'PURCHASE_ORDER_IMAGE_TOO_LARGE',
          '核价单内容超过单张图片可读尺寸，请减少产品行或行备注后重试',
        )
      }
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE',
        '核价单图片生成失败，请重试',
      )
    }
  }

  private businessToday(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  }

  private async resolveSupplierName(command: NormalizedPriceQuotationSheetRequest): Promise<string> {
    if (command.productMode === 'CUSTOM') return command.customSupplierName!
    const supplier = await this.dictionaryLookup.resolveStoredValue({
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      value: command.supplierValue!,
    })
    if (!supplier.known || !supplier.effectiveEnabled) {
      return purchaseOrderRuleFailure(
        'PURCHASE_ORDER_SUPPLIER_UNAVAILABLE',
        '供应商当前不可用',
      )
    }
    return supplier.label
  }

  private async loadProducts(
    lines: readonly NormalizedPriceQuotationSheetCatalogLine[],
    supplierValue: string | null,
  ): Promise<ReadonlyMap<string, CatalogProductSnapshot>> {
    const productIds = [...new Set(lines.map(line => line.productId))]
    if (productIds.length === 0) return new Map()
    const rows = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        status: true,
        supplierValue: true,
        purchaseCostAmount: true,
        purchaseCostCurrency: true,
      },
    })
    if (rows.length !== productIds.length) {
      return purchaseOrderRuleFailure(
        'PURCHASE_ORDER_PRODUCT_UNAVAILABLE',
        '所选产品已停用或不存在',
      )
    }
    for (const row of rows) {
      if (row.status !== 'ACTIVE') {
        return purchaseOrderRuleFailure(
          'PURCHASE_ORDER_PRODUCT_UNAVAILABLE',
          '所选产品已停用或不存在',
        )
      }
      if (row.supplierValue !== supplierValue) {
        return purchaseOrderRuleFailure(
          'PURCHASE_ORDER_PRODUCT_SUPPLIER_MISMATCH',
          '所选产品与采购供应商不匹配',
        )
      }
      if (row.purchaseCostAmount === null || row.purchaseCostCurrency !== 'CNY') {
        return purchaseOrderRuleFailure(
          'PURCHASE_ORDER_PRODUCT_COST_UNAVAILABLE',
          '产品采购定价当前不可用',
        )
      }
    }
    return new Map(rows.map(row => [row.id, row as CatalogProductSnapshot]))
  }

  /**
   * 产品主图只从产品媒体关联读取，不接受前端 URL；缺图或读取失败降级为空占位，
   * 核价单是沟通辅助文档，不能因为一张图片让整张单生成失败。
   */
  private async loadProductImages(productIds: readonly string[]): Promise<ReadonlyMap<string, Buffer>> {
    if (productIds.length === 0) return new Map()
    const rows = await this.prisma.productMedia.findMany({
      where: {
        productId: { in: [...productIds] },
        kind: 'IMAGE',
        isPrimary: true,
        detachedAt: null,
        mediaAsset: { is: { status: 'READY', deletedAt: null } },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { productId: true, mediaAsset: { select: { objectKey: true, sizeBytes: true } } },
    })
    const firstByProduct = new Map<string, ProductImageRow>()
    for (const row of rows as readonly ProductImageRow[]) {
      if (!firstByProduct.has(row.productId)) firstByProduct.set(row.productId, row)
    }
    const result = new Map<string, Buffer>()
    for (const [productId, row] of firstByProduct) {
      const bytes = await this.readThumbnail(row)
      if (bytes !== null) result.set(productId, bytes)
    }
    return result
  }

  private async readThumbnail(row: ProductImageRow): Promise<Buffer | null> {
    const asset = row.mediaAsset
    if (
      asset.objectKey === null
      || asset.sizeBytes === null
      || asset.sizeBytes > MEDIA_CONTENT_SIZE_LIMITS.IMAGE
    ) {
      return null
    }
    try {
      const stored = await this.delivery.open(requireMediaObjectKeyNamespace(asset.objectKey, 'assets'))
      const chunks: Buffer[] = []
      let size = 0n
      try {
        for await (const raw of stored.stream) {
          const chunk: unknown = raw
          if (!Buffer.isBuffer(chunk)) return null
          size += BigInt(chunk.length)
          if (size > MEDIA_CONTENT_SIZE_LIMITS.IMAGE) return null
          chunks.push(chunk)
        }
      }
      finally {
        stored.stream.destroy()
      }
      if (size !== asset.sizeBytes) return null
      return await sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000 }).rotate()
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true })
        .png().toBuffer()
    }
    catch {
      return null
    }
  }

  /**
   * 产品档案可能在用户选品后改价；在读取图片和渲染前拒绝，避免图片数字与屏幕当前展示不一致。
   */
  private assertReferencePrices(
    lines: readonly NormalizedPriceQuotationSheetCatalogLine[],
    referenceById: ReadonlyMap<string, string>,
  ): void {
    for (const line of lines) {
      if (referenceById.get(line.productId) !== line.expectedReferencePurchaseUnitPriceAmount) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'PURCHASE_ORDER_STATE_CHANGED',
          '产品采购定价已变化，请重新确认后再生成核价单',
        )
      }
    }
  }

  private toSnapshotLine(
    line: NormalizedPriceQuotationSheetLine,
    products: ReadonlyMap<string, CatalogProductSnapshot>,
    referenceById: ReadonlyMap<string, string>,
  ): PriceQuotationSheetSnapshot['lines'][number] {
    if (line.lineType === 'CUSTOM') {
      return Object.freeze({
        lineNumber: line.lineNumber,
        productName: line.name,
        description: line.description,
        imageKey: null,
        quantity: line.quantity,
        referenceUnitPrice: line.referencePurchaseUnitPriceAmount,
        actualUnitPrice: line.actualPurchaseUnitPriceAmount,
        actualAmount: line.lineTotalAmount,
      })
    }
    const product = products.get(line.productId)
    if (product === undefined) {
      return purchaseOrderRuleFailure(
        'PURCHASE_ORDER_PRODUCT_UNAVAILABLE',
        '所选产品已停用或不存在',
      )
    }
    return Object.freeze({
      lineNumber: line.lineNumber,
      productName: product.name,
      description: line.description,
      imageKey: product.id,
      quantity: line.quantity,
      referenceUnitPrice: referenceById.get(line.productId)!,
      actualUnitPrice: line.actualPurchaseUnitPriceAmount,
      actualAmount: line.lineTotalAmount,
    })
  }
}
