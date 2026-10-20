import {
  buildAvatarContentUrl,
  parseAvatarContentUrl,
  USER_AVATAR_UPLOAD_PURPOSE,
} from './profile-avatar.logic'

const ASSET_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const APP_ORIGIN = 'https://dms.example.com'

describe('profile avatar content URL', () => {
  it('builds an absolute URL on the configured app origin', () => {
    expect(buildAvatarContentUrl(APP_ORIGIN, ASSET_ID)).toBe(
      `https://dms.example.com/api/profile/avatars/${ASSET_ID}/content`,
    )
  })

  it('parses only the exact same-origin avatar content path', () => {
    const value = buildAvatarContentUrl(APP_ORIGIN, ASSET_ID)
    expect(parseAvatarContentUrl(value, APP_ORIGIN)).toBe(ASSET_ID)

    for (const invalid of [
      `https://evil.example.com/api/profile/avatars/${ASSET_ID}/content`,
      `https://dms.example.com/api/profile/avatars/${ASSET_ID}/content?x=1`,
      `https://dms.example.com/api/profile/avatars/${ASSET_ID}/content#x`,
      `https://dms.example.com/api/profile/avatars/not-a-uuid/content`,
      `https://dms.example.com/api/profile/avatars/${ASSET_ID}/content/`,
      `https://user:pass@dms.example.com/api/profile/avatars/${ASSET_ID}/content`,
      `https://dms.example.com/api/profile/avatars/${ASSET_ID}`,
      'https://cdn.example.com/avatar.png',
      'not-a-url',
    ]) {
      expect(parseAvatarContentUrl(invalid, APP_ORIGIN)).toBeNull()
    }
  })

  it('keeps the avatar upload purpose stable', () => {
    expect(USER_AVATAR_UPLOAD_PURPOSE).toBe('USER_AVATAR')
  })
})
