import { ApiProperty } from '@nestjs/swagger'

import { MediaType } from '../../../generated/prisma/enums'

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
