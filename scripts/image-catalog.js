/**
 * SEO 图片素材库（自动发现）
 * ------------------------------------------------------------
 * 设计目标（贴合运营诉求）：
 *  - 运营后续会把图片丢进 img/，文件名大致描述「这是什么场景」，本模块
 *    运行时递归扫描 img/，从「目录分类 + 文件名」自动提炼素材元数据，
 *    不需要人工维护清单。
 *  - 生成文章时把这份清单交给大模型，由模型按「主题强相关才用、不相关
 *    不用、单篇不重复、允许跨文章复用」自行挑选，避免硬套乱用。
 *  - 目录/文件名新增图片后，下次生成自动纳入，零配置扩展。
 *
 * 用法：
 *  const { buildCatalog, formatImagesForPrompt } = require('./image-catalog');
 *  const catalog = buildCatalog({ siteUrl, rootDir });
 *  const block = formatImagesForPrompt(catalog); // 交给大模型 prompt，空字符串表示无图
 */
const fs = require('fs');
const path = require('path');

// 支持的图片扩展名
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.bmp']);

/**
 * 去掉开头的「数字 + 分隔符」前缀（如 "1." 、"2、"、"3）"），保留场景文本。
 * 例："1.工作室一个人操控运营后台场景" -> "工作室一个人操控运营后台场景"
 */
function stripPrefix(s) {
  return s
    .replace(/^\d+\s*/, '')
    .replace(/^[.、)）\-]\s*/, '')
    .trim();
}

/**
 * 把仓库内相对路径编码成可放进 <img src> 的绝对 URL。
 * 仅对每个路径分段做 encodeURIComponent，保留 "/"，中文与空格会被正确编码。
 */
function encodeImageUrl(siteUrl, relPath) {
  const segs = relPath.split('/').map((seg) => encodeURIComponent(seg));
  return siteUrl.replace(/\/+$/, '') + '/' + segs.join('/');
}

/**
 * 递归扫描 img 目录，返回素材数组。
 * @param {string} rootDir 仓库根目录
 * @returns {Array<{relPath,category,scene,filename,ext}>}
 */
function scanImages(rootDir) {
  const imgDir = path.join(rootDir, 'img');
  const out = [];
  if (!fs.existsSync(imgDir)) return out;

  const walk = (dir, relParts) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = [...relParts, e.name];
      if (e.isDirectory()) {
        walk(full, rel);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!IMG_EXT.has(ext)) continue;
        // 顶层分类 = 第一级子目录（去掉数字前缀）
        const category = rel.length >= 2 ? stripPrefix(rel[0]) : '';
        const scene = stripPrefix(path.basename(e.name, ext));
        out.push({
          relPath: 'img/' + rel.join('/'),
          category,
          scene,
          filename: e.name,
          ext,
        });
      }
    }
  };

  walk(imgDir, []);
  return out;
}

/**
 * 构建完整素材库（含绝对 URL），并把缓存写入 scripts/image-catalog.json 便于排查。
 * @param {{siteUrl:string, rootDir:string, cachePath?:string}} opts
 */
function buildCatalog({ siteUrl, rootDir, cachePath }) {
  const list = scanImages(rootDir).map((it) => ({
    ...it,
    url: encodeImageUrl(siteUrl, it.relPath),
    // 给模型看的语义描述：分类 + 场景
    desc: [it.category, it.scene].filter(Boolean).join(' / '),
  }));

  if (cachePath) {
    try {
      fs.writeFileSync(cachePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch {
      /* 缓存写入失败不影响主流程 */
    }
  }
  return list;
}

/**
 * 把素材库格式化为可嵌入 prompt 的文本块。
 * 返回空字符串表示当前没有可用图片（调用方不应添加用图指令）。
 * @param {Array} catalog buildCatalog 的返回值
 */
function formatImagesForPrompt(catalog) {
  if (!catalog || catalog.length === 0) return '';
  const lines = catalog.map((it, i) => `${i + 1}. [${it.desc}] ${it.url}`);
  return lines.join('\n');
}

module.exports = { buildCatalog, formatImagesForPrompt, scanImages, encodeImageUrl, stripPrefix };

// 直接运行 node scripts/image-catalog.js 时打印素材库概览（方便本地排查）
if (require.main === module) {
  const root = path.join(__dirname, '..');
  const siteUrl = 'https://www.pod.ddddnet.cn';
  const cat = buildCatalog({ siteUrl, rootDir: root, cachePath: path.join(__dirname, 'image-catalog.json') });
  console.log(`共发现 ${cat.length} 张图片素材：`);
  for (const it of cat) {
    console.log(`- ${it.desc}`);
    console.log(`    ${it.url}`);
  }
}
