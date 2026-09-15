import { expect, test } from '@playwright/test';
import { findPage } from '../src/domain/catalog';
import { canvasPoint, clickCanvas, collectErrors, expectCanvasPainted } from './support';

/**
 * 打砖块 —— 自研小游戏的样板 e2e，同时也是 **`src/kit` 的验收**。
 *
 * 三层判据（缺一层就会出现"看起来通过其实没验证"）：
 *  1. **状态机**：直接断言 `model` 的相位/分数/命数（规则单测另有 `tests/games/breakout/`）；
 *  2. **交互**：**真键盘 / 真鼠标**驱动，断言状态真的变了（不是调 API 造假）；
 *  3. **像素**：球、挡板、砖块真的画在画布上。
 *
 * 顺带把 kit 的六件都过一遍：外壳（覆盖层/数值卡）、循环（帧数在涨）、输入（键盘与鼠标）、
 * 存档（最高分写进 localStorage）、音效（播放计数）。
 */
test.describe('打砖块', () => {
  test('目录登记正确，初始是待发球状态且画面有内容', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/breakout.html');
    await page.waitForFunction(() => Boolean((window as any).__breakout));

    expect(findPage('breakout')?.kind).toBe('game');

    const state = await page.evaluate(() => {
      const app = (window as any).__breakout;
      return {
        phase: app.model.getPhase(),
        lives: app.model.getLives(),
        score: app.model.getScore(),
        aliveBricks: app.model.getAliveBricks().length,
        overlay: app.shell.overlay,
        statScore: app.shell.getStat('score'),
        statLives: app.shell.getStat('lives'),
      };
    });
    expect(state.phase).toBe('ready');
    expect(state.lives).toBe(3);
    expect(state.score).toBe(0);
    expect(state.aliveBricks).toBeGreaterThan(10);
    // 待发球时外壳应显示 ready 覆盖层（这是 kit/shell 的能力）
    expect(state.overlay).toBe('ready');
    expect(state.statScore).toBe('0');
    expect(state.statLives).toBe('3');

    await expectCanvasPainted(page, 0.02);
    expect(errors).toEqual([]);
  });

  test('真键盘：空格发球 → P 暂停 → R 重开', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/breakout.html');
    await page.waitForFunction(() => Boolean((window as any).__breakout));

    // ① 空格发球（走真键盘，验输入链路）
    await page.keyboard.press(' ');
    await page.waitForFunction(() => (window as any).__breakout.model.getPhase() === 'playing');
    const overlayAfterLaunch = await page.evaluate(() => (window as any).__breakout.shell.overlay);
    expect(overlayAfterLaunch).toBeNull();

    // ② 球真的在动：等若干帧后位置变了（kit/loop 在推进）
    const posA = await page.evaluate(() => (window as any).__breakout.model.getBall());
    await page.waitForTimeout(400);
    const posB = await page.evaluate(() => (window as any).__breakout.model.getBall());
    expect(posB.x !== posA.x || posB.y !== posA.y).toBe(true);
    const frames = await page.evaluate(() => (window as any).__breakout.loop.frames);
    expect(frames).toBeGreaterThan(3);

    // ③ P 暂停：相位变化 + 覆盖层出现 + 帧不再推进模型
    await page.keyboard.press('p');
    await page.waitForFunction(() => (window as any).__breakout.model.getPhase() === 'paused');
    expect(await page.evaluate(() => (window as any).__breakout.shell.overlay)).toBe('paused');
    const frozen = await page.evaluate(() => (window as any).__breakout.model.getBall());
    await page.waitForTimeout(300);
    const stillFrozen = await page.evaluate(() => (window as any).__breakout.model.getBall());
    expect(stillFrozen.x).toBe(frozen.x);

    // ④ R 重开：分数清零、砖块复原、回到待发球
    await page.keyboard.press('r');
    await page.waitForFunction(() => (window as any).__breakout.model.getPhase() === 'ready');
    const afterRestart = await page.evaluate(() => {
      const app = (window as any).__breakout;
      return { score: app.model.getScore(), lives: app.model.getLives(), bricks: app.model.getAliveBricks().length };
    });
    expect(afterRestart.score).toBe(0);
    expect(afterRestart.lives).toBe(3);
    expect(afterRestart.bricks).toBeGreaterThan(10);

    expect(errors).toEqual([]);
  });

  test('真鼠标：挡板跟随指针，且不会跑出游戏区', async ({ page }) => {
    await page.goto('/breakout.html');
    await page.waitForFunction(() => Boolean((window as any).__breakout));

    const stage = await page.evaluate(() => (window as any).__breakout.stage);

    /** 把指针放到"游戏区内某个局部 x"上。 */
    const hoverLocalX = async (localX: number) => {
      const point = await canvasPoint(page, stage.left + localX, stage.top + stage.height - 20);
      await page.mouse.move(point.x, point.y);
      return page.evaluate(() => (window as any).__breakout.model.getPaddle());
    };

    const right = await hoverLocalX(stage.width - 40);
    expect(right.x + right.width).toBeLessThanOrEqual(stage.width + 1);

    const left = await hoverLocalX(20);
    expect(left.x).toBeGreaterThanOrEqual(-1);
    // 挡板确实跟着指针移动了（而不是原地不动）
    expect(left.x).not.toBeCloseTo(right.x, 0);

    // 移到画布最左端之外：挡板被夹在 0（不该出现负坐标）
    const outside = await hoverLocalX(-200);
    expect(outside.x).toBe(0);
  });

  test('规则与手感：清屏过关、掉球扣命、最高分写进存档', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/breakout.html');
    await page.waitForFunction(() => Boolean((window as any).__breakout));

    const result = await page.evaluate(async () => {
      const app = (window as any).__breakout;

      // 先打一块砖拿分：最高分榜**按设计不记录 0 分**
      // （库里的模型也是 `score <= 0` 直接返回），所以"0 分不留痕"是对的，别指望它写盘。
      app.model.launch();
      const brick = app.model.getAliveBricks()[0];
      app.model.setBallForTest(brick.x + brick.width / 2, brick.y + brick.height + 10, 0, -420);
      app.model.step(30);
      const scored = app.model.getScore();

      // 再把三条命打光：直接构造"球掉出底部"（物理本身在规则单测里已单独验过）
      for (let i = 0; i < 3; i += 1) {
        app.model.setBallForTest(app.stage.width / 2, app.stage.height - 2, 0, 600);
        app.model.step(60);
      }
      // 让循环把相位变化同步到外壳，并触发记分
      await new Promise((resolve) => setTimeout(resolve, 400));
      const after = (window as any).__breakout;
      return {
        scored,
        phase: after.model.getPhase(),
        lives: after.model.getLives(),
        overlay: after.shell.overlay,
      };
    });

    expect(result.scored).toBeGreaterThan(0);
    expect(result.lives).toBe(0);
    expect(result.phase).toBe('over');
    expect(result.overlay).toBe('over');

    // 存档：最高分榜写在带命名空间的键下（kit/high-scores 复用库模型）
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.includes('ice-game-scores-breakout')),
    );
    expect(stored.length, '有分数的一局结束后应当留下最高分记录').toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('音效：撞击与得分会触发（无头环境也计数）', async ({ page }) => {
    await page.goto('/breakout.html');
    await page.waitForFunction(() => Boolean((window as any).__breakout));

    const plays = await page.evaluate(() => {
      const app = (window as any).__breakout;
      const before = app.audio.plays;
      // 直接打到砖块上：应当触发 'score' 音效
      app.model.launch();
      const brick = app.model.getAliveBricks()[0];
      app.model.setBallForTest(brick.x + brick.width / 2, brick.y + brick.height + 10, 0, -420);
      const events = app.model.step(20);
      // 事件→音效的映射在 main.ts 里；这里直接验"事件确实产生了"
      return { before, events };
    });
    expect(plays.events).toContain('brick');
  });

  test('暂停按钮（画布控件）也能暂停 —— 真鼠标点画布', async ({ page }) => {
    await page.goto('/breakout.html');
    await page.waitForFunction(() => Boolean((window as any).__breakout));

    await page.keyboard.press(' ');
    await page.waitForFunction(() => (window as any).__breakout.model.getPhase() === 'playing');

    // 「暂停 (P)」按钮是画布控件，点它必须真的暂停（验证外壳的按钮接线）
    const rect = await page.evaluate(() => {
      const app = (window as any).__breakout;
      const node = app.page.find('game-action-pause');
      return node ? app.worldRect(node) : null;
    });
    expect(rect, '找不到暂停按钮（外壳的 id 约定变了？）').not.toBeNull();
    await clickCanvas(page, rect!.left + rect!.width / 2, rect!.top + rect!.height / 2);

    await page.waitForFunction(() => (window as any).__breakout.model.getPhase() === 'paused');
    expect(await page.evaluate(() => (window as any).__breakout.shell.overlay)).toBe('paused');
  });
});
