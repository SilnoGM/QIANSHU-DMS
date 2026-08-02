/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CdpConnection,
  ChromeBrowser,
  ChromePage,
} from './chrome-driver.mjs'

class FakeSocket {
  constructor({ respondToCommands = false } = {}) {
    this.closeCount = 0
    this.listeners = new Map()
    this.respondToCommands = respondToCommands
    this.sentMessages = []
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add({ listener, once: options.once === true })
    this.listeners.set(type, listeners)
  }

  dispatch(type, event = {}) {
    for (const entry of [...(this.listeners.get(type) ?? [])]) {
      entry.listener(event)
      if (entry.once) {
        this.listeners.get(type)?.delete(entry)
      }
    }
  }

  dispatchCdpMessage(message) {
    this.dispatch('message', { data: JSON.stringify(message) })
  }

  send(serializedMessage) {
    const message = JSON.parse(serializedMessage)
    this.sentMessages.push(message)
    if (!this.respondToCommands) {
      return
    }
    queueMicrotask(() => {
      this.dispatchCdpMessage({ id: message.id, result: {} })
      if (message.method === 'Page.navigate') {
        this.dispatchCdpMessage({
          method: 'Page.loadEventFired',
          params: {},
        })
      }
    })
  }

  close() {
    this.closeCount += 1
    this.dispatch('close')
  }
}

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

for (const terminalEvent of ['close', 'error']) {
  test(`DevTools ${terminalEvent} rejects active event waiters immediately`, async () => {
    const socket = new FakeSocket()
    const connection = new CdpConnection(socket)
    const waiting = connection.waitForEvent(
      'Page.loadEventFired',
      () => true,
      50,
    )

    socket.dispatch(terminalEvent)

    await assert.rejects(waiting, {
      message: 'Browser DevTools connection closed',
    })
    assert.equal(connection.listeners.get('Page.loadEventFired')?.size ?? 0, 0)
  })
}

test('DevTools event waiter supports explicit AbortSignal cancellation', async () => {
  const socket = new FakeSocket()
  const connection = new CdpConnection(socket)
  const controller = new AbortController()
  const waiting = connection.waitForEvent(
    'Network.responseReceived',
    () => true,
    50,
    { signal: controller.signal },
  )

  controller.abort()

  await assert.rejects(waiting, {
    message: 'Browser DevTools event cancelled: Network.responseReceived',
  })
  assert.equal(connection.eventWaiters.size, 0)
  assert.equal(connection.listeners.get('Network.responseReceived')?.size ?? 0, 0)
})

test('DevTools send fails without registering work after the connection closed', async () => {
  const socket = new FakeSocket()
  const connection = new CdpConnection(socket)
  socket.dispatch('close')

  const command = connection.send('Runtime.enable')
  const pendingSize = connection.pending.size
  const sentCount = socket.sentMessages.length
  // 红测失败时再次分发终止事件，确保旧实现留下的 command timer 也会回收。
  socket.dispatch('error')

  await assert.rejects(command, {
    message: 'Browser DevTools connection closed',
  })
  assert.equal(pendingSize, 0)
  assert.equal(sentCount, 0)
})

test('Browser close proactively closes every tracked page connection', async () => {
  const closeOrder = []
  const child = { exitCode: 0, signalCode: null }
  const browserConnection = {
    close() {
      closeOrder.push('browser-connection')
    },
    async send(method) {
      closeOrder.push(method)
    },
  }
  const firstPageConnection = {
    close() {
      closeOrder.push('first-page')
    },
  }
  const secondPageConnection = {
    close() {
      closeOrder.push('second-page')
    },
  }
  const browser = new ChromeBrowser(
    child,
    browserConnection,
    9_222,
    '/browser',
    '/profile',
  )
  browser.pageConnections = new Set([
    firstPageConnection,
    secondPageConnection,
  ])

  await browser.close()

  assert.deepEqual(closeOrder, [
    'first-page',
    'second-page',
    'Browser.close',
    'browser-connection',
  ])
  assert.equal(browser.pageConnections.size, 0)
})

test('Page navigation removes the event waiter that loses the navigation race', async () => {
  const socket = new FakeSocket({ respondToCommands: true })
  const connection = new CdpConnection(socket)
  const page = new ChromePage(connection)

  await page.navigate('http://127.0.0.1/example')

  const loadListenerCount = connection.listeners.get('Page.loadEventFired')?.size ?? 0
  const withinDocumentListenerCount = connection.listeners.get(
    'Page.navigatedWithinDocument',
  )?.size ?? 0
  // 旧实现的 race loser 需要补发事件才能清掉长 timer，避免红测进程悬挂。
  socket.dispatchCdpMessage({
    method: 'Page.navigatedWithinDocument',
    params: {},
  })
  connection.close()

  assert.equal(loadListenerCount, 0)
  assert.equal(withinDocumentListenerCount, 0)
})
