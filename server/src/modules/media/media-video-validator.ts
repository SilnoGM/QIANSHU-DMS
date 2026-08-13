import {
  MediaValidationError,
  type ValidatedVideoContent,
} from './media-validation'
import {
  RestrictedMediaProcessError,
  type RestrictedMediaProcessRequest,
  type RestrictedMediaProcessResult,
} from './restricted-media-process'

const PROCESS_TIMEOUT_MS = 15_000
const PROCESS_OUTPUT_LIMIT_BYTES = 256 * 1024
const MAX_DATABASE_DURATION_MS = 2_147_483_647

export type RunRestrictedMediaProcess = (
  request: RestrictedMediaProcessRequest,
) => Promise<RestrictedMediaProcessResult>

interface JsonRecord {
  readonly [key: string]: unknown
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePositiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null
}

function mapProcessFailure(error: unknown): never {
  if (
    error instanceof RestrictedMediaProcessError &&
    (
      error.code === 'MEDIA_PROCESS_EXIT_NON_ZERO' ||
      error.code === 'MEDIA_PROCESS_OUTPUT_LIMIT'
    )
  ) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  throw new MediaValidationError('MEDIA_VALIDATOR_UNAVAILABLE')
}

/**
 * ffprobe 仅能看到 file 协议，输入使用独立 `-i` 参数，不经过 shell，也不接受调用方附加选项。
 */
export async function validateVideoContent(
  sourcePath: string,
  sizeBytes: bigint,
  checksumSha256: string,
  ffprobePath: string,
  runProcess: RunRestrictedMediaProcess,
): Promise<ValidatedVideoContent> {
  let result: RestrictedMediaProcessResult
  try {
    result = await runProcess({
      arguments: [
        '-v', 'error',
        '-protocol_whitelist', 'file',
        '-show_entries',
        'format=format_name,duration:stream=codec_type,codec_name,codec_tag_string,width,height',
        '-of', 'json',
        '-i', sourcePath,
      ],
      executablePath: ffprobePath,
      stderrLimitBytes: PROCESS_OUTPUT_LIMIT_BYTES,
      stdoutLimitBytes: PROCESS_OUTPUT_LIMIT_BYTES,
      timeoutMs: PROCESS_TIMEOUT_MS,
    })
  }
  catch (error) {
    mapProcessFailure(error)
  }

  try {
    const payload: unknown = JSON.parse(result.stdout)
    if (!isRecord(payload) || !isRecord(payload.format) || !Array.isArray(payload.streams)) {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }
    const formatName = payload.format.format_name
    const durationSeconds = Number(payload.format.duration)
    const durationMs = Math.round(durationSeconds * 1_000)
    if (
      typeof formatName !== 'string' ||
      !formatName.split(',').includes('mp4') ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !Number.isSafeInteger(durationMs) ||
      durationMs <= 0 ||
      durationMs > MAX_DATABASE_DURATION_MS ||
      !payload.streams.every(isRecord)
    ) {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }

    const streams = payload.streams
    const videoStreams = streams.filter(stream => stream.codec_type === 'video')
    const audioStreams = streams.filter(stream => stream.codec_type === 'audio')
    if (
      streams.length !== videoStreams.length + audioStreams.length ||
      videoStreams.length !== 1 ||
      audioStreams.length > 1
    ) {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }

    const video = videoStreams[0]
    const width = parsePositiveInteger(video.width)
    const height = parsePositiveInteger(video.height)
    if (
      video.codec_name !== 'h264' ||
      video.codec_tag_string !== 'avc1' ||
      width === null ||
      height === null ||
      (audioStreams.length === 1 && audioStreams[0].codec_name !== 'aac')
    ) {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }

    return Object.freeze({
      audioCodec: audioStreams.length === 1 ? 'aac' : null,
      canonicalExtension: '.mp4',
      checksumSha256,
      durationMs,
      height,
      mediaType: 'VIDEO',
      mimeType: 'video/mp4',
      sizeBytes,
      videoCodec: 'h264',
      width,
    })
  }
  catch (error) {
    if (error instanceof MediaValidationError) throw error
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
}
