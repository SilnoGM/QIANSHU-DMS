import { HttpStatus } from '@nestjs/common'

import {
  hasPersistenceCode,
  hasPersistenceConstraint,
  readPersistenceErrorFacts,
} from '../../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { MediaAssetLifecycleError } from '../../media/media-asset.service'
import { MediaStorageError } from '../../media/media-storage'
import { ProductMediaPersistenceStateError } from './product-media.persistence'

const PRODUCT_STATE_CHANGE_CODES = [
  'P2034',
  '40001',
  '40P01',
  '55P03',
  '57014',
] as const

const PRODUCT_STATE_CONSTRAINTS = [
  'product_media_active_product_asset_key',
  'product_media_asset_ready_check',
  'media_assets_active_reference_check',
] as const

const LAYOUT_CONSTRAINTS = [
  'product_media_active_product_kind_sort_order_key',
  'product_media_active_product_primary_key',
  'product_media_primary_image_check',
] as const

function mediaException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

export function productMediaInternalError(): ApiException {
  return mediaException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}

export function productMediaNotFoundError(): ApiException {
  return mediaException(
    HttpStatus.NOT_FOUND,
    'PRODUCT_MEDIA_NOT_FOUND',
    '产品或媒体不存在',
  )
}

export function productMediaMultipartInvalidError(): ApiException {
  return mediaException(
    HttpStatus.BAD_REQUEST,
    'MEDIA_MULTIPART_INVALID',
    '媒体上传请求格式无效',
  )
}

export function productMediaFileTooLargeError(): ApiException {
  return mediaException(
    HttpStatus.PAYLOAD_TOO_LARGE,
    'MEDIA_FILE_TOO_LARGE',
    '媒体文件超过大小限制',
  )
}

export function productStateChangedError(): ApiException {
  return mediaException(
    HttpStatus.CONFLICT,
    'PRODUCT_STATE_CHANGED',
    '产品已变化，请刷新后重试',
  )
}

export function productMediaLayoutChangedError(): ApiException {
  return mediaException(
    HttpStatus.CONFLICT,
    'PRODUCT_MEDIA_LAYOUT_CHANGED',
    '产品媒体布局已变化，请刷新后重试',
  )
}

export function productMediaLimitExceededError(): ApiException {
  return mediaException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PRODUCT_MEDIA_LIMIT_EXCEEDED',
    '产品媒体数量已达到上限',
  )
}

export function productMediaUnsupportedTypeError(): ApiException {
  return mediaException(
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'MEDIA_TYPE_UNSUPPORTED',
    '媒体类型不受支持',
  )
}

export function productMediaStorageUnavailableError(): ApiException {
  return mediaException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'MEDIA_STORAGE_UNAVAILABLE',
    '媒体存储暂不可用',
  )
}

export function productMediaValidationError(): ApiException {
  return mediaException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
  )
}

function mapLifecycleError(error: MediaAssetLifecycleError): never {
  if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') {
    throw productMediaFileTooLargeError()
  }
  if (
    error.code === 'MEDIA_ASSET_CONTENT_TYPE_MISMATCH'
    || error.code === 'MEDIA_ASSET_CONTENT_UNSUPPORTED'
    || error.code === 'MEDIA_ASSET_TYPE_NOT_ALLOWED'
  ) {
    throw productMediaUnsupportedTypeError()
  }
  if (error.code === 'MEDIA_ASSET_CONTENT_INVALID') {
    throw mediaException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'MEDIA_CONTENT_INVALID',
      '媒体文件内容无效',
    )
  }
  if (
    error.code === 'MEDIA_ASSET_STORAGE_FAILED'
    || error.code === 'MEDIA_ASSET_STREAM_FAILED'
    || error.code === 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE'
  ) {
    throw productMediaStorageUnavailableError()
  }
  throw productMediaInternalError()
}

/**
 * 只读取结构化 error code、SQLSTATE 和约束名，绝不解析数据库 message/detail，
 * 从而让路径、SQL、文件内容和驱动上下文无法进入稳定公开错误。
 */
export function mapProductMediaCommandError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof MediaAssetLifecycleError) return mapLifecycleError(error)
  if (error instanceof MediaStorageError) throw productMediaStorageUnavailableError()
  if (error instanceof ProductMediaPersistenceStateError) {
    throw productStateChangedError()
  }

  const facts = readPersistenceErrorFacts(error)
  if (PRODUCT_STATE_CHANGE_CODES.some(code => hasPersistenceCode(facts, code))) {
    throw productStateChangedError()
  }
  if (PRODUCT_STATE_CONSTRAINTS.some(name => hasPersistenceConstraint(facts, name))) {
    throw productStateChangedError()
  }
  if (LAYOUT_CONSTRAINTS.some(name => hasPersistenceConstraint(facts, name))) {
    throw productMediaLayoutChangedError()
  }
  if (hasPersistenceConstraint(facts, 'product_media_asset_type_check')) {
    throw productMediaUnsupportedTypeError()
  }
  throw productMediaInternalError()
}
