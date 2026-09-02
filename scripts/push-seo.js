/**
 * 搜索引擎主动推送脚本
 * - IndexNow 协议（Bing / Yandex / Seznam 等）：每小时推送首页 + sitemap + 最近 5 篇文章
 * - 必应 URL 提交 API (Bing Webmaster)：每小时推送，加速收录
 * - 百度普通收录推送：每 24 小时一次，推送所有历史文章 + 首页（与文章生成解耦，避免超配额）
 * - Google：通过 sitemap.xml，需在 Search Console 手动提交一次 sitemap
 *
 * 说明：文章生成仍为每小时 1 篇（由 generate-seo.js 控制，与本脚本无关）。
 *       本脚本只决定推送频率：IndexNow + Bing 每小时，百度每 24 小时。
 *
 * 运行: node scripts/push-seo.js
 * 环境变量:
 *   BAIDU_TOKEN   (可选) 百度站长平台普通收录 token
 *   BING_API_KEY  (可选) 必应 Webmaster URL 提交 API key
 *   SITE_HOST     (可选) 站点域名，默认 www.pod.ddddnet.cn
 */
const fs = require('fs');
const path = require('path');

// 固定使用北京时区，避免 UTC 与本地时区导致日期偏移
process.env.TZ = 'Asia/Shanghai';

const INDEXNOW_KEY = '9c52420012041ce5090d1dcfc1866ec6';
const HOST = process.env.SITE_HOST || 'www.pod.ddddnet.cn';
const SITE_URL = `https://${HOST}`;
const KEY_LOCATION = `${SITE_URL}/${INDEXNOW_KEY}.txt`;
const LOG_FILE = path.join(__dirname, 'push-log.json');
// 百度降频：两次推送之间至少间隔 24 小时
const BAIDU_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

// 读取已生成文章记录
function loadGenerated() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'generated.json'), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { posts: [] };
  }
}

// 读取上次推送日志（用于判断百度是否需要降频）
function loadLastLog() {
  try {
    const data = fs.readFileSync(LOG_FILE, 'utf-8');
    const log = JSON.parse(data);
    // 兼容旧日志：results.baidu.lastPushedAt 不存在时回退到 updatedAt
    const baidu = log.results?.baidu || {};
    return {
      baiduLastPushedAt: baidu.lastPushedAt || log.updatedAt || null,
    };
  } catch {
    return { baiduLastPushedAt: null };
  }
}

// IndexNow 推送 URL：博客首页 + sitemap + 最近 5 篇文章
function collectIndexNowUrls(gen) {
  const urls = new Set();
  urls.add(`${SITE_URL}/blog/`);
  urls.add(`${SITE_URL}/sitemap.xml`);
  const recent = (gen.posts || []).slice(-5);
  for (const p of recent) {
    urls.add(`${SITE_URL}/blog/posts/${p.slug}.html`);
  }
  return [...urls];
}

// 百度推送 URL：博客首页 + 所有历史文章（每 24h 一次推送全部）
// 注：百度单次最多接收约 1000 条 URL，文章数远低于此上限，无需分批
function collectBaiduUrls(gen) {
  const urls = [`${SITE_URL}/blog/`];
  for (const p of (gen.posts || [])) {
    urls.push(`${SITE_URL}/blog/posts/${p.slug}.html`);
  }
  return urls;
}

// ===== IndexNow 推送（Bing / Yandex / Seznam）=====
async function pushIndexNow(urls) {
  const endpoints = [
    'https://api.indexnow.org/indexnow',
    'https://www.bing.com/indexnow',
  ];

  const body = JSON.stringify({
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls,
  });

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
      });
      // 200 = 已接受，202 = 待处理，422 = 密钥校验失败等
      if (res.status === 200 || res.status === 202) {
        console.log(`✓ IndexNow 推送成功 (${endpoint}) 状态=${res.status}，共 ${urls.length} 个 URL`);
        return { success: true, status: res.status, endpoint, urlCount: urls.length };
      } else {
        const text = await res.text().catch(() => '');
        console.warn(`⚠ IndexNow 返回 ${res.status} (${endpoint}): ${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn(`⚠ IndexNow 推送异常 (${endpoint}): ${err.message}`);
    }
  }
  return { success: false, error: '所有端点均失败' };
}

// ===== 必应 URL 提交 API (Bing Webmaster) =====
async function pushBingUrls(urls) {
  const apiKey = process.env.BING_API_KEY;
  if (!apiKey) {
    console.log('ℹ 未配置 BING_API_KEY，跳过必应推送（在必应 Webmaster 获取 API Key 后配置到 GitHub Secrets）');
    return { success: false, skipped: true, reason: '未配置 BING_API_KEY' };
  }

  const apiUrl = `https://www.bing.com/webmaster/api.aspx?apiKey=${apiKey}`;
  const body = urls.join('\n');

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`✓ 必应推送成功：状态=${res.status}，共 ${urls.length} 个 URL`);
      return { success: true, status: res.status, urlCount: urls.length, raw: text.slice(0, 200) };
    } else {
      console.warn(`⚠ 必应推送失败：状态=${res.status}，响应=${text.slice(0, 200)}`);
      return { success: false, status: res.status, error: text.slice(0, 200) };
    }
  } catch (err) {
    console.warn(`⚠ 必应推送异常: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ===== 百度普通收录推送（降频：每 24 小时一次）=====
async function pushBaidu(urls, { forceSkip }) {
  if (forceSkip) {
    console.log('ℹ 距离上次百度推送不足 24 小时，本次跳过（避免超配额）');
    return { success: false, skipped: true, reason: '24h 降频跳过' };
  }

  const token = process.env.BAIDU_TOKEN;
  if (!token) {
    console.log('ℹ 未配置 BAIDU_TOKEN，跳过百度推送（在百度搜索资源平台获取 token 后配置到 GitHub Secrets）');
    return { success: false, skipped: true, reason: '未配置 BAIDU_TOKEN' };
  }

  const apiUrl = `http://data.zz.baidu.com/urls?site=${HOST}&token=${token}`;
  // 百度要求 body 为每行一个 URL（纯文本）
  const body = urls.join('\n');

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
    const data = await res.json().catch(() => ({}));
    // 百度成功返回 { success: N, remain: M }；失败返回 { error: CODE, message: "..." }
    if (typeof data.success === 'number' && data.success > 0) {
      console.log(`✓ 百度推送成功：成功 ${data.success} 条，剩余 ${data.remain} 条`);
      return {
        success: true,
        pushed: data.success,
        remaining: data.remain,
        lastPushedAt: new Date().toISOString(),
      };
    }
    if (data.error !== undefined) {
      console.warn(`⚠ 百度推送失败：error=${data.error} ${data.message || ''}`);
      return { success: false, error: data.error, message: data.message };
    }
    console.log(`✓ 百度推送响应：`, JSON.stringify(data));
    return { success: true, raw: data, lastPushedAt: new Date().toISOString() };
  } catch (err) {
    console.warn(`⚠ 百度推送异常: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ===== 保存推送日志 =====
function saveLog(log) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf-8');
  console.log(`📝 推送日志已保存到: scripts/push-log.json`);
}

async function main() {
  console.log('=== 搜索引擎推送开始 ===');
  const gen = loadGenerated();

  // IndexNow：每小时推送首页 + sitemap + 最近 5 篇
  const indexNowUrls = collectIndexNowUrls(gen);
  // 百度：仅最新 1 篇 + 首页
  const baiduUrls = collectBaiduUrls(gen);

  console.log(`IndexNow 待推送 URL (${indexNowUrls.length} 个):`);
  indexNowUrls.forEach(u => console.log('  -', u));
  console.log(`必应待推送 URL (${indexNowUrls.length} 个):`);
  indexNowUrls.forEach(u => console.log('  -', u));
  console.log(`百度待推送 URL (${baiduUrls.length} 个):`);
  baiduUrls.forEach(u => console.log('  -', u));

  // 判断百度是否需要降频跳过
  const { baiduLastPushedAt } = loadLastLog();
  let baiduForceSkip = false;
  if (baiduLastPushedAt) {
    const elapsed = Date.now() - new Date(baiduLastPushedAt).getTime();
    if (elapsed < BAIDU_MIN_INTERVAL_MS) {
      baiduForceSkip = true;
      console.log(`ℹ 上次百度推送时间 ${baiduLastPushedAt}，距今 ${Math.floor(elapsed / 3600000)} 小时，将跳过本次推送`);
    }
  }

  const indexNowResult = await pushIndexNow(indexNowUrls);
  const bingResult = await pushBingUrls(indexNowUrls);
  const baiduResult = await pushBaidu(baiduUrls, { forceSkip: baiduForceSkip });

  // 保留 lastPushedAt 用于下次降频判断（仅在推送成功或被跳过时写入）
  const baiduLog = { ...baiduResult };
  if (baiduResult.success) {
    baiduLog.lastPushedAt = baiduResult.lastPushedAt || new Date().toISOString();
  } else if (baiduResult.skipped && baiduResult.reason === '24h 降频跳过') {
    // 跳过时沿用上次时间
    baiduLog.lastPushedAt = baiduLastPushedAt;
  }

  const log = {
    updatedAt: new Date().toISOString(),
    urlCount: indexNowUrls.length,
    urls: indexNowUrls,
    results: {
      indexnow: indexNowResult,
      bing: bingResult,
      baidu: baiduLog,
    },
  };

  saveLog(log);

  console.log('=== 推送完成 ===');
  console.log('查看推送状态: https://www.pod.ddddnet.cn/scripts/push-log.json');
}

main().catch(err => {
  console.error('推送失败:', err.message);
  // 即使失败也保存日志
  try {
    saveLog({
      updatedAt: new Date().toISOString(),
      error: err.message,
      results: { indexnow: { success: false }, bing: { success: false }, baidu: { success: false } },
    });
  } catch {}
  process.exit(0); // 推送失败不阻断 workflow
});
