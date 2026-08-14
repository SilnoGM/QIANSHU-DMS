import { applyDecorators, HttpStatus } from '@nestjs/common'
import { ApiHeader, type ApiResponseOptions } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'

const PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS: NonNullable<
  ApiResponseOptions['headers']
> = {
  'Accept-Ranges': {
    description: 'Byte-range capability is implemented by the internal proxy.',
    schema: { type: 'string', enum: ['bytes'] },
  },
  'Content-Disposition': {
    description: 'Inline disposition with a sanitized ASCII filename.',
    schema: { type: 'string' },
  },
  'Content-Type': {
    description: 'Trusted media type derived from validated persisted metadata.',
    schema: {
      type: 'string',
      enum: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
    },
  },
  ETag: {
    description: 'Opaque strong entity tag for conditional requests.',
    schema: { type: 'string' },
  },
  'X-Accel-Redirect': {
    description: 'Protected internal proxy location selected after authorization.',
    schema: { type: 'string' },
  },
  'X-Content-Type-Options': {
    schema: { type: 'string', enum: ['nosniff'] },
  },
}

const PRODUCT_MEDIA_CONTENT = {
  'image/jpeg': { schema: { type: 'string', format: 'binary' } },
  'image/png': { schema: { type: 'string', format: 'binary' } },
  'image/webp': { schema: { type: 'string', format: 'binary' } },
  'video/mp4': { schema: { type: 'string', format: 'binary' } },
} as const

/**
 * GET 与 HEAD 共享同一授权、条件请求及代理响应契约；仅 GET 声明 binary body。
 * Range Header 会原样抵达 Nginx，Nest 只声明能力，不在应用进程中解释或读取文件。
 */
export function ApiProductMediaContentContract(
  method: 'GET' | 'HEAD',
): MethodDecorator {
  return applyDecorators(
    ApiHeader({
      name: 'If-None-Match',
      required: false,
      schema: { type: 'string' },
    }),
    ApiHeader({
      name: 'Range',
      required: false,
      schema: { type: 'string', pattern: '^bytes=' },
    }),
    ApiContractResponse({
      status: HttpStatus.OK,
      description: 'Authorized private product media content.',
      headers: PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS,
      ...(method === 'GET' ? { content: PRODUCT_MEDIA_CONTENT } : {}),
    }),
    ApiContractResponse({
      status: HttpStatus.NOT_MODIFIED,
      description: 'The current opaque ETag matches If-None-Match.',
      headers: {
        'Accept-Ranges': PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS['Accept-Ranges'],
        ETag: PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS.ETag,
        'X-Content-Type-Options':
          PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS['X-Content-Type-Options'],
      },
    }),
    ApiApplicationContract({
      operationId: method === 'GET'
        ? 'products_get_media_content'
        : 'products_head_media_content',
      session: 'required',
      authorization: true,
      badRequest: true,
      resourceLocator: true,
      validation: true,
      privateNoStore: true,
      errors: [
        {
          status: 403,
          codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
        },
        { status: 404, codes: ['PRODUCT_MEDIA_NOT_FOUND'] },
        { status: 422, codes: ['VALIDATION_FAILED'] },
      ],
    }),
  )
}
