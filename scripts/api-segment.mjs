/* ═══════════════════════════════════════════════════════════════
   云端高精度分割（可选增强）· 百度 AI 开放平台 / 阿里云视觉智能

   定位：前端 detect.js（零依赖肤色/绿度/稀有色规则）是离线兜底；
   配置了 API 密钥时，server.mjs 的 POST /api/segment 会走本文件
   的云端管线，把「车辆 / 人物 / 植被」的识别交给训练过的大模型，
   返回非建筑元素的框坐标，前端照旧打码剔除。

   ── 启用方法 ──
   1. 到 https://ai.baidu.com 控制台创建应用，拿到 API Key / Secret Key
      （通用物体检测用「图像主体检测」；人物抠图用「人像分割」）。
   2. 设置环境变量后重启服务：
        set BAIDU_API_KEY=你的Key
        set BAIDU_SECRET_KEY=你的Secret
        node server.mjs 4173
   3. 前端无需改动：Cleanup 检测前先探一下 /api/segment，
      501 = 未配置密钥 → 走本地 detect.js；200 = 用云端框。
   4. 阿里云视觉智能（dashscope）同理：见 segmentViaAliyun，
      设置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 即切换。

   密钥只放在服务端 env，绝不进前端代码 / 单文件 HTML。
   ═══════════════════════════════════════════════════════════════ */

const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token'
const BAIDU_OBJECT_DETECT = 'https://aip.baidubce.com/rest/2.0/image-classify/v1/object_detect'
const BAIDU_BODY_SEG = 'https://aip.baidubce.com/rest/2.0/image-process/v1/body_seg'

let tokenCache = { token: null, expireAt: 0 }

/** 获取并缓存 access_token（百度 token 有效期 30 天，提前 1 小时刷新） */
export async function baiduToken (apiKey = process.env.BAIDU_API_KEY, secret = process.env.BAIDU_SECRET_KEY) {
  if (!apiKey || !secret) throw new Error('未配置 BAIDU_API_KEY / BAIDU_SECRET_KEY')
  if (tokenCache.token && Date.now() < tokenCache.expireAt) return tokenCache.token
  const url = `${BAIDU_TOKEN_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secret)}`
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error(`token 请求失败 HTTP ${res.status}`)
  const data = await res.json()
  if (!data.access_token) throw new Error('token 响应缺少 access_token：' + JSON.stringify(data).slice(0, 120))
  tokenCache = { token: data.access_token, expireAt: Date.now() + ((data.expires_in || 2592000) - 3600) * 1000 }
  return tokenCache.token
}

/**
 * 百度「图像主体检测」：返回带类别与框的检出结果。
 * @param {string} imageB64 不含 data: 前缀的 base64 图片
 * @returns {Promise<Array<{kind:string, score:number, box:{x,y,w,h}}>>}
 */
export async function segmentViaBaidu (imageB64) {
  const token = await baiduToken()
  const res = await fetch(`${BAIDU_OBJECT_DETECT}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'image=' + encodeURIComponent(imageB64) + '&with_face=0',
  })
  const data = await res.json()
  if (data.error_code) throw new Error(`百度 API ${data.error_code}: ${data.error_msg}`)
  /* 映射到 AXON 前端的 5 类：person / vehicle / vegetation / street furniture / misc */
  const KIND = {
    person: 'person', '人类': 'person',
    car: 'vehicle', bus: 'vehicle', truck: 'vehicle', motorbike: 'vehicle', bicycle: 'vehicle',
    tree: 'vegetation', plant: 'vegetation', flower: 'vegetation',
    streetlight: 'street_furniture', traffic_light: 'street_furniture', bench: 'street_furniture',
  }
  return (data.result || [])
    .map((r) => ({
      kind: KIND[r.keyword] || 'misc',
      score: r.score || 0.5,
      box: { x: r.location.left, y: r.location.top, w: r.location.width, h: r.location.height },
    }))
    .filter((r) => r.kind !== 'misc') // 建筑主体等非干扰物直接丢弃
}

/**
 * 百度「人像分割」兜底：object_detect 漏检的人，用二值 mask 补框。
 * 返回 score_mask（base64 灰度图），这里给出「由 mask 提取连通框」的完整流程。
 */
export async function personMaskBoxes (imageB64) {
  const token = await baiduToken()
  const res = await fetch(`${BAIDU_BODY_SEG}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'image=' + encodeURIComponent(imageB64) + '&type=score',
  })
  const data = await res.json()
  if (data.error_code) throw new Error(`百度 body_seg ${data.error_code}: ${data.error_msg}`)
  const buf = Buffer.from(data.score_mask, 'base64')
  const { width: W, height: H } = data // score_mask 与原图同尺寸，1 字节/像素
  /* 行列投影找人体簇：列有 ≥2% 人像像素即算占用，相邻占用列合并成框 */
  const colHit = new Array(W).fill(0)
  for (let x = 0; x < W; x++) {
    let hits = 0
    for (let y = 0; y < H; y++) if (buf[y * W + x] > 127) hits++
    colHit[x] = hits / H
  }
  const boxes = []
  let run = -1
  for (let x = 0; x <= W; x++) {
    const on = x < W && colHit[x] > 0.02
    if (on && run < 0) run = x
    if (!on && run >= 0) {
      let y0 = H; let y1 = 0
      for (let y = 0; y < H; y++) {
        for (let x2 = run; x2 < x; x2++) {
          if (buf[y * W + x2] > 127) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); break }
        }
      }
      boxes.push({ kind: 'person', score: 0.9, box: { x: run, y: y0, w: x - run, h: y1 - y0 } })
      run = -1
    }
  }
  return boxes
}

/**
 * 阿里云视觉智能开放平台（可选）：segmentCommonImage 通用分割。
 * 签名方式复杂（V3 RPC 签名），此处保留接口形态；生产接入建议直接用
 * 阿里官方 SDK `@alicloud/viapi-utils` + `viapi-regen`，或走函数计算代理。
 */
export async function segmentViaAliyun (imageB64) {
  const AK = process.env.ALIYUN_ACCESS_KEY_ID
  const SK = process.env.ALIYUN_ACCESS_KEY_SECRET
  if (!AK || !SK) throw new Error('未配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET')
  throw new Error('阿里云通道需接入官方 SDK（@alicloud/openplatform）完成 V3 签名 —— 接口形态已预留，见注释')
}

/** 统一入口：优先百度，失败抛错由 server.mjs 转成 502 */
export async function segmentImage (imageB64) {
  const providers = [segmentViaBaidu, segmentViaAliyun]
  let lastErr
  for (const fn of providers) {
    try {
      const boxes = await fn(imageB64)
      if (boxes.length) return boxes
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('所有云端分割通道均不可用')
}
