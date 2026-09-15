#!/usr/bin/env node
/**
 * 生成游戏厅首页的**卡片封面** —— 真跑一遍游戏、抓真实画面，不是手工准备图片。
 *
 * 为什么是"自动抓"而不是"手工放图"：
 * 本仓的定位是**大量**小游戏。手工为每个游戏准备封面，在只有 3 个游戏时看着还行，
 * 到 20 个时必然腐烂（改了玩法忘了重拍、新游戏忘了加图）。这里让封面跟着代码自动更新：
 * 加了游戏 → 跑一次 `npm run covers` → 有了封面；改了玩法 → 再跑一次 → 封面跟着变。
 *
 * 用法：
 *   npm run build && npm run covers            # 全部页面
 *   npm run covers -- breakout                 # 只重拍某些（改了一个游戏时省时间）
 *
 * 产出：`src/home/covers/<slug>.png`（720×405，圆角/描边/光泽已烘进图里）。
 *
 * ## 为什么圆角要"烘"进图里
 * 引擎的 `ICEImage` 只能拉伸绘制、且 `clipType` 只支持圆形（不支持圆角矩形裁剪），
 * 面板也不会裁剪子节点。所以圆角没法在画布上"裁"出来 —— 但离屏画布可以：
 * 生成时用 `clip()` 裁好再导出，PNG 自带透明圆角，画到卡片上就是圆角效果。
 * 同样是这个原因，accent 描边与顶部光泽也一起烘进去。
 *
 * ## 状态由 driver 决定
 * 封面要好看，就得让游戏处于"有内容"的状态（打砖块要有分数、XP 要有开着的窗口）。
 * 每个页面的驱动逻辑写在下面的 `DRIVERS` 里；**没有 driver 的页面也能拿到封面**
 * （默认驱动 = 等它自己画完），所以新游戏不需要为封面写任何代码。
 *
 * 端口与 playwright 同口径（`ICE_GAME_PORT`，默认 8098）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'src', 'home', 'covers');
const CATALOG = path.join(ROOT, 'src', 'domain', 'catalog.generated.json');
const PORT = Number(process.env.ICE_GAME_PORT || 8098);
const BASE = `http://127.0.0.1:${PORT}`;

/** 封面尺寸：16:9，宽度取 720（卡片上显示约 322 宽 → 约 2.2 倍，Retina 也清晰）。 */
const COVER = { width: 720, height: 405, radius: 22, hairline: 3 };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 在浏览器里把游戏画布合成为封面（Playwright 会把函数源码序列化过去执行）。
 *
 * 用 `cover` 语义（等比放大到铺满、居中裁切）而不是 `contain`：
 * 统一裁成 16:9 比留黑边好看，也比拉伸变形正确（`ICEImage` 的绘制是拉伸的，
 * 所以比例必须在生成时就统一）。
 *
 * `options.crop` 指定"从画布的哪一块取景"（画布坐标；缺省 = 整张画布）。
 * 这一项很重要：游戏页的画布上除了游戏区，还有标题、按钮、帮助说明 ——
 * 整张抓下来再 cover 裁切，会把标题栏与按钮行**裁进封面边缘**，看起来像截图没对齐
 * （实测就是这样：封面顶部露出标题残影、底部露出按钮）。
 */
function composeCover(options) {
  const { width, height, radius, hairline, accent, crop } = options;
  const source = document.querySelector('canvas');
  if (!source || !source.width) return null;

  // 取景矩形（默认整张画布）
  const sx = crop ? crop.left : 0;
  const sy = crop ? crop.top : 0;
  const sw = crop ? crop.width : source.width;
  const sh = crop ? crop.height : source.height;

  // 手写圆角路径（不依赖 ctx.roundRect：个别 Chrome 版本没有）
  const roundRect = (ctx, x, y, w, h, r) => {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.arcTo(x + w, y, x + w, y + rad, rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
    ctx.lineTo(x + rad, y + h);
    ctx.arcTo(x, y + h, x, y + h - rad, rad);
    ctx.lineTo(x, y + rad);
    ctx.arcTo(x, y, x + rad, y, rad);
    ctx.closePath();
  };

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');

  // ① 游戏画面（裁进圆角里）
  ctx.save();
  roundRect(ctx, 0, 0, width, height, radius);
  ctx.clip();

  /*
   * 先铺一层深色底。
   *
   * 画布本身是**透明**的（底色由页面 CSS 给），有些游戏页（如打砖块）的画布并没有铺满整屏，
   * 直接导出会让四周留下透明区域 —— 在深色卡片上会露出卡片底色，看起来像"图没贴满"。
   * 铺一层与页面同调的渐变，封面就是完整的一块。
   * 满屏绘制的页面（掌机 / XP）不受影响（会被自己的画面完全覆盖）。
   */
  const base = ctx.createRadialGradient(width / 2, height * 0.24, 0, width / 2, height * 0.24, width * 0.78);
  base.addColorStop(0, '#1b2130');
  base.addColorStop(1, '#080a0f');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const scale = Math.max(width / sw, height / sh);
  const drawWidth = sw * scale;
  const drawHeight = sh * scale;
  ctx.drawImage(source, sx, sy, sw, sh, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

  // ② 顶部光泽：让缩略图有"屏幕玻璃"的质感（很淡，只提亮顶部）
  const sheen = ctx.createLinearGradient(0, 0, 0, height * 0.55);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);

  // ③ 底部压暗：卡片下方紧接文字区，接缝处压暗一点更稳
  const shade = ctx.createLinearGradient(0, height * 0.72, 0, height);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // ④ accent 描边（画在圆角内缘；圆角外已经透明，所以不会露出直角）
  //
  // 透明度压得很低（0.26）：16:9 的封面比画布扁，左右两段描边各占满封面高度，
  // 比上下两段显眼得多 —— 浓了就变成"给每张卡套了个框"，反而压住画面。
  // 这里只想要一层"屏幕边"的暗示，所以宁可淡一点。
  ctx.save();
  roundRect(ctx, hairline / 2, hairline / 2, width - hairline, height - hairline, radius - hairline / 2);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.26;
  ctx.lineWidth = hairline;
  ctx.stroke();
  ctx.restore();

  return out.toDataURL('image/png');
}

/**
 * 各页面的"摆姿势"逻辑。
 *
 * `pose` 让画面处于有内容的状态（打砖块要有分数、XP 要有开着的窗口）；
 * `crop` 指定从画布的哪一块取景（缺省 = 整张画布）。
 *
 * **两者都不是必须的**：没登记的页面走默认（等它自己画完 + 整张画布），
 * 所以新游戏天然就有封面，只是可能停在开场画面。
 */
const DRIVERS = {
  /**
   * 打砖块：要拍到"正在玩"的画面 —— 有分数、砖块有缺口、球在场上。
   *
   * 三个坑（都踩过）：
   *  1. 光调 `model.launch()` 不会收起覆盖层 —— 循环只在**相位跳变**时同步外壳，
   *     所以必须显式调 `syncShell()`，否则封面里是一张盖住整个游戏的"准备好了吗"；
   *  2. 打完砖后球还在飞，**后续帧会继续 step**（页面在跑循环），球可能掉出底部
   *     → 玩家回到"待发球"，封面又变成覆盖层。所以最后要把球摆回场地中部；
   *  3. 取景要**只框住游戏区**（STAGE）。整张画布抓下来会连标题栏与按钮行一起裁进封面。
   */
  breakout: {
    pose: async (page) => {
      await page.evaluate(() => {
        const app = window.__game;
        if (!app) return;
        app.model.launch();

        // 打掉几块砖：封面里就有了分数、缺口与碎砖对比
        for (const index of [2, 11, 20, 29]) {
          const brick = app.model.getAliveBricks()[index];
          if (!brick) continue;
          app.model.setBallForTest(brick.x + brick.width / 2, brick.y + brick.height + 10, 0, -420);
          app.model.step(24);
        }

        // 把球放回场地中部、朝右上飞：既在画面里，又能在拍图前的这段时间留在场上
        app.model.setBallForTest(app.stage.width * 0.42, app.stage.height * 0.62, 260, -300);
        app.syncShell(); // 收起覆盖层（否则封面被"准备好了吗"盖住）
        app.render();
      });
      await wait(320);
    },
    crop: () => {
      const stage = window.__game.stage;
      // 上下各外扩 24px：cover 到 16:9 时会裁掉上下各约 40px，
      // 外扩后正好让砖块（顶部）与挡板（底部）都完整留在画面里。
      return { left: stage.left, top: stage.top - 24, width: stage.width, height: stage.height + 48 };
    },
  },

  /** 掌机：等 BIOS 自检跑完、卡带真的转起来（画面里是俄罗斯方块）。整机外观本身就好看，不裁。 */
  arcade: {
    pose: async (page) => {
      await page.waitForFunction(() => Boolean(window.__arcade && window.__arcade.game), undefined, {
        timeout: 30_000,
      });
      await wait(900);
      // 掰两下方向键：棋盘上落下几块，封面比空盘子好看
      for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight']) {
        await page.keyboard.press(key);
        await wait(160);
      }
      await wait(500);
    },
  },

  /** XP：一路开机到桌面，再开一个扫雷窗口（桌面 + 窗口 = 最像 XP 的一帧）。 */
  'windows-xp': {
    pose: async (page) => {
      await page.waitForFunction(() => Boolean(window.__result));
      for (let i = 0; i < 14; i += 1) {
        const phase = await page.evaluate(() => window.__result.session.phase);
        if (phase === 'desktop') break;
        await page.keyboard.press('Enter');
        await wait(380);
      }
      await page.evaluate(() => {
        const result = window.__result;
        if (!result || typeof result.openApp !== 'function') return;
        // ⚠️ `openApp` 收的是 **app 对象**（它内部要调 `app.build()`），不是 key 字符串。
        // 传字符串会报 `t.build is not a function`（实测踩过）。
        const app = (result.APPS || []).find((item) => item.key === 'minesweeper');
        if (app) result.openApp(app);
      });
      await wait(900);
    },
  },
};

/** 读取目录生成物（页面清单的权威来源；比再解析一次目录更省事）。 */
function readCatalog() {
  if (!fs.existsSync(CATALOG)) {
    throw new Error(`缺少 ${path.relative(ROOT, CATALOG)}，先跑 npm run gen:catalog`);
  }
  return JSON.parse(fs.readFileSync(CATALOG, 'utf8')).pages;
}

async function main() {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const pages = readCatalog().filter((page) => !only.length || only.includes(page.slug));

  if (!pages.length) {
    console.error(`没有匹配的页面${only.length ? `：${only.join('、')}` : ''}`);
    process.exit(1);
  }

  // 必须是构建后的产物：封面抓的是 dist 里的页面
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('缺少 dist/，先跑 npm run build（封面抓的是构建产物）');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = spawn('npx', ['http-server', 'dist', '-p', String(PORT), '-c-1', '--silent'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i += 1) {
    try {
      if ((await fetch(`${BASE}/index.html`)).ok) break;
    } catch (err) {
      /* 还没起来，继续等 */
    }
    await wait(250);
  }

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  console.log('抓封面：');

  let failed = 0;
  for (const meta of pages) {
    const errors = [];
    page.removeAllListeners('pageerror');
    page.removeAllListeners('console');
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    try {
      await page.goto(`${BASE}/${meta.page}`, { waitUntil: 'load' });
      // 先给它一点时间画出第一帧，再决定要不要摆姿势
      await wait(1100);
      const driver = DRIVERS[meta.slug];
      if (driver && driver.pose) await driver.pose(page);
      await wait(400);

      // 取景：driver 声明了就只在那一块取（避免把标题/按钮裁进封面）
      let crop = null;
      if (driver && driver.crop) {
        crop = await page.evaluate(driver.crop);
      }

      const dataUrl = await page.evaluate(composeCover, { ...COVER, accent: meta.accent, crop });
      if (!dataUrl) throw new Error('画布是空的，抓不到画面');

      const file = path.join(OUT_DIR, `${meta.slug}.png`);
      fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      const kb = (fs.statSync(file).size / 1024).toFixed(0);
      console.log(`  ✓ ${meta.slug.padEnd(16)} ${COVER.width}×${COVER.height}  ${kb.padStart(4)} KB`);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${meta.slug.padEnd(16)} ${String(err.message).split('\n')[0]}`);
    }
    if (errors.length) {
      console.log(`      页面有 ${errors.length} 条报错（封面可能不对）：${errors[0].slice(0, 100)}`);
    }
  }

  await browser.close();
  server.kill();

  console.log(`\n封面目录：${path.relative(ROOT, OUT_DIR)}/`);
  // 目录生成物里带 cover 标记（首页据此决定显示封面还是占位），所以要跟着刷新
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [path.join(HERE, 'gen-catalog.mjs')], { cwd: ROOT, stdio: 'inherit' });

  if (failed) {
    console.error(`\n有 ${failed} 个页面没抓到封面。`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
