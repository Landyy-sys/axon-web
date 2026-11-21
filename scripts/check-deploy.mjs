/**
 * 部署自检 —— 上传 GitHub / 点 Render 之前跑一遍，把"上线才发现的坑"提前挡掉。
 *
 *   node scripts/check-deploy.mjs      （或 npm run deploy:check）
 *
 * 只做静态检查（不启动服务、不联网），12 条断言覆盖：
 *   1. package.json 有 start 脚本且指向 server.mjs
 *   2. engines.node 满足 vite 8 的要求（^20.19 || >=22.12）
 *   3. server.mjs 读 process.env.PORT
 *   4. server.mjs 监听 0.0.0.0（不能是 127.0.0.1，否则公网进不来）
 *   5. 平台指定 PORT 时不允许端口漂移
 *   6. 存在 /healthz 健康检查端点
 *   7. .gitignore 排除 node_modules / dist / .env
 *   8. 源码里没有疑似硬编码密钥
 *   9. 前端没有硬编码 localhost / 内网 IP
 *  10. dist/index.html 已构建（否则云端起来就是 404）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => {
  try { return fs.readFileSync(path.join(root, p), 'utf8') } catch { return '' }
}
const readJSON = (p) => { try { return JSON.parse(read(p)) } catch { return null } }

const results = []
const ok = (name, pass, detail = '') => results.push({ name, pass, detail })

/* 1 ── start 脚本 */
const pkg = readJSON('package.json')
const start = pkg?.scripts?.start || ''
ok('package.json 有 start 脚本', /node\s+server\.mjs/.test(start), start || '(缺失)')

/* 2 ── Node 版本 */
const engines = pkg?.engines?.node || ''
const major = Number((engines.match(/\d+/) || [0])[0])
ok('engines.node ≥ 22.12（vite 8 要求）', major >= 22, engines || '(缺失)')

/* 3 ── PORT 环境变量 */
const server = read('server.mjs')
ok('server.mjs 读取 process.env.PORT', /process\.env\.PORT/.test(server), '')

/* 4 ── 绑定 0.0.0.0 */
ok('监听 0.0.0.0（公网可达）', /listen\([^)]*'0\.0\.0\.0'/.test(server), '')

/* 5 ── 平台端口不漂移 */
ok('平台指定端口时不顺延', /FROM_PLATFORM\s*\?\s*1/.test(server), '')

/* 6 ── 健康检查 */
ok('存在 /healthz 端点', /healthz/.test(server), '')

/* 7 ── .gitignore */
const ignore = read('.gitignore')
const ig = (p) => new RegExp(`^${p.replace('.', '\\.')}/?$`, 'm').test(ignore)
ok('.gitignore 排除 node_modules', ig('node_modules'), '')
ok('.gitignore 排除 dist', ig('dist'), '')
ok('.gitignore 排除 .env', /^\.env$/m.test(ignore), '')

/* 8 ── 硬编码密钥 */
const secretRe = /(sk-[A-Za-z0-9]{16,}|AKID[A-Za-z0-9]{10,}|(?:api[_-]?key|secret[_-]?key|access[_-]?key)\s*[:=]\s*['"][A-Za-z0-9]{12,}['"])/i
const scanFiles = ['server.mjs', 'scripts/api-segment.mjs', ...fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter((f) => /\.(jsx?|mjs)$/.test(String(f)))
  .map((f) => path.join('src', String(f)))]
const leaks = scanFiles.filter((f) => secretRe.test(read(f)))
ok('源码无硬编码密钥', leaks.length === 0, leaks.join(', '))

/* 9 ── 前端硬编码地址 */
const addrHits = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter((f) => /\.(jsx?|mjs|css)$/.test(String(f)))
  .map((f) => path.join('src', String(f)))
  .filter((f) => /localhost|127\.0\.0\.1|192\.168\./.test(read(f)))
ok('前端无硬编码本地地址', addrHits.length === 0, addrHits.join(', '))

/* 10 ── 构建产物 */
ok('dist/index.html 存在', fs.existsSync(path.join(root, 'dist', 'index.html')), '先跑 npm run build')

/* ── 输出 ── */
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length))
console.log('\nAXON 部署自检\n' + '─'.repeat(46))
for (const r of results) {
  console.log(`${r.pass ? '✓' : '✗'} ${pad(r.name, 30)} ${r.detail ? `[${r.detail}]` : ''}`)
}
const failed = results.filter((r) => !r.pass)
console.log('─'.repeat(46))
console.log(`${results.length - failed.length} 通过 / ${failed.length} 失败\n`)
if (failed.length) process.exitCode = 1
