import {
  DATA_SCOPE_ALL,
  DATA_SCOPE_SELF,
  OPERATIONS_STAFF_ROLE_CODE,
  resolveDataScope,
} from './data-scope'

describe('resolveDataScope', () => {
  it('keeps roles without an explicit self scope on the full data set', () => {
    expect(resolveDataScope({
      permissionCodes: ['sales-orders:read'],
      roleCodes: ['finance_staff'],
    })).toBe('ALL')
    expect(resolveDataScope({
      permissionCodes: [],
      roleCodes: [],
    })).toBe('ALL')
  })

  it('restricts a role holding data-scope:self to its own records', () => {
    expect(resolveDataScope({
      permissionCodes: [DATA_SCOPE_SELF],
      roleCodes: ['custom_sales'],
    })).toBe('SELF')
  })

  it('restricts the built-in operations role even if data-scope:self was removed', () => {
    expect(resolveDataScope({
      permissionCodes: [],
      roleCodes: [OPERATIONS_STAFF_ROLE_CODE],
    })).toBe('SELF')
  })

  it('lets data-scope:all override both self and the operations role', () => {
    expect(resolveDataScope({
      permissionCodes: [DATA_SCOPE_ALL, DATA_SCOPE_SELF],
      roleCodes: [OPERATIONS_STAFF_ROLE_CODE],
    })).toBe('ALL')
  })
})
