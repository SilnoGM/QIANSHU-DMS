import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID } from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class SalesOrderDocumentUploadRequestDto {
  @ApiProperty({ type: 'string', enum: ['IMAGE'] })
  readonly mediaType!: 'IMAGE'

  /**
   * 可选的凭证用途。出单凭证、收款凭证与签收单共用本入口，且全部只允许图片；
   * 用途只决定对象池与业务归属，对象键一旦物化不可改写。缺省＝出单凭证。
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

  @ApiProperty({ enum: ['IMAGE'] })
  readonly mediaType!: 'IMAGE'

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
