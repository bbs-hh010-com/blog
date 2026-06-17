// scripts/update-posts.js
// 扫描 posts/ 目录，读取每篇文章头部的元信息注释，
// 自动更新 index.html 中的文章列表和 sitemap.xml

const fs   = require('fs');
const path = require('path');

const POSTS_DIR   = path.join(__dirname, '..', 'posts');
const INDEX_FILE  = path.join(__dirname, '..', 'index.html');
const SITEMAP_FILE = path.join(__dirname, '..', 'sitemap.xml');
const BASE_URL    = 'https://quantum-darkmatter.github.io';

// ── 1. 读取所有文章，解析头部注释 ──────────────────────────────────
// 每篇文章 HTML 最顶部写这样的注释块（第一行必须是 <!DOCTYPE html> 之前）：
//
// <!--
// @title:   文章标题
// @date:    2025-01-10
// @tag:     cert          (可选值: cert / tool / tip)
// @excerpt: 一两句摘要
// @min:     8
// @featured: true         (可选，只有一篇)
// -->
//
// 解析器会提取这些字段。

function parseMeta(html) {
  const block = html.match(/^<!--\s*([\s\S]*?)-->/);
  if (!block) return null;

  const meta = {};
  const lines = block[1].split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*@(\w+):\s*(.+)/);
    if (m) meta[m[1].trim()] = m[2].trim();
  }

  if (!meta.title || !meta.date) return null;  // 必填字段
  return meta;
}

function readPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];

  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.html'))
    .map(file => {
      const html = fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8');
      const meta = parseMeta(html);
      if (!meta) {
        console.warn(`⚠️  跳过 ${file}（找不到元信息注释）`);
        return null;
      }
      return { file, ...meta };
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));  // 按日期降序
}

// ── 2. 生成 HTML 片段 ──────────────────────────────────────────────
const TAG_CLASS = { cert: 'cert', tool: 'tool', tip: 'tip' };

function tagLabel(tag) {
  return (tag || 'cert').toUpperCase();
}

function buildFeaturedHTML(post) {
  const href = `posts/${post.file}`;
  return `    <a href="${href}" class="feat-card">
      <div class="feat-title">${post.title}</div>
      <p class="feat-desc">${post.excerpt || ''}</p>
      <div class="feat-foot">
        <div class="tags">
          <span class="tag blue">${tagLabel(post.tag)}</span>
        </div>
        <div class="read-more">READ FULL →</div>
      </div>
    </a>`;
}

function buildPostRowHTML(post) {
  const href  = `posts/${post.file}`;
  const cls   = TAG_CLASS[post.tag] || 'cert';
  const label = tagLabel(post.tag);
  const min   = post.min ? `${post.min} MIN` : '';
  return `      <a href="${href}" class="post-row">
        <div>
          <div class="post-meta"><span class="post-tag ${cls}">${label}</span><span class="post-date">${post.date}</span></div>
          <div class="post-title">${post.title}</div>
          <div class="post-exc">${post.excerpt || ''}</div>
        </div>
        <div class="post-min">${min}</div>
      </a>`;
}

// ── 3. 更新 index.html 中的文章列表 ────────────────────────────────
function updateIndex(posts) {
  let html = fs.readFileSync(INDEX_FILE, 'utf-8');

  // 先清空之前可能遺留的置頂推薦區塊，防止重復生成
  html = html.replace(/<div class="featured-post">[\s\S]*?<\/div>\s*\s*/gi, '');

  let featureSection = '';
  let displayPosts = [...posts]; // 複製一份完整的文章列表

  if (posts.length > 0) {
    // 1. 尋找帶有推薦標籤中日期最新的一篇；如果都沒有帶，就默認拿最新的一篇文章置頂
    const featured = posts.find(p => p.featured === 'true') || posts[0];
    
    // 2. 【核心修改】：只把真正被選為置頂的這一篇從普通列表裡剔除
    // 這樣其餘同樣帶有 @featured: true 的舊推薦文章，就會安全留在 displayPosts 裡排隊
    displayPosts = posts.filter(p => p.file !== featured.file);

    // 3. 生成置頂推薦區塊的 HTML
    featureSection = buildFeaturedHTML(featured);
    
    // 4. 精準插入到 LATEST POSTS 的前面
    html = html.replace(/(<section class="sec"[^>]*>\s*<div class="sec-hd">\s*<span class="sec-title"><span>\/\/<\/span>LATEST POSTS)/i, featureSection + '$1');
  }

  // 3b. LATEST POSTS 區塊（最多顯示 10 篇）
  // 【核心修改】：這裡改用過濾後的 displayPosts，保證置頂的不重復，舊推薦文章能正常顯示
  const latestRows = displayPosts.slice(0, 10).map(buildPostRowHTML).join('\n');
  
  html = html.replace(
    /(<div class="posts-list">)\s*[\s\S]*?(<\/div>\s*<\/section>)/,
    `$1\n${latestRows}\n    $2`
  );

  fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  console.log(`✅ index.html 已更新（共 ${posts.length} 篇文章，當前置頂 1 篇，普通列表顯示 ${displayPosts.slice(0, 10).length} 篇）`);
}

// ── 4. 更新 sitemap.xml ────────────────────────────────────────────
function updateSitemap(posts) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `  <url><loc>${BASE_URL}/</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>`,
    ...posts.map(p =>
      `  <url><loc>${BASE_URL}/posts/${p.file}</loc><lastmod>${p.date}</lastmod><priority>0.8</priority></url>`
    )
  ].join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  fs.writeFileSync(SITEMAP_FILE, xml, 'utf-8');
  console.log(`✅ sitemap.xml 已更新`);
}

// ── 5. 入口 ───────────────────────────────────────────────────────
const posts = readPosts();
console.log(`📄 找到 ${posts.length} 篇文章`);

if (posts.length === 0) {
  console.log('没有找到文章，跳过更新。');
  process.exit(0);
}

updateIndex(posts);
updateSitemap(posts);
