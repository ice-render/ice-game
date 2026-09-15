/**
 * 游戏分区扫描器 —— 「本仓有哪些页面」的唯一事实来源，被三处共用：
 *
 *  - `webpack.config.js`：据此生成 entry 与 HtmlWebpackPlugin（**新增游戏不改构建配置**）
 *  - `scripts/gen-catalog.mjs`：据此生成 `src/domain/catalog.generated.json`（首页/测试读它）
 *  - `scripts/check-games.mjs`：据此断言「目录 ↔ catalog ↔ 构建产物」三者对齐
 *
 * 三处共用一份扫描 + 一份校验，避免"构建收了这个游戏、首页却没列"这类各说各话。
 *
 * ## 两个分区，规则完全不同
 *
 * | 分区 | 目录 | 内容 | 能否手改 |
 * |---|---|---|---|
 * | `games` | `src/games/<slug>/` | 自研单页小游戏 | **就是要改** |
 * | `ported` | `src/ported/<slug>/` | 从上游抽取的整机（arcade / XP） | **禁止手改**（会被 sync 覆盖） |
 *
 * 分区是物理隔离的：混在一个目录里只靠文档约束，迟早有人改错地方。
 *
 * ## 约定（会被这里强制校验）
 *
 * 1. **`meta.json` 是"已注册"的标志**。目录里没有 meta.json → 不算入口、不进构建。
 *    这条让"写到一半的目录"不会被误打包，也让新建游戏有了明确的完成动作。
 * 2. **`slug` 必须等于目录名**，且全局唯一（`games` 与 `ported` 之间也不能重名）——
 *    否则两个游戏会抢同一个 webpack chunk / 同一个 `xxx.html`，静默互相覆盖。
 * 3. **`kind` 必须与分区一致**（games 只能 `game`，ported 只能 `machine`），免得首页分组错乱。
 * 4. `slug` 只能是小写字母/数字/连字符（它要当文件名与 URL）。
 */
const fs = require('node:fs');
const path = require('node:path');

/** 分区表：目录名 + 该分区允许的 kind。顺序 = 扫描顺序。 */
const PARTITIONS = [
  { name: 'games', kind: 'game', label: '小游戏' },
  { name: 'ported', kind: 'machine', label: '整机展厅' },
];

/** 小游戏页面的默认画布规格（`meta.json` 可覆盖）。 */
const PAGE_DEFAULTS = {
  width: 1180,
  height: 800,
  background: 'radial-gradient(circle at 50% 24%, #1b2130 0%, #080a0f 72%)',
  accent: '#0d6efd',
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} 不是合法 JSON：${err.message}`);
  }
}

/** 校验一条元数据；返回错误信息数组（空数组 = 合法）。 */
function validateMeta(meta, dirName, partition) {
  const errors = [];
  if (!meta || typeof meta !== 'object') return [`meta.json 必须是一个对象`];

  if (meta.slug !== dirName) {
    errors.push(`meta.json 的 slug="${meta.slug}" 与目录名 "${dirName}" 不一致（复制目录后忘了改？）`);
  }
  if (typeof meta.slug === 'string' && !SLUG_RE.test(meta.slug)) {
    errors.push(`slug="${meta.slug}" 不合法：只能是小写字母/数字/连字符，且不以连字符开头（它要当文件名和 URL）`);
  }
  if (typeof meta.title !== 'string' || !meta.title.trim()) {
    errors.push('缺少 title（首页卡片标题）');
  }
  if (typeof meta.tagline !== 'string' || !meta.tagline.trim()) {
    errors.push('缺少 tagline（首页卡片的一句话说明）');
  }
  if (meta.tagline && meta.tagline.length > 34) {
    errors.push(`tagline 有 ${meta.tagline.length} 字，首页那行只装得下 ~34 字（会被截断）`);
  }
  if (meta.kind !== partition.kind) {
    errors.push(`kind="${meta.kind}" 与所在分区 "${partition.name}" 不符（应为 "${partition.kind}"）`);
  }
  if (meta.accent !== undefined && !ACCENT_RE.test(meta.accent)) {
    errors.push(`accent="${meta.accent}" 不是 #rrggbb 形式的颜色`);
  }
  for (const key of ['features', 'controls']) {
    if (meta[key] !== undefined && !Array.isArray(meta[key])) {
      errors.push(`${key} 必须是数组`);
    }
  }
  if (Array.isArray(meta.controls)) {
    meta.controls.forEach((row, i) => {
      if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || typeof row[1] !== 'string') {
        errors.push(`controls[${i}] 必须是 [按键, 作用] 两个字符串`);
      }
    });
  }
  for (const key of ['width', 'height']) {
    if (meta[key] !== undefined && (!Number.isInteger(meta[key]) || meta[key] <= 0)) {
      errors.push(`${key} 必须是正整数（当前 ${JSON.stringify(meta[key])}）`);
    }
  }
  return errors;
}

/** 扫描单个分区。返回 `{ items, skipped, errors }`。 */
function scanPartition(root, partition) {
  const dir = path.join(root, 'src', partition.name);
  const items = [];
  const skipped = [];
  const errors = [];
  if (!fs.existsSync(dir)) return { items, skipped, errors };

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();

  for (const name of entries) {
    const itemDir = path.join(dir, name);
    const metaPath = path.join(itemDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      // 没有 meta.json = 尚未注册（半成品目录），不算入口
      skipped.push({ partition: partition.name, slug: name, dir: itemDir });
      continue;
    }
    const raw = readJson(metaPath);
    const found = validateMeta(raw, name, partition);
    if (found.length) {
      errors.push(...found.map((msg) => `src/${partition.name}/${name}/meta.json：${msg}`));
      continue;
    }
    if (!fs.existsSync(path.join(itemDir, 'main.ts'))) {
      errors.push(`src/${partition.name}/${name}/ 缺 main.ts（入口脚本）`);
      continue;
    }
    items.push({
      slug: name,
      partition: partition.name,
      label: partition.label,
      dir: itemDir,
      /** 产物文件名与 chunk 名（= slug；两者一致，相对路径才成立） */
      page: `${name}.html`,
      chunk: name,
      entry: path.join(itemDir, 'main.ts'),
      kind: partition.kind,
      meta: {
        slug: name,
        kind: partition.kind,
        title: raw.title,
        tagline: raw.tagline,
        accent: raw.accent || PAGE_DEFAULTS.accent,
        features: Array.isArray(raw.features) ? raw.features : [],
        controls: Array.isArray(raw.controls) ? raw.controls : [],
        width: raw.width || PAGE_DEFAULTS.width,
        height: raw.height || PAGE_DEFAULTS.height,
        background: raw.background || PAGE_DEFAULTS.background,
      },
    });
  }
  return { items, skipped, errors };
}

/**
 * 扫描全部分区。
 *
 * @param {string} root 工程根目录
 * @returns {{ items: any[], skipped: any[], errors: string[] }} items 按分区顺序 + slug 字母序
 */
function scanAll(root) {
  const items = [];
  const skipped = [];
  const errors = [];

  for (const partition of PARTITIONS) {
    const res = scanPartition(root, partition);
    items.push(...res.items);
    skipped.push(...res.skipped);
    errors.push(...res.errors);
  }

  // slug 全局唯一：重名会让两个页面抢同一个 chunk 与同一个 <slug>.html
  const seen = new Map();
  for (const item of items) {
    if (seen.has(item.slug)) {
      errors.push(
        `slug "${item.slug}" 重复：${seen.get(item.slug)} 与 src/${item.partition}/${item.slug}。` +
          `两者会抢同一个 webpack chunk 与 ${item.page}，静默互相覆盖。`,
      );
    } else {
      seen.set(item.slug, `src/${item.partition}/${item.slug}`);
    }
  }

  return { items, skipped, errors };
}

/** 只取小游戏（自研分区）。 */
function scanGames(root) {
  return scanAll(root).items.filter((item) => item.partition === 'games');
}

module.exports = { PARTITIONS, PAGE_DEFAULTS, scanAll, scanGames, validateMeta };
