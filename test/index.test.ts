import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import createMemoryMonitorPlugin from '../src'

const fsMock = vi.hoisted(() => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('node:fs', () => {
  const mod = {
    appendFileSync: fsMock.appendFileSync,
    mkdirSync: fsMock.mkdirSync,
    writeFileSync: fsMock.writeFileSync,
  }

  return {
    ...mod,
    default: mod,
  }
})

function toBytes(mb: number): number {
  return mb * 1024 * 1024
}

function createMemoryUsage(heapMb: number, rssMb: number): NodeJS.MemoryUsage {
  return {
    arrayBuffers: 0,
    external: 0,
    heapTotal: toBytes(heapMb + 32),
    heapUsed: toBytes(heapMb),
    rss: toBytes(rssMb),
  }
}

function mockMemorySequence(sequence: Array<{ heapMb: number, rssMb: number }>) {
  const queue = sequence.map(({ heapMb, rssMb }) => createMemoryUsage(heapMb, rssMb))
  const fallback = createMemoryUsage(64, 128)

  return vi.spyOn(process, 'memoryUsage').mockImplementation(() => queue.shift() ?? fallback)
}

function invokeBuildHook(
  hook: unknown,
  ...args: unknown[]
) {
  if (typeof hook === 'function') {
    hook(...args)
    return
  }

  if (hook && typeof hook === 'object' && 'handler' in hook && typeof hook.handler === 'function')
    hook.handler(...args)
}

function expectTimestampedDefaultLogPath(value: unknown): asserts value is string {
  expect(typeof value).toBe('string')
  const normalized = String(value).replaceAll('\\', '/')
  expect(normalized).toContain('/vite-build-monitor/')
  expect(normalized).toMatch(/build-memory-\d{8}-\d{6}\.log$/)
}

describe('vite-build-memory-monitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    fsMock.appendFileSync.mockReset()
    fsMock.mkdirSync.mockReset()
    fsMock.writeFileSync.mockReset()
  })

  it('tracks build lifecycle and emits final peak log', () => {
    mockMemorySequence([
      { heapMb: 100, rssMb: 180 }, // buildStart snapshot
      { heapMb: 150, rssMb: 200 }, // timer peak update
      { heapMb: 120, rssMb: 190 }, // buildEnd snapshot
      { heapMb: 110, rssMb: 170 }, // closeBundle snapshot
    ])

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const plugin = createMemoryMonitorPlugin({
      logFile: 'logs/memory.log',
      printSummary: true,
      sampleIntervalMs: 100,
    })

    invokeBuildHook(plugin.buildStart, {})
    vi.advanceTimersByTime(100)
    vi.advanceTimersByTime(2400)
    invokeBuildHook(plugin.buildEnd, undefined)
    invokeBuildHook(plugin.closeBundle, undefined)

    const absoluteLogFile = resolve(process.cwd(), 'logs/memory.log')
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(resolve(process.cwd(), 'logs'), { recursive: true })
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      absoluteLogFile,
      expect.stringContaining('=== 构建开始'),
    )
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      absoluteLogFile,
      expect.stringContaining('[阶段] [buildStart'),
    )
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      absoluteLogFile,
      expect.stringContaining('[峰值] [buildStart'),
    )
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      absoluteLogFile,
      expect.stringContaining('[构建耗时] 2.50 秒 (2500 毫秒)'),
    )
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      absoluteLogFile,
      expect.stringContaining('[最终峰值] 150.0 MB | 阶段: buildStart'),
    )
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      absoluteLogFile,
      expect.stringContaining('[摘要] Top'),
    )
    expect(infoSpy).toHaveBeenCalledWith('[vite-build-memory-monitor] 内存峰值 150.0 MB，阶段：buildStart，耗时：2.50 秒 (2500 毫秒)')
  })

  it('registers and tears down uncaughtException listener and logs crash details', () => {
    mockMemorySequence([
      { heapMb: 80, rssMb: 140 }, // buildStart snapshot
      { heapMb: 95, rssMb: 150 }, // crash sample
      { heapMb: 70, rssMb: 130 }, // closeBundle snapshot
    ])

    const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process)
    const offSpy = vi.spyOn(process, 'off').mockImplementation(() => process)
    const plugin = createMemoryMonitorPlugin({ printSummary: false })

    invokeBuildHook(plugin.buildStart, {})
    const defaultLogFile = fsMock.writeFileSync.mock.calls[0]?.[0]
    expectTimestampedDefaultLogPath(defaultLogFile)

    const handler = onSpy.mock.calls.find(([event]) => event === 'uncaughtException')?.[1]
    expect(handler).toBeTypeOf('function')

    handler?.(new Error('boom'))
    invokeBuildHook(plugin.closeBundle, undefined)

    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      defaultLogFile,
      expect.stringContaining('[崩溃] [buildStart'),
    )
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      defaultLogFile,
      expect.stringContaining('[错误] Error: boom'),
    )
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      defaultLogFile,
      expect.stringContaining('[构建耗时] 0.00 秒 (0 毫秒)'),
    )
    expect(offSpy).toHaveBeenCalledWith('uncaughtException', handler)
  })

  it('records transform hook memory snapshots', () => {
    mockMemorySequence([
      { heapMb: 60, rssMb: 120 }, // buildStart snapshot
      { heapMb: 88, rssMb: 140 }, // transform snapshot
      { heapMb: 70, rssMb: 130 }, // closeBundle snapshot
    ])

    const plugin = createMemoryMonitorPlugin({
      logFile: 'logs/transform.log',
      printSummary: false,
    })

    invokeBuildHook(plugin.buildStart, {})
    invokeBuildHook(plugin.transform, 'const value = 42', 'src/main.ts')
    invokeBuildHook(plugin.closeBundle, undefined)

    const absoluteLogFile = resolve(process.cwd(), 'logs/transform.log')
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      absoluteLogFile,
      expect.stringContaining('[阶段] [transform:src/main.ts'),
    )
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      absoluteLogFile,
      expect.stringContaining('[最终峰值] 88.0 MB | 阶段: transform:src/main.ts'),
    )
  })

  it('emits machine-readable json logs when logFormat is json', () => {
    mockMemorySequence([
      { heapMb: 30, rssMb: 60 }, // buildStart snapshot
      { heapMb: 45, rssMb: 70 }, // timer peak update
      { heapMb: 40, rssMb: 65 }, // closeBundle snapshot
    ])

    const plugin = createMemoryMonitorPlugin({
      logFile: 'logs/memory.jsonl',
      logFormat: 'json',
      summaryTopN: 1,
      printSummary: false,
      sampleIntervalMs: 100,
    })

    invokeBuildHook(plugin.buildStart, {})
    vi.advanceTimersByTime(100)
    vi.advanceTimersByTime(900)
    invokeBuildHook(plugin.closeBundle, undefined)

    const absoluteLogFile = resolve(process.cwd(), 'logs/memory.jsonl')
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(absoluteLogFile, '')

    const payloads = fsMock.appendFileSync.mock.calls
      .filter(([file]) => file === absoluteLogFile)
      .map(([, line]) => JSON.parse(String(line).trim()) as Record<string, unknown>)

    expect(payloads.some(payload => payload.type === 'event' && payload.tag === '构建开始')).toBe(true)
    expect(payloads.some(payload => payload.type === 'sample' && payload.tag === '峰值')).toBe(true)

    const summary = payloads.find(payload => payload.type === 'summary')
    expect(summary).toBeDefined()
    expect(summary?.durationMs).toBe(1000)
    expect(Array.isArray(summary?.topPhases)).toBe(true)
    expect((summary?.topPhases as unknown[]).length).toBe(1)
  })

  it('does not attach uncaughtException listener when disabled', () => {
    mockMemorySequence([
      { heapMb: 50, rssMb: 110 }, // buildStart snapshot
      { heapMb: 45, rssMb: 100 }, // closeBundle snapshot
    ])

    const onSpy = vi.spyOn(process, 'on')
    const plugin = createMemoryMonitorPlugin({
      captureUncaughtException: false,
      printSummary: false,
    })

    invokeBuildHook(plugin.buildStart, {})
    invokeBuildHook(plugin.closeBundle, undefined)

    expect(onSpy).not.toHaveBeenCalledWith('uncaughtException', expect.any(Function))
  })
})
