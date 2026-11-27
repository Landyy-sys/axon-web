/* ═══════════════════════════════════════════════════════════════
   前端图片重采样（模块二 · 性能优化与防崩溃）
   ─────────────────────────────────────────────────────────────
   用户随手拍的照片动辄 4000×3000（12MP+），直接解码进 Sobel /
   Canvas 分析会让移动端浏览器内存暴涨甚至崩溃。
   上传后立刻在本模块压缩：
   · 最长边限制 1920 px（1080p 量级），等比缩放
   · JPEG 质量 0.8 重新编码（PNG/WEBP/GIF/BMP 统一转 JPEG ——
     视觉分析只吃像素，透明通道毫无用处）
   · 不足上限的图原样跳过，零损耗；重采样失败也原样跳过，
     绝不因压缩环节挂掉而阻塞上传主流程
   ═══════════════════════════════════════════════════════════════ */

export const IMG_LIMITS = { maxSide: 1920, quality: 0.8 }

/**
 * @param {{ raw: Blob|File, url: string, w: number, h: number, name: string }} item
 * @returns {Promise<item & { resampled?: boolean, origW?, origH?, origSize? }>}
 */
export async function resampleImage(item, { maxSide = IMG_LIMITS.maxSide, quality = IMG_LIMITS.quality } = {}) {
  try {
    if (!item?.raw || !item.w || !item.h) return item
    const long = Math.max(item.w, item.h)
    if (long <= maxSide) return item // 已在限内，不折腾

    /* 解码：优先 createImageBitmap（快、省内存），老浏览器回退 <img> */
    let src
    let sw = item.w
    let sh = item.h
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(item.raw)
      src = bmp
      sw = bmp.width
      sh = bmp.height
    } else {
      const url = item.url || URL.createObjectURL(item.raw)
      const img = await new Promise((resolve, reject) => {
        const im = new Image()
        im.onload = () => resolve(im)
        im.onerror = reject
        im.src = url
      })
      src = img
      sw = img.naturalWidth || item.w
      sh = img.naturalHeight || item.h
    }

    const scale = maxSide / Math.max(sw, sh)
    const w = Math.round(sw * scale)
    const h = Math.round(sh * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, w, h)
    if (typeof src.close === 'function') src.close() // 释放 ImageBitmap

    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality),
    )
    canvas.width = 0
    canvas.height = 0

    /* 换掉 raw 与预览 url（旧 url 由调用方 revoke） */
    const name = item.name?.replace(/\.[^.]+$/, '') + '.jpg'
    return {
      ...item,
      raw: new File([blob], name, { type: 'image/jpeg' }),
      url: URL.createObjectURL(blob),
      name,
      size: blob.size,
      w,
      h,
      resampled: true,
      origW: item.w,
      origH: item.h,
      origSize: item.size,
    }
  } catch {
    return item // 压缩失败不阻塞上传，原图照常走后续流程
  }
}
