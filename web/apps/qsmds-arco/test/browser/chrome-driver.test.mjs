/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CdpConnection } from './chrome-driver.mjs'

test('DevTools event timeout includes the awaited method', async () => {
  const socket = {
    addEventListener() {},
  }
  const connection = new CdpConnection(socket)

  await assert.rejects(
    connection.waitForEvent('Page.loadEventFired', () => true, 1),
    {
      message: 'Browser DevTools event timed out: Page.loadEventFired',
    },
  )
})
