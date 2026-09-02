# 轩宇汇 官网 · 全自动 SEO 站

Temu 半托管 POD 美国源头工厂「轩宇汇」的品牌官网与全自动 SEO 内容站，部署在 `www.pod.ddddnet.cn`。

## 说明

- **官网域名**：`www.pod.ddddnet.cn`
- **应用域名**：`pod.ddddnet.cn`（对应 `pod-distribution/` 前端项目）
- 本目录为纯静态单页网站 + 自动化博客，**无需构建工具**，由 Cloudflare Pages 托管。
- 博客文章由 GitHub Actions 每小时调用智谱 GLM-4V-Flash（免费模型）自动生成并推送搜索引擎。

## 业务定位

轩宇汇是面向 TEMU 半托管卖家的美国源头 POD 工厂，采用白标模式直供货盘：

- 美国源头工厂直供：服装 / T恤 / 卫衣、水杯 / 马克杯、帆布包、手机壳等 POD 货盘
- 白标绑店：绑定卖家店铺，自动拉取订单
- 工厂选品中心：海量 POD 图案 / 品类可直接出单
- 工厂直发一件代发：零库存创业，赚取货品价差
- 订单审核流 + 物流状态回传
- 多区域覆盖：125 / 225 / 325 / 525

## 文件结构

```
website/
├── index.html                              # 官网主页面（单文件，内联 CSS + JS）
├── robots.txt                              # 搜索引擎爬虫配置
├── sitemap.xml                             # 站点地图（自动更新）
├── _redirects                              # Cloudflare Pages 路由配置（SPA fallback）
├── 9c52420012041ce5090d1dcfc1866ec6.txt   # IndexNow 密钥文件（Bing/Yandex 推送校验用）
├── README.md                               # 本文档
├── blog/                                   # SEO 博客（自动生成）
│   ├── index.html                          # 博客列表首页（第 1 页，带分页）
│   ├── page/                               # 分页（第 2 页起）
│   └── posts/                              # 文章详情页
├── scripts/                                # 自动化脚本
│   ├── generate-seo.js                     # 调用 GLM-4V-Flash 生成文章
│   ├── push-seo.js                         # 推送到 Bing (IndexNow + URL Submission API) / 百度
│   ├── topics.js                           # 静态选题库（110 个，8 大类）
│   ├── topics-hot.json                     # 动态热点选题（每 7 天更新，GitHub Actions 运行时生成）
│   ├── generated.json                      # 已生成文章记录（运行时）
│   └── push-log.json                       # 推送日志（运行时）
└── .github/
    └── workflows/
        └── seo-blog.yml                    # GitHub Actions 每小时自动生成并推送
```

## 本地预览

直接用浏览器打开 `index.html` 即可；纯静态，无构建步骤。

## 自动化流水线（GitHub Actions）

`.github/workflows/seo-blog.yml` 负责：

1. `cron: '0 * * * *'` 每小时触发（UTC 整点），`push` 到 main 或手动 `workflow_dispatch` 也会触发。
2. 安装 Node.js 20，运行 `node scripts/generate-seo.js` 生成一篇文章。
3. 运行 `node scripts/push-seo.js` 向 Bing（IndexNow + Webmaster URL Submission）/ 百度 推送新 URL。
4. 自动 `git commit` 并 `git push`（bot 提交，含防循环判断）。

### 必需的 Secrets

| Secret | 说明 | 必要性 |
| --- | --- | --- |
| `BIGMODEL_API_KEY` | 智谱 BigModel API Key（GLM-4V-Flash 免费模型） | **必需** |
| `BING_API_KEY` | Bing Webmaster Tools API Key（URL Submission） | 可选 |
| `BAIDU_TOKEN` | 百度普通收录推送 Token | 可选 |

> 配置路径：仓库 `Settings → Secrets and variables → Actions → New repository secret`。

## 部署（Cloudflare Pages）

1. Cloudflare 控制台 → **Workers & Pages → Create → 连接 Git 仓库** `zxwljs/www.pod.ddddnet.cn`。
2. 构建设置：**Framework preset = None**，**Build command 留空**，**Output directory = `/`**（仓库根目录）。
3. 部署完成后，到 **Custom domains** 绑定 `www.pod.ddddnet.cn`（按提示添加 CNAME 解析）。
4. 可选：Bing Webmaster Tools / 百度搜索资源平台 添加站点验证（IndexNow 密钥文件已就位）。

## 搜索引擎推送

- **IndexNow**：`9c52420012041ce5090d1dcfc1866ec6.txt` 为密钥校验文件，已放在根目录；新文章 URL 自动推送至 `api.indexnow.org`。
- **Bing Webmaster API**：通过 `BING_API_KEY` 调用 URL Submission。
- **百度普通收录**：通过 `BAIDU_TOKEN` 推送（有 24h 降频保护）。

## 品牌资产

- 主色：海军蓝渐变 `#2563eb → #0ea5e9`
- Logo 字：「轩」
- 站点名：轩宇汇
- CTA 入口统一指向应用 `https://pod.ddddnet.cn`
