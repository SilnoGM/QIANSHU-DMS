import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID } from 'class-validator'

import { MediaType } from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class SalesOrderDocumentUploadRequestDto {
  @ApiProperty({ type: 'string', enum: ['IMAGE', 'DOCUMENT'] })
  readonly mediaType!: Extract<MediaType, 'IMAGE' | 'DOCUMENT'>

  /**
   * 可选的凭证用途。只有收款凭证需要显式声明：它与出单凭证共用本入口，而对象键由本入口在
   * 上传瞬间物化且不可改写。缺省＝出单凭证 / 签收单。
   */
  @ApiProperty({ type: 'string', enum: ['PAYMENT_VOUCHER'], required: false })
  readonly purpose?: 'PAYMENT_VOUCHER'

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
