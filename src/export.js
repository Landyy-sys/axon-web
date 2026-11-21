/* ═══════════════════════════════════════════════════════════════
   图纸导出：PNG / PDF（零依赖 · 离线可用）

   为什么不用 html2canvas / jsPDF（CDN）：
   · CDN 断网就废 —— 与「兜底单文件」的离线诉求直接矛盾；
   · 两个库合计 600KB+，而本页导出的只是一张白底矢量 SVG。
   浏览器原生能力足够：
   · SVG → <img>（data URL，不污染 canvas）→ canvas 位图 → PNG
   · PNG/JPEG 字节 → 手写最小 PDF 容器（DCTDecode 内嵌 JPEG）
     —— 一个单页 PDF 只需要 5 个对象和 1 张 xref 表，~70 行。

   注意：svgToPngBlob 内所有几何都来自 serializeToString 的 SVG 源码，
   不含外部资源引用，因此 file:// 双击 AXON.html 也能正常导出。
   ═══════════════════════════════════════════════════════════════ */

/** 从 <svg> DOM 元素读取 viewBox 尺寸 */
function svgSize (svgEl) {
  const vb = (svgEl.getAttribute('viewBox') || '0 0 1200 800').split(/[\s,]+/).map(Number)
  return { w: vb[2] || 1200, h: vb[3] || 800 }
}

/** 克隆并规范化 SVG（补 xmlns，否则 <img> 解析会失败） */
function svgToDataUrl (svgEl) {
  const clone = svgEl.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  /* Firefox 要求 <img> 里的 SVG 必须带显式 width/height，仅有 viewBox 会解析失败 */
  const { w, h } = svgSize(clone)
  clone.setAttribute('width', w)
  clone.setAttribute('height', h)
  const src = new XMLSerializer().serializeToString(clone)
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src)
}

/** 把 SVG 栅格化为离屏 canvas（scale=3 → 约 300 DPI 的高清导出） */
function svgToCanvas (svgEl, scale = 3) {
  return new Promise((resolve, reject) => {
    const { w, h } = svgSize(svgEl)
    const img = new Image()
    img.onload = () => {
      const cv = document.createElement('canvas')
      cv.width = Math.round(w * scale)
      cv.height = Math.round(h * scale)
      const ctx = cv.getContext('2d')
      ctx.fillStyle = '#ffffff' // 图纸底色：SVG 自身背景透明，PDF/PNG 需要白底
      ctx.fillRect(0, 0, cv.width, cv.height)
      ctx.drawImage(img, 0, 0, cv.width, cv.height)
      resolve(cv)
    }
    img.onerror = () => reject(new Error('SVG 栅格化失败（浏览器解析图形源码出错）'))
    img.src = svgToDataUrl(svgEl)
  })
}

/** 导出高清 PNG */
export async function exportPng (svgEl, filename = 'axon-drawing', scale = 3) {
  const cv = await svgToCanvas(svgEl, scale)
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'))
  saveBlob(blob, `${filename}.png`)
  return { w: cv.width, h: cv.height }
}

/**
 * 导出单页 PDF（A 系列纸面按 96dpi 换算为 pt，图面等比居中）。
 * 手写 PDF 结构：catalog / pages / page / image(DCTDecode) / content。
 */
export async function exportPdf (svgEl, filename = 'axon-drawing', scale = 3) {
  const { w: vw, h: vh } = svgSize(svgEl)
  const cv = await svgToCanvas(svgEl, scale)
  const dataUrl = cv.toDataURL('image/jpeg', 0.92)
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(b64)
  const jpg = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) jpg[i] = bin.charCodeAt(i)

  /* 页面 pt 尺寸：按 96dpi 换算并取整（1px = 0.75pt），A4 横向量级 */
  const PW = Math.round(vw * 0.75)
  const PH = Math.round(vh * 0.75)
  const IW = cv.width
  const IH = cv.height

  const enc = new TextEncoder()
  const chunks = []
  let pos = 0
  const offsets = {}
  const write = (s) => {
    const u8 = typeof s === 'string' ? enc.encode(s) : s
    chunks.push(u8)
    pos += u8.length
  }
  const obj = (id, body) => {
    offsets[id] = pos
    write(`${id} 0 obj\n${body}\nendobj\n`)
  }

  write('%PDF-1.4\n% AXON drawing export\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  )
  offsets[4] = pos
  write(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${IW} /Height ${IH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`,
  )
  write(jpg)
  write('\nendstream\nendobj\n')
  const content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  const xrefPos = pos
  let xref = 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  write(xref)
  write(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`)

  const pdf = new Blob(chunks, { type: 'application/pdf' })
  saveBlob(pdf, `${filename}.pdf`)
  return { pw: PW, ph: PH }
}

/** 触发浏览器下载 */
export function saveBlob (blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
