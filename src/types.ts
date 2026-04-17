export type LogFormat = 'pretty' | 'json'

export interface MemoryMonitorOptions {
  /**
   * The output file path, resolved from `process.cwd()` when relative.
   */
  logFile?: string
  /**
   * Polling interval in milliseconds for peak tracking.
   * Values less than 50 are clamped to 50.
   */
  sampleIntervalMs?: number
  /**
   * Write logs by appending to the existing file instead of truncating on each build.
   */
  appendLog?: boolean
  /**
   * Log uncaught exceptions to improve diagnostics near OOM crashes.
   */
  captureUncaughtException?: boolean
  /**
   * Print final peak memory summary to the console.
   */
  printSummary?: boolean
  /**
   * Decimal precision for memory values in MB.
   */
  precision?: number
  /**
   * Log output format: human-readable `pretty` or machine-readable `json`.
   */
  logFormat?: LogFormat
  /**
   * Number of top high-memory phases to include in summary.
   */
  summaryTopN?: number
}

export interface MemorySample {
  heapUsedMb: number
  rssMb: number
}

export interface MemoryDelta {
  heapDeltaMb: number
  rssDeltaMb: number
}

export interface SnapshotRecord {
  phase: string
  timestamp: string
  tag: string
  heapUsedMb: number
  rssMb: number
  heapDeltaMb: number
  rssDeltaMb: number
}
