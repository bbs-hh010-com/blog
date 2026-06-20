// scripts/update-posts.js
// 扫描 posts/ 目录，读取每篇文章头部的元信息注释，
// 自动更新 index.html 中的文章列表和 sitemap.xml

const fs   = require('fs');
const path = require('path');

const POSTS_DIR   = path.join(__dirname, '..', 'posts');
const INDEX_FILE  = path.join(__dirname, '..', 'index.html');
const SITEMAP_FILE = path.join(__dirname, '..', 'sitemap.xml');
const BASE_URL    = 'https://bbs-hh010-com.github.io/blog';

// ── 1. 读取所有文章，解析头部注释 ──────────────────────────────────
function parseMeta(html) {
  const block = html.match(/^<!--\s*([\s\S]*?)-->/);
  if (!block) return null;

  const meta = {};
  const lines = block[1].split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*@(\w+):\s*(.+)/);
    if (m) meta[m[1].trim()] = m[2].trim();
  }

  if (!meta.title || !meta.date) return null;
  return meta;
}

function readPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];

  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.html'))
    .map(file => {
      const filePath = path.join(POSTS_DIR, file);
      const html = fs.readFileSync(filePath, 'utf-8');
      const meta = parseMeta(html);
      if (!meta) {
        console.warn(`⚠️  跳过 ${file}（找不到元信息注释）`);
        return null;
      }
      return { file, filePath, ...meta };
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));  // 按日期降序
}

// ── 2. 处理 featured 逻辑，自动清理旧标记 ─────────────────────────
// 规则：
//   - 所有 featured=true 的文章里，日期最新的那篇作为置顶
//   - 其余有 featured=true 的文章，自动删除该行（回写文件）
//   - 如果没有任何 featured，置顶位置留空（不强制取第一篇）

function resolveFeatured(posts) {
  const featuredPosts = posts.filter(p => p.featured === 'true');

  if (featuredPosts.length === 0) {
    return { featured: null, normalPosts: posts };
  }

  // 已按日期降序排列，第一个即最新
  const [keeper, ...stale] = featuredPosts;

  // 清理旧 featured 标记（回写文件）
  for (const post of stale) {
    try {
      const original = fs.readFileSync(post.filePath, 'utf-8');
      // 删除含 @featured: 的整行
      const cleaned = original.replace(/^\s*@featured:.*\r?\n?/m, '');
      if (cleaned !== original) {
        fs.writeFileSync(post.filePath, cleaned, 'utf-8');
        console.log(`🧹 已清除旧置顶标记：${post.file}`);
      }
    } catch (e) {
      console.warn(`⚠️  清理 ${post.file} 时出错：${e.message}`);
    }
  }

  // 普通文章列表：排除置顶文章
  const normalPosts = posts.filter(p => p.file !== keeper.file);

  return { featured: keeper, normalPosts };
}

// ── 3. 生成 HTML 片段 ──────────────────────────────────────────────
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

// ── 4. 更新 index.html ─────────────────────────────────────────────
function updateIndex(featured, normalPosts) {
  let html = fs.readFileSync(INDEX_FILE, 'utf-8');

  // 注入搜索数据
  const searchData = normalPosts.map(p => ({
    title: p.title,
    excerpt: p.excerpt || '',
    date: p.date,
    tag: p.tag || 'cert',
    file: p.file
  }));
  if (featured) {
    searchData.unshift({
      title: featured.title,
      excerpt: featured.excerpt || '',
      date: featured.date,
      tag: featured.tag || 'cert',
      file: featured.file
    });
  }
  
  const searchDataScript = `<script id="search-data" type="application/json">\n${JSON.stringify(searchData)}\n</script>`;
  
  if (html.includes('<script id="search-data"')) {
    html = html.replace(/<script id="search-data" type="application\/json">[\s\S]*?<\/script>/, searchDataScript);
  } else {
    html = html.replace('</body>', searchDataScript + '\n</body>');
  }

  // 4a. FEATURED 区块
  if (featured) {
    if (html.includes('FEATURED</span>')) {
      html = html.replace(
        /(<section class="sec"[^>]*>\s*<div class="sec-hd">\s*<span class="sec-title"><span>\/\/<\/span>FEATURED<\/span>\s*<\/div>\s*)[\s\S]*?(<\/section>)/i,
        `$1${buildFeaturedHTML(featured)}\n  $2`
      );
    } else {
      const featureSection = `  <section class="sec" aria-label="推荐文章">\n    <div class="sec-hd">\n      <span class="sec-title"><span>//</span>FEATURED</span>\n    </div>\n${buildFeaturedHTML(featured)}\n  </section>\n\n  `;
      html = html.replace(
        /(<section class="sec"[^>]*>\s*<div class="sec-hd">\s*<span class="sec-title"><span>\/\/<\/span>LATEST POSTS)/i,
        featureSection + '$1'
      );
    }
  }

  // 4b. LATEST POSTS 区块（最多显示 10 篇，排除置顶文章）
  const latestRows = normalPosts.slice(0, 10).map(buildPostRowHTML).join('\n');
  html = html.replace(
    /(<div class="posts-list">)\s*[\s\S]*?(<\/div>\s*<\/section>)/,
    `$1\n${latestRows}\n    $2`
  );

  fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  console.log(`✅ index.html 已更新（置顶：${featured ? featured.file : '无'} / 普通：${Math.min(normalPosts.length, 10)} 篇）`);
}

// ── 5. 更新 sitemap.xml ────────────────────────────────────────────
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

// ── 6. 入口 ───────────────────────────────────────────────────────
const allPosts = readPosts();
console.log(`📄 找到 ${allPosts.length} 篇文章`);

if (allPosts.length === 0) {
  console.log('没有找到文章，跳过更新。');
  process.exit(0);
}

const { featured, normalPosts } = resolveFeatured(allPosts);

updateIndex(featured, normalPosts);
updateSitemap(allPosts);  // sitemap 包含全部文章
