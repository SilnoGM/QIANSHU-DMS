/** 媒体探针缓存：COS 写探针是真实 PUT+DELETE，不能跟随 30 秒页面轮询执行。 */
export const MEDIA_PROBE_TTL_MS = 5 * 60_000

/**
 * 冷缓存时最多等待媒体探针的时间。
 *
 * COS 客户端超时是 60 秒；状态接口不能因此挂住整页。超过该时间先返回“探测中”，
 * 探针继续在后台完成，下一次轮询读取缓存。
 */
export const MEDIA_PROBE_FIRST_WAIT_MS = 1_500

/** 无缓存且探针失败后的重试间隔，避免每个 30 秒轮询都打一次外部请求。 */
export const MEDIA_PROBE_RETRY_MS = 60_000

/** 少于该样本数时性能状态为 unknown，避免 1/1 请求把错误率放大成 100%。 */
export const PERFORMANCE_MIN_SAMPLES = 20

export const PERFORMANCE_WARNING_ERROR_RATE = 5
export const PERFORMANCE_CRITICAL_ERROR_RATE = 10

export const HOST_CPU_WARNING_PERCENT = 80
export const HOST_CPU_CRITICAL_PERCENT = 90

export const CONTAINER_MEMORY_WARNING_PERCENT = 90
export const CONTAINER_MEMORY_CRITICAL_PERCENT = 95

/** 与媒体探针既有口径保持一致：可用块低于 20% 关注、低于 10% 严重。 */
export const DISK_WARNING_FREE_PERCENT = 20
export const DISK_CRITICAL_FREE_PERCENT = 10
