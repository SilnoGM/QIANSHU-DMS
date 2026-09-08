import {
  hasPersistenceCode,
  readPersistenceErrorFacts,
} from './persistence-error-facts'

describe('readPersistenceErrorFacts', () => {
  it('reads Prisma driver-adapter originalCode without parsing sensitive messages', () => {
    const facts = readPersistenceErrorFacts({
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: {
            kind: 'postgres',
            originalCode: '40001',
            originalMessage: 'must-not-be-parsed',
          },
        },
      },
    })

    expect(hasPersistenceCode(facts, 'P2010')).toBe(true)
    expect(hasPersistenceCode(facts, '40001')).toBe(true)
    expect(hasPersistenceCode(facts, 'must-not-be-parsed')).toBe(false)
  })
})
