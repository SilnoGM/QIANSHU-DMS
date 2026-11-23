import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证看机预约传输契约与幂等重试边界。
import test from 'node:test'

import { createMachineViewingsApi } from '../../src/api/modules/machine-viewings'

test('列表按分页查询，创建携带幂等键且禁止自动重试', async () => {
  const calls: unknown[][] = []
  const invoke = (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  }
  const api = createMachineViewingsApi({
    get: invoke,
    post: invoke,
    patch: invoke,
  } as unknown as AxiosInstance)
  const signal = new AbortController().signal

  await api.list({ page: 2, pageSize: 50, keyword: '陈先生', status: 'APPOINTED' }, signal)
  await api.create({
    site: 'TAICHUNG_LONGJING',
    machineType: 'SHREDDER',
    appointmentMonth: 11,
    appointmentDay: 20,
    period: 'AM',
    customerName: '陈先生',
    contactPerson: '李华',
  }, 'key-1', signal)
  await api.update('viewing-1', {
    site: 'TAICHUNG_LONGJING',
    machineType: 'SHREDDER',
    appointmentDate: '2026-11-20',
    period: 'AM',
    customerName: '陈先生',
    contactPerson: '李华',
  }, signal)
  await api.transitionStatus('viewing-1', {
    status: 'FEEDBACK_GIVEN',
    feedback: '客户已到场',
  }, signal)
  await api.manualNotificationText('viewing-1', signal)
  await api.markManuallyNotified('viewing-1', signal)
  await api.statusCounts({ keyword: '陈先生' }, signal)

  assert.equal(calls[0][0], 'machine-viewings')
  assert.deepEqual(calls[0][1], {
    errorPresentation: 'local',
    params: { page: 2, pageSize: 50, keyword: '陈先生', status: 'APPOINTED' },
    signal,
  })

  assert.equal(calls[1][0], 'machine-viewings')
  assert.deepEqual((calls[1][1] as { customerName: string }).customerName, '陈先生')
  assert.deepEqual(calls[1][2], {
    errorPresentation: 'local',
    retry: false,
    headers: { 'Idempotency-Key': 'key-1' },
    signal,
  })

  assert.equal(calls[2][0], 'machine-viewings/viewing-1')
  assert.deepEqual(calls[2][2], {
    errorPresentation: 'local',
    retry: false,
    signal,
  })

  assert.equal(calls[3][0], 'machine-viewings/viewing-1/status-transitions')
  assert.deepEqual(calls[3][1], { status: 'FEEDBACK_GIVEN', feedback: '客户已到场' })
  assert.deepEqual(calls[3][2], {
    errorPresentation: 'local',
    retry: false,
    signal,
  })

  assert.equal(calls[4][0], 'machine-viewings/viewing-1/manual-notification-text')
  assert.deepEqual(calls[4][1], {
    errorPresentation: 'local',
    signal,
  })

  assert.equal(calls[5][0], 'machine-viewings/viewing-1/manual-notifications')
  assert.equal(calls[5][1], undefined)
  assert.deepEqual(calls[5][2], {
    errorPresentation: 'local',
    retry: false,
    signal,
  })

  assert.equal(calls[6][0], 'machine-viewings/status-counts')
  assert.deepEqual(calls[6][1], {
    errorPresentation: 'local',
    params: { keyword: '陈先生' },
    signal,
  })
})
