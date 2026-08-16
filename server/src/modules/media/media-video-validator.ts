import {
  MediaValidationError,
  type ValidatedVideoContent,
} from './media-validation'
import {
  RestrictedMediaProcessError,
  type RestrictedMediaProcessRequest,
  type RestrictedMediaProcessResult,
} from './restricted-media-process'
import type { TrustedVideoContainer } from './media-video-container'

const PROCESS_TIMEOUT_MS = 15_000
const PROCESS_OUTPUT_LIMIT_BYTES = 256 * 1024
const MAX_DATABASE_DURATION_MS = 2_147_483_647
const H264_CODEC_TAGS = new Set(['avc1', 'avc3'])
const HEVC_CODEC_TAGS = new Set(['hvc1', 'hev1'])
const WEBM_VIDEO_CODECS = new Set(['av1', 'vp8', 'vp9'])
const INVALID_AUDIO_CODEC = Symbol('qianshu.media.invalid-audio-codec')

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

function resolveVideoCodec(
  container: TrustedVideoContainer,
  codecName: unknown,
  codecTag: unknown,
): ValidatedVideoContent['videoCodec'] | null {
  if (
    container.family === 'WEBM'
    && typeof codecName === 'string'
    && WEBM_VIDEO_CODECS.has(codecName)
  ) {
    return codecName as 'av1' | 'vp8' | 'vp9'
  }
  if (
    container.family === 'ISO_BASE_MEDIA' &&
    codecName === 'h264' &&
    typeof codecTag === 'string' &&
    H264_CODEC_TAGS.has(codecTag)
  ) {
    return 'h264'
  }
  if (
    container.family === 'ISO_BASE_MEDIA' &&
    codecName === 'hevc' &&
    typeof codecTag === 'string' &&
    HEVC_CODEC_TAGS.has(codecTag)
  ) {
    return 'hevc'
  }
  return null
}

function resolveAudioCodec(
  container: TrustedVideoContainer,
  audioStreams: readonly JsonRecord[],
): ValidatedVideoContent['audioCodec'] | typeof INVALID_AUDIO_CODEC {
  if (audioStreams.length === 0) return null
  const codecName = audioStreams[0]?.codec_name
  if (container.family === 'ISO_BASE_MEDIA' && codecName === 'aac') {
    return 'aac'
  }
  if (container.family === 'WEBM' && (codecName === 'opus' || codecName === 'vorbis')) {
    return codecName
  }
  return INVALID_AUDIO_CODEC
}

function matchesContainerFormat(
  container: TrustedVideoContainer,
  formatName: string,
): boolean {
  const tokens = new Set(formatName.split(','))
  return container.family === 'WEBM'
    ? tokens.has('webm')
    : tokens.has('mov') || tokens.has('mp4')
}

/**
 * ffprobe 仅能看到 file 协议，输入使用独立 `-i` 参数，不经过 shell，也不接受调用方附加选项。
 */
export async function validateVideoContent(
  sourcePath: string,
  sizeBytes: bigint,
  checksumSha256: string,
  container: TrustedVideoContainer,
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
      !matchesContainerFormat(container, formatName) ||
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
    const dataStreams = streams.filter(stream => stream.codec_type === 'data')
    const allowedStreamCount = videoStreams.length
      + audioStreams.length
      + (container.family === 'ISO_BASE_MEDIA' ? dataStreams.length : 0)
    if (
      streams.length !== allowedStreamCount ||
      videoStreams.length !== 1 ||
      audioStreams.length > 1
    ) {
      throw new MediaValidationError('MEDIA_CONTENT_UNSUPPORTED')
    }

    const video = videoStreams[0]
    const width = parsePositiveInteger(video.width)
    const height = parsePositiveInteger(video.height)
    const videoCodec = resolveVideoCodec(
      container,
      video.codec_name,
      video.codec_tag_string,
    )
    if (width === null || height === null) {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }
    const audioCodec = resolveAudioCodec(container, audioStreams)
    if (videoCodec === null || audioCodec === INVALID_AUDIO_CODEC) {
      throw new MediaValidationError('MEDIA_CONTENT_UNSUPPORTED')
    }

    return Object.freeze({
      audioCodec,
      canonicalExtension: container.canonicalExtension,
      checksumSha256,
      durationMs,
      height,
      mediaType: 'VIDEO',
      mimeType: container.mimeType,
      sizeBytes,
      videoCodec,
      width,
    })
  }
  catch (error) {
    if (error instanceof MediaValidationError) throw error
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
}
