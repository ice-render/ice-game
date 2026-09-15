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

async function shoot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.locator('canvas').screenshot({ path: file });
  const { size } = fs.statSync(file);
  console.log(`  ${name.padEnd(22)} ${(size / 1024).toFixed(0)} KB`);
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

  // 游戏厅首页
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__gameHome));
  await wait(600);
  await shoot(page, 'home');

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
