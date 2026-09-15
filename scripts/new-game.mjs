#!/usr/bin/env node
/**
 * 新建一个自研小游戏：`npm run new:game <slug>`（可选 `--title 中文名`）。
 *
 * 生成 `src/games/<slug>/` 四个文件（meta.json / model.ts / main.ts）+ 一份规则单测，
 * 内容是一个**能跑起来的最小骨架**：限时计分 + 暂停 + 重开 + 最高分存档。
 *
 * 设计取舍：生成的不是一堆 TODO 空壳，而是**可运行的三层结构**。
 * 空壳只能告诉你"要写什么"，可运行的骨架能告诉你"怎么写才对"——
 * 尤其 `src/kit` 的六件怎么接（外壳/循环/输入/存档/音效），照着改比从零接快得多。
 *
 * 生成后还需要做什么，脚本会打印出来（其实就是：改 meta.json 的文案、改 model 的规则、
 * 跑 `npm run dev` —— **不需要改 webpack / 首页 / e2e**，那些都由目录驱动）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TEMPLATE_DIR = path.join(HERE, 'templates', 'game');
const GAMES_DIR = path.join(ROOT, 'src', 'games');
/** 与 playwright.config.ts 同一口径（端口撞了可以用 ICE_GAME_PORT 覆盖）。 */
const PORT = Number(process.env.ICE_GAME_PORT || 8098);

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const args = process.argv.slice(2);
const positionals = args.filter((arg) => !arg.startsWith('--'));
const slug = positionals[0];
const titleFlag = args.indexOf('--title');

/**
 * 标题的来源，按优先级：
 *  1. `--title "中文名"`（注意 npm 会把 `--title` 当自己的参数吃掉，
 *     正确写法是 `npm run new:game -- <slug> --title "中文名"`）；
 *  2. 第二个位置参数 —— 宽容一点，`npm run new:game demo 演示` 也认
 *     （用户按 npm 的直觉传参时不会得到一句莫名其妙的错误）；
 *  3. 退回 slug。
 */
const title = titleFlag !== -1 ? args[titleFlag + 1] : positionals[1] || null;

function fail(message) {
  console.error(`✗ ${message}`);
  console.error('\n用法（注意 npm 需要 `--` 分隔）：');
  console.error('  npm run new:game -- <slug> [--title "中文名"]');
  console.error('  例：npm run new:game -- tetris2 --title "俄罗斯方块 2"');
  console.error('  slug 只能是小写字母/数字/连字符（它会成为目录名、chunk 名与页面 URL）');
  process.exit(1);
}

if (!slug) fail('缺少 slug');
if (!SLUG_RE.test(slug)) fail(`slug "${slug}" 不合法：只能小写字母/数字/连字符，且不能以连字符开头`);

const targetDir = path.join(GAMES_DIR, slug);
if (fs.existsSync(targetDir)) fail(`src/games/${slug}/ 已存在`);

/** `my-game` → `MyGame`（用于 TS 类名）。 */
const pascal = slug
  .split('-')
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join('');

const displayTitle = title || slug;

/** 模板占位符替换。 */
const render = (text) =>
  text
    .replace(/__SLUG__/g, slug)
    .replace(/__NAME__/g, pascal)
    .replace(/__TITLE__/g, displayTitle);

fs.mkdirSync(targetDir, { recursive: true });
const created = [];

for (const file of ['meta.json', 'main.ts', 'model.ts']) {
  const src = path.join(TEMPLATE_DIR, file);
  const dest = path.join(targetDir, file);
  fs.writeFileSync(dest, render(fs.readFileSync(src, 'utf8')), 'utf8');
  created.push(path.relative(ROOT, dest));
}

// 规则单测放到镜像目录（本仓约定：测试在顶层 tests/ 下镜像 src/，不 co-located）
const testDir = path.join(ROOT, 'tests', 'games', slug);
fs.mkdirSync(testDir, { recursive: true });
const testDest = path.join(testDir, 'model.test.ts');
fs.writeFileSync(testDest, render(fs.readFileSync(path.join(TEMPLATE_DIR, 'model.test.ts'), 'utf8')), 'utf8');
created.push(path.relative(ROOT, testDest));

console.log(`✓ 已创建小游戏 "${displayTitle}"（slug: ${slug}）\n`);
for (const file of created) console.log(`  ${file}`);

/*
 * 顺手更新目录生成物。
 *
 * 少了这一步，用户刚建完游戏跑 `npm run verify` 就会红在 `check:catalog` 上
 * （"生成物与各游戏目录不一致"）—— 那不是他做错了什么，只是两条命令之间还有一步
 * 该由工具代劳。构建时也会自动生成，但"建完立刻可用"才是这条流程该有的手感。
 */
try {
  execFileSync(process.execPath, [path.join(HERE, 'gen-catalog.mjs')], { cwd: ROOT, stdio: 'ignore' });
  console.log('\n✓ 已更新目录生成物（这个游戏现在就在游戏厅首页上）');
} catch (err) {
  console.error('\n⚠ 目录生成物更新失败，请手动跑一次：npm run gen:catalog');
}

console.log(`
接下来（三件事，都不用改 webpack / 首页 / e2e —— 那些由目录驱动）：

  1. 改 src/games/${slug}/meta.json 的 title / tagline / controls / accent
     （title 与 tagline 会直接出现在游戏厅首页的卡片上）

  2. 改 src/games/${slug}/model.ts 的规则，并把 tests/games/${slug}/model.test.ts
     的断言换成你自己规则里最容易写错的那几条

  3. npm run dev        # 自动出现在构建与首页：本机 http://localhost:${PORT}/${slug}.html

三条门禁会自动覆盖这个新游戏（无需登记）：
  npm test              # 规则单测
  npm run check:catalog # 目录生成物是否最新（构建时会自动生成）
  npm run test:e2e      # 逐页冒烟会遍历到它；深交互用例自己写 e2e/${slug}.spec.ts

端口撞了的话用 \`ICE_GAME_PORT\` 覆盖（见 playwright.config.ts 顶部注释）。
`);
