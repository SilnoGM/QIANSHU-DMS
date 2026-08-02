import {
  NUMBERING_ERROR_CODES,
  NumberingGenerationError,
} from './numbering.errors'

export const MAX_RANDOM_ATTEMPTS = 32 as const

export type RandomCandidateFactory<T> = (attempt: number) => T

/**
 * true 表示调用方已原子接受该候选，false 表示候选发生冲突。Task 8 只定义
 * 这个窄边界；Task 9 才会用 PostgreSQL conflict target 提供真实实现，禁止
 * 把非原子的“先查是否存在”伪装成这里的 callback。
 */
export type TryClaimRandomCandidate<T> = (
  candidate: T,
  attempt: number,
) => boolean | Promise<boolean>

/**
 * 重试器只选择第一个被接受的候选，不接收或推进 period state。调用方必须在
 * 返回成功后再推进状态；32 次全部冲突时，本函数只抛稳定错误。
 */
export async function retryRandomCandidate<T>(
  createCandidate: RandomCandidateFactory<T>,
  tryClaimCandidate: TryClaimRandomCandidate<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RANDOM_ATTEMPTS; attempt += 1) {
    const candidate = createCandidate(attempt)
    const claimed = await tryClaimCandidate(candidate, attempt)

    if (claimed === true) {
      return candidate
    }

    if (claimed !== false) {
      throw new TypeError('随机候选 callback 必须返回 boolean')
    }
  }

  throw new NumberingGenerationError(
    NUMBERING_ERROR_CODES.GENERATION_RETRY_EXHAUSTED,
  )
}
