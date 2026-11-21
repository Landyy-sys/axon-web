/* 打印本机所有可对外访问的局域网地址 */
import os from 'node:os'

const PORT = process.argv[2] || '4173'
const nets = os.networkInterfaces()
const urls = []

for (const list of Object.values(nets)) {
  for (const ni of list || []) {
    if (ni.family === 'IPv4' && !ni.internal) {
      urls.push(`http://${ni.address}:${PORT}/`)
    }
  }
}

console.log('')
console.log('  AXON · 局域网访问地址')
console.log('  ────────────────────────────────────')
console.log(`  本机     http://localhost:${PORT}/`)
for (const u of urls) console.log(`  局域网   ${u}`)
console.log('')
console.log('  同一 Wi-Fi 下的其他设备用上面的「局域网」地址打开即可。')
console.log('  若打不开，多半是 Windows 防火墙拦截 —— 见 README 的排查一节。')
console.log('')
