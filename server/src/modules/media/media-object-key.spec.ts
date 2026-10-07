import {
  belongsToMediaStorageEnvironment,
  buildMediaObjectKey,
  isMediaStoragePool,
  type MediaStoragePool,
  MediaObjectKeyError,
  parseStoredMediaObjectKey,
} from './media-object-key'

const ASSET_ID = '6f1c9a44-2b0e-4f6d-9c31-8a7b5e0d1234'

type BuildOverrides = Partial<Parameters<typeof buildMediaObjectKey>[0]>

function buildWith(overrides: BuildOverrides): string {
  return buildMediaObjectKey({
    assetId: ASSET_ID,
    canonicalExtension: '.png',
    now: new Date('2026-10-07T00:00:00.000Z'),
    pool: 'product',
    storageEnvironment: 'dev',
    ...overrides,
  })
}

describe('media object key', () => {
  describe('buildMediaObjectKey', () => {
    it('builds the structured layout with the UTC upload month', () => {
      // 东八区的 10 月 1 日 02:00 仍是 UTC 的 9 月 30 日：键内年月只作分片，不等于业务口径月份。
      expect(buildWith({
        now: new Date('2026-09-30T18:00:00.000Z'),
        pool: 'voucher',
        storageEnvironment: 'prod',
      })).toBe(`assets/prod/voucher/2026/09/${ASSET_ID}.png`)
    })

    it.each<[string, BuildOverrides]>([
      ['unknown pool', { pool: 'payments' as MediaStoragePool }],
      ['four-digit pool', { pool: '2026' as MediaStoragePool }],
      ['uppercase pool', { pool: 'VOUCHER' as MediaStoragePool }],
      ['unknown environment', { storageEnvironment: 'staging' as never }],
      ['four-digit environment', { storageEnvironment: '2026' as never }],
      ['non-uuid asset id', { assetId: 'not-a-uuid' }],
      ['invalid clock', { now: new Date(Number.NaN) }],
    ])('rejects %s', (_label, overrides) => {
      expect(() => buildWith(overrides)).toThrow(MediaObjectKeyError)
    })
  })

  describe('parseStoredMediaObjectKey', () => {
    it('parses the legacy layout without an environment or pool segment', () => {
      expect(parseStoredMediaObjectKey(`assets/2026/10/${ASSET_ID}.jpg`)).toEqual({
        assetId: ASSET_ID,
        extension: '.jpg',
        layout: 'legacy',
        namespace: 'assets',
        pool: null,
        storageEnvironment: null,
      })
    })

    it('parses the structured layout in both namespaces', () => {
      expect(parseStoredMediaObjectKey(
        `trash/prod/payment-recipient/2026/10/${ASSET_ID}.webp`,
      )).toEqual({
        assetId: ASSET_ID,
        extension: '.webp',
        layout: 'structured',
        namespace: 'trash',
        pool: 'payment-recipient',
        storageEnvironment: 'prod',
      })
    })

    it('normalizes case instead of rejecting it', () => {
      const parsed = parseStoredMediaObjectKey(
        `assets/prod/voucher/2026/10/${ASSET_ID.toUpperCase()}.PNG`,
      )
      expect(parsed).toMatchObject({ assetId: ASSET_ID, extension: '.png' })
    })

    it.each([
      ['staging namespace', `staging/${ASSET_ID}.7d26e6e2-8ed4-4f1a-9f6f-3ac0d9b1e111.part`],
      ['unknown namespace', `_ops/prod/health-probe-read`],
      ['missing month', `assets/2026/${ASSET_ID}.jpg`],
      ['extra segment', `assets/prod/voucher/2026/10/extra/${ASSET_ID}.jpg`],
      ['non-numeric year', `assets/dev/product/abcd/10/${ASSET_ID}.jpg`],
      ['year in the environment slot', `assets/2026/product/2026/10/${ASSET_ID}.jpg`],
      ['year in the pool slot', `assets/prod/2026/2026/10/${ASSET_ID}.jpg`],
      ['missing extension', `assets/prod/voucher/2026/10/${ASSET_ID}`],
      ['non-uuid asset id', 'assets/prod/voucher/2026/10/readme.png'],
      ['absolute path', `/assets/prod/voucher/2026/10/${ASSET_ID}.png`],
      ['backslash', `assets\\prod\\voucher\\2026\\10\\${ASSET_ID}.png`],
    ])('returns null for %s', (_label, key) => {
      expect(parseStoredMediaObjectKey(key)).toBeNull()
    })

    it.each([null, undefined, '', 42, {}])(
      'returns null for the non-string input %p',
      (value) => {
        expect(parseStoredMediaObjectKey(value)).toBeNull()
      },
    )

    it('round-trips a generated key', () => {
      const key = buildMediaObjectKey({
        assetId: ASSET_ID,
        canonicalExtension: '.xlsx',
        now: new Date('2026-10-07T00:00:00.000Z'),
        pool: 'bill',
        storageEnvironment: 'test',
      })
      expect(parseStoredMediaObjectKey(key)).toEqual({
        assetId: ASSET_ID,
        extension: '.xlsx',
        layout: 'structured',
        namespace: 'assets',
        pool: 'bill',
        storageEnvironment: 'test',
      })
    })
  })

  describe('belongsToMediaStorageEnvironment', () => {
    it('keeps legacy objects visible to every environment', () => {
      const parsed = parseStoredMediaObjectKey(`assets/2026/10/${ASSET_ID}.jpg`)
      expect(parsed).not.toBeNull()
      expect(belongsToMediaStorageEnvironment(parsed!, 'dev')).toBe(true)
      expect(belongsToMediaStorageEnvironment(parsed!, 'prod')).toBe(true)
    })

    it('hides objects that belong to another environment', () => {
      const parsed = parseStoredMediaObjectKey(
        `assets/dev/product/2026/10/${ASSET_ID}.jpg`,
      )
      expect(parsed).not.toBeNull()
      expect(belongsToMediaStorageEnvironment(parsed!, 'dev')).toBe(true)
      expect(belongsToMediaStorageEnvironment(parsed!, 'prod')).toBe(false)
    })
  })

  it('exposes the pool inventory for call sites and the migration tool', () => {
    expect(isMediaStoragePool('payment-recipient')).toBe(true)
    expect(isMediaStoragePool('misc')).toBe(true)
    expect(isMediaStoragePool('invoices')).toBe(false)
  })
})
