import type { Readable } from 'node:stream'

import {
  MediaType,
  ProductMediaKind,
  type ProductMediaKind as ProductMediaKindValue,
} from '../../../generated/prisma/enums'
import { isCanonicalProductActorId } from '../product-command.normalizer'
import {
  productMediaInternalError,
  productMediaLayoutChangedError,
  productMediaUnsupportedTypeError,
  productMediaValidationError,
} from './product-media.errors'
import type { ProductMediaSnapshotItem } from './product-media.persistence'

const IMAGE_LIMIT = 20
const VIDEO_LIMIT = 5
const REQUEST_ID_MAXIMUM_CODE_POINTS = 64

export interface ProductMediaCommandContext {
  /** AuthenticationGuard 写入的可信、canonical lowercase Session User id。 */
  readonly actorUserId: string
  /** request-id middleware 已校验的请求标识。 */
  readonly requestId: string
}

export interface ProductMediaUploadInput {
  readonly declaredMimeType: string | null
  readonly expectedVersion: number
  readonly kind: ProductMediaKindValue
  readonly originalFilename: string
  readonly stream: Readable
}

export interface ProductMediaLayoutInput {
  readonly expectedVersion: number
  readonly imageIds: readonly string[]
  readonly primaryImageId: string | null
  readonly videoIds: readonly string[]
}

export interface ProductMediaDetachInput {
  readonly expectedVersion: number
}

export interface ProductMediaCommandResult {
  readonly affectedProductMediaId: string | null
  readonly changed: boolean
  readonly items: readonly ProductMediaSnapshotItem[]
  readonly productId: string
  readonly version: number
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
  })
}

export function validateProductMediaContext(
  context: ProductMediaCommandContext,
): ProductMediaCommandContext {
  if (
    !context
    || !isCanonicalProductActorId(context.actorUserId)
    || typeof context.requestId !== 'string'
    || context.requestId.length === 0
    || [...context.requestId].length > REQUEST_ID_MAXIMUM_CODE_POINTS
    || hasControlCharacter(context.requestId)
  ) {
    throw productMediaInternalError()
  }
  return Object.freeze({
    actorUserId: context.actorUserId,
    requestId: context.requestId,
  })
}

export function validateProductMediaExpectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw productMediaValidationError()
  }
  return value
}

export function validateProductMediaKind(
  value: ProductMediaKindValue,
): ProductMediaKindValue {
  if (!Object.values(ProductMediaKind).includes(value)) {
    throw productMediaUnsupportedTypeError()
  }
  return value
}

function normalizeIdArray(value: unknown): readonly string[] | null {
  if (
    !Array.isArray(value)
    || !value.every((item: unknown) => typeof item === 'string' && item.length > 0)
  ) {
    return null
  }
  return Object.freeze(value.map((item: unknown) => item as string))
}

export function mediaTypeForProductMedia(kind: ProductMediaKindValue): MediaType {
  return kind === ProductMediaKind.IMAGE ? MediaType.IMAGE : MediaType.VIDEO
}

export function productMediaLimit(kind: ProductMediaKindValue): number {
  return kind === ProductMediaKind.IMAGE ? IMAGE_LIMIT : VIDEO_LIMIT
}

export function validateProductMediaLayoutInput(
  input: ProductMediaLayoutInput,
): ProductMediaLayoutInput {
  validateProductMediaExpectedVersion(input.expectedVersion)
  const imageIds = normalizeIdArray(input.imageIds)
  const videoIds = normalizeIdArray(input.videoIds)
  if (
    imageIds === null
    || videoIds === null
    || new Set(imageIds).size !== imageIds.length
    || new Set(videoIds).size !== videoIds.length
    || imageIds.some(id => videoIds.includes(id))
    || (input.primaryImageId !== null && !imageIds.includes(input.primaryImageId))
  ) {
    throw productMediaLayoutChangedError()
  }
  return Object.freeze({
    expectedVersion: input.expectedVersion,
    imageIds,
    primaryImageId: input.primaryImageId,
    videoIds,
  })
}

export function productMediaSnapshotResult(
  productId: string,
  version: number,
  items: readonly ProductMediaSnapshotItem[],
  changed: boolean,
  affectedProductMediaId: string | null,
): ProductMediaCommandResult {
  return Object.freeze({
    affectedProductMediaId,
    changed,
    items: Object.freeze(items.map(item => Object.freeze({ ...item }))),
    productId,
    version,
  })
}

export function productMediaIdsFor(
  items: readonly ProductMediaSnapshotItem[],
  kind: ProductMediaKindValue,
): string[] {
  return items
    .filter(item => item.kind === kind)
    .sort((left, right) => (
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
    ))
    .map(item => item.id)
}

export function sameOrderedProductMediaIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function sameProductMediaIdSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(id => rightSet.has(id))
}

export function currentPrimaryImageId(
  items: readonly ProductMediaSnapshotItem[],
): string | null {
  const primary = items.filter(item => (
    item.isPrimary && item.kind === ProductMediaKind.IMAGE
  ))
  if (
    primary.length > 1
    || items.some(item => item.isPrimary && item.kind !== ProductMediaKind.IMAGE)
  ) {
    throw productMediaInternalError()
  }
  return primary[0]?.id ?? null
}

export function assertContinuousProductMediaKind(
  items: readonly ProductMediaSnapshotItem[],
  kind: ProductMediaKindValue,
): void {
  const ordered = items
    .filter(item => item.kind === kind)
    .sort((left, right) => (
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
    ))
  if (ordered.some((item, index) => item.sortOrder !== index)) {
    throw productMediaInternalError()
  }
}
