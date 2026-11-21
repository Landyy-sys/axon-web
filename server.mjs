/**
 * AXON 零依赖静态服务器
 * 只用 Node 内置模块（http/fs/path），不依赖 vite / 任何 npm 包，
 * 因此可以被 Windows 任务计划长期托管，不会因为某个 shell 会话结束而被回收。
 *
 * 用法： node server.mjs [端口]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, 'dist')

/* ── 端口来源优先级：命令行参数 > 云平台环境变量 PORT > 本地默认 4173 ──
   Render / Railway / Fly 等平台会注入 PORT，且**必须**监听这个精确端口，
   否则健康检查失败、部署被判为不健康。所以只要 PORT 是平台给的，就绝不漂移。 */
const ENV_PORT = Number(process.env.PORT || 0)
const ARG_PORT = Number(process.argv[2] || 0)
const FROM_PLATFORM = Boolean(process.env.PORT) && !(ARG_PORT > 0)
const BASE_PORT = ARG_PORT > 0 ? ARG_PORT : (ENV_PORT > 0 ? ENV_PORT : 4173)
const MAX_TRIES = FROM_PLATFORM ? 1 : 12 // 云端只认指定端口；本地才允许 4173→4184 顺延
const ON_CLOUD = Boolean(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME)
const PIDFILE = path.join(__dirname, 'server.port')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.obj': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
}

/* 云平台的文件系统是临时的，写日志文件既没意义又拖慢每个请求，
   所以云端只打到 stdout（Render 的 Logs 面板会收），本地才落盘。 */
function log (msg) {
  if (process.env.AXON_LOG === 'console' || ON_CLOUD) {
    console.log(msg)
    return
  }
  try {
    fs.appendFileSync(path.join(__dirname, 'server.log'),
      `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* 日志写不进去也不能让服务挂 */ }
}

function safePath (urlPath) {
  // 去掉 query / hash，解码，然后规范化，杜绝 ../ 越界
  let p = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
  if (p === '/' || p === '') p = '/index.html'
  const abs = path.normalize(path.join(ROOT, p))
  if (!abs.startsWith(ROOT)) return null // 越界，直接拒绝
  return abs
}

function lanUrls () {
  const out = []
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}

/* ── 可选：云端高精度分割代理（配置了 BAIDU_API_KEY 才启用）──
   POST /api/segment  body: { image: "<不含 data: 前缀的 base64>" }
   返回: { provider, boxes:[{kind,score,box:{x,y,w,h}}] }
   未配置密钥 → 501（前端收到 501 自动回退本地 detect.js，零配置也能用） */
const SEGMENT_PATH = '/api/segment'

/* ── 简易限流：公网暴露的付费接口必须防刷 ──
   同一 IP 每分钟最多 20 次、每天最多 400 次（内存计数，进程重启即清零）。
   免费额度足够单人演示；要更严格可换成 Redis / 平台自带 WAF。 */
const RATE_PER_MIN = Number(process.env.AXON_SEGMENT_PER_MIN || 20)
const RATE_PER_DAY = Number(process.env.AXON_SEGMENT_PER_DAY || 400)
const hits = new Map() // ip -> { min: [windowStart, count], day: [dayStart, count] }
function rateLimited (ip) {
  const now = Date.now()
  const day = new Date().toISOString().slice(0, 10)
  const rec = hits.get(ip) || { minStart: now, minCount: 0, day, dayCount: 0 }
  if (now - rec.minStart > 60_000) { rec.minStart = now; rec.minCount = 0 }
  if (rec.day !== day) { rec.day = day; rec.dayCount = 0 }
  rec.minCount++
  rec.dayCount++
  hits.set(ip, rec)
  if (hits.size > 5000) hits.clear() // 防内存无限增长
  return rec.minCount > RATE_PER_MIN || rec.dayCount > RATE_PER_DAY
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 12 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleSegment (req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'POST only' }))
    return
  }
  if (!process.env.BAIDU_API_KEY || !process.env.BAIDU_SECRET_KEY) {
    res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'cloud segmentation not configured (set BAIDU_API_KEY / BAIDU_SECRET_KEY)' }))
    return
  }
  // 平台通常会在 x-forwarded-for 里放真实客户端 IP
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || 'unknown'
  if (rateLimited(ip)) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' })
    res.end(JSON.stringify({ error: 'too many requests, slow down' }))
    return
  }
  try {
    const { image } = JSON.parse(await readBody(req))
    if (!image || typeof image !== 'string') throw new Error('missing image base64')
    const mod = await import('./scripts/api-segment.mjs')
    const boxes = await mod.segmentImage(image)
    log(`segment OK ${boxes.length} boxes`)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ provider: 'baidu', boxes }))
  } catch (e) {
    log(`segment ERR ${e && e.message}`)
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: String(e && e.message || e).slice(0, 200) }))
  }
}

const server = http.createServer((req, res) => {
  const started = Date.now()
  const pathname = (req.url || '').split('?')[0]

  // 健康检查：Render / 负载均衡 / 监控探针都走这里，不读磁盘、不算缓存
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), pid: process.pid }))
    return
  }

  if (pathname === SEGMENT_PATH) {
    handleSegment(req, res)
    return
  }
  let target = safePath(req.url || '/')
  if (!target) {
    res.writeHead(403).end('Forbidden')
    return
  }
  fs.stat(target, (err, st) => {
    // SPA 回退：找不到具体文件时回到 index.html（本项目是单页应用）
    if (err || !st.isFile()) {
      const idx = path.join(ROOT, 'index.html')
      if (fs.existsSync(idx)) target = idx
      else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('404 — dist/index.html 不存在，请先执行 npm run build')
        return
      }
    }
    const ext = path.extname(target).toLowerCase()
    const type = MIME[ext] || 'application/octet-stream'
    // 带 hash 的构建产物可以长缓存，入口文件必须每次校验
    const cache = target.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': cache,
      // 允许被任意来源的 <img> / canvas 读取像素（ detect.js 需要 getImageData ）
      'Cross-Origin-Resource-Policy': 'cross-origin'
    })
    fs.createReadStream(target)
      .on('error', () => { try { res.end() } catch { /* noop */ } })
      .pipe(res)
      .on('finish', () => log(`${req.method} ${req.url} -> ${target.replace(ROOT, '')} ${Date.now() - started}ms`))
  })
})

/** 探测某个端口上是否已经有 AXON 服务在跑（避免重复启动导致端口漂移） */
function probe (port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/', timeout: 600 },
      (res) => { res.resume(); resolve(res.statusCode === 200) }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

async function start () {
  // 已经有一个实例在 BASE_PORT 上正常服务 —— 什么都不做，直接退出（本地防重复启动）
  if (!ON_CLOUD && await probe(BASE_PORT)) {
    log(`another instance already serving on ${BASE_PORT}, exit silently`)
    try { fs.writeFileSync(PIDFILE, String(BASE_PORT)) } catch { /* noop */ }
    return
  }

  // dist 缺失时给出明确提示，而不是让用户看到一堆 404
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
    log('FATAL dist/index.html missing')
    console.error('dist/index.html 不存在，请先在项目目录执行 npm run build')
    process.exitCode = 1
    return
  }

  let port = BASE_PORT
  for (let i = 0; i < MAX_TRIES; i++) {
    port = BASE_PORT + i
    const ok = await new Promise((resolve) => {
      const onErr = (e) => {
        if (e && e.code === 'EADDRINUSE') resolve(false)
        else { log(`FATAL ${e && e.message}`); resolve('fatal') }
      }
      server.once('error', onErr)
      server.listen(port, '0.0.0.0', () => {
        server.removeListener('error', onErr)
        server.on('error', (e) => log(`server-error ${e && e.message}`))
        resolve(true)
      })
    })
    if (ok === true) break
    if (ok === 'fatal') return
    log(`port ${port} busy, trying next`)
  }

  try { fs.writeFileSync(PIDFILE, String(port)) } catch { /* noop */ }
  const ips = lanUrls()
  const lines = [
    `AXON server listening on ${port}`,
    ...(ON_CLOUD
      ? [`  公网   https://<你的服务名>.onrender.com（由平台转发到本进程）`]
      : [
          `  本机   http://localhost:${port}/`,
          ...ips.map((ip) => `  局域网 http://${ip}:${port}/`)
        ]),
    `  root   ${ROOT}`,
    `  pid    ${process.pid}`,
    `  env    PORT=${process.env.PORT || '(未设置，用默认值)'}${FROM_PLATFORM ? ' [平台指定，不漂移]' : ''}`
  ]
  const banner = lines.join('\n')
  console.log(banner)
  log(`--- start on ${port} ---`)

  // 云平台缩容/重新部署时会先发 SIGTERM，给它 8 秒把手上的请求送完再退出
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`${sig} received, closing server...`)
      server.close(() => process.exit(0))
      setTimeout(() => process.exit(0), 8000).unref()
    })
  }
}

start()

// 防止空闲/异常导致静默退出
process.on('uncaughtException', (e) => log(`uncaughtException ${e && e.stack}`))
process.on('unhandledRejection', (e) => log(`unhandledRejection ${e}`))
