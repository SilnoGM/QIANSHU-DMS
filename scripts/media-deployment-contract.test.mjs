import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')

async function read(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8')
}

test('Server release 包含媒体部署模板且模板不携带真实 Secret', async () => {
  const packageJson = JSON.parse(await read('server/package.json'))
  assert.ok(packageJson.files.includes('deploy/'))
  assert.equal(
    packageJson.scripts['media:ops:health'],
    'node dist/commands/media-operations.js health',
  )
  assert.equal(
    packageJson.scripts['media:recovery:dry-run'],
    'node dist/commands/media-operations.js recovery-dry-run',
  )
  assert.equal(
    packageJson.scripts['media:cleanup:expired-trash'],
    'node dist/commands/media-operations.js cleanup-expired-trash',
  )
  assert.equal(
    packageJson.scripts['media:migrate'],
    'node dist/commands/media-migration.js',
  )
  assert.equal(
    packageJson.scripts['media:accept:cos'],
    'MEDIA_STORAGE_DRIVER=cos node ./scripts/cos-acceptance.cjs',
  )

  const environment = await read(
    'server/deploy/environment/server.env.example',
  )
  for (const expected of [
    'MEDIA_STORAGE_DRIVER=local',
    'MEDIA_STORAGE_ENV=dev',
    'MEDIA_STORAGE_ROOT=/var/lib/qianshu-dms/media',
    'MEDIA_FFMPEG_PATH=/usr/bin/ffmpeg',
    'MEDIA_FFPROBE_PATH=/usr/bin/ffprobe',
    'MEDIA_QPDF_PATH=/usr/bin/qpdf',
    'MEDIA_COS_REGION=ap-beijing',
  ]) {
    assert.match(environment, new RegExp(`^${expected}$`, 'mu'))
  }
  // 对象键的环境段必须出现在两套模板里：cos 驱动缺它会在启动时失败关闭，
  // 模板漏写会让部署方在第一次启动才发现。
  assert.match(
    await read('deploy/docker/server.env.example'),
    /^MEDIA_STORAGE_ENV=(?:dev|test|prod)$/mu,
  )
  assert.match(environment, /^DATABASE_URL=$/mu)
  assert.match(environment, /^AUTH_USERNAME_HMAC_KEY=$/mu)
  assert.doesNotMatch(environment, /postgres(?:ql)?:\/\/[^\s]*@/u)

  // 两套模板都必须只留空占位：一旦有人把真实凭据写进模板，空行断言就会失败。
  for (const relativePath of [
    'server/deploy/environment/server.env.example',
    'deploy/docker/server.env.example',
  ]) {
    const template = await read(relativePath)
    for (const expected of ['MEDIA_COS_BUCKET=', 'MEDIA_COS_SECRET_ID=', 'MEDIA_COS_SECRET_KEY=']) {
      assert.match(template, new RegExp(`^${expected}$`, 'mu'), relativePath)
    }
    assert.doesNotMatch(template, /^MEDIA_COS_SECRET_(?:ID|KEY)=\S+$/mu, relativePath)
  }
})

test('Nginx 与 systemd 模板固定 internal、Range、body limit 和运行身份边界', async () => {
  const nginx = await read('server/deploy/nginx/qianshu-dms-media.conf')
  assert.match(nginx, /location \^~ \/_qianshu_internal_media\//u)
  assert.match(nginx, /\binternal;/u)
  assert.match(nginx, /alias \/var\/lib\/qianshu-dms\/media\//u)
  assert.match(nginx, /client_max_body_size 501m;/u)
  assert.match(nginx, /proxy_request_buffering off;/u)
  assert.match(nginx, /max_ranges 1;/u)

  const systemd = await read(
    'server/deploy/systemd/qianshu-dms-server.service',
  )
  assert.match(systemd, /^User=qianshu-dms$/mu)
  assert.match(systemd, /^Group=qianshu-media$/mu)
  assert.match(systemd, /^UMask=0027$/mu)
  assert.match(
    systemd,
    /^EnvironmentFile=\/etc\/qianshu-dms\/server\.env$/mu,
  )
  assert.match(
    systemd,
    /^ExecStartPre=\/usr\/bin\/node dist\/commands\/media-operations\.js preflight$/mu,
  )

  const cleanupService = await read(
    'server/deploy/systemd/qianshu-dms-media-cleanup.service',
  )
  for (const expected of [
    'Type=oneshot',
    'User=qianshu-dms',
    'Group=qianshu-media',
    'UMask=0027',
    'EnvironmentFile=/etc/qianshu-dms/server.env',
    'ReadWritePaths=/var/lib/qianshu-dms/media',
    'ExecStart=/usr/bin/node dist/commands/media-operations.js cleanup-expired-trash',
  ]) {
    assert.match(cleanupService, new RegExp(`^${expected}$`, 'mu'))
  }

  const cleanupTimer = await read(
    'server/deploy/systemd/qianshu-dms-media-cleanup.timer',
  )
  assert.match(cleanupTimer, /^OnCalendar=hourly$/mu)
  assert.match(cleanupTimer, /^Persistent=true$/mu)
  assert.match(
    cleanupTimer,
    /^Unit=qianshu-dms-media-cleanup\.service$/mu,
  )
  assert.match(cleanupTimer, /^WantedBy=timers\.target$/mu)
})

test('媒体指标与告警合同只允许固定低基数 Label', async () => {
  const contract = JSON.parse(await read(
    'server/deploy/monitoring/media-observability.json',
  ))
  const requiredMetrics = new Set([
    'media_capacity_free_percent',
    'media_staging_oldest_age_seconds',
    'media_failed_assets',
    'media_reconciliation_mismatch',
    'media_upload_total',
    'media_cleanup_total',
  ])
  const forbiddenLabels = new Set([
    'assetId',
    'filename',
    'objectKey',
    'originalFilename',
    'productId',
    'requestId',
  ])

  for (const metric of contract.metrics) {
    requiredMetrics.delete(metric.name)
    for (const label of Object.keys(metric.labels)) {
      assert.equal(forbiddenLabels.has(label), false, `${metric.name}.${label}`)
    }
    for (const values of Object.values(metric.labels)) {
      assert.ok(Array.isArray(values) && values.length > 0)
      assert.ok(values.length <= 12)
    }
  }
  assert.deepEqual([...requiredMetrics], [])
  assert.deepEqual(contract.capacityThresholds, {
    criticalBelowPercent: 10,
    warningBelowPercent: 20,
  })
  assert.equal(
    contract.alerts.find(alert => alert.name === 'MediaCleanupFailure')?.condition,
    'increase(media_cleanup_total{result=~"failed|isolated"}[1h]) > 0',
  )
})

test('恢复 runbook 固定容量、离机备份、同一恢复点和只读恢复顺序', async () => {
  const runbook = await read('docs/后端文档/媒体存储部署与恢复.md')
  for (const phrase of [
    '最低 30GB',
    '建议 50GB',
    '离机备份',
    '同一恢复点',
    '恢复数据库',
    '恢复 `assets/` 与 `trash/`',
    '只读 dry run',
    '不得删除或修复',
    '生产授权',
  ]) {
    assert.ok(runbook.includes(phrase), phrase)
  }
})
