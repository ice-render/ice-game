#!/usr/bin/env node
/**
 * 从各游戏目录的 `meta.json` 聚合出 `src/domain/catalog.generated.json`（首页与测试都读它）。
 *
 * 为什么要生成、而不是让 `catalog.ts` 手写一份列表：
 * **手工维护的列表一定会漏。** 加了游戏忘了登记 → 构建收了它、首页却没有入口；
 * 删了游戏忘了删条目 → 首页点进去 404。生成物 + 一致性门禁把这类问题变成"构建期就红"。
 *
 * 用法：
 *   node scripts/gen-catalog.mjs           写生成物
 *   node scripts/gen-catalog.mjs --check   断言生成物最新（不写；落后就非零退出）
 *
 * `--check` 放在 `npm run verify` 里，所以"改了 meta.json 却没重新生成"进不了主干。
 * 构建与 dev server 会**前置**执行一次生成（见 package.json），所以日常不需要手动跑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAll } from './lib/scan-games.cjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_FILE = path.join(ROOT, 'src', 'domain', 'catalog.generated.json');
const COVERS_DIR = path.join(ROOT, 'src', 'home', 'covers');

const check = process.argv.includes('--check');

const { items, skipped, errors } = scanAll(ROOT);

if (errors.length) {
  console.error('✗ 页面元数据有问题，无法生成目录：\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\n提示：新建游戏可以用 `npm run new:game <slug>`。');
  process.exit(1);
}

/**
 * 只把**界面需要**的字段写进生成物：构建细节（目录/入口）不进这里，
 * 免得生成物变成第二份"构建配置"，改一个字段要动两个地方。
 *
 * `cover` 是"有没有封面图"的标记：首页据此决定画封面还是画占位块。
 * 在这里（而不是运行时 fetch）判断，是因为构建期就知道结果 ——
 * 顺带让 `check:covers` 能在构建前提醒"还有游戏没封面"。
 */
const payload = {
  pages: items.map((item) => ({
    slug: item.slug,
    kind: item.kind,
    title: item.meta.title,
    tagline: item.meta.tagline,
    accent: item.meta.accent,
    features: item.meta.features,
    controls: item.meta.controls,
    page: item.page,
    cover: fs.existsSync(path.join(COVERS_DIR, `${item.slug}.png`)),
  })),
};

const next = JSON.stringify(payload, null, 2) + '\n';
const prev = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;

if (check) {
  if (prev === next) {
    console.log('✓ 目录生成物是最新的');
  } else {
    console.error('✗ src/domain/catalog.generated.json 与各游戏目录的 meta.json 不一致。');
    console.error('  跑 `npm run gen:catalog` 重新生成（构建与 dev server 也会自动跑）。');
    process.exit(1);
  }
} else if (prev === next) {
  console.log('✓ 目录生成物无变化');
} else {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, next, 'utf8');
  console.log(`✓ 已生成 ${path.relative(ROOT, OUT_FILE)}（${payload.pages.length} 个页面）`);
}

// 有目录但没登记（缺 meta.json）时提醒一声：这不是错误，但常常是"忘了注册"
if (skipped.length) {
  console.log('\n提醒：下列目录没有 meta.json，未纳入构建（半成品？还是忘了注册？）：');
  for (const s of skipped) console.log(`  - ${path.relative(ROOT, s.dir)}`);
}

if (!check) {
  for (const page of payload.pages) {
    const cover = page.cover ? '有封面' : '无封面';
    console.log(`  ${page.page.padEnd(18)} [${page.kind.padEnd(7)}] ${cover}  ${page.title}`);
  }
  const missing = payload.pages.filter((page) => !page.cover);
  if (missing.length) {
    console.log(`\n提醒：${missing.length} 个页面还没有封面图（首页会显示占位块）。`);
    console.log('      跑 `npm run covers` 自动抓取（需要先 npm run build）。');
  }
}
