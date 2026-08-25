import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

import { MediaType } from '../../../generated/prisma/enums'

export class SalesOrderDocumentUploadRequestDto {
  @ApiProperty({ type: 'string', enum: ['IMAGE', 'DOCUMENT'] })
  readonly mediaType!: Extract<MediaType, 'IMAGE' | 'DOCUMENT'>

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
}

export class SalesOrderDocumentIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  salesOrderId!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  documentId!: string
}
