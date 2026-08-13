import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
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

const detectMp4FileType = jest.fn().mockResolvedValue({
  ext: 'mp4',
  mime: 'video/mp4',
})

function createVideoValidator(
  runProcess: (request: RestrictedMediaProcessRequest) => Promise<RestrictedMediaProcessResult>,
): MediaContentValidator {
  return new MediaContentValidator(VALIDATOR_CONFIGURATION, {
    detectFileType: detectMp4FileType,
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
      'non-H.264 video',
      [{ codec_name: 'hevc', codec_tag_string: 'hvc1', codec_type: 'video', height: 720, width: 1280 }],
    ],
    [
      'non-avc1 tag',
      [{ codec_name: 'h264', codec_tag_string: 'avc3', codec_type: 'video', height: 720, width: 1280 }],
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
    [
      'invalid dimensions',
      [{ codec_name: 'h264', codec_tag_string: 'avc1', codec_type: 'video', height: 0, width: 1280 }],
    ],
  ])('rejects %s', async (_caseName, streams) => {
    const runProcess = jest.fn().mockResolvedValue(ffprobeOutput(streams))
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
