import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator'

import { MediaType } from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

export class PurchaseOrderDocumentAttachRequestDto {
  @ApiProperty({ enum: ['ORDER_ISSUANCE_VOUCHER', 'DELIVERY_RECEIPT'] })
  @IsIn(['ORDER_ISSUANCE_VOUCHER', 'DELIVERY_RECEIPT'])
  documentType!: 'ORDER_ISSUANCE_VOUCHER' | 'DELIVERY_RECEIPT'

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  mediaAssetId!: string

  @ApiProperty({ type: 'string', maxLength: 500, required: false, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  remark?: string | null
}

export class PurchaseOrderDocumentUploadRequestDto {
  @ApiProperty({ type: 'string', enum: ['IMAGE', 'DOCUMENT'] })
  readonly mediaType!: Extract<MediaType, 'IMAGE' | 'DOCUMENT'>

  @ApiProperty({ type: 'string', format: 'binary' })
  readonly file!: string
}

export class PurchaseOrderTemporaryDocumentDto {
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
