#!/usr/bin/env node
/**
 * 抓 README 用的截图（真 Chrome + 真交互，不是手截）。
 *
 * 改过版面 / 换过引擎版本之后重新跑一次，别手动截图 —— 手截的图会和代码对不上。
 *
 * 用法：
 *   npm run build && npm run screenshots
 *
 * 产出：`screenshots/*.png`（画布元素的截图，不含浏览器外框）。
 * 需要端口空闲（脚本自己起 http-server，跑完自己收；撞了用 `ICE_GAME_PORT` 覆盖）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = Number(process.env.ICE_GAME_PORT || 8098);
const BASE = `http://127.0.0.1:${PORT}`;
const ICON_ORDER = ['computer', 'documents', 'notepad', 'paint', 'minesweeper', 'ie', 'display', 'arcade'];

const RECT_HELPER = `
window.__rect = function (node) {
  let left = 0, top = 0, cursor = node;
  while (cursor && cursor.state) { left += cursor.state.left || 0; top += cursor.state.top || 0; cursor = cursor.parentNode; }
  return { left: left, top: top, width: (node.state && node.state.width) || 0, height: (node.state && node.state.height) || 0 };
};
`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 画布内部坐标 → 页面坐标（引擎按 dpr 放大过 backing store）。 */
async function clickCanvas(page, x, y) {
  const box = await page.locator('canvas').boundingBox();
  const size = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return { width: c.width, height: c.height };
  });
  await page.mouse.click(box.x + (x * box.width) / size.width, box.y + (y * box.height) / size.height);
}

/**
 * 截一张画布。
 *
 * ⚠️ 必须用 **id 选择器**而不是 `page.locator('canvas')`：首页现在有**两块画布**
 * （吸顶导航 `#navbar` + 页面主体 `#canvas`），笼统选 `canvas` 会命中多个元素
 * （strict mode 直接报错，或者更糟：默默截到导航那条 60px 的窄条）。
 */
async function shoot(page, name, canvasId = 'canvas') {
  const file = path.join(OUT, `${name}.png`);
  await page.locator(`#${canvasId}`).screenshot({ path: file });
  const { size } = fs.statSync(file);
  console.log(`  ${name.padEnd(22)} ${(size / 1024).toFixed(0)} KB`);
}

/**
 * 截**视口**（用户实际看到的画面，含固定定位的吸顶导航）。
 *
 * 为什么不用 `fullPage: true`：整页截图在 Chrome 里对 `position: fixed` 元素有渲染偏差 ——
 * 它把 fixed 元素画在顶部一次，于是会**压在正文之上**（实测看起来像"导航盖住了 hero"，
 * 而实际不会）。要看"打开页面时看到什么"，唯一可靠的是视口截图。
 */
async function shootViewport(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  const { size } = fs.statSync(file);
  console.log(`  ${name.padEnd(22)} ${(size / 1024).toFixed(0)} KB  (视口)`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('npx', ['http-server', 'dist', '-p', String(PORT), '-c-1', '--silent'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  // 等端口起来（http-server 没有 ready 回调）
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${BASE}/index.html`);
      if (res.ok) break;
    } catch (err) {
      /* 还没起来，继续等 */
    }
    await wait(250);
  }

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript({ content: RECT_HELPER });
  console.log('抓取截图：');

  // 游戏厅首页：
  //  · home-hero    —— 视口截图（打开页面时看到的：吸顶导航 + hero + 第一行卡片）
  //  · home         —— 主体画布本身（完整内容：卡片网格 + 页脚，不含固定的导航）
  //  · home-navbar  —— 导航条单独一张（1180×60，用于文档里说明它的构成）
  //  · home-footer  —— 滚到底的视口截图（页脚与家族链接）
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__gameHome));
  await wait(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(300);
  await shootViewport(page, 'home-hero');
  await shoot(page, 'home');
  await shoot(page, 'home-navbar', 'navbar');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await wait(600);
  await shootViewport(page, 'home-footer');
  await page.evaluate(() => window.scrollTo(0, 0));

  // 打砖块：待发球（有覆盖层）→ 打掉几块砖（有分数、球在飞）
  await page.goto(`${BASE}/breakout.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__breakout));
  await wait(600);
  await shoot(page, 'breakout-ready');
  await page.evaluate(() => {
    // 走真实 API 打一球拿分：截图里要有分数，而不是一张"0 分"的空场
    const app = window.__breakout;
    app.model.launch();
    for (const index of [2, 11, 20]) {
      const brick = app.model.getAliveBricks()[index];
      if (!brick) continue;
      app.model.setBallForTest(brick.x + brick.width / 2, brick.y + brick.height + 10, 0, -420);
      app.model.step(24);
    }
    app.render();
  });
  await wait(500);
  await shoot(page, 'breakout-playing');

  // 掌机：BIOS 自检 → 卡带
  await page.goto(`${BASE}/arcade.html`, { waitUntil: 'load' });
  await wait(500);
  await shoot(page, 'arcade-bios');
  await page.waitForFunction(() => Boolean(window.__arcade?.game), undefined, { timeout: 30_000 });
  await wait(500);
  await shoot(page, 'arcade-tetris');

  for (const [key, name] of [
    ['snake', 'arcade-snake'],
    ['2048', 'arcade-2048'],
    ['chip8', 'arcade-chip8'],
  ]) {
    const rect = await page.evaluate((k) => window.__rect(window.__arcade.cartridges[k]), key);
    await clickCanvas(page, rect.left + rect.width / 2, rect.top + rect.height / 2);
    await wait(1200);
    await shoot(page, name);
  }

  // XP：开机 → 欢迎屏 → 桌面 → 扫雷
  await page.goto(`${BASE}/windows-xp.html`, { waitUntil: 'load' });
  await wait(400);
  await shoot(page, 'xp-boot');
  await page.waitForFunction(() => Boolean(window.__result));
  for (let i = 0; i < 12; i += 1) {
    const phase = await page.evaluate(() => window.__result.session.phase);
    if (phase === 'desktop') break;
    await page.keyboard.press('Enter');
    await wait(400);
    if (phase === 'login') await shoot(page, 'xp-login');
  }
  await wait(700);
  await shoot(page, 'xp-desktop');

  const rect = await page.evaluate((order) => {
    const tile = window.__result.iconTiles[order.indexOf('minesweeper')];
    return window.__rect(tile);
  }, ICON_ORDER);
  const box = await page.locator('canvas').boundingBox();
  const size = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return { width: c.width, height: c.height };
  });
  await page.mouse.dblclick(
    box.x + ((rect.left + rect.width / 2) * box.width) / size.width,
    box.y + ((rect.top + rect.height / 2) * box.height) / size.height,
  );
  await page.waitForFunction(() => window.__result.openWindows.has('minesweeper'));
  await wait(600);
  await shoot(page, 'xp-minesweeper');

  await browser.close();
  server.kill();
  console.log(`\n截图目录：${path.relative(ROOT, OUT)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
