import type { MemorySample } from './types'
import { resolve } from 'node:path'
import process from 'node:process'
import { DEFAULT_LOG_DIR, DEFAULT_LOG_PREFIX, MB } from './constants'

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

export function formatTimestampForFilename(date: Date): string {
  return `${[
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join('')
  }-${
    [
      pad2(date.getHours()),
      pad2(date.getMinutes()),
      pad2(date.getSeconds()),
    ].join('')}`
}

export function buildDefaultLogFilePath(date: Date): string {
  const filename = `${DEFAULT_LOG_PREFIX}-${formatTimestampForFilename(date)}.log`
  return resolve(process.cwd(), DEFAULT_LOG_DIR, filename)
}

export function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export function readMemorySample(): MemorySample {
  const usage = process.memoryUsage()
  return {
    heapUsedMb: usage.heapUsed / MB,
    rssMb: usage.rss / MB,
  }
}

export function stringifyError(error: unknown): string {
  if (error instanceof Error)
    return error.stack ?? error.message
  return String(error)
}
