import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID } from 'class-validator'

import { MediaType } from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class SalesOrderDocumentUploadRequestDto {
  @ApiProperty({ type: 'string', enum: ['IMAGE', 'DOCUMENT'] })
  readonly mediaType!: Extract<MediaType, 'IMAGE' | 'DOCUMENT'>

  /**
   * 可选的凭证用途。收款凭证与签收单必须显式声明，才能在上传瞬间收紧为图片：
   * 它们与出单凭证共用本入口，而对象键一旦物化不可改写。缺省＝出单凭证。
   */
  @ApiProperty({
    type: 'string',
    enum: ['PAYMENT_VOUCHER', 'DELIVERY_RECEIPT'],
    required: false,
  })
  readonly purpose?: 'PAYMENT_VOUCHER' | 'DELIVERY_RECEIPT'

  @ApiProperty({ type: 'string', format: 'binary' })
  readonly file!: string
}

export class SalesOrderTemporaryDocumentDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  readonly mediaAssetId!: string

  @ApiProperty({ enum: ['IMAGE', 'DOCUMENT'] })
  readonly mediaType!: Extract<MediaType, 'IMAGE' | 'DOCUMENT'>

  @ApiProperty({ type: 'string' })
  readonly mimeType!: string

  @ApiProperty({ type: 'string', pattern: '^\\d+$' })
  readonly sizeBytes!: string

  @ApiProperty({ type: 'string' })
  readonly originalFilename!: string
}

export class SalesOrderDeliveryReceiptRequestDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  mediaAssetId!: string

  @ApiProperty({ type: 'string', maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  remark!: string | null
}

export class SalesOrderDocumentIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  salesOrderId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  documentId!: string
}
