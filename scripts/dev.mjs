import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { constants as osConstants } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  applyFailureToProcess,
  isDirectEntry,
} from './run-command.mjs'
import { cleanRootArtifacts } from './root-artifact-cleaner.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const developmentCommandsByTarget = {
  server: ['pnpm', ['-C', 'server', 'dev']],
  web: ['pnpm', ['-C', 'web', 'dev']],
}

export function developmentCommandsFor(target) {
  if (target === undefined) {
    return Object.values(developmentCommandsByTarget)
  }

  const command = developmentCommandsByTarget[target]
  if (!command) {
    // 入口错误保持固定文本，不回显可能由外部调用方注入的原始参数。
    throw new Error('Unsupported development target')
  }

  return [command]
}

export async function startDevelopment(target, {
  cleanRoot = cleanRootArtifacts,
  run = runDevelopment,
} = {}) {
  const commands = developmentCommandsFor(target)
  // pnpm 从根 package 启动脚本时可能已生成违规 lockfile 或状态目录，因此
  // 必须在创建任何长期运行子进程之前清理。目标参数要先完成无副作用校验，
  // 清理失败则直接阻止 Server/Web 启动。
  await cleanRoot()
  return run({ commands })
}

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

function readLinuxParentPid(pid) {
  if (
    process.platform !== 'linux'
    || !Number.isInteger(pid)
    || pid <= 1
  ) {
    return undefined
  }

  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const commandEnd = stat.lastIndexOf(')')
    if (commandEnd === -1) {
      return undefined
    }

    // /proc/<pid>/stat 的 comm 字段允许空格和右括号，因此从最后一个右括号
    // 后读取 state 与 PPID，不能对整行直接 split。
    const [, parentPidText] = stat.slice(commandEnd + 2).split(' ')
    if (!/^\d+$/u.test(parentPidText ?? '')) {
      return undefined
    }

    const parentPid = Number(parentPidText)
    return Number.isSafeInteger(parentPid) && parentPid > 0
      ? parentPid
      : undefined
  } catch {
    // 父进程在读取期间退出或 /proc 不可用时返回未知；监控器若已建立初始
    // ancestry，会把后续未知状态视为外层 launcher 已消失并安全收口。
    return undefined
  }
}

export function runDevelopment({
  clearIntervalImpl = clearInterval,
  commands = developmentCommandsFor(),
  processRef = process,
  readParentPidImpl = readLinuxParentPid,
  setIntervalImpl = setInterval,
  spawnImpl = spawn,
  useProcessGroups = process.platform !== 'win32',
} = {}) {
  return new Promise((resolve) => {
    const childStates = []
    const initialParentPid = processRef.ppid
    const initialOuterParentPid = useProcessGroups
      ? readParentPidImpl(initialParentPid)
      : undefined
    let firstFailureCode
    let parentMonitor
    let rootSignalObserved = false
    let spawningComplete = false
    let completed = false

    const stopParentMonitor = () => {
      if (parentMonitor === undefined) {
        return
      }

      clearIntervalImpl(parentMonitor)
      parentMonitor = undefined
    }

    const removeSignalListeners = () => {
      processRef.off('SIGHUP', handleSighup)
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
      stopParentMonitor()
      removeSignalListeners()
      resolve(firstFailureCode ?? 0)
    }

    const killRunningChild = (state, signal) => {
      if (state.settled) {
        return
      }

      let attemptedProcessGroup = false
      try {
        if (
          useProcessGroups
          && state.started
          && Number.isInteger(state.child.pid)
          && state.child.pid > 0
          && typeof processRef.kill === 'function'
        ) {
          attemptedProcessGroup = true
          // POSIX detached child 的 PID 同时是进程组 ID；向负 PID 发信号才能覆盖
          // pnpm、shell、Nest/Vite 等完整后代树，而不是只结束直接 launcher。
          processRef.kill(-state.child.pid, signal)
          return
        }

        state.child.kill(signal)
      } catch {
        if (!attemptedProcessGroup) {
          // 直接 child kill 的异常已经代表唯一可用路径失败，不能重复发送同一信号。
          return
        }

        // 进程组可能已在 exit 事件到达前消失；再尝试直接 child 可覆盖不支持
        // 负 PID 的注入实现。两次失败都不能覆盖首个退出码或回显底层异常。
        try {
          state.child.kill(signal)
        } catch {
          // 按阶段一约束继续等待真实 exit/error，不在编排器内增加 SIGKILL。
        }
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

    function handleSighup() {
      // 终端关闭时 detached 子进程组通常不会自动收到 HUP，必须由 manager
      // 显式转发，否则 Nest/Vite 可能在 shell 消失后继续占用监听端口。
      rootSignalObserved = true
      handleRootSignal('SIGHUP', 129)
    }

    function handleSigint() {
      rootSignalObserved = true
      handleRootSignal('SIGINT', 130)
    }

    function handleSigterm() {
      rootSignalObserved = true
      handleRootSignal('SIGTERM', 143)
    }

    processRef.on('SIGHUP', handleSighup)
    processRef.on('SIGINT', handleSigint)
    processRef.on('SIGTERM', handleSigterm)

    for (const [command, args] of commands) {
      let child
      try {
        const spawnOptions = {
          cwd: repositoryRoot,
          stdio: 'inherit',
        }
        if (useProcessGroups) {
          // macOS/Linux 上每个依赖域拥有独立进程组，根编排信号不会误伤当前
          // shell 或其他开发任务；Windows 保留 ChildProcess 的标准 kill 语义。
          spawnOptions.detached = true
        }
        child = spawnImpl(command, args, spawnOptions)
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
    if (
      useProcessGroups
      && Number.isInteger(initialParentPid)
      && initialParentPid > 1
    ) {
      // `node --run` 自身收到信号后不会把信号转给 package script。轮询 PPID
      // 可在外层进程消失并把本进程重挂到 PID 1 时，主动终止受控进程组。
      // Linux 还会保留一层被重挂的 /bin/sh，导致 manager 的直接 PPID 不变；
      // 此时必须同时比较该 shell 的 PPID，才能观察 outer node launcher 消失。
      parentMonitor = setIntervalImpl(() => {
        const directParentChanged = processRef.ppid !== initialParentPid
        const outerParentChanged = initialOuterParentPid !== undefined
          && readParentPidImpl(initialParentPid) !== initialOuterParentPid
        if (!directParentChanged && !outerParentChanged) {
          return
        }

        stopParentMonitor()
        if (!rootSignalObserved) {
          handleRootSignal('SIGTERM', 143)
        }
      }, 100)
      parentMonitor?.unref?.()
    }
    finishIfReady()
  })
}

if (isDirectEntry(import.meta.url)) {
  const target = process.argv[2]
  const hasUnexpectedArguments = process.argv.length > 3

  if (hasUnexpectedArguments) {
    applyFailureToProcess(new Error('Unsupported development target'))
  } else {
    Promise.resolve()
      .then(() => startDevelopment(target))
      .then((exitCode) => {
        process.exitCode = exitCode
      })
      .catch(error => applyFailureToProcess(error))
  }
}
