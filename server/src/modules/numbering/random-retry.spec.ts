import {
  MAX_RANDOM_ATTEMPTS,
  retryRandomCandidate,
} from './random-retry'
import {
  NUMBERING_ERROR_CODES,
  NumberingGenerationError,
} from './numbering.errors'

describe('numbering random collision retry', () => {
  it('freezes the maximum attempt count at 32', () => {
    expect(MAX_RANDOM_ATTEMPTS).toBe(32)
  })

  it.each(Array.from({ length: 31 }, (_, index) => index + 1))(
    'returns the candidate after %i prior collisions',
    async (collisionCount) => {
      const generatedAttempts: number[] = []
      const triedAttempts: number[] = []

      const candidate = await retryRandomCandidate(
        (attempt) => {
          generatedAttempts.push(attempt)
          return `CANDIDATE_${attempt}`
        },
        (_value, attempt) => {
          triedAttempts.push(attempt)
          return attempt > collisionCount
        },
      )

      expect(candidate).toBe(`CANDIDATE_${collisionCount + 1}`)
      expect(generatedAttempts).toEqual(
        Array.from({ length: collisionCount + 1 }, (_, index) => index + 1),
      )
      expect(triedAttempts).toEqual(generatedAttempts)
    },
  )

  it('throws the stable retry exhaustion error after exactly 32 collisions', async () => {
    const attempts: number[] = []
    const periodState = {
      usedCount: 7n,
      nextSequenceValue: null,
    }
    const stateBefore = { ...periodState }

    let thrown: unknown
    try {
      await retryRandomCandidate(
        (attempt) => `CANDIDATE_${attempt}`,
        (_candidate, attempt) => {
          attempts.push(attempt)
          return false
        },
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(NumberingGenerationError)
    expect(thrown).toMatchObject({
      code: NUMBERING_ERROR_CODES.GENERATION_RETRY_EXHAUSTED,
      retryable: true,
    })
    expect(attempts).toEqual(
      Array.from({ length: MAX_RANDOM_ATTEMPTS }, (_, index) => index + 1),
    )
    expect(periodState).toEqual(stateBefore)
  })

  it('propagates callback failures without pretending they are collisions', async () => {
    const persistenceFailure = new Error('structured persistence failure')
    let candidateCount = 0

    await expect(retryRandomCandidate(
      () => {
        candidateCount += 1
        return 'CANDIDATE'
      },
      () => {
        throw persistenceFailure
      },
    )).rejects.toBe(persistenceFailure)
    expect(candidateCount).toBe(1)
  })
})
