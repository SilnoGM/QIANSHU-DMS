import { applyDecorators, HttpStatus } from '@nestjs/common'
import { ApiHeader, ApiQuery, type ApiResponseOptions } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import {
  MEDIA_VARIANT_CACHE_CONTROL,
  MEDIA_VARIANT_NAMES,
} from '../../media/media-variant.service'
import { PRIVATE_NO_STORE_CACHE_CONTROL } from '../../../infrastructure/http/private-no-store.interceptor'

const PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS: NonNullable<
  ApiResponseOptions['headers']
> = {
  'Accept-Ranges': {
    description: 'Byte-range capability is implemented by the selected private delivery mode; derived variants serve complete representations only.',
    schema: { type: 'string', enum: ['bytes', 'none'] },
  },
  // 原件路由的默认策略仍是 no-store，商品主路由按不可变内容放宽为长期私有缓存；
  // 派生变体由不可变原件确定性生成，任何路由上都返回长期私有缓存。
  'Cache-Control': {
    description: 'Private cache policy selected by route metadata and representation kind.',
    schema: {
      type: 'string',
      enum: [PRIVATE_NO_STORE_CACHE_CONTROL, MEDIA_VARIANT_CACHE_CONTROL],
    },
  },
  'Content-Disposition': {
    description: 'Inline disposition with a sanitized ASCII filename.',
    schema: { type: 'string' },
  },
  'Content-Length': {
    description: 'Selected representation length for application delivery.',
    schema: { type: 'string', pattern: '^\\d+$' },
  },
  'Content-Range': {
    description: 'Selected or unsatisfied byte range for application delivery.',
    schema: { type: 'string', pattern: '^bytes ' },
  },
  'Content-Type': {
    description: 'Trusted media type derived from validated persisted metadata.',
    schema: {
      type: 'string',
      enum: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
        'video/quicktime',
        'video/webm',
        'video/x-m4v',
      ],
    },
  },
  ETag: {
    description: 'Opaque strong entity tag for conditional requests.',
    schema: { type: 'string' },
  },
  'X-Accel-Redirect': {
    description: 'Optional protected internal proxy location selected after authorization.',
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
  'video/quicktime': { schema: { type: 'string', format: 'binary' } },
  'video/webm': { schema: { type: 'string', format: 'binary' } },
  'video/x-m4v': { schema: { type: 'string', format: 'binary' } },
} as const

/**
 * GET 与 HEAD 共享同一授权、条件请求及私有交付契约；仅 GET 声明 binary body。
 * application 模式由 Nest 返回完整或单区间内容，internal_redirect 模式继续交给 Nginx。
 */
export interface ProductMediaContentContractOptions {
  readonly operationId?: string
  readonly notFoundCode?: string
  readonly description?: string
}

export function ApiProductMediaContentContract(
  method: 'GET' | 'HEAD',
  options: ProductMediaContentContractOptions = {},
): MethodDecorator {
  return applyDecorators(
    ApiQuery({
      name: 'variant',
      required: false,
      enum: [...MEDIA_VARIANT_NAMES],
      description:
        'Derived presentation variant: thumb (IMAGE only) or poster (VIDEO only). '
        + 'Variants are rendered on demand and cached privately by the browser.',
    }),
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
      description: options.description ?? 'Authorized private product media content.',
      headers: PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS,
      ...(method === 'GET' ? { content: PRODUCT_MEDIA_CONTENT } : {}),
    }),
    ApiContractResponse({
      status: HttpStatus.PARTIAL_CONTENT,
      description: options.description ?? 'Authorized private product media byte range.',
      headers: PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS,
      ...(method === 'GET' ? { content: PRODUCT_MEDIA_CONTENT } : {}),
    }),
    ApiContractResponse({
      status: HttpStatus.NOT_MODIFIED,
      description: 'The current opaque ETag matches If-None-Match.',
      headers: {
        'Accept-Ranges': PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS['Accept-Ranges'],
        'Cache-Control': PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS['Cache-Control'],
        ETag: PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS.ETag,
        'X-Content-Type-Options':
          PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS['X-Content-Type-Options'],
      },
    }),
    ApiContractResponse({
      status: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      description: 'The requested application-delivery byte range is invalid or unsatisfied.',
      headers: {
        'Accept-Ranges': PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS['Accept-Ranges'],
        'Cache-Control': PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS['Cache-Control'],
        'Content-Range': PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS['Content-Range'],
        ETag: PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS.ETag,
        'X-Content-Type-Options':
          PRODUCT_MEDIA_CONTENT_RESPONSE_HEADERS['X-Content-Type-Options'],
      },
    }),
    ApiApplicationContract({
      operationId: options.operationId ?? (method === 'GET'
        ? 'products_get_media_content'
        : 'products_head_media_content'),
      session: 'required',
      authorization: true,
      badRequest: true,
      resourceLocator: true,
      validation: true,
      // 不设置 privateNoStore：缓存策略按「路由元数据 + 表示种类」在两档之间选择，
      // 由上方响应头里的 Cache-Control 枚举如实声明；错误响应仍由异常过滤器固定 no-store。
      errors: [
        {
          status: 403,
          codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
        },
        { status: 404, codes: [options.notFoundCode ?? 'PRODUCT_MEDIA_NOT_FOUND'] },
        { status: 422, codes: ['VALIDATION_FAILED'] },
        { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
      ],
    }),
  )
}
