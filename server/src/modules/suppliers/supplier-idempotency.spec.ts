import { createHash, createHmac } from 'node:crypto'

import { SupplierEntityType } from '../../generated/prisma/enums'
import {
  buildSupplierNumberingIdempotencyKey,
  calculateSupplierCreateFingerprintHash,
  calculateSupplierCreateScopeHash,
  normalizeSupplierIdempotencyKey,
  serializeCanonicalSupplierCreatePayload,
  SUPPLIER_CREATE_ENDPOINT,
  SUPPLIER_CREATE_FINGERPRINT_VERSION,
  SUPPLIER_CREATE_SCOPE_VERSION,
} from './supplier-idempotency'
import { normalizeCreateSupplierInput } from './supplier.normalizer'

const ACTOR_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const KEY = '2f1adcbc-5d63-4f0f-9a9f-265d4c823241'

describe('supplier create idempotency', () => {
  it('accepts only an exact canonical lowercase UUID v4 key', () => {
    expect(normalizeSupplierIdempotencyKey(KEY)).toBe(KEY)

    for (const invalid of [
      KEY.toUpperCase(),
      ` ${KEY}`,
      '2f1adcbc-5d63-1f0f-9a9f-265d4c823241',
      '2f1adcbc-5d63-4f0f-7a9f-265d4c823241',
      'not-a-uuid',
      null,
    ]) {
      expect(() => normalizeSupplierIdempotencyKey(invalid)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      )
    }
  })

  it('serializes the normalized payload with an exact version and key order', () => {
    const normalized = normalizeCreateSupplierInput({
      legalName: '  示例供方  ',
      entityType: SupplierEntityType.ORGANIZATION,
      remark: ' ',
    })

    expect(serializeCanonicalSupplierCreatePayload(normalized)).toBe(
      JSON.stringify({
        version: SUPPLIER_CREATE_FINGERPRINT_VERSION,
        legalName: '示例供方',
        shortName: null,
        entityType: 'ORGANIZATION',
        registration: null,
        primaryContact: null,
        primaryAddress: null,
        remark: null,
      }),
    )
  })

  it('makes omitted, blank and explicit null optional fields fingerprint-equivalent', () => {
    const first = normalizeCreateSupplierInput({
      legalName: '示例供方',
      entityType: SupplierEntityType.ORGANIZATION,
    })
    const second = normalizeCreateSupplierInput({
      legalName: ' 示例供方 ',
      shortName: ' ',
      entityType: SupplierEntityType.ORGANIZATION,
      registration: null,
      primaryContact: null,
      primaryAddress: null,
      remark: null,
    })

    expect(calculateSupplierCreateFingerprintHash(KEY, first)).toEqual(
      calculateSupplierCreateFingerprintHash(KEY, second),
    )
  })

  it('uses SHA-256 scope and HMAC-SHA-256 payload without returning raw key', () => {
    const payload = normalizeCreateSupplierInput({
      legalName: '示例供方',
      entityType: SupplierEntityType.ORGANIZATION,
    })
    const canonical = serializeCanonicalSupplierCreatePayload(payload)

    expect(calculateSupplierCreateScopeHash(ACTOR_ID, KEY)).toEqual(
      createHash('sha256').update(Buffer.from(
        `${SUPPLIER_CREATE_SCOPE_VERSION}\0${ACTOR_ID}\0${SUPPLIER_CREATE_ENDPOINT}\0${KEY}`,
        'utf8',
      )).digest(),
    )
    expect(calculateSupplierCreateFingerprintHash(KEY, payload)).toEqual(
      createHmac('sha256', Buffer.from(KEY, 'utf8'))
        .update(Buffer.from(canonical, 'utf8'))
        .digest(),
    )
    expect(calculateSupplierCreateScopeHash(ACTOR_ID, KEY)).toHaveLength(32)
    expect(calculateSupplierCreateFingerprintHash(KEY, payload)).toHaveLength(32)
  })

  it('separates actor scopes and normalized payload identities', () => {
    const base = normalizeCreateSupplierInput({
      legalName: '示例供方',
      entityType: SupplierEntityType.ORGANIZATION,
    })
    const changed = normalizeCreateSupplierInput({
      legalName: '另一供方',
      entityType: SupplierEntityType.ORGANIZATION,
    })

    expect(calculateSupplierCreateScopeHash(ACTOR_ID, KEY)).not.toEqual(
      calculateSupplierCreateScopeHash(
        'ba6e6036-42c7-489b-b22b-238c3d36a879',
        KEY,
      ),
    )
    expect(calculateSupplierCreateFingerprintHash(KEY, base)).not.toEqual(
      calculateSupplierCreateFingerprintHash(KEY, changed),
    )
  })

  it('binds the internal numbering replay identity to actor and public key', () => {
    expect(buildSupplierNumberingIdempotencyKey(ACTOR_ID, KEY)).toBe(
      `supplier.create.v1:${ACTOR_ID}:${KEY}`,
    )
    expect(Buffer.byteLength(
      buildSupplierNumberingIdempotencyKey(ACTOR_ID, KEY),
      'utf8',
    )).toBeLessThanOrEqual(200)
  })
})
