import type { Plugin } from 'vite'
import type {
  MemoryDelta,
  MemoryMonitorOptions,
  MemorySample,
  SnapshotRecord,
} from './types'
import { Buffer as NodeBuffer } from 'node:buffer'
import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { DEFAULT_SAMPLE_INTERVAL_MS, DEFAULT_SUMMARY_TOP_N } from './constants'
import {
  buildDefaultLogFilePath,
  formatClock,
  readMemorySample,
  stringifyError,
} from './utils'

export default function createMemoryMonitorPlugin(options: MemoryMonitorOptions = {}): Plugin {
  const userLogFile = options.logFile ? resolve(process.cwd(), options.logFile) : undefined
  const sampleIntervalMs = Math.max(50, options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS)
  const summaryTopN = Math.max(0, Math.floor(options.summaryTopN ?? DEFAULT_SUMMARY_TOP_N))
  const precision = options.precision ?? 1
  const appendLog = options.appendLog ?? false
  const captureUncaughtException = options.captureUncaughtException ?? true
  const printSummary = options.printSummary ?? true
  const logFormat = options.logFormat ?? 'pretty'

  let phase = 'init'
  let peakHeapMb = 0
  let peakPhase = 'init'
  let buildStartedAtMs: number | undefined
  let lastSample: MemorySample | undefined
  let currentLogFile = userLogFile ?? buildDefaultLogFilePath(new Date())
  let snapshots: SnapshotRecord[] = []
  let timer: NodeJS.Timeout | undefined
  let uncaughtHandler: ((error: unknown) => void) | undefined

  const formatMb = (value: number): string => value.toFixed(precision)
  const formatSignedMb = (value: number): string => `${value >= 0 ? '+' : ''}${formatMb(value)}`
  const formatDuration = (durationMs: number): string => `${(durationMs / 1000).toFixed(2)} 秒 (${durationMs} 毫秒)`

  const resolveLogFileForBuild = (): string => userLogFile ?? buildDefaultLogFilePath(new Date())

  const write = (message: string): void => {
    fs.appendFileSync(currentLogFile, `${message}\n`)
  }

  const writeJson = (payload: Record<string, unknown>): void => {
    write(JSON.stringify(payload))
  }

  const computeDelta = (sample: MemorySample): MemoryDelta => {
    const delta: MemoryDelta = {
      heapDeltaMb: sample.heapUsedMb - (lastSample?.heapUsedMb ?? sample.heapUsedMb),
      rssDeltaMb: sample.rssMb - (lastSample?.rssMb ?? sample.rssMb),
    }
    lastSample = sample
    return delta
  }

  const writeEvent = (tag: string, message: string, extra: Record<string, unknown> = {}): void => {
    const now = new Date()
    if (logFormat === 'json') {
      writeJson({
        type: 'event',
        tag,
        timestamp: now.toISOString(),
        message,
        ...extra,
      })
      return
    }

    write(`[${formatClock(now)}] [${tag}] ${message}`)
  }

  const writeSample = (tag: string, phaseLabel: string, sample: MemorySample): void => {
    const now = new Date()
    const delta = computeDelta(sample)
    snapshots.push({
      phase: phaseLabel,
      timestamp: now.toISOString(),
      tag,
      heapUsedMb: sample.heapUsedMb,
      rssMb: sample.rssMb,
      heapDeltaMb: delta.heapDeltaMb,
      rssDeltaMb: delta.rssDeltaMb,
    })

    if (logFormat === 'json') {
      writeJson({
        type: 'sample',
        tag,
        timestamp: now.toISOString(),
        phase: phaseLabel,
        heapMb: Number(formatMb(sample.heapUsedMb)),
        rssMb: Number(formatMb(sample.rssMb)),
        heapDeltaMb: Number(formatMb(delta.heapDeltaMb)),
        rssDeltaMb: Number(formatMb(delta.rssDeltaMb)),
      })
      return
    }

    const phaseColumn = phaseLabel.padEnd(22, ' ')
    write(
      `[${formatClock(now)}] [${tag}] [${phaseColumn}] `
      + `heap: ${formatMb(sample.heapUsedMb)} MB (Δ${formatSignedMb(delta.heapDeltaMb)} MB) | `
      + `rss: ${formatMb(sample.rssMb)} MB (Δ${formatSignedMb(delta.rssDeltaMb)} MB)`,
    )
  }

  const ensureLogDirectory = (): void => {
    fs.mkdirSync(dirname(currentLogFile), { recursive: true })
  }

  const updatePeak = (sample: MemorySample, label: string): boolean => {
    if (sample.heapUsedMb <= peakHeapMb)
      return false

    peakHeapMb = sample.heapUsedMb
    peakPhase = label
    return true
  }

  const snapshot = (label: string): MemorySample => {
    const sample = readMemorySample()
    updatePeak(sample, label)
    writeSample('阶段', label, sample)
    return sample
  }

  const getTopPhaseSnapshots = (topN: number): SnapshotRecord[] => {
    const phasePeaks = new Map<string, SnapshotRecord>()
    for (const record of snapshots) {
      const previous = phasePeaks.get(record.phase)
      if (!previous || record.heapUsedMb > previous.heapUsedMb)
        phasePeaks.set(record.phase, record)
    }
    return [...phasePeaks.values()]
      .sort((a, b) => b.heapUsedMb - a.heapUsedMb)
      .slice(0, topN)
  }

  const writeSummary = (durationMs?: number): void => {
    const topPhases = getTopPhaseSnapshots(summaryTopN)
    if (logFormat === 'json') {
      writeJson({
        type: 'summary',
        timestamp: new Date().toISOString(),
        durationMs,
        duration: durationMs === undefined ? undefined : formatDuration(durationMs),
        peak: {
          heapMb: Number(formatMb(peakHeapMb)),
          phase: peakPhase,
        },
        topPhases: topPhases.map((record, index) => ({
          rank: index + 1,
          phase: record.phase,
          heapMb: Number(formatMb(record.heapUsedMb)),
          rssMb: Number(formatMb(record.rssMb)),
          timestamp: record.timestamp,
        })),
      })
      return
    }

    if (durationMs !== undefined)
      writeEvent('构建耗时', formatDuration(durationMs))
    writeEvent('最终峰值', `${formatMb(peakHeapMb)} MB | 阶段: ${peakPhase}`)
    if (topPhases.length > 0) {
      writeEvent('摘要', `Top ${topPhases.length} 内存阶段`)
      for (const [index, record] of topPhases.entries()) {
        writeEvent(
          `Top${index + 1}`,
          `${record.phase} | heap: ${formatMb(record.heapUsedMb)} MB | rss: ${formatMb(record.rssMb)} MB`,
        )
      }
    }
  }

  const stopSampling = (): void => {
    if (!timer)
      return

    clearInterval(timer)
    timer = undefined
  }

  const teardownUncaughtHook = (): void => {
    if (!uncaughtHandler)
      return

    process.off('uncaughtException', uncaughtHandler)
    uncaughtHandler = undefined
  }

  const setupUncaughtHook = (): void => {
    if (!captureUncaughtException)
      return

    teardownUncaughtHook()
    uncaughtHandler = (error: unknown) => {
      const sample = readMemorySample()
      const phaseLabel = phase
      updatePeak(sample, phaseLabel)
      writeSample('崩溃', phaseLabel, sample)
      writeEvent('错误', stringifyError(error), { phase: phaseLabel })
    }
    process.on('uncaughtException', uncaughtHandler)
  }

  const startSampling = (): void => {
    stopSampling()
    timer = setInterval(() => {
      const sample = readMemorySample()
      const phaseLabel = phase
      if (updatePeak(sample, phaseLabel))
        writeSample('峰值', phaseLabel, sample)
    }, sampleIntervalMs)
    timer.unref?.()
  }

  const finalize = (): void => {
    stopSampling()
    teardownUncaughtHook()
  }

  return {
    name: 'vite-build-memory-monitor',
    apply: 'build',

    buildStart() {
      phase = 'buildStart'
      peakHeapMb = 0
      peakPhase = phase
      buildStartedAtMs = Date.now()
      lastSample = undefined
      snapshots = []
      currentLogFile = resolveLogFileForBuild()

      ensureLogDirectory()
      if (logFormat === 'pretty') {
        const header = `=== 构建开始 ${new Date().toISOString()} ===\n`
        if (appendLog)
          fs.appendFileSync(currentLogFile, header)
        else
          fs.writeFileSync(currentLogFile, header)
      }
      else if (!appendLog) {
        fs.writeFileSync(currentLogFile, '')
        writeEvent('构建开始', '构建已开始')
      }
      else {
        writeEvent('构建开始', '构建已开始')
      }

      setupUncaughtHook()
      startSampling()
      snapshot(phase)
    },

    buildEnd(error) {
      phase = 'buildEnd'
      snapshot(phase)
      if (error)
        writeEvent('构建错误', stringifyError(error))
    },

    renderStart() {
      phase = 'renderStart'
      snapshot(phase)
    },

    transform(code, id) {
      const sourceSizeKb = NodeBuffer.byteLength(code, 'utf8') / 1024
      phase = `transform:${id}`
      snapshot(`${phase} (${sourceSizeKb.toFixed(1)}KB)`)
      return null
    },

    renderChunk(code, chunk) {
      const chunkSizeKb = NodeBuffer.byteLength(code, 'utf8') / 1024
      phase = `renderChunk:${chunk.fileName}`
      snapshot(`${phase} (${chunkSizeKb.toFixed(1)}KB)`)
    },

    generateBundle() {
      phase = 'generateBundle'
      snapshot(phase)
    },

    writeBundle() {
      phase = 'writeBundle'
      snapshot(phase)
    },

    closeBundle(error) {
      phase = 'closeBundle'
      snapshot(phase)
      if (error)
        writeEvent('关闭错误', stringifyError(error))

      const durationMs = buildStartedAtMs === undefined
        ? undefined
        : Math.max(0, Date.now() - buildStartedAtMs)
      writeSummary(durationMs)

      if (printSummary) {
        const summary = `[vite-build-memory-monitor] 内存峰值 ${formatMb(peakHeapMb)} MB，阶段：${peakPhase}，耗时：${durationMs === undefined ? '未知' : formatDuration(durationMs)}`
        // eslint-disable-next-line no-console
        console.info(summary)
      }

      finalize()
    },

    closeWatcher() {
      finalize()
    },
  }
}
