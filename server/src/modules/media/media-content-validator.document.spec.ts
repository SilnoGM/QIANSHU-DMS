import { createHash } from 'node:crypto'
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'

import { MediaContentValidator } from './media-content-validator'
import { validateOoxmlPackage } from './media-document-validator'
import type {
  RestrictedMediaProcessRequest,
  RestrictedMediaProcessResult,
} from './restricted-media-process'

const QPDF_PATH = '/usr/bin/qpdf'
const VALIDATOR_CONFIGURATION = {
  ffprobePath: '/usr/bin/ffprobe',
  qpdfPath: QPDF_PATH,
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function detectDocumentFileType(sourcePath: string) {
  const handle = await open(sourcePath, 'r')
  try {
    const signature = Buffer.alloc(8)
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0)
    const bytes = signature.subarray(0, bytesRead)
    if (bytes.toString('ascii', 0, 5) === '%PDF-') {
      return { ext: 'pdf', mime: 'application/pdf' }
    }
    if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      return { ext: 'zip', mime: 'application/zip' }
    }
    return undefined
  }
  finally {
    await handle.close()
  }
}

function createDocumentValidator(
  runProcess: (request: RestrictedMediaProcessRequest) => Promise<RestrictedMediaProcessResult> = qpdfSuccess,
): MediaContentValidator {
  return new MediaContentValidator(VALIDATOR_CONFIGURATION, {
    detectFileType: detectDocumentFileType,
    runProcess,
  })
}

interface ZipFixtureEntry {
  readonly contents: Buffer | string
  readonly encrypted?: boolean
  readonly name: string
  readonly useDeflate?: boolean
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? 0xedb8_8320 ^ (value >>> 1)
        : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(contents: Buffer): number {
  let crc = 0xffff_ffff
  for (const byte of contents) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

/**
 * 测试夹具只实现本任务需要的最小 ZIP 子集，所有内容均在测试中声明并归项目自有。
 * 手写 central directory 能精确制造 encrypted flag、path traversal 和压缩比边界，
 * 避免为了测试再引入一个生产无关的 ZIP writer 依赖。
 */
function createZipFixture(entries: readonly ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const contents = Buffer.isBuffer(entry.contents)
      ? entry.contents
      : Buffer.from(entry.contents, 'utf8')
    const compressed = entry.useDeflate ? deflateRawSync(contents) : contents
    const compressionMethod = entry.useDeflate ? 8 : 0
    const flags = 0x0800 | (entry.encrypted ? 0x0001 : 0)
    const checksum = crc32(contents)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x0403_4b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(flags, 6)
    localHeader.writeUInt16LE(compressionMethod, 8)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(contents.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localParts.push(localHeader, name, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x0201_4b50, 0)
    centralHeader.writeUInt16LE(0x0314, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(flags, 8)
    centralHeader.writeUInt16LE(compressionMethod, 10)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(contents.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt32LE((0o100640 << 16) >>> 0, 38)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralParts.push(centralHeader, name)

    localOffset += localHeader.length + name.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x0605_4b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localParts, centralDirectory, end])
}

function contentTypes(mainPart: string, mainContentType: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/${mainPart}" ContentType="${mainContentType}"/>
</Types>`
}

function packageRelationships(mainPart: string, external = false): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${mainPart}"${external ? ' TargetMode="External"' : ''}/>
</Relationships>`
}

function minimalOoxmlEntries(kind: 'DOCX' | 'XLSX'): ZipFixtureEntry[] {
  const isDocx = kind === 'DOCX'
  const mainPart = isDocx ? 'word/document.xml' : 'xl/workbook.xml'
  const mainContentType = isDocx
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
  const mainDocument = isDocx
    ? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'
    : '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>'
  return [
    {
      contents: contentTypes(mainPart, mainContentType),
      name: '[Content_Types].xml',
    },
    {
      contents: packageRelationships(mainPart),
      name: '_rels/.rels',
    },
    { contents: mainDocument, name: mainPart },
  ]
}

function qpdfSuccess(
  request: RestrictedMediaProcessRequest,
): Promise<RestrictedMediaProcessResult> {
  const stdout = request.arguments.includes('--show-encryption')
    ? 'File is not encrypted\n'
    : request.arguments.includes('--json=1')
      ? '{"version":1,"attachments":{},"objects":{}}'
      : ''
  return Promise.resolve({ stdout })
}

describe('MediaContentValidator DOCUMENT', () => {
  let sandbox: string

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'qianshu-media-document-test-'))
  })

  afterEach(async () => {
    await rm(sandbox, { force: true, recursive: true })
  })

  it('accepts a structurally checked, unencrypted PDF with fixed qpdf controls', async () => {
    const sourcePath = join(sandbox, 'document.pdf')
    await writeFile(
      sourcePath,
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n',
    )
    const runProcess = jest.fn(qpdfSuccess)
    const validator = createDocumentValidator(runProcess)
    const sourceStat = await stat(sourcePath)
    const checksumSha256 = createHash('sha256')
      .update(await readFile(sourcePath))
      .digest('hex')

    await expect(
      validator.validate({
        declaredMimeType: 'application/pdf',
        expectedMediaType: 'DOCUMENT',
        originalFilename: 'document.pdf',
        sourcePath,
      }),
    ).resolves.toEqual({
      canonicalExtension: '.pdf',
      checksumSha256,
      mediaType: 'DOCUMENT',
      mimeType: 'application/pdf',
      sizeBytes: BigInt(sourceStat.size),
    })

    expect(runProcess).toHaveBeenCalledTimes(3)
    expect(runProcess.mock.calls.map(([request]) => request)).toEqual([
      {
        arguments: ['--check', '--password=', sourcePath],
        executablePath: QPDF_PATH,
        stderrLimitBytes: 64 * 1024,
        stdoutLimitBytes: 64 * 1024,
        timeoutMs: 15_000,
      },
      {
        arguments: ['--show-encryption', '--password=', sourcePath],
        executablePath: QPDF_PATH,
        stderrLimitBytes: 64 * 1024,
        stdoutLimitBytes: 64 * 1024,
        timeoutMs: 15_000,
      },
      {
        arguments: [
          '--json=1',
          '--json-key=attachments',
          '--json-key=objects',
          '--json-stream-data=none',
          '--password=',
          sourcePath,
        ],
        executablePath: QPDF_PATH,
        stderrLimitBytes: 64 * 1024,
        stdoutLimitBytes: 64 * 1024,
        timeoutMs: 15_000,
      },
    ])
  })

  it.each(['XLSX', 'DOCX'] as const)('accepts %s theme font script attributes', async kind => {
    const sourcePath = join(sandbox, kind === 'XLSX' ? 'theme.xlsx' : 'theme.docx')
    const entries = [
      ...minimalOoxmlEntries(kind),
      { name: `${kind === 'XLSX' ? 'xl' : 'word'}/theme/theme1.xml`, contents: '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="Office"><a:majorFont><a:font script="Hans" typeface="SimSun"/><a:font script="Hant" typeface="MingLiU"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>' },
    ]
    await writeFile(sourcePath, createZipFixture(entries))
    await expect(createDocumentValidator(jest.fn(qpdfSuccess)).validate({
      declaredMimeType: kind === 'XLSX' ? XLSX_MIME : DOCX_MIME,
      expectedMediaType: 'DOCUMENT', originalFilename: kind === 'XLSX' ? 'theme.xlsx' : 'theme.docx', sourcePath,
    })).resolves.toMatchObject({ mediaType: 'DOCUMENT' })
  })

  it.each(['<script>unsafe</script>', '<a:script/>', '<SCRIPT src="unsafe"/>'])('rejects script elements inside XLSX theme: %s', async contents => {
    const sourcePath = join(sandbox, 'unsafe-theme.xlsx')
    await writeFile(sourcePath, createZipFixture([
      ...minimalOoxmlEntries('XLSX'),
      { name: 'xl/theme/theme1.xml', contents: `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${contents}</a:theme>` },
    ]))
    await expect(validateOoxmlPackage(sourcePath, 'XLSX')).rejects.toMatchObject({ code: 'MEDIA_CONTENT_INVALID' })
  })

  it.each([
    ['DOCX', 'document.docx', DOCX_MIME, '.docx'],
    ['XLSX', 'workbook.xlsx', XLSX_MIME, '.xlsx'],
  ] as const)(
    'accepts a minimal valid %s package and returns its canonical identity',
    async (kind, originalFilename, declaredMimeType, canonicalExtension) => {
      const sourcePath = join(sandbox, originalFilename)
      await writeFile(sourcePath, createZipFixture(minimalOoxmlEntries(kind)))
      const sourceStat = await stat(sourcePath)
      const checksumSha256 = createHash('sha256')
        .update(await readFile(sourcePath))
        .digest('hex')
      const validator = createDocumentValidator(jest.fn(qpdfSuccess))

      await expect(
        validator.validate({
          declaredMimeType,
          expectedMediaType: 'DOCUMENT',
          originalFilename,
          sourcePath,
        }),
      ).resolves.toEqual({
        canonicalExtension,
        checksumSha256,
        mediaType: 'DOCUMENT',
        mimeType: declaredMimeType,
        sizeBytes: BigInt(sourceStat.size),
      })
    },
  )

  it('rejects a valid XLSX package renamed and declared as DOCX', async () => {
    const sourcePath = join(sandbox, 'renamed.docx')
    await writeFile(sourcePath, createZipFixture(minimalOoxmlEntries('XLSX')))
    const validator = createDocumentValidator()

    await expect(
      validator.validate({
        declaredMimeType: DOCX_MIME,
        expectedMediaType: 'DOCUMENT',
        originalFilename: 'renamed.docx',
        sourcePath,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_TYPE_MISMATCH' })
  })

  it.each([
    [
      'macro entry',
      [...minimalOoxmlEntries('DOCX'), { contents: 'macro', name: 'word/vbaProject.bin' }],
    ],
    [
      'path traversal',
      [...minimalOoxmlEntries('DOCX'), { contents: 'escape', name: '../escape.xml' }],
    ],
    [
      'portable duplicate',
      [...minimalOoxmlEntries('DOCX'), { contents: '<duplicate/>', name: 'WORD/document.xml' }],
    ],
    [
      'encrypted entry',
      minimalOoxmlEntries('DOCX').map((entry, index) => (
        index === 2 ? { ...entry, encrypted: true } : entry
      )),
    ],
    [
      'external relationship',
      minimalOoxmlEntries('DOCX').map(entry => (
        entry.name === '_rels/.rels'
          ? { ...entry, contents: packageRelationships('word/document.xml', true) }
          : entry
      )),
    ],
    [
      'wrong root officeDocument relationship',
      minimalOoxmlEntries('DOCX').map(entry => (
        entry.name === '_rels/.rels'
          ? { ...entry, contents: packageRelationships('word/missing.xml') }
          : entry
      )),
    ],
    [
      'invalid main part root',
      minimalOoxmlEntries('DOCX').map(entry => (
        entry.name === 'word/document.xml'
          ? { ...entry, contents: '<html xmlns="http://www.w3.org/1999/xhtml"><script/></html>' }
          : entry
      )),
    ],
    [
      'nested script in a valid main part',
      minimalOoxmlEntries('DOCX').map(entry => (
        entry.name === 'word/document.xml'
          ? {
            ...entry,
            contents: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><script>unsafe</script></w:body></w:document>',
          }
          : entry
      )),
    ],
    [
      'zip bomb ratio',
      [
        ...minimalOoxmlEntries('DOCX'),
        { contents: Buffer.alloc(64 * 1024, 0x41), name: 'word/repeated.xml', useDeflate: true },
      ],
    ],
  ] as const)('rejects OOXML %s', async (_caseName, entries) => {
    const sourcePath = join(sandbox, 'unsafe.docx')
    await writeFile(sourcePath, createZipFixture(entries))

    await expect(validateOoxmlPackage(sourcePath, 'DOCX')).rejects.toMatchObject({
      code: 'MEDIA_CONTENT_INVALID',
      message: 'Media content is invalid',
    })
  })

  it('rejects more than 2,000 OOXML entries before opening their streams', async () => {
    const sourcePath = join(sandbox, 'too-many.docx')
    const entries = [
      ...minimalOoxmlEntries('DOCX'),
      ...Array.from({ length: 1_998 }, (_, index) => ({
        contents: '',
        name: `word/empty-${index}.xml`,
      })),
    ]
    await writeFile(sourcePath, createZipFixture(entries))

    await expect(validateOoxmlPackage(sourcePath, 'DOCX')).rejects.toMatchObject({
      code: 'MEDIA_CONTENT_INVALID',
    })
  })

  it.each([
    [
      'missing EOF',
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n',
    ],
    [
      'JavaScript action',
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction 2 0 R /JavaScript (alert) >>\nendobj\n%%EOF\n',
    ],
    [
      'embedded file',
      '%PDF-1.4\n1 0 obj\n<< /Type /EmbeddedFile >>\nendobj\n%%EOF\n',
    ],
  ])('rejects PDF %s without exposing parser details', async (_caseName, contents) => {
    const sourcePath = join(sandbox, 'unsafe.pdf')
    await writeFile(sourcePath, contents)
    const validator = createDocumentValidator(jest.fn(qpdfSuccess))

    await expect(
      validator.validate({
        declaredMimeType: 'application/pdf',
        expectedMediaType: 'DOCUMENT',
        originalFilename: 'unsafe.pdf',
        sourcePath,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_INVALID' })
  })

  it('rejects qpdf encryption output even when an empty password opens the file', async () => {
    const sourcePath = join(sandbox, 'encrypted.pdf')
    await writeFile(sourcePath, '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
    const runProcess = jest.fn((request: RestrictedMediaProcessRequest) => Promise.resolve({
      stdout: request.arguments.includes('--show-encryption')
        ? 'R = 6\nP = -4\n'
        : '',
    }))
    const validator = createDocumentValidator(runProcess)

    await expect(
      validator.validate({
        declaredMimeType: 'application/pdf',
        expectedMediaType: 'DOCUMENT',
        originalFilename: 'encrypted.pdf',
        sourcePath,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_INVALID' })
  })

  it('rejects dangerous names decoded from qpdf object streams', async () => {
    const sourcePath = join(sandbox, 'compressed-script.pdf')
    await writeFile(sourcePath, '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
    const runProcess = jest.fn((request: RestrictedMediaProcessRequest) => Promise.resolve({
      stdout: request.arguments.includes('--show-encryption')
        ? 'File is not encrypted\n'
        : request.arguments.includes('--json=1')
          ? '{"version":1,"attachments":{},"objects":{"obj:7 0 R":{"value":{"/S":"/JavaScript"}}}}'
          : '',
    }))
    const validator = createDocumentValidator(runProcess)

    await expect(
      validator.validate({
        declaredMimeType: 'application/pdf',
        expectedMediaType: 'DOCUMENT',
        originalFilename: 'compressed-script.pdf',
        sourcePath,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_INVALID' })
  })
})
