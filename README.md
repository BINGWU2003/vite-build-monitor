# vite-build-monitor

[npm version](https://npmjs.com/package/vite-build-monitor)
[npm downloads](https://npmjs.com/package/vite-build-monitor)
[bundle](https://bundlephobia.com/result?p=vite-build-monitor)
[License](https://github.com/BINGWU2003/vite-build-monitor/blob/main/LICENSE.md)

一个用于监控 Vite 构建阶段内存使用情况的插件，支持记录 heap / RSS 快照、峰值追踪、异常阶段诊断与总构建耗时。

## 安装

```bash
pnpm add -D vite-build-monitor
```

## 使用方式

```ts
import { defineConfig } from 'vite'
import memoryMonitor from 'vite-build-monitor'

export default defineConfig({
  plugins: [
    memoryMonitor({
      logFile: './vite-build-monitor/build-memory.log',
      sampleIntervalMs: 100,
      logFormat: 'pretty',
      summaryTopN: 3,
      excludeHooks: ['buildEnd', 'renderStart'],
      printSummary: true,
    }),
  ],
})
```

## 配置项

```ts
interface MemoryMonitorOptions {
  logFile?: string
  sampleIntervalMs?: number
  appendLog?: boolean
  captureUncaughtException?: boolean
  printSummary?: boolean
  precision?: number
  logFormat?: 'pretty' | 'json'
  summaryTopN?: number
  excludeHooks?: HookName[]
}

type HookName
  = 'buildStart'
    | 'buildEnd'
    | 'renderStart'
    | 'transform'
    | 'renderChunk'
    | 'generateBundle'
    | 'writeBundle'
    | 'closeBundle'
```

- `logFile`
日志文件路径。传相对路径时会按 `process.cwd()` 解析。
默认：自动生成到 `./vite-build-monitor/` 目录，例如 `./vite-build-monitor/build-memory-20260418-101530.log`
- `sampleIntervalMs`
峰值轮询间隔（毫秒），小于 `50` 会自动提升到 `50`。
默认：`100`
- `appendLog`
是否在每次构建时追加日志，而不是覆盖旧文件。
默认：`false`
- `captureUncaughtException`
是否监听 `uncaughtException`，在崩溃前记录阶段和内存。
默认：`true`
- `printSummary`
是否在控制台输出最终峰值摘要。
默认：`true`
- `precision`
日志中内存值（MB）的保留小数位。
默认：`1`
- `logFormat`
日志输出格式，`pretty` 为易读文本，`json` 为机器可读 JSON Lines。
默认：`pretty`
- `summaryTopN`
构建结束时摘要里展示的高内存阶段数量。
默认：`3`
- `excludeHooks`
指定不输出哪些钩子的日志。默认不排除任何钩子。
示例：`['buildEnd', 'renderStart']`

## 美化日志示例（pretty）

```txt
=== 构建开始 2026-04-18T00:00:00.000Z ===
[10:15:30] [阶段] [buildStart            ] heap: 93.4 MB (Δ+0.0 MB) | rss: 168.9 MB (Δ+0.0 MB)
[10:15:31] [峰值] [renderChunk:main.js   ] heap: 287.1 MB (Δ+46.2 MB) | rss: 361.3 MB (Δ+54.7 MB)
[10:15:43] [构建耗时] 13.42 秒 (13420 毫秒)
[10:15:43] [最终峰值] 287.1 MB | 阶段: renderChunk:main.js
[10:15:43] [摘要] Top 3 内存阶段
[10:15:43] [Top1] renderChunk:main.js | heap: 287.1 MB | rss: 361.3 MB
```

## 机器日志示例（json）

```txt
{"type":"event","tag":"构建开始","timestamp":"2026-04-18T10:15:30.000Z","message":"构建已开始"}
{"type":"sample","tag":"阶段","timestamp":"2026-04-18T10:15:30.012Z","phase":"buildStart","heapMb":93.4,"rssMb":168.9,"heapDeltaMb":0,"rssDeltaMb":0}
{"type":"summary","timestamp":"2026-04-18T10:15:43.420Z","durationMs":13420,"duration":"13.42 秒 (13420 毫秒)","peak":{"heapMb":287.1,"phase":"renderChunk:main.js"},"topPhases":[{"rank":1,"phase":"renderChunk:main.js","heapMb":287.1,"rssMb":361.3,"timestamp":"2026-04-18T10:15:31.002Z"}]}
```

## 本地自检

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run release
```

## License

[MIT](./LICENSE.md)
