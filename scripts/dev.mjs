import { spawn } from 'node:child_process'
import { constants as osConstants } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  applyFailureToProcess,
  isDirectEntry,
} from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const developmentCommands = [
  ['pnpm', ['-C', 'server', 'dev']],
  ['pnpm', ['-C', 'web', 'dev']],
]

function exitCodeFromSignal(signal) {
  const signalNumber = typeof signal === 'string'
    ? osConstants.signals[signal]
    : undefined
  return Number.isInteger(signalNumber) && signalNumber > 0
    ? 128 + signalNumber
    : 1
}

function normalizeExitCode(exitCode) {
  return Number.isInteger(exitCode) && exitCode > 0 ? exitCode : 1
}

export function runDevelopment({ spawnImpl = spawn, processRef = process } = {}) {
  return new Promise((resolve) => {
    const childStates = []
    let firstFailureCode
    let spawningComplete = false
    let completed = false

    const removeSignalListeners = () => {
      processRef.off('SIGINT', handleSigint)
      processRef.off('SIGTERM', handleSigterm)
    }

    const finishIfReady = () => {
      // spawn 循环结束前不能提前完成，否则极快退出的第一个子进程可能让第二个
      // 子进程尚未创建就错误收口。所有已启动进程都终止后才清理根监听器。
      if (
        completed
        || !spawningComplete
        || childStates.some(state => !state.settled)
      ) {
        return
      }

      completed = true
      removeSignalListeners()
      resolve(firstFailureCode ?? 0)
    }

    const killRunningChild = (state, signal) => {
      if (state.settled) {
        return
      }

      try {
        state.child.kill(signal)
      } catch {
        // kill 失败不能覆盖首个退出码，也不能回显可能携带环境信息的异常。
        // 按阶段一约束继续等待该子进程后续 exit/error，不增加超时或 SIGKILL。
      }
    }

    const recordFailure = (exitCode, sourceState, peerSignal = 'SIGTERM') => {
      if (firstFailureCode !== undefined) {
        return
      }

      firstFailureCode = normalizeExitCode(exitCode)
      for (const state of childStates) {
        if (state !== sourceState) {
          killRunningChild(state, peerSignal)
        }
      }
    }

    const settleChild = (state, exitCode) => {
      // 同一 ChildProcess 可能先发 error 再发 exit；只把第一个终态计入结果。
      if (state.settled) {
        return
      }

      state.settled = true
      if (exitCode !== 0) {
        recordFailure(exitCode, state)
      }
      finishIfReady()
    }

    const handleRootSignal = (signal, exitCode) => {
      // 根信号到达时只在尚无结果时记录对应退出码，已有首个失败码则保持不变；
      // 但每一次根信号都必须继续转发给仍运行的子进程，确保用户可以再次中断
      // 尚未响应先前 SIGTERM 的 peer。
      if (firstFailureCode === undefined) {
        firstFailureCode = exitCode
      }

      for (const state of childStates) {
        killRunningChild(state, signal)
      }
      finishIfReady()
    }

    function handleSigint() {
      handleRootSignal('SIGINT', 130)
    }

    function handleSigterm() {
      handleRootSignal('SIGTERM', 143)
    }

    processRef.on('SIGINT', handleSigint)
    processRef.on('SIGTERM', handleSigterm)

    for (const [command, args] of developmentCommands) {
      let child
      try {
        child = spawnImpl(command, args, {
          cwd: repositoryRoot,
          stdio: 'inherit',
        })
      } catch {
        // 第一条 spawn 同步失败时不再启动第二条；第二条失败时清理已经启动的
        // peer。同步异常可能含敏感上下文，因此这里只记录统一失败码 1。
        recordFailure(1)
        break
      }

      const state = {
        child,
        settled: false,
        // 成功 spawn 的真实 ChildProcess 会提供正整数 pid；测试和极短时序下也可
        // 通过后续 spawn 事件确认启动。只有未启动状态的 error 才等同 spawn failure。
        started: Number.isInteger(child.pid) && child.pid > 0,
      }
      childStates.push(state)

      child.once('spawn', () => {
        if (!state.settled) {
          state.started = true
        }
      })
      child.once('error', () => {
        if (state.settled) {
          return
        }

        if (!state.started) {
          settleChild(state, 1)
          return
        }

        // started child 的 error 可能来自 kill 失败等运行期问题，并不证明进程已
        // 终止。记录失败并清理 peer，但必须等待该 child 的真实 exit 才能收口。
        recordFailure(1, state)
      })
      child.once('exit', (code, signal) => {
        const exitCode = code === null
          ? exitCodeFromSignal(signal)
          : code === 0 ? 0 : normalizeExitCode(code)
        settleChild(state, exitCode)
      })
    }

    spawningComplete = true
    finishIfReady()
  })
}

if (isDirectEntry(import.meta.url)) {
  runDevelopment()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch(error => applyFailureToProcess(error))
}
