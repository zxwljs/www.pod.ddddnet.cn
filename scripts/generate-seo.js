/**
 * SEO 博客自动生成脚本
 * 调用智谱 GLM-4V-Flash 模型生成原创文章，输出 SEO 优化的 HTML 页面
 * 运行: node scripts/generate-seo.js
 * 环境变量: BIGMODEL_API_KEY (智谱API密钥)
 */
const fs = require('fs');
const path = require('path');

// 固定使用北京时区，避免 GitHub Actions（UTC）运行时日期/月份偏移
process.env.TZ = 'Asia/Shanghai';

// ===== 配置 =====
const CONFIG = {
  apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  model: 'glm-4v-flash',
  siteUrl: 'https://www.pod.ddddnet.cn',
  appUrl: 'https://pod.ddddnet.cn',
  siteName: '轩宇汇',
  blogDir: path.join(__dirname, '..', 'blog'),
  postsDir: path.join(__dirname, '..', 'blog', 'posts'),
  blogIndex: path.join(__dirname, '..', 'blog', 'index.html'),
  sitemapPath: path.join(__dirname, '..', 'sitemap.xml'),
  generatedPath: path.join(__dirname, '..', 'scripts', 'generated.json'),
  maxRetries: 3,
};

// 读取选题库
const { site, topics } = require('./topics');
// 读取图片素材库（自动发现 img/ 下图片，按场景命名复用）
const { buildCatalog, formatImagesForPrompt } = require('./image-catalog');
CONFIG.siteUrl = site.url;
CONFIG.appUrl = site.appUrl;
CONFIG.siteName = site.name;

// ===== 工具函数 =====
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowStr() {
  return new Date().toISOString();
}

// 读取已生成记录
function loadGenerated() {
  try {
    const data = fs.readFileSync(CONFIG.generatedPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { usedTopics: [], titles: [], posts: [], count: 0 };
  }
}

// 保存已生成记录
function saveGenerated(gen) {
  fs.writeFileSync(CONFIG.generatedPath, JSON.stringify(gen, null, 2), 'utf-8');
}

// 随机选取未使用选题
// 加载动态热点选题
function loadHotTopics() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'topics-hot.json'), 'utf-8');
    return JSON.parse(data).topics || [];
  } catch {
    return [];
  }
}

// 保存热点选题
function saveHotTopics(topics) {
  fs.writeFileSync(path.join(__dirname, 'topics-hot.json'), JSON.stringify({ updated: nowStr(), topics }, null, 2), 'utf-8');
}

// 动态生成热点话题（基于当前日期/季节/节日）
async function generateHotTopics() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const year = now.getFullYear();
  const weekday = ['日','一','二','三','四','五','六'][now.getDay()];

  // 季节性提示
  const seasonHints = {
    1: '新年元旦、冬季促销、年货节',
    2: '情人节、春节、元宵节、冬季清仓',
    3: '春季新品、妇女节、植树节',
    4: '愚人节、清明节、春季大促',
    5: '劳动节、母亲节、春季促销',
    6: '端午节、618大促、夏季新品',
    7: '建党节、暑假、夏季清仓',
    8: '立秋、七夕、夏日促销',
    9: '教师节、中秋节、秋季新品',
    10: '国庆节、双十一预热、秋季大促',
    11: '双十一、黑五、感恩节',
    12: '双十二、圣诞节、年终大促',
  };

  const season = seasonHints[month] || '';
  const weekDayHint = weekday === '一' ? '本周新品上架、周一周度运营' : '';

  const prompt = `你是一位专注 Temu 半托管的跨境电商 SEO 选题专家。当前日期是 ${year}年${month}月${date}日 星期${weekday}。

请围绕 Temu 半托管卖家最关心的话题，生成 5 个高价值的 SEO 选题：
- Temu 半托管最新政策变化与平台动态
- Temu 半托管运营技巧与上品效率提升
- Temu 半托管选品、定价、促销策略
- 轩宇汇美国源头 POD 工厂货盘与一件代发卖货（服装/T恤、水杯/马克杯、帆布包、手机壳等）
- 当前季节热点在 Temu 上的运营机会（${season}）

选题要求：
1. 全部围绕 Temu 半托管卖家的实际需求
2. 紧贴当前热点和时效性
3. 每个选题的关键词要有搜索量
4. 5个选题覆盖不同维度（平台动态、运营技巧、工具推荐、实操教程等）
5. 关键词必须包含「Temu半托管」或相关高搜索量词

请输出 JSON 数组格式：
[{"topic":"选题标题","keywords":["关键词1","关键词2"],"category":"分类"}]

分类可选值：平台动态、运营技巧、工具推荐、实操教程、政策解读`;

  const body = JSON.stringify({
    model: CONFIG.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.9,
    max_tokens: 2000,
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(CONFIG.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.BIGMODEL_API_KEY}`,
        },
        body,
      });
      if (!res.ok) { await sleep(3000); continue; }
      const data = await res.json();
      const raw = data.choices?.[0]?.content || '';

      // 解析 JSON 数组（多种格式容错）
      let rawText = raw.trim();
      
      // 尝试1：去除 markdown 代码块
      let jsonStr = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      
      // 尝试2：直接找第一个 [ 到最后一个 ]
      let start = jsonStr.indexOf('[');
      let end = jsonStr.lastIndexOf(']');
      if (start !== -1 && end !== -1 && end > start) {
        jsonStr = jsonStr.slice(start, end + 1);
      }
      
      // 尝试3：如果还不对，尝试从 { 到 } 找
      let hotTopics = null;
      try {
        hotTopics = JSON.parse(jsonStr);
      } catch {
        try {
          // 试试直接解析 raw
          hotTopics = JSON.parse(rawText);
        } catch {
          // 最后兜底：用正则提取每个对象
          const objectRe = /\{\s*"topic"\s*:\s*"([^"]+)"[\s\S]*?\}/g;
          const matches = [];
          let m;
          while ((m = objectRe.exec(rawText)) !== null) {
            try {
              const obj = JSON.parse(m[0]);
              if (obj.topic) matches.push(obj);
            } catch {}
          }
          if (matches.length > 0) {
            console.log(`兜底解析提取到 ${matches.length} 个选题`);
            return matches.slice(0, 5);
          }
        }
      }
      
      if (hotTopics && Array.isArray(hotTopics)) {
        const validated = hotTopics.filter(t => t && t.topic && t.keywords && Array.isArray(t.keywords));
        if (validated.length > 0) {
          console.log(`动态生成了 ${validated.length} 个热点选题`);
          return validated;
        }
      }
    } catch (err) {
      console.warn('热点生成失败:', err.message);
      if (attempt === 1) console.warn('原始返回前500字符:', raw.slice(0, 500));
      if (attempt < 2) await sleep(3000);
    }
  }
  console.warn('热点话题生成失败，将使用静态选题');
  return [];
}

function pickTopic(gen) {
  // 合并静态选题和动态热点选题
  const hotTopics = loadHotTopics();
  const allTopics = [...topics, ...hotTopics];

  const usedKeys = new Set(gen.usedTopics);
  const unused = allTopics.filter(t => !usedKeys.has(t.topic));

  // 优先使用热点选题
  const hotUnused = hotTopics.filter(t => !usedKeys.has(t.topic));
  if (hotUnused.length > 0) {
    return hotUnused[Math.floor(Math.random() * hotUnused.length)];
  }

  if (unused.length > 0) {
    return unused[Math.floor(Math.random() * unused.length)];
  }
  // 全部用完，随机重选
  const random = allTopics[Math.floor(Math.random() * allTopics.length)];
  random._retryAngle = true;
  return random;
}

// ===== 调用 GLM API =====
async function callGLM(topic) {
  const angleHint = topic._retryAngle
    ? '\n注意：这个主题之前已经写过，请从全新的角度切入，避免与已有内容重复。'
    : '';

  // 图片素材库：自动发现 img/ 下图片，交给模型按相关性挑图（可复用、不强塞）
  const imageCatalog = buildCatalog({
    siteUrl: CONFIG.siteUrl,
    rootDir: path.join(__dirname, '..'),
    cachePath: path.join(__dirname, 'image-catalog.json'),
  });
  const imageList = formatImagesForPrompt(imageCatalog);
  const imageSection = imageList
    ? `

【图片素材库（站内存图，可在不同文章中复用，禁止引用列表外的链接）】
以下是网站已有的图片素材，每行格式为「序号. [分类 / 场景] 图片URL」：
${imageList}

用图要求（非常重要）：
- 只能在上面清单里挑选图片插入正文，严禁编造或引用清单外的任何图片链接。
- 只有当某张图的「场景」与当前段落主题强相关时，才在该段落之后自然插入该图；若清单里没有贴合当前文章的图，可以一张都不插，绝不为凑图而硬套。
- 单篇文章最多插入 2-3 张图，且同一张图在一篇文章内不要重复出现。
- 不同文章可以复用同一张图；若多篇都适合某类图，优先换用同类别里不同的一张，避免长期总是同一张。
- 插入方式（直接用 HTML，不要 markdown 图片语法）：
  <figure class="article-figure">
    <img src="图片URL" alt="贴合该图内容的中文描述" loading="lazy" />
    <figcaption>一句话图注（可选，说明这张图在讲什么）</figcaption>
  </figure>
- 图片放在相关段落之间或段落后，不要堆在开头或结尾。`
    : '';

  const prompt = `你是做了5年Temu半托管的跨境卖家，擅长写实操干货。文风接地气，像同行分享经验，不像AI也不像软文。

写一篇关于「${topic.topic}」的文章，读者是Temu半托管卖家。
SEO关键词：${topic.keywords.join('、')}

要求：
- 正文 HTML 内纯文字（不含标签）不少于 800 字、不超过 1100 字，按汉字字符计（注意：模型单次输出上限约 1000 token，请勿超过此长度）；务必在限定长度内完整收尾，结尾要有小结或行动建议，绝不要写到一半就停；不足时补充实操步骤、案例细节或常见问题，不要靠空话凑字数
- 用 h2/h3/p/ul/ol/li/strong/blockquote 等 HTML 标签书写
- 标题像同行分享，不要「全面解析」「深度解读」「一文搞懂」
- 开头直接切入痛点，禁止「大家好」「随着跨境电商发展」「在当今...背景下」「近年来」「如今」类套话开头
- 主体必须有具体实操步骤或真实案例（数字、流程、坑点），不要泛泛而谈
- 文章分 4-6 个 h2 章节，每节有实质内容
- 至少自然带出 POD 的核心卖点：零库存、一件代发、无资金压力、可卖向全球；可结合服装/T恤、水杯/马克杯等具体品类举例，让想卖货的读者一眼看到机会
- 不要emoji、不要「点赞转发」类社交用语，正文内不要出现 [XXX] 这种方括号标记

轩宇汇（pod.ddddnet.cn）是 Temu 半托管卖家的美国源头 POD 工厂：自有工厂直供可卖的 POD 货品——服装（T恤/卫衣/帽子）、水杯马克杯、帆布包、手机壳等。卖家零库存、无资金压力，顾客在 Temu 下单后，轩宇汇美国工厂直接印刷代发、物流回传，你只赚货品价差，把货卖向全球。

全文提及「轩宇汇」或「pod.ddddnet.cn」2-3次，像推荐美国源头 POD 工厂/货盘一样自然，不要整段介绍工厂。核心叙事：用轩宇汇美国工厂的现成 POD 货盘（服装/T恤、水杯/马克杯等），零库存、一件代发、无资金压力，就能把货卖向全球；先讲 POD 服装/水杯「零库存卖货、无资金压力、全球出货、卖不动就下架零滞销」的机会与痛点，再顺带说轩宇汇美国工厂直供货盘、帮你把货卖出去。文末自然引导：去 pod.ddddnet.cn 用轩宇汇美国工厂的货盘开店卖货。${angleHint}${imageSection}

严格按以下格式输出，不要其他内容。注意：[TITLE]、[CONTENT] 等方括号标签是结构分隔符，必须严格保留；但正文（[CONTENT] 和 [/CONTENT] 之间的内容）里不要出现方括号标记。

[TITLE]
标题
[/TITLE]
[SLUG]
english-slug
[/SLUG]
[DESCRIPTION]
120字内摘要
[/DESCRIPTION]
[KEYWORDS]
关键词1,关键词2,关键词3
[/KEYWORDS]
[CONTENT]
正文HTML
[/CONTENT]`;

  const body = JSON.stringify({
    model: CONFIG.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    top_p: 0.9,
    max_tokens: 4096,
  });

  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      const res = await fetch(CONFIG.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.BIGMODEL_API_KEY}`,
        },
        body,
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`API 请求失败 (尝试 ${attempt}/${CONFIG.maxRetries}): ${res.status} ${errText}`);
        if (attempt < CONFIG.maxRetries) await sleep(5000 * attempt);
        continue;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('API 返回内容为空');
      return content;
    } catch (err) {
      console.error(`调用异常 (尝试 ${attempt}/${CONFIG.maxRetries}): ${err.message}`);
      if (attempt < CONFIG.maxRetries) await sleep(5000 * attempt);
    }
  }
  throw new Error('API 调用失败，已重试 ' + CONFIG.maxRetries + ' 次');
}

// 解析 AI 返回的内容（分隔符格式，容错性强）
function parseArticle(raw, topic) {
  let title = '', slug = '', description = '', keywordsRaw = '', content = '';

  // 用正则提取每个块，非贪婪匹配
  const extractBlock = (tag) => {
    // 匹配 [TAG]...[/TAG] 之间的内容
    const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\[\\/${tag}\\]`, 'i');
    const m = raw.match(re);
    return m ? m[1].trim() : '';
  };

  title = extractBlock('TITLE');
  slug = extractBlock('SLUG');
  description = extractBlock('DESCRIPTION');
  keywordsRaw = extractBlock('KEYWORDS');
  content = extractBlock('CONTENT');

  // 兜底处理：如果 CONTENT 为空，可能 AI 没有正确使用标签
  if (!content) {
    console.warn('警告：未找到 CONTENT 标记，尝试兜底解析...');
    // 尝试找最后一个大块内容
    const lastContent = raw.lastIndexOf('[/CONTENT]');
    const firstContent = raw.indexOf('[CONTENT]');
    if (firstContent !== -1 && lastContent !== -1) {
      content = raw.slice(firstContent + '[CONTENT]'.length, lastContent).trim();
    } else {
      // 直接用全部内容作为 content
      content = raw.trim();
    }
  }

  // 清理 content 中残留的标记
  content = content
    .replace(/\[TITLE\][\s\S]*?\[\/TITLE\]/gi, '')
    .replace(/\[SLUG\][\s\S]*?\[\/SLUG\]/gi, '')
    .replace(/\[DESCRIPTION\][\s\S]*?\[\/DESCRIPTION\]/gi, '')
    .replace(/\[KEYWORDS\][\s\S]*?\[\/KEYWORDS\]/gi, '')
    .replace(/\[\/?CONTENT\]/gi, '')
    .replace(/\[\/?END OF CONTENT\]/gi, '')
    .replace(/\[\/?ARTICLE\]/gi, '')
    .replace(/\[\/?TEXT\]/gi, '')
    .replace(/\[\/?BODY\]/gi, '')
    .replace(/\[\/?START\]/gi, '')
    .replace(/\[\/?FINAL\]/gi, '')
    .replace(/\[\/?SUMMARY\]/gi, '')
    .replace(/\[\/?END\]/gi, '')
    .replace(/\[\/?[A-Z _]{2,20}\]/gi, '') // 移除所有 [XXX] 格式标记
    .replace(/^```html\s*/im, '')
    .replace(/```\s*$/m, '')
    .trim();

  // 移除 emoji 表情符号
  content = content.replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}]/gu, '');

  // 移除开头 AI 套话段落（prompt 已明确禁止）
  // 只删第一段，避免误伤正文中合法的「随着」表述
  // 情况1：HTML 段落 <p>随着...</p>
  content = content.replace(
    /^\s*<p>\s*(?:随着|在当今|在如今|如今|近年来|当下|眼下|伴随着)[\s\S]*?<\/p>\s*/i,
    ''
  );
  // 情况2：纯文本开头（无 <p> 包裹）
  content = content.replace(
    /^\s*(?:随着|在当今|在如今|如今|近年来|当下|眼下|伴随着)[^\n]*\n?/i,
    ''
  );
  // 清理因删除开头套话可能残留的空 p 标签
  content = content.replace(/^<p>\s*<\/p>\s*/i, '');

  // 移除社交平台套话和 AI 套话
  const junkPatterns = [
    /点赞[^<]*$/gm,
    /转发[^<]*$/gm,
    /关注[^<]*$/gm,
    /记得点赞转发哦[^<]*/g,
    /祝大家[^<]*[！!]/g,
    /财源广进[^<]*/g,
    /生意兴隆[^<]*/g,
    /如有疑问欢迎随时咨询[^<]*/g,
    /以上内容仅供参考[^<]*/g,
    /以上就是[^<]*希望[^<]*对你有帮助[^<]*/g,
    /希望这篇文章对你有所帮助[^<]*$/gm,
    /以上就是我为大家带来的[^<]*/g,
    /好了今天的分享就到这里[^<]*/g,
    /让我们一起加油[^<]*/g,
    /如有疑问欢迎随时咨询我哦[^<]*/g,
    /以上内容仅供参考[^<]*/g,
  ];
  for (const p of junkPatterns) {
    content = content.replace(p, '');
  }

  // 清理多余的 hr 标签（AI 喜欢在结尾加 hr）
  content = content.replace(/(<hr\/?>\s*){2,}/gi, '<hr/>');
  // 移除结尾的空 hr
  content = content.replace(/<hr\/?>\s*$/i, '').trim();

  // 清理空的 p 标签和多余空行
  content = content.replace(/<p>\s*<\/p>/gi, '');
  content = content.replace(/\n{3,}/g, '\n\n').trim();

  // 兜底：如果 title 还是空的，用 content 第一行
  if (!title) {
    const firstLine = content.split('\n').find(l => l.trim());
    if (firstLine) {
      title = firstLine.replace(/^[#*\s]+/, '').replace(/[*`]/g, '');
    }
  }

  if (!title || !content) {
    console.error('解析失败，原始内容前800字符:', raw.slice(0, 800));
    throw new Error('解析失败：缺少标题或正文');
  }

  // 清理 content 中可能残留的 markdown 标记
  content = content.replace(/^```html\s*/im, '').replace(/```\s*$/m, '');

  const keywords = keywordsRaw
    ? keywordsRaw.split(/[,，、]/).map(k => k.trim()).filter(Boolean)
    : [];

  return { title, slug, description, keywords, content, category: topic.category };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// slug 清理
function cleanSlug(slug) {
  let s = (slug || '').toLowerCase().trim();
  s = s.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!s) s = 'article-' + Date.now();
  return s;
}

// ===== Markdown → HTML 转换 =====
// AI 可能返回 Markdown 格式，需要转换成 HTML；如果已经是 HTML 则跳过
function mdToHtml(md) {
  if (!md) return '';

  // 检测内容是否已经是 HTML 格式（包含 h2/p/ul 等标签）
  const htmlTagCount = (md.match(/<(h[1-6]|p|ul|ol|li|strong|em|blockquote|pre|code|br|hr|img|a)\b/gi) || []).length;
  const totalTags = (md.match(/<[^>]+>/g) || []).length;

  // 如果已有较多 HTML 标签，说明 AI 已经输出了 HTML，直接返回（仅做清理）
  if (htmlTagCount >= 3 || totalTags >= 5) {
    // 清理可能残留的 markdown 标记
    let html = md.trim();
    html = html.replace(/```html\s*/gi, '').replace(/```\s*/g, '');
    // 清理 [TAG] 残留
    html = html.replace(/\[\/?(TITLE|SLUG|DESCRIPTION|KEYWORDS|CONTENT)\]/gi, '');
    return html;
  }

  // 以下是 Markdown → HTML 的转换逻辑
  let html = md;

  // 代码块 ```...``` 先处理
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // 行内代码 `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 标题 # ~ ######
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // 块引用 >
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // 有序列表 1. item
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

  // 无序列表 - item 或 * item
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');

  // 将连续 <li> 包裹在 <ul> 或 <ol> 中
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => {
    const isOrdered = /^\d+\./.test(match.trim().split('\n')[0] || '');
    return isOrdered ? `<ol>${match}</ol>` : `<ul>${match}</ul>`;
  });

  // 粗体 **text** 或 __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // 斜体 *text* 或 _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '<em>$1</em>');

  // 链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 图片 ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

  // 水平线 ---
  html = html.replace(/^---+$/gm, '<hr/>');

  // 段落处理：按双换行分割，每段用 <p> 包裹
  html = html.replace(/\n\n+/g, '\n\n');
  const blocks = html.split(/\n\n+/);
  const result = blocks.map(block => {
    block = block.trim();
    if (!block) return '';
    // 如果已经是 HTML 标签包裹的，不重复包裹
    if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|img|div)/i.test(block)) {
      return block;
    }
    // 将单换行转为 <br>
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      return '<p>' + lines.join('<br/>') + '</p>';
    }
    return '<p>' + block + '</p>';
  }).join('\n');

  return result;
}

// ===== HTML 生成 =====
function generateArticleHTML(article, topic) {
  const date = todayStr();
  const kwStr = (article.keywords || topic.keywords).join(', ');
  const url = `${CONFIG.siteUrl}/blog/posts/${article.slug}.html`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHTML(article.title)} | ${CONFIG.siteName}博客</title>
<meta name="description" content="${escapeAttr(article.description)}" />
<meta name="keywords" content="${escapeAttr(kwStr)}" />
<meta name="author" content="${CONFIG.siteName}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${url}" />

<!-- Open Graph -->
<meta property="og:type" content="article" />
<meta property="og:title" content="${escapeAttr(article.title)}" />
<meta property="og:description" content="${escapeAttr(article.description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:site_name" content="${CONFIG.siteName}" />
<meta property="article:published_time" content="${nowStr()}" />
<meta property="article:section" content="${escapeAttr(article.category || topic.category)}" />
<meta property="article:tag" content="${escapeAttr(kwStr)}" />

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeAttr(article.title)}" />
<meta name="twitter:description" content="${escapeAttr(article.description)}" />

<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%232563eb'/%3E%3Cstop offset='100%25' style='stop-color:%230ea5e9'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100' height='100' rx='22' fill='url(%23g)'/%3E%3Cpath d='M20 78 V44 H34 V56 H48 V44 H62 V56 H76 V34 L86 42 V78 Z' fill='white'/%3E%3C/svg%3E" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />

<!-- JSON-LD 结构化数据 -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": ${JSON.stringify(article.title)},
  "description": ${JSON.stringify(article.description)},
  "keywords": ${JSON.stringify(kwStr)},
  "datePublished": "${nowStr()}",
  "dateModified": "${nowStr()}",
  "author": { "@type": "Organization", "name": "${CONFIG.siteName}" },
  "publisher": {
    "@type": "Organization",
    "name": "${CONFIG.siteName}",
    "url": "${CONFIG.siteUrl}"
  },
  "mainEntityOfPage": "${url}",
  "articleSection": ${JSON.stringify(article.category || topic.category)}
}
</script>

<style>
:root{--bg:#fbfcfd;--surface:#fff;--border:#eef2f7;--border2:#e2e8f0;--text:#0b1426;--text2:#475569;--text3:#94a3b8;--p1:#2563eb;--p2:#0ea5e9;--g1:linear-gradient(135deg,#2563eb,#0ea5e9)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans SC',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.8;-webkit-font-smoothing:antialiased}
a{color:var(--p1);text-decoration:none}
.nav{position:sticky;top:0;z-index:50;backdrop-filter:blur(20px);background:rgba(255,255,255,.85);border-bottom:1px solid var(--border);padding:14px 0}
.nav-in{max-width:800px;margin:0 auto;padding:0 24px;display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;cursor:pointer}
.logo-ic{width:32px;height:32px;border-radius:8px;background:var(--g1);display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;font-weight:900}
.logo-t{background:var(--g1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.nav-back{font-size:14px;color:var(--text2);font-weight:500}
.nav-back:hover{color:var(--p1)}
.article-wrap{max-width:800px;margin:0 auto;padding:48px 24px 80px}
.breadcrumb{font-size:13px;color:var(--text3);margin-bottom:20px}
.breadcrumb a{color:var(--text3)}
.breadcrumb a:hover{color:var(--p1)}
.article-tag{display:inline-block;padding:4px 12px;background:linear-gradient(135deg,rgba(37,99,235,.06),rgba(14,165,233,.06));border:1px solid rgba(37,99,235,.12);border-radius:999px;font-size:12.5px;font-weight:600;color:var(--p1);margin-bottom:16px}
article h1{font-size:32px;font-weight:800;line-height:1.3;letter-spacing:-.02em;margin-bottom:16px}
.article-meta{display:flex;align-items:center;gap:14px;font-size:13.5px;color:var(--text3);margin-bottom:36px;padding-bottom:28px;border-bottom:1px solid var(--border2)}
.article-meta span{display:flex;align-items:center;gap:5px}
article h2{font-size:24px;font-weight:700;margin:36px 0 14px;letter-spacing:-.01em}
article h3{font-size:19px;font-weight:600;margin:28px 0 12px}
article p{color:var(--text2);font-size:16px;margin-bottom:16px}
article ul,article ol{color:var(--text2);font-size:16px;margin:0 0 16px 22px}
article li{margin-bottom:8px}
article strong{color:var(--text);font-weight:600}
article blockquote{border-left:3px solid var(--p1);padding:12px 20px;margin:20px 0;background:var(--surface);border-radius:0 8px 8px 0;color:var(--text2);font-size:15px}
article img{max-width:100%;height:auto;border-radius:12px;margin:24px 0;box-shadow:0 4px 18px rgba(15,23,42,.08)}
.article-figure{margin:28px 0;text-align:center}
.article-figure img{margin:0}
.article-figure figcaption{font-size:13.5px;color:var(--text3);margin-top:10px;line-height:1.5}
.cta-box{margin-top:48px;padding:32px;background:linear-gradient(135deg,#eff6ff,#ecfeff);border:1px solid #bfdbfe;border-radius:18px;text-align:center}
.cta-box h3{font-size:20px;font-weight:700;margin-bottom:10px}
.cta-box p{color:var(--text2);font-size:15px;margin-bottom:20px}
.cta-btn{display:inline-flex;align-items:center;gap:8px;padding:12px 28px;background:var(--g1);color:#fff;border-radius:10px;font-weight:600;font-size:15px;box-shadow:0 4px 14px rgba(37,99,235,.3)}
.cta-btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(37,99,235,.4)}
footer{border-top:1px solid var(--border);padding:32px 0;text-align:center;color:var(--text3);font-size:13px}
footer a{color:var(--text3)}
@media(max-width:768px){.article-wrap{padding:32px 18px 60px}article h1{font-size:24px}article h2{font-size:20px}article p{font-size:15px}}
</style>
</head>
<body>

<nav class="nav">
  <div class="nav-in">
    <div class="logo" onclick="window.location.href='${CONFIG.siteUrl}'">
      <div class="logo-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M22 22H2V10l7-3v2l5-2v3h3v-3.5l5 2V22z"/></svg></div>
      <span class="logo-t">${CONFIG.siteName}</span>
    </div>
    <a href="${CONFIG.siteUrl}/blog/" class="nav-back">← 返回博客</a>
  </div>
</nav>

<div class="article-wrap">
  <div class="breadcrumb">
    <a href="${CONFIG.siteUrl}">首页</a> / <a href="${CONFIG.siteUrl}/blog/">博客</a> / ${escapeHTML(article.category || topic.category)}
  </div>
  <span class="article-tag">${escapeHTML(article.category || topic.category)}</span>
  <article>
    <h1>${escapeHTML(article.title)}</h1>
    <div class="article-meta">
      <span>${CONFIG.siteName}</span>
      <span>·</span>
      <span>${date}</span>
      <span>·</span>
      <span>阅读约 ${Math.ceil((article.content || '').length / 400)} 分钟</span>
    </div>
    ${mdToHtml(article.content)}
    <div class="cta-box">
      <h3>用轩宇汇的货盘，零库存把货卖向全球</h3>
      <p>服装、水杯等 POD 货品一件代发，无资金压力、无库存风险。立即去 轩宇汇 用现成货盘开店卖货。</p>
      <a href="${CONFIG.appUrl}" class="cta-btn">直接访问 轩宇汇 →</a>
    </div>
  </article>

</div>

<footer>
  <p>© 2025-2026 ${CONFIG.siteName}. <a href="${CONFIG.siteUrl}">www.pod.ddddnet.cn</a></p>
</footer>

</body>
</html>`;
}

// 博客列表页（带分页，每页 PAGE_SIZE 篇）
const PAGE_SIZE = 10;

function generateBlogIndex(posts) {
  const sorted = posts.slice().reverse();
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pages = [];

  for (let page = 1; page <= totalPages; page++) {
    const pagePosts = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const postsHtml = pagePosts.map(p => `
      <a href="${CONFIG.siteUrl}/blog/posts/${p.slug}.html" class="post-card">
        <span class="post-tag">${escapeHTML(p.category)}</span>
        <h3>${escapeHTML(p.title)}</h3>
        <p>${escapeHTML(p.description)}</p>
        <span class="post-date">${p.date}</span>
      </a>`).join('');

    // 分页导航
    let pagerHtml = '';
    if (totalPages > 1) {
      const prevLink = page === 1 ? '' : (page === 2 ? `${CONFIG.siteUrl}/blog/` : `${CONFIG.siteUrl}/blog/page/${page - 1}.html`);
      const nextLink = page === totalPages ? '' : `${CONFIG.siteUrl}/blog/page/${page + 1}.html`;
      const pageNums = [];
      for (let i = 1; i <= totalPages; i++) {
        if (i === page) {
          pageNums.push(`<span class="pg-num active">${i}</span>`);
        } else if (i === 1) {
          pageNums.push(`<a href="${CONFIG.siteUrl}/blog/" class="pg-num">${i}</a>`);
        } else {
          pageNums.push(`<a href="${CONFIG.siteUrl}/blog/page/${i}.html" class="pg-num">${i}</a>`);
        }
      }
      pagerHtml = `
  <div class="pager">
    ${page > 1 ? `<a href="${prevLink}" class="pg-btn">← 上一页</a>` : '<span class="pg-btn disabled">← 上一页</span>'}
    <div class="pg-nums">${pageNums.join('')}</div>
    ${page < totalPages ? `<a href="${nextLink}" class="pg-btn">下一页 →</a>` : '<span class="pg-btn disabled">下一页 →</span>'}
  </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>轩宇汇 POD 货盘卖货博客${page > 1 ? ' 第' + page + '页' : ''} | ${CONFIG.siteName}</title>
<meta name="description" content="轩宇汇美国源头 POD 工厂：服装、水杯等 POD 货盘一件代发，零库存、无资金压力，持续更新跨境电商卖货干货。" />
<meta name="robots" content="index, follow" />
${page === 1 ? `<link rel="canonical" href="${CONFIG.siteUrl}/blog/" />` : `<link rel="canonical" href="${CONFIG.siteUrl}/blog/page/${page}.html" />`}
${page > 1 ? `<meta name="robots" content="noindex, follow" />` : ''}
<meta property="og:type" content="website" />
<meta property="og:title" content="轩宇汇 POD 货盘卖货博客 | ${CONFIG.siteName}" />
<meta property="og:description" content="轩宇汇美国源头 POD 工厂：服装、水杯等 POD 货盘一件代发，零库存、无资金压力，帮你把货卖向全球。" />
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%232563eb'/%3E%3Cstop offset='100%25' style='stop-color:%230ea5e9'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100' height='100' rx='22' fill='url(%23g)'/%3E%3Cpath d='M20 78 V44 H34 V56 H48 V44 H62 V56 H76 V34 L86 42 V78 Z' fill='white'/%3E%3C/svg%3E" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
:root{--bg:#fbfcfd;--surface:#fff;--border:#eef2f7;--border2:#e2e8f0;--text:#0b1426;--text2:#475569;--text3:#94a3b8;--p1:#2563eb;--p2:#0ea5e9;--g1:linear-gradient(135deg,#2563eb,#0ea5e9)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans SC',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.nav{position:sticky;top:0;z-index:50;backdrop-filter:blur(20px);background:rgba(255,255,255,.85);border-bottom:1px solid var(--border);padding:14px 0}
.nav-in{max-width:900px;margin:0 auto;padding:0 24px;display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;cursor:pointer}
.logo-ic{width:32px;height:32px;border-radius:8px;background:var(--g1);display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;font-weight:900}
.logo-t{background:var(--g1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.wrap{max-width:900px;margin:0 auto;padding:48px 24px 80px}
.header{text-align:center;margin-bottom:48px}
.header h1{font-size:36px;font-weight:800;letter-spacing:-.02em;margin-bottom:12px}
.header h1 .g{background:var(--g1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.header p{color:var(--text2);font-size:16px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}
.post-card{display:block;background:var(--surface);border:1px solid var(--border2);border-radius:16px;padding:24px;transition:all .3s}
.post-card:hover{transform:translateY(-3px);border-color:rgba(37,99,235,.2);box-shadow:0 12px 32px rgba(15,23,42,.06)}
.post-tag{display:inline-block;padding:3px 10px;background:linear-gradient(135deg,rgba(37,99,235,.06),rgba(14,165,233,.06));border:1px solid rgba(37,99,235,.12);border-radius:999px;font-size:11.5px;font-weight:600;color:var(--p1);margin-bottom:12px}
.post-card h3{font-size:17px;font-weight:700;margin-bottom:8px;line-height:1.4}
.post-card p{color:var(--text2);font-size:14px;line-height:1.6;margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.post-date{font-size:12.5px;color:var(--text3)}
.empty{text-align:center;padding:60px;color:var(--text3)}
.pager{display:flex;align-items:center;justify-content:center;gap:16px;margin-top:48px;flex-wrap:wrap}
.pg-btn{padding:10px 18px;background:var(--surface);border:1px solid var(--border2);border-radius:10px;font-size:14px;font-weight:600;color:var(--text2);transition:all .2s}
a.pg-btn:hover{border-color:var(--p1);color:var(--p1);transform:translateY(-1px)}
.pg-btn.disabled{opacity:.4;cursor:default}
.pg-nums{display:flex;gap:8px}
.pg-num{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;font-size:14px;font-weight:600;color:var(--text2);border:1px solid var(--border2);background:var(--surface);transition:all .2s}
a.pg-num:hover{border-color:var(--p1);color:var(--p1)}
.pg-num.active{background:var(--g1);color:#fff;border-color:transparent}
footer{border-top:1px solid var(--border);padding:32px 0;text-align:center;color:var(--text3);font-size:13px}
@media(max-width:768px){.grid{grid-template-columns:1fr}.header h1{font-size:28px}.pg-nums{display:none}}
</style>
</head>
<body>

<nav class="nav">
  <div class="nav-in">
    <div class="logo" onclick="window.location.href='${CONFIG.siteUrl}'">
      <div class="logo-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M22 22H2V10l7-3v2l5-2v3h3v-3.5l5 2V22z"/></svg></div>
      <span class="logo-t">${CONFIG.siteName}</span>
    </div>
    <a href="${CONFIG.siteUrl}" style="font-size:14px;color:var(--text2);font-weight:500">← 返回首页</a>
  </div>
</nav>

<div class="wrap">
  <div class="header">
    <h1>轩宇汇<span class="g">POD货盘卖货博客</span></h1>
    <p>Temu半托管POD美国源头工厂：服装、水杯等货盘一件代发、零库存卖货、全球出货干货文章</p>
  </div>
  <div class="grid">${postsHtml}
  </div>${pagerHtml}
</div>

<footer>
  <p>© 2025 ${CONFIG.siteName}. <a href="${CONFIG.siteUrl}" style="color:inherit">www.pod.ddddnet.cn</a></p>
</footer>

</body>
</html>`;

    pages.push({ page, html });
  }

  return pages;
}

// sitemap.xml
function generateSitemap(posts) {
  const today = todayStr();
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${CONFIG.siteUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${CONFIG.siteUrl}/blog/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.9</priority>
  </url>`;

  for (const p of posts) {
    xml += `
  <url>
    <loc>${CONFIG.siteUrl}/blog/posts/${p.slug}.html</loc>
    <lastmod>${p.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
  }

  xml += '\n</urlset>\n';
  return xml;
}

// HTML 转义
function escapeHTML(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(str) {
  return escapeHTML(str).replace(/"/g, '&quot;');
}

// ===== 主流程 =====
async function main() {
  console.log('=== SEO 博客生成器启动 ===');
  console.log(`时间: ${nowStr()}`);

  if (!process.env.BIGMODEL_API_KEY) {
    console.error('错误: 未设置 BIGMODEL_API_KEY 环境变量');
    process.exit(1);
  }

  // 确保目录存在
  fs.mkdirSync(CONFIG.postsDir, { recursive: true });

  // 加载已生成记录
  const gen = loadGenerated();
  console.log(`已生成文章数: ${gen.posts.length}`);

  // 检查是否需要生成新一批热点话题（7天更新一次）
  const hotFile = path.join(__dirname, 'topics-hot.json');
  let needHotRefresh = false;
  try {
    if (!fs.existsSync(hotFile)) {
      needHotRefresh = true;
    } else {
      const hotData = JSON.parse(fs.readFileSync(hotFile, 'utf-8'));
      const updatedAt = hotData.updated ? new Date(hotData.updated) : new Date(0);
      const daysDiff = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff >= 7 || (hotData.topics || []).length < 5) {
        needHotRefresh = true;
      }
    }
  } catch {
    needHotRefresh = true;
  }

  if (needHotRefresh) {
    console.log('正在生成热点话题...');
    try {
      const newHot = await generateHotTopics();
      if (newHot.length > 0) {
        // 合并保留一部分旧热点
        const oldHot = loadHotTopics();
        const merged = [...newHot, ...oldHot.slice(0, 3)];
        saveHotTopics(merged);
        console.log(`热点话题已更新：共 ${merged.length} 个`);
      }
    } catch (err) {
      console.warn('热点话题生成异常，使用现有选题:', err.message);
    }
  }

  // 选取选题
  const topic = pickTopic(gen);
  console.log(`本次选题: ${topic.topic} [${topic.category}]`);

  // 调用 AI 生成
  console.log('正在调用 GLM-4V-Flash 生成文章...');
  const rawContent = await callGLM(topic);
  console.log('AI 返回内容长度:', rawContent.length);

  // 解析
  const article = parseArticle(rawContent, topic);
  article.slug = cleanSlug(article.slug);

  // 确保 slug 不重复
  if (gen.posts.some(p => p.slug === article.slug)) {
    article.slug = article.slug + '-' + Date.now();
  }

  console.log(`文章标题: ${article.title}`);
  console.log(`URL slug: ${article.slug}`);

  // 生成文章 HTML
  const articleHTML = generateArticleHTML(article, topic);
  const articlePath = path.join(CONFIG.postsDir, `${article.slug}.html`);
  fs.writeFileSync(articlePath, articleHTML, 'utf-8');
  console.log(`文章已保存: ${articlePath}`);

  // 更新记录
  gen.posts.push({
    slug: article.slug,
    title: article.title,
    description: article.description,
    category: article.category || topic.category,
    date: todayStr(),
    keywords: article.keywords || topic.keywords,
  });
  if (!gen.usedTopics.includes(topic.topic)) {
    gen.usedTopics.push(topic.topic);
  }
  gen.count = gen.posts.length;
  saveGenerated(gen);

  // 更新博客列表页（带分页）
  const blogPages = generateBlogIndex(gen.posts);
  const blogPageDir = path.join(CONFIG.blogDir, 'page');
  fs.mkdirSync(blogPageDir, { recursive: true });

  // 第1页写到 blog/index.html
  fs.writeFileSync(CONFIG.blogIndex, blogPages[0].html, 'utf-8');

  // 清理旧的多余分页文件
  const existingFiles = fs.existsSync(blogPageDir) ? fs.readdirSync(blogPageDir) : [];
  const neededFiles = blogPages.slice(1).map(p => `${p.page}.html`);
  for (const f of existingFiles) {
    if (!neededFiles.includes(f)) {
      fs.unlinkSync(path.join(blogPageDir, f));
    }
  }

  // 第2页及以后写到 blog/page/N.html
  for (let i = 1; i < blogPages.length; i++) {
    const p = blogPages[i];
    fs.writeFileSync(path.join(blogPageDir, `${p.page}.html`), p.html, 'utf-8');
  }
  console.log(`博客列表页已更新（共 ${blogPages.length} 页）`);

  // 更新 sitemap
  const sitemap = generateSitemap(gen.posts);
  fs.writeFileSync(CONFIG.sitemapPath, sitemap, 'utf-8');
  console.log('sitemap.xml 已更新');

  console.log(`\n=== 生成完成！累计 ${gen.posts.length} 篇文章 ===`);
}

main().catch(err => {
  console.error('生成失败:', err.message);
  process.exit(1);
});
