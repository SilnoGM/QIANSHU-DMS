import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MediaContentValidator } from './media-content-validator'
import {
  RestrictedMediaProcessError,
  type RestrictedMediaProcessRequest,
  type RestrictedMediaProcessResult,
} from './restricted-media-process'

const FFPROBE_PATH = '/usr/bin/ffprobe'
const VALIDATOR_CONFIGURATION = {
  ffprobePath: FFPROBE_PATH,
  qpdfPath: '/usr/bin/qpdf',
}

const MINIMAL_MP4_SIGNATURE = Buffer.from([
  0x00, 0x00, 0x00, 0x20,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d,
  0x69, 0x73, 0x6f, 0x32,
  0x61, 0x76, 0x63, 0x31,
  0x6d, 0x70, 0x34, 0x31,
])

const MP4_FILE_TYPE = {
  ext: 'mp4',
  mime: 'video/mp4',
} as const

function createVideoValidator(
  runProcess: (request: RestrictedMediaProcessRequest) => Promise<RestrictedMediaProcessResult>,
  detectedFileType: { readonly ext: string; readonly mime: string } = MP4_FILE_TYPE,
): MediaContentValidator {
  return new MediaContentValidator(VALIDATOR_CONFIGURATION, {
    detectFileType: jest.fn().mockResolvedValue(detectedFileType),
    runProcess,
  })
}

function ffprobeOutput(
  streams: readonly Record<string, unknown>[] = [
    {
      codec_name: 'h264',
      codec_tag_string: 'avc1',
      codec_type: 'video',
      height: 1080,
      width: 1920,
    },
  ],
  format: Record<string, unknown> = {
    duration: '1.250',
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
  },
): RestrictedMediaProcessResult {
  return { stdout: JSON.stringify({ format, streams }) }
}

describe('MediaContentValidator VIDEO', () => {
  let sandbox: string
  let sourcePath: string

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'qianshu-media-video-test-'))
    sourcePath = join(sandbox, 'trusted.mp4')
    await writeFile(sourcePath, MINIMAL_MP4_SIGNATURE)
  })

  afterEach(async () => {
    await rm(sandbox, { force: true, recursive: true })
  })

  it('accepts one H.264 video stream and no audio using fixed ffprobe controls', async () => {
    const runProcess = jest.fn<Promise<RestrictedMediaProcessResult>, [RestrictedMediaProcessRequest]>()
      .mockResolvedValue(ffprobeOutput())
    const validator = createVideoValidator(runProcess)
    const sourceStat = await stat(sourcePath)
    const checksumSha256 = createHash('sha256')
      .update(await readFile(sourcePath))
      .digest('hex')

    await expect(
      validator.validate({
        declaredMimeType: 'video/mp4',
        expectedMediaType: 'VIDEO',
        originalFilename: 'trusted.mp4',
        sourcePath,
      }),
    ).resolves.toEqual({
      audioCodec: null,
      canonicalExtension: '.mp4',
      checksumSha256,
      durationMs: 1_250,
      height: 1080,
      mediaType: 'VIDEO',
      mimeType: 'video/mp4',
      sizeBytes: BigInt(sourceStat.size),
      videoCodec: 'h264',
      width: 1920,
    })

    expect(runProcess).toHaveBeenCalledTimes(1)
    const request = runProcess.mock.calls[0]?.[0]
    expect(request).toMatchObject({
      executablePath: FFPROBE_PATH,
      stderrLimitBytes: 256 * 1024,
      stdoutLimitBytes: 256 * 1024,
      timeoutMs: 15_000,
    })
    expect(request?.arguments).toEqual([
      '-v', 'error',
      '-protocol_whitelist', 'file',
      '-show_entries',
      'format=format_name,duration:stream=codec_type,codec_name,codec_tag_string,width,height',
      '-of', 'json',
      '-i', sourcePath,
    ])
  })

  it('accepts exactly one AAC audio stream', async () => {
    const runProcess = jest.fn().mockResolvedValue(
      ffprobeOutput([
        {
          codec_name: 'h264',
          codec_tag_string: 'avc1',
          codec_type: 'video',
          height: 720,
          width: 1280,
        },
        { codec_name: 'aac', codec_type: 'audio' },
      ]),
    )
    const validator = createVideoValidator(runProcess)

    await expect(
      validator.validate({
        declaredMimeType: 'video/mp4',
        expectedMediaType: 'VIDEO',
        originalFilename: 'with-audio.mp4',
        sourcePath,
      }),
    ).resolves.toMatchObject({ audioCodec: 'aac', videoCodec: 'h264' })
  })

  it.each([
    [
      'MOV detected behind an MP4 declaration',
      'camera.mp4',
      'video/mp4',
      { ext: 'mov', mime: 'video/quicktime' },
      'mov,mp4,m4a,3gp,3g2,mj2',
      'h264',
      'avc1',
      'aac',
      '.mov',
      'video/quicktime',
    ],
    [
      'M4V detected behind a MOV declaration',
      'camera.mov',
      'video/quicktime',
      { ext: 'm4v', mime: 'video/x-m4v' },
      'mov,mp4,m4a,3gp,3g2,mj2',
      'hevc',
      'hvc1',
      'aac',
      '.m4v',
      'video/x-m4v',
    ],
    [
      'MP4 detected behind an M4V declaration',
      'camera.m4v',
      'video/x-m4v',
      MP4_FILE_TYPE,
      'mov,mp4,m4a,3gp,3g2,mj2',
      'h264',
      'avc3',
      null,
      '.mp4',
      'video/mp4',
    ],
    [
      'strict WebM identity',
      'camera.webm',
      'video/webm',
      { ext: 'webm', mime: 'video/webm' },
      'matroska,webm',
      'vp9',
      '[0][0][0][0]',
      'opus',
      '.webm',
      'video/webm',
    ],
  ] as const)(
    'accepts %s and persists the detected canonical identity',
    async (
      _caseName,
      originalFilename,
      declaredMimeType,
      detectedFileType,
      formatName,
      videoCodec,
      codecTag,
      audioCodec,
      canonicalExtension,
      trustedMimeType,
    ) => {
      const streams: Record<string, unknown>[] = [{
        codec_name: videoCodec,
        codec_tag_string: codecTag,
        codec_type: 'video',
        height: 1080,
        width: 1920,
      }]
      if (audioCodec !== null) {
        streams.push({ codec_name: audioCodec, codec_type: 'audio' })
      }
      const runProcess = jest.fn().mockResolvedValue(ffprobeOutput(
        streams,
        { duration: '1.250', format_name: formatName },
      ))
      const validator = createVideoValidator(runProcess, detectedFileType)

      await expect(validator.validate({
        declaredMimeType,
        expectedMediaType: 'VIDEO',
        originalFilename,
        sourcePath,
      })).resolves.toMatchObject({
        audioCodec,
        canonicalExtension,
        mimeType: trustedMimeType,
        videoCodec,
      })
    },
  )

  it.each([
    ['M4A brand', 'camera.mp4', 'video/mp4', { ext: 'm4a', mime: 'audio/x-m4a' }],
    ['M4P brand', 'camera.m4v', 'video/x-m4v', { ext: 'm4p', mime: 'video/mp4' }],
    ['F4V brand', 'camera.mov', 'video/quicktime', { ext: 'f4v', mime: 'video/mp4' }],
    ['3GP brand', 'camera.mp4', 'video/mp4', { ext: '3gp', mime: 'video/3gpp' }],
    ['HEIC brand', 'camera.mov', 'video/quicktime', { ext: 'heic', mime: 'image/heic' }],
    ['WebM disguised as MP4', 'camera.mp4', 'video/mp4', { ext: 'webm', mime: 'video/webm' }],
    ['MP4 disguised as WebM', 'camera.webm', 'video/webm', MP4_FILE_TYPE],
  ] as const)('rejects %s before ffprobe', async (
    _caseName,
    originalFilename,
    declaredMimeType,
    detectedFileType,
  ) => {
    const runProcess = jest.fn().mockResolvedValue(ffprobeOutput())
    const validator = createVideoValidator(runProcess, detectedFileType)

    await expect(validator.validate({
      declaredMimeType,
      expectedMediaType: 'VIDEO',
      originalFilename,
      sourcePath,
    })).rejects.toMatchObject({ code: 'MEDIA_CONTENT_TYPE_MISMATCH' })
    expect(runProcess).not.toHaveBeenCalled()
  })

  it.each([
    ['H.264 avc3', 'h264', 'avc3', 'h264'],
    ['HEVC hvc1', 'hevc', 'hvc1', 'hevc'],
    ['HEVC hev1', 'hevc', 'hev1', 'hevc'],
  ] as const)('accepts %s video', async (_caseName, codecName, codecTag, expectedCodec) => {
    const runProcess = jest.fn().mockResolvedValue(
      ffprobeOutput([{
        codec_name: codecName,
        codec_tag_string: codecTag,
        codec_type: 'video',
        height: 720,
        width: 1280,
      }]),
    )
    const validator = createVideoValidator(runProcess)

    await expect(
      validator.validate({
        declaredMimeType: 'video/mp4',
        expectedMediaType: 'VIDEO',
        originalFilename: 'compatible.mp4',
        sourcePath,
      }),
    ).resolves.toMatchObject({ videoCodec: expectedCodec })
  })

  it.each([
    ['VP8 without audio', 'vp8', null],
    ['VP9 with Opus', 'vp9', 'opus'],
    ['AV1 with Vorbis', 'av1', 'vorbis'],
  ] as const)('accepts WebM %s', async (_caseName, codecName, audioCodec) => {
    const streams: Record<string, unknown>[] = [{
      codec_name: codecName,
      codec_tag_string: '[0][0][0][0]',
      codec_type: 'video',
      height: 720,
      width: 1280,
    }]
    if (audioCodec !== null) {
      streams.push({ codec_name: audioCodec, codec_type: 'audio' })
    }
    const runProcess = jest.fn().mockResolvedValue(ffprobeOutput(
      streams,
      { duration: '2.500', format_name: 'matroska,webm' },
    ))
    const validator = createVideoValidator(runProcess, {
      ext: 'webm',
      mime: 'video/webm',
    })

    await expect(validator.validate({
      declaredMimeType: 'video/webm',
      expectedMediaType: 'VIDEO',
      originalFilename: 'compatible.webm',
      sourcePath,
    })).resolves.toMatchObject({
      audioCodec,
      canonicalExtension: '.webm',
      mimeType: 'video/webm',
      videoCodec: codecName,
    })
  })

  it('accepts common auxiliary data streams while preserving the primary video metadata', async () => {
    const runProcess = jest.fn().mockResolvedValue(
      ffprobeOutput([
        {
          codec_name: 'hevc',
          codec_tag_string: 'hvc1',
          codec_type: 'video',
          height: 2160,
          width: 3840,
        },
        { codec_name: 'aac', codec_type: 'audio' },
        { codec_name: 'bin_data', codec_tag_string: 'tmcd', codec_type: 'data' },
      ]),
    )
    const validator = createVideoValidator(runProcess)

    await expect(
      validator.validate({
        declaredMimeType: 'video/mp4',
        expectedMediaType: 'VIDEO',
        originalFilename: 'camera.mp4',
        sourcePath,
      }),
    ).resolves.toMatchObject({
      audioCodec: 'aac',
      height: 2160,
      videoCodec: 'hevc',
      width: 3840,
    })
  })

  it.each([
    [
      'mismatched H.264 tag',
      [{ codec_name: 'h264', codec_tag_string: 'hvc1', codec_type: 'video', height: 720, width: 1280 }],
    ],
    [
      'mismatched HEVC tag',
      [{ codec_name: 'hevc', codec_tag_string: 'avc1', codec_type: 'video', height: 720, width: 1280 }],
    ],
    [
      'non-AAC audio',
      [
        { codec_name: 'h264', codec_tag_string: 'avc1', codec_type: 'video', height: 720, width: 1280 },
        { codec_name: 'mp3', codec_type: 'audio' },
      ],
    ],
    [
      'unknown extra stream',
      [
        { codec_name: 'h264', codec_tag_string: 'avc1', codec_type: 'video', height: 720, width: 1280 },
        { codec_name: 'mov_text', codec_type: 'subtitle' },
      ],
    ],
    [
      'second video stream',
      [
        { codec_name: 'h264', codec_tag_string: 'avc1', codec_type: 'video', height: 720, width: 1280 },
        { codec_name: 'h264', codec_tag_string: 'avc1', codec_type: 'video', height: 360, width: 640 },
      ],
    ],
  ])('rejects unsupported %s with a policy error', async (_caseName, streams) => {
    const runProcess = jest.fn().mockResolvedValue(ffprobeOutput(streams))
    const validator = createVideoValidator(runProcess)

    await expect(
      validator.validate({
        declaredMimeType: 'video/mp4',
        expectedMediaType: 'VIDEO',
        originalFilename: 'invalid.mp4',
        sourcePath,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_UNSUPPORTED' })
  })

  it('rejects invalid dimensions as malformed content', async () => {
    const runProcess = jest.fn().mockResolvedValue(ffprobeOutput([{
      codec_name: 'h264',
      codec_tag_string: 'avc1',
      codec_type: 'video',
      height: 0,
      width: 1280,
    }]))
    const validator = createVideoValidator(runProcess)

    await expect(validator.validate({
      declaredMimeType: 'video/mp4',
      expectedMediaType: 'VIDEO',
      originalFilename: 'invalid.mp4',
      sourcePath,
    })).rejects.toMatchObject({ code: 'MEDIA_CONTENT_INVALID' })
  })

  it('rejects WebM data streams with an unsupported policy error', async () => {
    const runProcess = jest.fn().mockResolvedValue(ffprobeOutput(
      [
        {
          codec_name: 'vp9',
          codec_tag_string: '[0][0][0][0]',
          codec_type: 'video',
          height: 720,
          width: 1280,
        },
        { codec_name: 'bin_data', codec_type: 'data' },
      ],
      { duration: '1.5', format_name: 'matroska,webm' },
    ))
    const validator = createVideoValidator(runProcess, {
      ext: 'webm',
      mime: 'video/webm',
    })

    await expect(validator.validate({
      declaredMimeType: 'video/webm',
      expectedMediaType: 'VIDEO',
      originalFilename: 'invalid.webm',
      sourcePath,
    })).rejects.toMatchObject({ code: 'MEDIA_CONTENT_UNSUPPORTED' })
  })

  it.each([
    ['invalid duration', { duration: 'NaN', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }],
    ['zero duration', { duration: '0', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }],
    ['wrong container', { duration: '1.5', format_name: 'matroska,webm' }],
  ])('rejects %s', async (_caseName, format) => {
    const runProcess = jest.fn().mockResolvedValue(ffprobeOutput(undefined, format))
    const validator = createVideoValidator(runProcess)

    await expect(
      validator.validate({
        declaredMimeType: 'video/mp4',
        expectedMediaType: 'VIDEO',
        originalFilename: 'invalid.mp4',
        sourcePath,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_INVALID' })
  })

  it('rejects malformed ffprobe JSON and maps process failures without stderr leakage', async () => {
    const malformed = createVideoValidator(
      jest.fn().mockResolvedValue({ stdout: '{not-json' }),
    )
    await expect(
      malformed.validate({
        declaredMimeType: 'video/mp4',
        expectedMediaType: 'VIDEO',
        originalFilename: 'invalid.mp4',
        sourcePath,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_INVALID' })

    const unavailable = createVideoValidator(
      jest.fn().mockRejectedValue(
        new RestrictedMediaProcessError('MEDIA_PROCESS_UNAVAILABLE'),
      ),
    )
    await expect(
      unavailable.validate({
        declaredMimeType: 'video/mp4',
        expectedMediaType: 'VIDEO',
        originalFilename: 'customer-secret.mp4',
        sourcePath,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_VALIDATOR_UNAVAILABLE',
      message: 'Media content validator is unavailable',
    })
  })

  it('fails closed when the staging file changes during validation', async () => {
    const runProcess = jest.fn(async () => {
      await writeFile(sourcePath, Buffer.concat([MINIMAL_MP4_SIGNATURE, Buffer.from('changed')]))
      return ffprobeOutput()
    })
    const validator = createVideoValidator(runProcess)

    await expect(
      validator.validate({
        declaredMimeType: 'video/mp4',
        expectedMediaType: 'VIDEO',
        originalFilename: 'trusted.mp4',
        sourcePath,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_CONTENT_INVALID',
      message: 'Media content is invalid',
    })
  })
})
