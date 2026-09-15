// @ts-nocheck
/**
 * ⚠️ 生成物，禁止手改：正文由 `scripts/sync-upstream.mjs` 从
 *    `../ice-web-components/examples/arcade.html` 的内联 <script> 正文**逐字**抽取。
 *    要改玩法请改上游页，然后 `npm run sync:upstream`。
 *
 * 与上游页的唯一差异 = 下面两行 import：上游靠 <script src="…umd.js"> 把 `ICE` / `ICEWEB`
 * 挂在 window 上，这里改成模块引入 —— `import * as` 拿到的命名空间对象与 UMD 全局**形状一致**
 * （`ICE.ICE`、`ICE.ICEBoxLayout`、`ICEWEB.ICEPanel` 照旧），所以正文一字不用改。
 *
 * 类型检查用 `@ts-nocheck` 关掉：这是上游的 JS 正文，"保持逐字"比"通过 strict 检查"重要。
 * 本仓的类型门禁落在 `src/domain`（纯逻辑）与 `src/home`（自己写的画布首页）上。
 */
import * as ICE from 'ice-render';
import * as ICEWEB from 'ice-web-components';

      /**
       * ICE Arcade —— 一台掌机，多个卡带。
       *
       * 机壳、屏幕框、HUD 卡片、按键、音效开关全是 ICE 组件，画面里没有一个位图资源。
       * 游戏规则一律落在**纯逻辑模型**里（`ICETetrisModel` / `ICESnakeModel`，各自有单测），
       * 页面只负责三件事：读模型画格子、按节奏调 `tick()`、把键盘翻译成模型调用。
       *
       * 卡带通过 `GAMES` 注册表插拔：每个卡带 mount() 出自己的棋盘与侧栏，返回同一套运行时
       * 契约（model / paint / hud / keydown / frame / setOverlay / destroy），换卡带就是
       * 「销毁旧的 → 建新的 → 重画 HUD」。
       *
       * 注意：这一页**不启动** `ICEFocusManager` —— 它会用 Enter/Space 激活「有焦点的按钮」，
       * 正好和游戏按键打架。游戏页把键盘完全留给自己，鼠标 hover 仍由 `ICEHoverManager` 接管。
       */
      (() => {
        'use strict';
        const W = ICEWEB;
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const ice = new ICE.ICE().init('canvas', { dpr });
        // 街机主题：HUD 卡片、按钮、开关、**以及方块与蛇的配色**都走同一套 token
        W.iceUIManager.registerTheme('arcade', W.ICE_ARCADE_THEME).setTheme('arcade', ice); // 第二个参数 = 顺带把主题同步到引擎（选中框 / 手柄 / 插槽等外壳 token）
        const theme = W.iceUIManager.getTheme();
        new W.ICEHoverManager(ice).start();

        /* --------------------------------- 配色 --------------------------------- */

        /**
         * 棋盘调色板直接取库里的 token（`ICE_ARCADE_PALETTE`）：
         * 方块 7 种 + 蛇头 / 蛇身 / 食物都是主题的一部分，换主题时游戏美术跟着换。
         */
        const PALETTE = W.ICE_ARCADE_PALETTE;

        const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        /** t < 0 变暗、t > 0 变亮。 */
        const shade = (hex, t) => {
          const [r, g, b] = hexToRgb(hex);
          const mix = (v) => Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t);
          return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
        };
        const alpha = (hex, a) => {
          const [r, g, b] = hexToRgb(hex);
          return `rgba(${r}, ${g}, ${b}, ${a})`;
        };

        /* --------------------------------- 音效（WebAudio 合成，零音频文件） --------------------------------- */

        const sound = { enabled: true, ctx: null, lastCue: null, cues: 0 };
        const audioCtx = () => {
          try {
            if (!sound.ctx) {
              const Ctor = window.AudioContext || window.webkitAudioContext;
              if (!Ctor) return null;
              sound.ctx = new Ctor();
            }
            if (sound.ctx.state === 'suspended' && sound.ctx.resume) sound.ctx.resume();
            return sound.ctx;
          } catch (err) {
            return null;
          }
        };
        const beep = (freq, ms, type = 'square', gain = 0.04, at = 0) => {
          if (!sound.enabled) return;
          try {
            const ctx = audioCtx();
            if (!ctx) return;
            const osc = ctx.createOscillator();
            const amp = ctx.createGain();
            const startAt = ctx.currentTime + at;
            const endAt = startAt + ms / 1000;
            osc.type = type;
            osc.frequency.value = freq;
            amp.gain.setValueAtTime(0.0001, startAt);
            amp.gain.exponentialRampToValueAtTime(gain, startAt + 0.012);
            amp.gain.exponentialRampToValueAtTime(0.0001, endAt);
            osc.connect(amp);
            amp.connect(ctx.destination);
            osc.start(startAt);
            osc.stop(endAt + 0.02);
          } catch (err) {
            /* 没有音频设备（headless）时静默降级 */
          }
        };
        const CUES = {
          turn: () => beep(380, 40, 'square', 0.02),
          lock: () => beep(180, 70, 'square', 0.03),
          drop: () => beep(150, 90, 'triangle', 0.035),
          line: (rows) => {
            beep(rows >= 4 ? 880 : 660, 130, 'triangle', 0.05);
            if (rows >= 2) beep(rows >= 4 ? 1170 : 990, 120, 'triangle', 0.04, 0.09);
          },
          levelup: () => {
            beep(520, 90, 'square', 0.04);
            beep(780, 120, 'square', 0.04, 0.09);
          },
          eat: () => beep(720, 60, 'triangle', 0.045),
          over: () => {
            beep(220, 200, 'sawtooth', 0.05);
            beep(150, 320, 'sawtooth', 0.05, 0.18);
          },
        };
        const playCue = (name, arg) => {
          if (!sound.enabled || !CUES[name]) return;
          sound.lastCue = name;
          sound.cues += 1;
          CUES[name](arg);
        };

        /* --------------------------------- 机壳与屏幕 --------------------------------- */

        const BEZEL = { left: 70, top: 90, width: 420, height: 600 };
        const COLUMN_X = 530;
        const COLUMN_W = 620;

        const shell = new W.ICEWidget({
          id: 'arcade-cabinet',
          left: 30,
          top: 30,
          width: 1120,
          height: 740,
          radius: 34,
          fill: true,
          stroke: true,
          interactive: false,
          style: {
            fillStyle: '#232a36',
            strokeStyle: '#39424f',
            lineWidth: 2,
            shadowColor: 'rgba(0, 0, 0, 0.55)',
            shadowBlur: 30,
            shadowOffsetX: 0,
            shadowOffsetY: 16,
          },
        });
        const shellHighlight = new W.ICEWidget({
          left: 40,
          top: 40,
          width: 1080,
          height: 2,
          radius: 1,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: 'rgba(255, 255, 255, 0.16)' },
        });
        const bezel = new W.ICEWidget({
          id: 'arcade-bezel',
          left: BEZEL.left,
          top: BEZEL.top,
          width: BEZEL.width,
          height: BEZEL.height,
          radius: 20,
          fill: true,
          stroke: true,
          interactive: false,
          style: { fillStyle: '#0d1117', strokeStyle: '#141a24', lineWidth: 2 },
        });
        /** 卡带自己的画面都挂在 screen 里（相对坐标），换卡带就清空重建。 */
        const screen = new W.ICEWidget({
          id: 'arcade-screen',
          left: BEZEL.left + 10,
          top: BEZEL.top + 10,
          width: BEZEL.width - 20,
          height: BEZEL.height - 20,
          fill: false,
          stroke: false,
          interactive: false,
        });
        /** 屏幕正中的提示层（暂停 / 结束），由卡带按自己的棋盘尺寸调用。 */
        const messageBox = (id, area, title, hint, color) => {
          const box = new W.ICEWidget({
            id,
            left: area.left,
            top: area.top,
            width: area.width,
            height: area.height,
            fill: true,
            stroke: false,
            display: false,
            interactive: false,
            style: { fillStyle: 'rgba(8, 11, 16, 0.84)' },
          });
          const titleLabel = new W.ICELabel({
            interactive: false,
            left: 0,
            top: 16,
            width: area.width,
            height: 34,
            text: title,
            align: 'center',
            verticalAlign: 'middle',
            style: { fontSize: 24, fontWeight: '700', fillStyle: color },
          });
          const hintLabel = new W.ICELabel({
            interactive: false,
            left: 0,
            top: 52,
            width: area.width,
            height: 20,
            text: hint,
            align: 'center',
            verticalAlign: 'middle',
            style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
          });
          box.addChild(titleLabel, false);
          box.addChild(hintLabel, false);
          screen.addChild(box, false);
          return box;
        };

        /* --------------------------------- 右侧 HUD --------------------------------- */

        const title = new W.ICELabel({
          interactive: false,
          left: COLUMN_X,
          top: 74,
          width: COLUMN_W,
          height: 40,
          text: 'ICE ARCADE',
          style: { fontSize: 32, fontWeight: '700', fillStyle: '#f8f9fa' },
        });
        const subtitle = new W.ICELabel({
          id: 'arcade-subtitle',
          interactive: false,
          left: COLUMN_X,
          top: 116,
          width: COLUMN_W,
          height: 20,
          text: '',
          style: { fontSize: 13, fillStyle: theme.colors.textSecondary },
        });

        const card = (id, left, top, width, caption) => {
          const panel = new W.ICEPanel({ left, top, width, height: 104, interactive: false });
          const captionLabel = new W.ICELabel({
            interactive: false,
            left: 16,
            top: 14,
            width: width - 32,
            height: 18,
            text: caption,
            style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
          });
          const value = new W.ICELabel({
            id,
            interactive: false,
            left: 16,
            top: 40,
            width: width - 32,
            height: 44,
            text: '0',
            align: 'left',
            verticalAlign: 'middle',
            style: { fontSize: 30, fontWeight: '700', fontFamily: '"Courier New", monospace', fillStyle: '#f8f9fa' },
          });
          panel.addChild(captionLabel, false);
          panel.addChild(value, false);
          return { panel, caption: captionLabel, value };
        };
        const scoreCard = card('arcade-score', COLUMN_X, 200, 300, '得分 SCORE');
        const midCard = card('arcade-mid', 850, 200, 140, '');
        const rightCard = card('arcade-right', 1010, 200, 140, '');

        const progressPanel = new W.ICEPanel({ left: COLUMN_X, top: 324, width: COLUMN_W, height: 76, interactive: false });
        const progressCaption = new W.ICELabel({
          interactive: false,
          left: 16,
          top: 14,
          width: 220,
          height: 18,
          text: '升级进度',
          style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
        });
        const progressBar = new W.ICEProgressBar({
          id: 'arcade-progress',
          left: 16,
          top: 42,
          width: 440,
          height: 14,
          max: 10,
          value: 0,
          showText: false,
          interactive: false,
        });
        const progressLabel = new W.ICELabel({
          id: 'arcade-progress-label',
          interactive: false,
          left: 496,
          top: 30,
          width: 108,
          height: 38,
          text: '',
          align: 'right',
          verticalAlign: 'middle',
          style: { fontSize: 13, fillStyle: theme.colors.textSecondary },
        });
        progressPanel.addChild(progressCaption, false);
        progressPanel.addChild(progressBar, false);
        progressPanel.addChild(progressLabel, false);

        const sidePanel = new W.ICEPanel({ left: COLUMN_X, top: 420, width: 300, height: 196, interactive: false });
        const sideCaption = new W.ICELabel({
          interactive: false,
          left: 16,
          top: 14,
          width: 268,
          height: 18,
          text: '',
          style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
        });
        /** 卡带的侧栏内容挂在 sideBody 里。 */
        const sideBody = new W.ICEWidget({
          id: 'arcade-side-body',
          left: 16,
          top: 44,
          width: 268,
          height: 136,
          fill: false,
          stroke: false,
          interactive: false,
        });
        sidePanel.addChild(sideCaption, false);
        sidePanel.addChild(sideBody, false);

        /**
         * 侧栏「项名 / 值」两列行：行距 4，项名 60 + 缝 2 + 值 206。
         *
         * 四块卡带的侧栏原来各自抄了一遍 `top: index * 26` + 逐行 addChild ——
         * 现在只留「一张纵向 BoxLayout + 每行一张横向 BoxLayout」，返回值标签供刷新用。
         */
        const createInfoRows = (parent) => {
          const host = new W.ICEWidget({ left: 0, top: 0, width: 268, height: 82, fill: false, stroke: false, interactive: false });
          host.setLayout(new ICE.ICEBoxLayout({ axis: 'y', gap: 4 }));
          parent.addChild(host, false);
          return {
            host,
            add(label, value) {
              const row = new W.ICEWidget({ width: 268, height: 22, fill: false, stroke: false, interactive: false });
              row.setLayout(new ICE.ICEBoxLayout({ axis: 'x', gap: 2 }));
              const key = new W.ICELabel({
                interactive: false,
                width: 60,
                height: 22,
                text: label,
                verticalAlign: 'middle',
                style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
              });
              const val = new W.ICELabel({
                interactive: false,
                width: 206,
                height: 22,
                text: value,
                verticalAlign: 'middle',
                style: { fontSize: 12, fontFamily: '"Courier New", monospace', fillStyle: theme.colors.text },
              });
              row.addChild(key, false);
              row.addChild(val, false);
              host.addChild(row, false);
              return val;
            },
          };
        };

        const helpPanel = new W.ICEPanel({ left: 850, top: 420, width: 300, height: 196, interactive: false });
        const helpCaption = new W.ICELabel({
          interactive: false,
          left: 16,
          top: 14,
          width: 268,
          height: 18,
          text: '操作 CONTROLS',
          style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
        });
        const helpBody = new W.ICEWidget({
          id: 'arcade-help-body',
          left: 16,
          top: 42,
          width: 268,
          height: 144,
          fill: false,
          stroke: false,
          interactive: false,
        });
        helpPanel.addChild(helpCaption, false);
        helpPanel.addChild(helpBody, false);
        /** 说明行容器：一行 = 「按键 96 + 缝 8 + 说明 164」，行距 4 —— 两列与行距都交给 BoxLayout。 */
        const helpRows = new W.ICEWidget({ left: 0, top: 0, width: 268, height: 144, fill: false, stroke: false, interactive: false });
        helpRows.setLayout(new ICE.ICEBoxLayout({ axis: 'y', gap: 4 }));
        helpBody.addChild(helpRows, false);
        /** 按「按键 / 说明」两列铺一组说明（等宽字体 + 固定列宽，不用空格硬凑）。 */
        const setHelpRows = (rows) => {
          helpRows.removeChildren([...helpRows.childNodes]);
          rows.forEach(([keys, desc]) => {
            const row = new W.ICEWidget({ width: 268, height: 20, fill: false, stroke: false, interactive: false });
            row.setLayout(new ICE.ICEBoxLayout({ axis: 'x', gap: 8 }));
            const keyLabel = new W.ICELabel({
              interactive: false,
              width: 96,
              height: 20,
              text: keys,
              style: { fontSize: 13, fontFamily: '"Courier New", monospace', fillStyle: theme.colors.text },
            });
            const descLabel = new W.ICELabel({
              interactive: false,
              width: 164,
              height: 20,
              text: desc,
              style: { fontSize: 13, fillStyle: theme.colors.textSecondary },
            });
            row.addChild(keyLabel, false);
            row.addChild(descLabel, false);
            helpRows.addChild(row, false);
          });
        };

        /** 底部这一排四颗按钮 + 音效开关，正好按 20px 缝铺满 COLUMN_W。 */
        const ACTION_W = 108;
        /** 这一排四颗按钮（108 宽 + 10 间距）→ 横向 BoxLayout，不必再写 `COLUMN_X + i * 118`。 */
        const actionRow = new W.ICEWidget({
          id: 'arcade-actions',
          left: COLUMN_X,
          top: 636,
          width: ACTION_W * 4 + 10 * 3,
          height: 40,
          fill: false,
          stroke: false,
          interactive: false,
        });
        actionRow.setLayout(new ICE.ICEBoxLayout({ axis: 'x', gap: 10 }));
        const pauseButton = new W.ICEButton({ id: 'arcade-pause', width: ACTION_W, height: 40, text: '暂停 (P)' });
        const restartButton = new W.ICEButton({
          id: 'arcade-restart',
          width: ACTION_W,
          height: 40,
          text: '重开 (R)',
          variant: 'default',
        });
        const leaderboardButton = new W.ICEButton({
          id: 'arcade-leaderboard',
          width: ACTION_W,
          height: 40,
          text: '排行榜 (L)',
          variant: 'default',
        });
        const biosButton = new W.ICEButton({
          id: 'arcade-bios',
          width: ACTION_W,
          height: 40,
          text: 'BIOS (F2)',
          variant: 'default',
        });
        [pauseButton, restartButton, leaderboardButton, biosButton].forEach((button) => actionRow.addChild(button));
        const soundSwitch = new W.ICESwitch({ id: 'arcade-sound', left: 1010, top: 645, width: 46, height: 22, selected: true });
        const soundLabel = new W.ICELabel({
          interactive: false,
          left: 1062,
          top: 645,
          width: 88,
          height: 22,
          text: '音效',
          verticalAlign: 'middle',
          style: { fontSize: 13, fillStyle: theme.colors.text },
        });
        // 最高分挪到副标题那一行（右侧对齐），把底部这排留给按钮
        const bestLabel = new W.ICELabel({
          id: 'arcade-best',
          interactive: false,
          left: COLUMN_X + COLUMN_W - 200,
          top: 116,
          width: 200,
          height: 20,
          text: '最高分 0',
          align: 'right',
          verticalAlign: 'middle',
          style: { fontSize: 13, fillStyle: theme.colors.textSecondary },
        });
        const footer = new W.ICELabel({
          interactive: false,
          left: COLUMN_X,
          top: 696,
          width: COLUMN_W,
          height: 20,
          text: '五个纯逻辑模型（ICETetrisModel / ICESnakeModel / ICE2048Model / ICEChip8Model / ICEBiosModel）+ ICE 组件绘制 · 规则与渲染完全解耦',
          style: { fontSize: 12, fillStyle: theme.colors.textTertiary },
        });
        soundSwitch.on('change', () => {
          sound.enabled = soundSwitch.isSelected();
        });

        /* --------------------------------- 卡带注册表 --------------------------------- */

        /* 每个卡带的 mount(ctx) 返回同一套运行时契约：
         *   model                 主模型（页面负责挂 change 监听 → refresh）
         *   paint()               重画自己的画面
         *   hud()                 { score, mid, right, progress: { value, text } }
         *   keydown(key, repeat)  键盘（P / R 由页面统一处理）
         *   frame(dt, now)        每帧：重力 / 步进
         *   setOverlay(paused, over)
         *   destroy()             换卡带时清理监听与节点
         */
        const GAMES = {
          tetris: {
            key: 'tetris',
            name: '俄罗斯方块',
            subtitle: '第 1 弹 · 俄罗斯方块 · 7-bag 公平随机',
            hud: { mid: '消行 LINES', right: '等级 LEVEL' },
            side: '下一批 NEXT',
            help: [
              ['← / →', '左右移动'],
              ['↓', '软降（+1/格）'],
              ['空格', '硬降（+2/格）'],
              ['↑ 或 X', '顺时针旋转'],
              ['Z', '逆时针旋转'],
              ['P / R', '暂停 / 重开'],
            ],
            mount(ctx) {
              const COLS = 10;
              const ROWS = 20;
              const CELL = 26;
              const boardW = COLS * CELL;
              const boardH = ROWS * CELL;
              const originX = Math.round((ctx.screen.state.width - boardW) / 2);
              const originY = 30;
              // 整块棋盘就是**一个** ICETileMap 节点：底板 + 200 个格子都在它的 doRender 里自绘
              const board = new W.ICETileMap({
                id: 'tetris-board',
                left: originX,
                top: originY,
                rows: ROWS,
                cols: COLS,
                cellSize: CELL,
                gap: 2,
                cellRadius: 5,
                palette: PALETTE,
                fill: true,
                stroke: true,
                interactive: false,
                style: { fillStyle: '#12161d', strokeStyle: '#1f2733', lineWidth: 2 },
                highlightColor: 'rgba(255, 255, 255, 0.4)',
              });
              ctx.screen.addChild(board, false);
              const allCells = [];
              for (let row = 0; row < ROWS; row += 1) {
                for (let col = 0; col < COLS; col += 1) allCells.push({ row, col });
              }
              const pauseBox = ctx.messageBox(
                'tetris-paused',
                { left: originX, top: originY + boardH / 2 - 46, width: boardW, height: 92 },
                '已暂停',
                '按 P 继续',
                theme.colors.warning,
              );
              const overBox = ctx.messageBox(
                'tetris-over',
                { left: originX, top: originY + boardH / 2 - 46, width: boardW, height: 92 },
                'GAME OVER',
                '按 R 再开一局',
                theme.colors.error,
              );

              /** 侧栏：三个 NEXT 预览槽（每槽 4 个小格）。 */
              const PREVIEW_CELL = 15;
              /** 三个预览槽是一行（84 宽 + 8 缝）→ 横向 BoxLayout。 */
              const slotRow = new W.ICEWidget({ left: 0, top: 0, width: 268, height: 132, fill: false, stroke: false, interactive: false });
              slotRow.setLayout(new ICE.ICEBoxLayout({ axis: 'x', gap: 8 }));
              ctx.sideBody.addChild(slotRow, false);
              const slots = [0, 1, 2].map((index) => {
                const slot = new W.ICEWidget({
                  id: `tetris-next-${index}`,
                  width: 84,
                  height: 132,
                  radius: 10,
                  fill: true,
                  stroke: true,
                  interactive: false,
                  style: { fillStyle: '#12161d', strokeStyle: '#232b36', lineWidth: 1 },
                });
                const previewCells = [];
                for (let i = 0; i < 4; i += 1) {
                  const cell = new W.ICEWidget({
                    left: 0,
                    top: 0,
                    width: PREVIEW_CELL - 2,
                    height: PREVIEW_CELL - 2,
                    radius: 3,
                    fill: true,
                    stroke: true,
                    display: false,
                    interactive: false,
                    style: { fillStyle: '#0d1117', strokeStyle: '#0d1117', lineWidth: 1 },
                  });
                  slot.addChild(cell, false);
                  previewCells.push(cell);
                }
                slotRow.addChild(slot, false);
                return { slot, cells: previewCells };
              });

              const model = new W.ICETetrisModel({ rows: ROWS, cols: COLS });
              const state = {
                level: model.getLevel(),
                lines: 0,
                over: false,
                piece: null,
                accumulator: 0,
                previewKey: '',
                combo: 0,
                pausedShown: false,
                overShown: false,
              };

              /** NEXT 预览的小格子也走同一套调色板（它们是真·子节点，4 个一组，量很小）。 */
              const paintPreviewCell = (node, type) => {
                const style = PALETTE[type] || { fillStyle: '#adb5bd', strokeStyle: '#6c757d' };
                node.setState({
                  style: {
                    ...node.state.style,
                    fillStyle: style.fillStyle,
                    strokeStyle: style.strokeStyle || style.fillStyle,
                    lineWidth: 1,
                  },
                });
              };
              const preview = () => {
                const queue = model.getNextQueue().slice(0, slots.length);
                const key = queue.join(',');
                if (key === state.previewKey) return;
                state.previewKey = key;
                slots.forEach((entry, index) => {
                  const type = queue[index];
                  const offsets = (W.ICE_TETROMINOES[type] || [])[0] || [];
                  entry.cells.forEach((cell) => cell.setState({ display: false }));
                  if (!offsets.length) return;
                  const rows = offsets.map(([row]) => row);
                  const cols = offsets.map(([, col]) => col);
                  const minRow = Math.min(...rows);
                  const minCol = Math.min(...cols);
                  const width = Math.max(...cols) - minCol + 1;
                  const height = Math.max(...rows) - minRow + 1;
                  const startX = Math.round((entry.slot.state.width - (width * PREVIEW_CELL - 2)) / 2);
                  const startY = Math.round((entry.slot.state.height - (height * PREVIEW_CELL - 2)) / 2);
                  offsets.forEach(([row, col], cellIndex) => {
                    const cell = entry.cells[cellIndex];
                    cell.setState({
                      display: true,
                      left: startX + (col - minCol) * PREVIEW_CELL,
                      top: startY + (row - minRow) * PREVIEW_CELL,
                    });
                    paintPreviewCell(cell, type);
                  });
                });
              };
              /**
               * 重画 = 把「棋盘 + 当前方块 + 幽灵」摊平成一层 tiles 交给 ICETileMap，
               * 幽灵落点走高亮层。setTiles 内部比对签名，值没变就什么都不做 —— 所以这里
               * 每帧调也不怕（真正的重绘只发生在变化的那一帧）。
               */
              const paint = () => {
                const boardRows = model.getBoard();
                const tiles = new Array(ROWS * COLS).fill('empty');
                for (let row = 0; row < ROWS; row += 1) {
                  for (let col = 0; col < COLS; col += 1) {
                    if (boardRows[row][col]) tiles[row * COLS + col] = boardRows[row][col];
                  }
                }
                const highlights = [];
                if (!model.isGameOver()) {
                  const type = model.getCurrent().type;
                  const color = (PALETTE[type] || {}).fillStyle || '#adb5bd';
                  model.getGhost().forEach(([row, col]) => {
                    const index = row * COLS + col;
                    if (index >= 0 && index < tiles.length && !tiles[index]) {
                      highlights.push({ row, col, fillStyle: alpha(color, 0.14), strokeStyle: alpha(color, 0.45), lineWidth: 1 });
                    }
                  });
                  model.getCurrent().cells.forEach(([row, col]) => {
                    if (row < 0) return;
                    tiles[row * COLS + col] = type;
                  });
                }
                board.setTiles(tiles);
                board.setHighlights(highlights);
                preview();
              };
              const hud = () => {
                const inLevel = model.getLines() % 10;
                return {
                  score: String(model.getScore()),
                  mid: String(model.getLines()),
                  right: String(model.getLevel()),
                  progress: { value: inLevel, text: `${inLevel} / 10 行` },
                };
              };

              model.addChangeListener(() => {
                const lines = model.getLines();
                const cleared = model.getLastClearedLines();
                if (lines > state.lines && cleared > 0) {
                  state.combo += 1;
                  playCue('line', cleared);
                  // 整块棋盘闪一下：ICETileMap.pulse 内部用 tween 把透明度 1 → 0
                  board.pulse(allCells, { duration: 240, color: 'rgba(255, 255, 255, 0.5)' });
                  if (cleared >= 4) ctx.toast('TETRIS！四行消除');
                  else if (cleared >= 2) ctx.toast(`${cleared} 行消除`);
                } else if (cleared === 0) {
                  state.combo = 0;
                }
                state.lines = lines;
                if (model.getLevel() > state.level) {
                  state.level = model.getLevel();
                  playCue('levelup');
                  ctx.toast(`升到 LV.${state.level}，下落加速`, 'warning');
                }
                if (model.isGameOver() && !state.over) {
                  state.over = true;
                  playCue('over');
                }
              });

              return {
                model,
                board,
                paint,
                hud,
                keydown(key, repeating) {
                  switch (key) {
                    case 'ArrowLeft':
                      model.moveLeft();
                      break;
                    case 'ArrowRight':
                      model.moveRight();
                      break;
                    case 'ArrowDown':
                      model.softDrop();
                      break;
                    case 'ArrowUp':
                    case 'x':
                    case 'X':
                      if (!repeating && model.rotateCW()) playCue('turn');
                      break;
                    case 'z':
                    case 'Z':
                      if (!repeating && model.rotateCCW()) playCue('turn');
                      break;
                    case ' ':
                    case 'Spacebar':
                      if (!repeating) {
                        model.hardDrop();
                        playCue('drop');
                      }
                      break;
                    default:
                      break;
                  }
                },
                frame(dt) {
                  const piece = model.getCurrent();
                  if (piece !== state.piece) {
                    // 换方块（含重开）时重力计时归零：新方块不该「一出生就掉一格」
                    state.piece = piece;
                    state.accumulator = 0;
                  }
                  if (model.isPaused() || model.isGameOver()) {
                    state.accumulator = 0;
                  } else {
                    state.accumulator += dt;
                    const interval = model.getDropInterval();
                    while (state.accumulator >= interval) {
                      state.accumulator -= interval;
                      model.tick();
                    }
                  }
                },
                setOverlay(paused, over) {
                  // 出现的那一帧给个动画（tween / scaleIn），之后保持显示
                  if (paused !== state.pausedShown) {
                    state.pausedShown = paused;
                    pauseBox.setState({ display: paused });
                    if (paused) W.fadeIn(pauseBox, { duration: 160 });
                  }
                  if (over !== state.overShown) {
                    state.overShown = over;
                    overBox.setState({ display: over });
                    if (over) W.scaleIn(overBox, { duration: 220 });
                  }
                },
                restart() {
                  model.reset();
                  state.combo = 0;
                  state.level = model.getLevel();
                  state.lines = 0;
                  state.over = false;
                  state.piece = null;
                  state.previewKey = '';
                },
                destroy() {
                  board.removeChildren([...board.childNodes]);
                },
              };
            },
          },
          snake: {
            key: 'snake',
            name: '贪吃蛇',
            subtitle: '第 2 弹 · 贪吃蛇 · 越吃越快',
            hud: { mid: '长度 LENGTH', right: '等级 LEVEL' },
            side: '蛇 SNAKE',
            help: [
              ['↑ / W', '向上'],
              ['↓ / S', '向下'],
              ['← / A', '向左'],
              ['→ / D', '向右'],
              ['只能转 90°', '不能原地掉头'],
              ['P / R', '暂停 / 重开'],
            ],
            mount(ctx) {
              const COLS = 20;
              const ROWS = 20;
              const CELL = 20;
              const boardW = COLS * CELL;
              const boardH = ROWS * CELL;
              const originX = Math.round((ctx.screen.state.width - boardW) / 2);
              const originY = 90;
              // 400 格的贪吃蛇棋盘同样只是**一个** ICETileMap 节点
              const board = new W.ICETileMap({
                id: 'snake-board',
                left: originX,
                top: originY,
                rows: ROWS,
                cols: COLS,
                cellSize: CELL,
                gap: 2,
                cellRadius: 4,
                palette: PALETTE,
                fill: true,
                stroke: true,
                style: { fillStyle: '#0f141b', strokeStyle: '#1f2733', lineWidth: 2 },
              });
              ctx.screen.addChild(board, false);
              /** 点格子 = 朝那一格转向（组件的 `cellclick` 事件走的就是真实命中检测）。 */
              board.on('cellclick', (evt) => {
                const cell = evt && evt.param ? evt.param : null;
                if (cell) steerToward(cell.row, cell.col);
              });
              const pauseBox = ctx.messageBox(
                'snake-paused',
                { left: originX, top: originY + boardH / 2 - 46, width: boardW, height: 92 },
                '已暂停',
                '按 P 继续',
                theme.colors.warning,
              );
              const overBox = ctx.messageBox(
                'snake-over',
                { left: originX, top: originY + boardH / 2 - 46, width: boardW, height: 92 },
                'GAME OVER',
                '按 R 再开一局',
                theme.colors.error,
              );

              /** 侧栏：速度 / 地图 / 转向队列 + 图例。 */
              const infoRows = createInfoRows(ctx.sideBody);
              const info = [
                ['速度', '170 ms/格'],
                ['地图', '20 × 20 · 撞墙即死'],
                ['转向', '队列里还没有输入'],
              ].map(([label, value]) => infoRows.add(label, value));
              const legend = new W.ICEWidget({
                left: 0,
                top: 92,
                width: 268,
                height: 44,
                radius: 8,
                fill: true,
                stroke: true,
                interactive: false,
                style: { fillStyle: '#12161d', strokeStyle: '#232b36', lineWidth: 1 },
              });
              const legendDot = (left, color) =>
                legend.addChild(
                  new W.ICEWidget({
                    left,
                    top: 14,
                    width: 16,
                    height: 16,
                    radius: 4,
                    fill: true,
                    stroke: false,
                    interactive: false,
                    style: { fillStyle: color },
                  }),
                  false,
                );
              legendDot(14, PALETTE.snakeHead.fillStyle);
              legend.addChild(
                new W.ICELabel({
                  interactive: false,
                  left: 36,
                  top: 0,
                  width: 80,
                  height: 44,
                  text: '蛇头',
                  verticalAlign: 'middle',
                  style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
                }),
                false,
              );
              legendDot(112, PALETTE.food.fillStyle);
              legend.addChild(
                new W.ICELabel({
                  interactive: false,
                  left: 134,
                  top: 0,
                  width: 120,
                  height: 44,
                  text: '食物 +10 分',
                  verticalAlign: 'middle',
                  style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
                }),
                false,
              );
              ctx.sideBody.addChild(legend, false);

              const model = new W.ICESnakeModel({ rows: ROWS, cols: COLS });
              const state = { accumulator: 0, level: model.getLevel(), over: false, pausedShown: false, overShown: false };
              /** 点格子 → 朝那一格转（只接受合法的 90°，掉头会被模型拒掉）。 */
              const steerToward = (row, col) => {
                const head = model.getHead();
                const dRow = row - head[0];
                const dCol = col - head[1];
                if (!dRow && !dCol) return;
                const direction = Math.abs(dRow) >= Math.abs(dCol) ? (dRow > 0 ? 'down' : 'up') : dCol > 0 ? 'right' : 'left';
                if (model.setDirection(direction)) playCue('turn');
              };
              const paint = () => {
                const tiles = new Array(ROWS * COLS).fill('empty');
                const food = model.getFood();
                if (food) tiles[food[0] * COLS + food[1]] = 'food';
                model.getBody().forEach(([row, col], index) => {
                  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
                  tiles[row * COLS + col] = index === 0 ? 'snakeHead' : index % 2 === 0 ? 'snakeBody' : 'snakeBodyAlt';
                });
                board.setTiles(tiles);
                info[0].setText(`${model.getTickInterval()} ms/格`);
                const pending = model.getPendingDirections();
                info[2].setText(pending.length ? pending.join(' → ') : '队列里还没有输入');
              };
              const hud = () => {
                const eaten = model.getEaten();
                return {
                  score: String(model.getScore()),
                  mid: String(model.getLength()),
                  right: String(model.getLevel()),
                  progress: { value: (eaten % 5) * 2, text: `再吃 ${5 - (eaten % 5)} 个升级` },
                };
              };

              model.addChangeListener(() => {
                if (model.getLevel() > state.level) {
                  state.level = model.getLevel();
                  playCue('levelup');
                  ctx.toast(`升到 LV.${state.level}，蛇更快了`, 'warning');
                }
                if (model.isGameOver() && !state.over) {
                  state.over = true;
                  playCue('over');
                }
              });

              const DIRECTION_KEYS = {
                ArrowUp: 'up',
                w: 'up',
                W: 'up',
                ArrowDown: 'down',
                s: 'down',
                S: 'down',
                ArrowLeft: 'left',
                a: 'left',
                A: 'left',
                ArrowRight: 'right',
                d: 'right',
                D: 'right',
              };
              return {
                model,
                board,
                paint,
                hud,
                keydown(key) {
                  const direction = DIRECTION_KEYS[key];
                  if (!direction) return;
                  if (!model.setDirection(direction)) return;
                  playCue('turn');
                },
                frame(dt) {
                  if (model.isPaused() || model.isGameOver()) {
                    state.accumulator = 0;
                    return;
                  }
                  state.accumulator += dt;
                  const interval = model.getTickInterval();
                  while (state.accumulator >= interval) {
                    state.accumulator -= interval;
                    const scoreBefore = model.getScore();
                    model.tick();
                    if (model.getScore() > scoreBefore) {
                      playCue('eat');
                      // 吃到的那一格脉冲一下 + 头也亮一下（ICETileMap.pulse 用 tween 淡出）
                      const head = model.getHead();
                      const food = model.getFood();
                      const cells = [{ row: head[0], col: head[1] }];
                      if (food) cells.push({ row: food[0], col: food[1] });
                      board.pulse(cells, { duration: 200, color: 'rgba(255, 255, 255, 0.35)' });
                    }
                  }
                },
                setOverlay(paused, over) {
                  if (paused !== state.pausedShown) {
                    state.pausedShown = paused;
                    pauseBox.setState({ display: paused });
                    if (paused) W.fadeIn(pauseBox, { duration: 160 });
                  }
                  if (over !== state.overShown) {
                    state.overShown = over;
                    overBox.setState({ display: over });
                    if (over) W.scaleIn(overBox, { duration: 220 });
                  }
                },
                restart() {
                  model.reset();
                  state.level = model.getLevel();
                  state.over = false;
                  state.accumulator = 0;
                },
                destroy() {
                  board.removeChildren([...board.childNodes]);
                },
              };
            },
          },
          '2048': {
            key: '2048',
            name: '2048',
            subtitle: '第 3 弹 · 2048 · 合并出 2048',
            hud: { mid: '最大块 BEST', right: '步数 MOVES' },
            side: '盘面 BOARD',
            help: [
              ['↑ ↓ ← →', '滑动（也可用 WASD）'],
              ['同值相撞', '合并成两倍'],
              ['一次移动', '每块只合并一次'],
              ['目标', '合并出 2048'],
              ['P / R', '暂停 / 重开'],
            ],
            mount(ctx) {
              const COLS = 4;
              const ROWS = 4;
              const CELL = 84;
              const boardW = COLS * CELL;
              const boardH = ROWS * CELL;
              const originX = Math.round((ctx.screen.state.width - boardW) / 2);
              const originY = 122;
              const board = new W.ICETileMap({
                id: 'game2048-board',
                left: originX,
                top: originY,
                rows: ROWS,
                cols: COLS,
                cellSize: CELL,
                gap: 8,
                cellRadius: 6,
                palette: PALETTE,
                labelFontSize: 30,
                fill: true,
                stroke: true,
                style: { fillStyle: '#1b2130', strokeStyle: '#2b3340', lineWidth: 2 },
              });
              ctx.screen.addChild(board, false);
              const pauseBox = ctx.messageBox(
                'game2048-paused',
                { left: originX, top: originY + boardH / 2 - 46, width: boardW, height: 92 },
                '已暂停',
                '按 P 继续',
                theme.colors.warning,
              );
              const overBox = ctx.messageBox(
                'game2048-over',
                { left: originX, top: originY + boardH / 2 - 46, width: boardW, height: 92 },
                'GAME OVER',
                '按 R 再开一局',
                theme.colors.error,
              );

              /** 侧栏：目标 / 最大块 / 提示。 */
              const infoRows = createInfoRows(ctx.sideBody);
              const info = [
                ['目标', '合并出 2048'],
                ['当前最大', '2'],
                ['状态', '进行中'],
              ].map(([label, value]) => infoRows.add(label, value));
              const legend = new W.ICEWidget({
                left: 0,
                top: 92,
                width: 268,
                height: 44,
                radius: 8,
                fill: true,
                stroke: true,
                interactive: false,
                style: { fillStyle: '#12161d', strokeStyle: '#232b36', lineWidth: 1 },
              });
              /** 图例是四个「色块 + 数字」组合（组合间 10 缝、块与字 4 缝）→ 两层 BoxLayout。 */
              legend.setLayout(new ICE.ICEBoxLayout({ axis: 'x', gap: 10, align: 'center' }));
              legend.setState({ padding: { left: 14 } });
              ['2', '8', '64', '512'].forEach((value) => {
                const style = PALETTE[value] || { fillStyle: '#adb5bd' };
                const chip = new W.ICEWidget({ width: 56, height: 44, fill: false, stroke: false, interactive: false });
                chip.setLayout(new ICE.ICEBoxLayout({ axis: 'x', gap: 4, align: 'center' }));
                chip.addChild(
                  new W.ICEWidget({
                    width: 18,
                    height: 18,
                    radius: 4,
                    fill: true,
                    stroke: false,
                    interactive: false,
                    style: { fillStyle: style.fillStyle },
                  }),
                  false,
                );
                chip.addChild(
                  new W.ICELabel({
                    interactive: false,
                    width: 34,
                    height: 44,
                    text: value,
                    verticalAlign: 'middle',
                    style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
                  }),
                  false,
                );
                legend.addChild(chip, false);
              });
              ctx.sideBody.addChild(legend, false);

              const model = new W.ICE2048Model({ rows: ROWS, cols: COLS });
              const state = { pausedShown: false, overShown: false, won: false, over: false };
              const paint = () => {
                const cells = model.getCells();
                const tiles = cells.map((value) => (value === null ? 'empty' : String(value)));
                const labels = cells.map((value) => (value === null ? null : String(value)));
                board.setTiles(tiles);
                board.setLabels(labels);
                info[1].setText(String(model.getBestTile()));
                info[2].setText(model.isGameOver() ? '结束' : model.isWon() ? '达成 2048（可继续）' : '进行中');
              };
              const hud = () => ({
                score: String(model.getScore()),
                mid: String(model.getBestTile()),
                right: String(model.getMoves()),
                progress: { value: Math.min(10, Math.round((Math.log2(Math.max(2, model.getBestTile())) / 11) * 10)), text: `目标 2048` },
              });
              model.addChangeListener(() => {
                if (model.isWon() && !state.won) {
                  state.won = true;
                  playCue('levelup');
                  ctx.toast('达成 2048！可以继续冲高分', 'success');
                }
                if (model.isGameOver() && !state.over) {
                  state.over = true;
                  playCue('over');
                }
              });
              const DIRECTIONS = {
                ArrowUp: 'up',
                w: 'up',
                W: 'up',
                ArrowDown: 'down',
                s: 'down',
                S: 'down',
                ArrowLeft: 'left',
                a: 'left',
                A: 'left',
                ArrowRight: 'right',
                d: 'right',
                D: 'right',
              };
              return {
                model,
                board,
                paint,
                hud,
                keydown(key) {
                  const direction = DIRECTIONS[key];
                  if (!direction) return;
                  if (!model.move(direction)) {
                    playCue('turn');
                    return;
                  }
                  // 只让**真正发生合并**的格子脉冲一下（模型直接告诉我们落在哪几格）
                  const merged = model.getLastMerged().map(([row, col]) => ({ row, col }));
                  if (merged.length) {
                    board.pulse(merged, { duration: 180, color: 'rgba(255,255,255,0.4)' });
                    playCue('eat');
                  } else {
                    playCue('turn');
                  }
                },
                frame() {
                  // 2048 是回合制，不需要每帧推进
                },
                setOverlay(paused, over) {
                  if (paused !== state.pausedShown) {
                    state.pausedShown = paused;
                    pauseBox.setState({ display: paused });
                    if (paused) W.fadeIn(pauseBox, { duration: 160 });
                  }
                  if (over !== state.overShown) {
                    state.overShown = over;
                    overBox.setState({ display: over });
                    if (over) W.scaleIn(overBox, { duration: 220 });
                  }
                },
                restart() {
                  model.reset();
                  state.won = false;
                  state.over = false;
                  state.pausedShown = false;
                  state.overShown = false;
                },
                destroy() {
                  board.removeChildren([...board.childNodes]);
                },
              };
            },
          },
          chip8: {
            key: 'chip8',
            name: 'CHIP-8',
            subtitle: '第 4 弹 · CHIP-8 虚拟机 · 自写 demo ROM',
            hud: { scoreCaption: '指令 CYCLES', mid: '地址 PC', right: '状态 STATE', progressCaption: '累计指令' },
            side: '机器 MACHINE',
            help: [
              ['1 2 3 4', '机器键盘 1-4'],
              ['Q W E R', '机器键盘 5-8'],
              ['A S D F', '机器键盘 9-C'],
              ['Z X C V', '机器键盘 D-F'],
              ['P', '暂停 / 继续'],
              ['重开 / 排行榜', '按钮上（R 让给机器键盘）'],
            ],
            /** 声明这 16 个键归机器键盘，外壳的快捷键让路（见键盘路由）。 */
            mount(ctx) {
              const COLS = 64;
              const ROWS = 32;
              const CELL = 6;
              const KEY_CELL = 24;
              /** 机器键盘：CHIP-8 原版排布 1234 / QWER / ASDF / ZXCV（数组下标就是键码 0-F）。 */
              const KEY_MAP = { '1': 0, '2': 1, '3': 2, '4': 3, q: 4, w: 5, e: 6, r: 7, a: 8, s: 9, d: 10, f: 11, z: 12, x: 13, c: 14, v: 15 };
              /** 机器键盘占用的 16 个键：外壳看到这个清单就让路（R 也得让给它）。 */
              const OWNED_KEYS = Object.keys(KEY_MAP);
              const boardW = COLS * CELL;
              const boardH = ROWS * CELL;
              const originX = Math.round((ctx.screen.state.width - boardW) / 2);
              // 屏幕里上下居中地摆「显存 + 机器键盘」这一组内容
              const keyboardH = 4 * KEY_CELL;
              const originY = Math.round((ctx.screen.state.height - (boardH + 28 + keyboardH)) / 2);
              // 64×32 = 2048 格，依然只有 1 个节点（ICETileMap 的自绘）
              const board = new W.ICETileMap({
                id: 'chip8-board',
                left: originX,
                top: originY,
                rows: ROWS,
                cols: COLS,
                cellSize: CELL,
                gap: 1,
                cellRadius: 1,
                palette: PALETTE,
                fill: true,
                stroke: true,
                style: { fillStyle: '#0b0f14', strokeStyle: '#1f2733', lineWidth: 2 },
              });
              ctx.screen.addChild(board, false);
              /**
               * 机器键盘可视化：4×4 = 16 格，按下去就点亮。
               * 这不只是装饰 —— 它把「按下 / 松开」这条链路摆在屏幕上，FX0A 等按键时一眼能看出卡在哪。
               */
              const KEY_LABELS = Object.keys(KEY_MAP).map((key) => key.toUpperCase());
              const keyboard = new W.ICETileMap({
                id: 'chip8-keyboard',
                left: Math.round((ctx.screen.state.width - 4 * KEY_CELL) / 2),
                top: originY + boardH + 28,
                rows: 4,
                cols: 4,
                cellSize: KEY_CELL,
                gap: 4,
                cellRadius: 4,
                palette: {
                  key: {
                    fillStyle: '#141c26',
                    strokeStyle: '#28323f',
                    lineWidth: 1,
                    textColor: '#7d8b9c',
                    fontSize: 12,
                    fontFamily: '"Courier New", monospace',
                  },
                  pressed: {
                    fillStyle: '#9be7ff',
                    strokeStyle: '#4aa8c9',
                    lineWidth: 1,
                    textColor: '#0b0f14',
                    fontSize: 12,
                    fontFamily: '"Courier New", monospace',
                  },
                },
                fill: false,
                stroke: false,
                interactive: false,
              });
              keyboard.setTiles(new Array(16).fill('key'));
              keyboard.setLabels(KEY_LABELS);
              ctx.screen.addChild(keyboard, false);
              const pauseBox = ctx.messageBox(
                'chip8-paused',
                { left: originX, top: originY + boardH / 2 - 46, width: boardW, height: 92 },
                '已暂停',
                '按 P 继续',
                theme.colors.warning,
              );
              const infoRows = createInfoRows(ctx.sideBody);
              const info = [['ROM', 'demo · 绕屏笑脸'], ['频率', '600 指令/秒'], ['按键', '1234 QWER ASDF ZXCV']].map(([label, value]) =>
                infoRows.add(label, value),
              );
              const model = new W.ICEChip8Model();
              model.loadProgram(W.ICE_CHIP8_DEMO_ROM);
              const state = { accumulator: 0, timer: 0, pausedShown: false, lastBeep: 0, lastPaint: '', lastKeyPaint: '' };
              const paint = () => {
                const display = model.getDisplay();
                let key = '';
                const tiles = new Array(display.length);
                for (let i = 0; i < display.length; i += 1) {
                  tiles[i] = display[i] ? 'chip8On' : 'chip8Off';
                  key += display[i] ? '1' : '0';
                }
                // 单色屏只有两种状态，整屏签名的比较比逐格 setState 便宜得多
                if (key !== state.lastPaint) {
                  state.lastPaint = key;
                  board.setTiles(tiles);
                }
                // 键盘同理：只在「按下的键变了」时重画那 16 格
                let keyState = '';
                const keyTiles = new Array(16);
                for (let i = 0; i < 16; i += 1) {
                  const down = model.isKeyDown(i);
                  keyTiles[i] = down ? 'pressed' : 'key';
                  keyState += down ? '1' : '0';
                }
                if (keyState !== state.lastKeyPaint) {
                  state.lastKeyPaint = keyState;
                  keyboard.setTiles(keyTiles);
                }
                info[1].setText(`600 指令/秒 · ${model.getCycles()} 条`);
              };
              return {
                model,
                board,
                keyboard,
                keys: OWNED_KEYS,
                paint,
                hud: () => ({
                  score: String(model.getCycles()),
                  mid: `0x${model.getPC().toString(16).toUpperCase().padStart(3, '0')}`,
                  right: model.isWaitingForKey() ? '按键' : '运行',
                  progress: { value: Math.min(10, Math.round(model.getCycles() / 600) % 10), text: 'CHIP-8' },
                }),
                keydown(key) {
                  const index = KEY_MAP[key];
                  if (index === undefined) return;
                  model.setKey(index, true);
                },
                keyup(key) {
                  const index = KEY_MAP[key];
                  if (index === undefined) return;
                  model.setKey(index, false);
                },
                frame(dt) {
                  if (model.isPaused()) return;
                  const perInstruction = 1000 / 600;
                  state.accumulator += dt;
                  let budget = 80;
                  while (state.accumulator >= perInstruction && budget > 0) {
                    state.accumulator -= perInstruction;
                    budget -= 1;
                    try {
                      model.step();
                    } catch (err) {
                      break; // ROM 跑飞了：停下来，别把页面搞崩
                    }
                  }
                  state.timer += dt;
                  while (state.timer >= 1000 / 60) {
                    state.timer -= 1000 / 60;
                    model.tickTimers();
                  }
                  if (model.getSoundTimer() > 0 && Date.now() - state.lastBeep > 90) {
                    state.lastBeep = Date.now();
                    playCue('eat');
                  }
                },
                setOverlay(paused) {
                  if (paused !== state.pausedShown) {
                    state.pausedShown = paused;
                    pauseBox.setState({ display: paused });
                    if (paused) W.fadeIn(pauseBox, { duration: 160 });
                  }
                },
                restart() {
                  model.reset();
                  model.loadProgram(W.ICE_CHIP8_DEMO_ROM);
                  state.lastPaint = '';
                  state.lastKeyPaint = '';
                  state.accumulator = 0;
                  state.timer = 0;
                },
                destroy() {
                  model.clearKeys();
                  board.removeChildren([...board.childNodes]);
                  keyboard.removeChildren([...keyboard.childNodes]);
                },
              };
            },
          },
        };

        /* --------------------------------- 卡带切换与 HUD --------------------------------- */

        const CART_RIDGE = [
          { key: 'tetris', label: '俄罗斯方块' },
          { key: 'snake', label: '贪吃蛇' },
          { key: '2048', label: '2048' },
          { key: 'chip8', label: 'CHIP-8' },
        ];
        const CART_WIDTH = 108;
        /** 卡带位：和上下几排面板一个节奏（20px 缝），一共 5 格正好铺满 COLUMN_W */
        const CART_GAP = 20;
        /**
         * 卡带位。ICEButton 的 variant 是构造期决定的（没有 setVariant），所以选中态不靠
         * 改属性，而是**每次切换重建这一行按钮** —— 反正只有四五个，重建最省心。
         */
        const cartridgeBar = new W.ICEWidget({
          id: 'arcade-cartridges',
          left: COLUMN_X,
          top: 150,
          width: COLUMN_W,
          height: 32,
          fill: false,
          stroke: false,
          interactive: false,
        });
        /** 卡带位是一行按钮（108 宽 + 20 缝）→ 横向 BoxLayout。 */
        cartridgeBar.setLayout(new ICE.ICEBoxLayout({ axis: 'x', gap: CART_GAP }));
        const cartridges = {};
        const renderCartridges = () => {
          cartridgeBar.removeChildren([...cartridgeBar.childNodes]);
          Object.keys(cartridges).forEach((key) => delete cartridges[key]);
          CART_RIDGE.forEach((item) => {
            const button = new W.ICEButton({
              id: `arcade-cart-${item.key}`,
              width: CART_WIDTH,
              height: 32,
              text: item.label,
              variant: item.key === currentKey ? 'primary' : 'default',
              size: 'small',
            });
            button.on('click', () => selectGame(item.key));
            cartridgeBar.addChild(button, false);
            cartridges[item.key] = button;
          });
          const soonButton = new W.ICEButton({
            id: 'arcade-cart-soon',
            width: CART_WIDTH,
            height: 32,
            text: '中国象棋',
            variant: 'default',
            size: 'small',
          });
          soonButton.setEnabled(false);
          cartridgeBar.addChild(soonButton, false);
        };

        /** 每块卡带一份排行榜（`ICEHighScoreModel` 自己管排序、截断与存档容错）。 */
        /* --------------------------------- BIOS：开机自检与启动菜单 --------------------------------- */

        /**
         * BIOS 状态机（`ICEBiosModel`，纯逻辑）：自检时序、菜单光标、设置持久化都在模型里。
         * 页面只做三件事：把模型画成屏幕上的文字、把按键喂给模型、执行模型返回的动作。
         *
         * 出厂默认「快速启动」：自检完直接进上次那块卡带（开箱即玩）；F2 / BIOS 按钮随时回到菜单。
         * 用户在设置里改过之后以存储为准（`settings` 只是默认值，存储优先）。
         */
        const bios = new W.ICEBiosModel({
          cartridges: CART_RIDGE.map((item) => ({ key: item.key, label: item.label })),
          settings: { quickBoot: true, defaultCartridge: 'tetris' },
          prefix: 'ice-arcade-bios-',
        });
        const BIOS_MENU_TOP = 116;
        const BIOS_ROW_H = 30;
        const BIOS_SETUP_TOP = 126;
        const BIOS_SETUP_ROW = 36;
        let biosNodes = null;
        let biosSignature = '';
        let biosHudSignature = '';
        /** 设置页的光标是纯 UI 状态（值本身在模型里） */
        let biosSettingsCursor = 0;

        const buildBiosLayer = () => {
          const layer = new W.ICEWidget({
            id: 'arcade-bios-layer',
            left: 0,
            top: 0,
            width: screen.state.width,
            height: screen.state.height,
            fill: false,
            stroke: false,
            interactive: false,
          });
          const titleLabel = new W.ICELabel({
            id: 'bios-title',
            interactive: false,
            left: 24,
            top: 22,
            width: 352,
            height: 26,
            text: 'ICE ARCADE BIOS v1.0',
            style: { fontSize: 15, fontWeight: '700', fontFamily: '"Courier New", monospace', fillStyle: '#9be7ff' },
          });
          const ruleLabel = new W.ICELabel({
            interactive: false,
            left: 24,
            top: 52,
            width: 352,
            height: 16,
            text: '────────────────────────────────',
            style: { fontSize: 12, fillStyle: '#39424f' },
          });
          layer.addChild(titleLabel, false);
          layer.addChild(ruleLabel, false);

          /** 自检行：老式 BIOS 的「项目 + 详情 + 结果」三栏文字。 */
          const stepNodes = bios.getSteps().map(
            (step, index) =>
              new W.ICELabel({
                id: `bios-step-${step.key}`,
                interactive: false,
                left: 24,
                top: 96 + index * 28,
                width: 352,
                height: 24,
                text: '',
                verticalAlign: 'middle',
                style: { fontSize: 13, fontFamily: '"Courier New", monospace', fillStyle: '#6b7480' },
              }),
          );
          stepNodes.forEach((node) => layer.addChild(node, false));

          /** 菜单高亮垫在文字下面（先加 → zIndex 更低）。 */
          const cursorPlate = new W.ICEWidget({
            id: 'bios-cursor',
            left: 16,
            top: BIOS_MENU_TOP - 2,
            width: 368,
            height: BIOS_ROW_H - 4,
            radius: 6,
            fill: true,
            stroke: false,
            display: false,
            interactive: false,
            style: { fillStyle: 'rgba(13, 110, 253, 0.24)' },
          });
          layer.addChild(cursorPlate, false);
          const menuNodes = bios.getMenuEntries().map(
            (entry, index) =>
              new W.ICELabel({
                id: `bios-menu-${entry.key}`,
                interactive: false,
                left: 30,
                top: BIOS_MENU_TOP + index * BIOS_ROW_H,
                width: 346,
                height: BIOS_ROW_H - 4,
                text: '',
                verticalAlign: 'middle',
                style: { fontSize: 14, fillStyle: '#adb5bd' },
              }),
          );
          menuNodes.forEach((node) => layer.addChild(node, false));

          /** 设置页三行：快速启动 / 默认卡带 / 返回。 */
          const settingNodes = [0, 1, 2].map(
            (index) =>
              new W.ICELabel({
                id: `bios-setting-${index}`,
                interactive: false,
                left: 24,
                top: BIOS_SETUP_TOP + index * BIOS_SETUP_ROW,
                width: 352,
                height: 28,
                text: '',
                verticalAlign: 'middle',
                style: { fontSize: 13, fillStyle: '#adb5bd' },
              }),
          );
          settingNodes.forEach((node) => layer.addChild(node, false));

          const hintLabel = new W.ICELabel({
            id: 'bios-hint',
            interactive: false,
            left: 24,
            top: screen.state.height - 60,
            width: 352,
            height: 40,
            text: '',
            style: { fontSize: 12, fillStyle: '#6b7480' },
          });
          layer.addChild(hintLabel, false);

          return { layer, stepNodes, menuNodes, cursorPlate, settingNodes, hintLabel };
        };

        /** 把模型的相位画出来（签名没变就直接返回，自检 60fps 也不会白刷）。 */
        const renderBios = () => {
          if (!biosNodes) return;
          const phase = bios.getPhase();
          const steps = bios.getSteps();
          const cursor = bios.getCursor();
          const signature = [
            phase,
            steps.map((step) => `${step.state}${Math.round(step.progress * 8)}`).join(','),
            cursor,
            bios.isQuickBoot(),
            bios.getDefaultCartridge(),
            biosSettingsCursor,
          ].join('|');
          if (signature === biosSignature) return;
          biosSignature = signature;
          const isPost = phase === 'post';
          const isMenu = phase === 'menu';
          const isSetup = phase === 'settings';

          biosNodes.stepNodes.forEach((node, index) => {
            node.setState({ display: isPost });
            if (!isPost) return;
            const step = steps[index];
            const mark = step.state === 'ok' ? 'OK' : step.state === 'running' ? '<<<' : '...';
            const color = step.state === 'ok' ? '#20c997' : step.state === 'running' ? '#ffc107' : '#6b7480';
            node.setText(`${step.label.padEnd(7)}${step.detail.padEnd(26)}${mark}`);
            node.setTextColor(color);
          });

          const entries = bios.getMenuEntries();
          biosNodes.menuNodes.forEach((node, index) => {
            node.setState({ display: isMenu });
            if (!isMenu) return;
            const entry = entries[index];
            const selected = index === cursor;
            node.setText(`${selected ? '>' : ' '} ${entry.label}`);
            node.setTextColor(selected ? '#9be7ff' : '#adb5bd');
          });
          biosNodes.cursorPlate.setState({ display: isMenu, top: BIOS_MENU_TOP - 2 + cursor * BIOS_ROW_H });

          const defaultLabel = (bios.getCartridges().find((item) => item.key === bios.getDefaultCartridge()) || {}).label || '—';
          const settingTexts = [
            `快速启动 QUICK BOOT   ${bios.isQuickBoot() ? '[ 开 ]' : '[ 关 ]'}`,
            `默认卡带 DEFAULT      ${defaultLabel}`,
            '返回 BACK (Esc)',
          ];
          biosNodes.settingNodes.forEach((node, index) => {
            node.setState({ display: isSetup });
            if (!isSetup) return;
            const selected = index === biosSettingsCursor;
            node.setText(`${selected ? '>' : ' '} ${settingTexts[index]}`);
            node.setTextColor(selected ? '#9be7ff' : '#adb5bd');
          });

          biosNodes.hintLabel.setText(
            isPost
              ? '按任意键跳过自检 …'
              : isSetup
              ? '↑↓ 选择 · Enter 切换 · Esc 返回菜单'
              : '↑↓ 选择 · Enter 启动卡带 · F2 回游戏',
          );
          biosNodes.layer.dirty = true;
          ice.dirty = true;
        };

        /** BIOS 期间的 HUD / 侧栏 / 操作说明（和卡带用同一批组件，只是换了文案）。 */
        const refreshBios = () => {
          const phase = bios.getPhase();
          if (phase === 'boot') return;
          const steps = bios.getSteps();
          const okCount = steps.filter((step) => step.state === 'ok').length;
          const percent = Math.round(bios.getPostProgress() * 100);
          const signature = `${phase}|${okCount}|${percent}|${bios.isQuickBoot()}|${bios.getDefaultCartridge()}`;
          if (signature === biosHudSignature) return;
          biosHudSignature = signature;

          subtitle.setText(phase === 'post' ? '第 0 弹 · BIOS 开机自检' : phase === 'settings' ? '第 0 弹 · BIOS 设置' : '第 0 弹 · BIOS 启动菜单');
          scoreCard.caption.setText(phase === 'post' ? '自检 POST' : phase === 'settings' ? '设置 SETUP' : '卡带 CARTS');
          scoreCard.value.setText(phase === 'post' ? `${okCount}/${steps.length}` : String(bios.getCartridges().length));
          midCard.caption.setText(phase === 'post' ? '进度' : '默认卡带');
          midCard.value.setText(phase === 'post' ? `${percent}%` : bios.getDefaultCartridge().toUpperCase());
          rightCard.caption.setText('相位 PHASE');
          rightCard.value.setText(phase.toUpperCase());
          progressCaption.setText('自检进度');
          progressBar.setValue(Math.round(bios.getPostProgress() * 10));
          progressLabel.setText(phase === 'post' ? `${percent}%` : 'READY');
          bestLabel.setText('BIOS v1.0 · F2 进菜单');
          sideCaption.setText('卡带 CARTS');
          sideBody.removeChildren([...sideBody.childNodes]);
          bios.getCartridges().forEach((item, index) => {
            const isDefault = item.key === bios.getDefaultCartridge();
            const label = new W.ICELabel({
              id: `bios-side-${item.key}`,
              interactive: false,
              left: 0,
              top: index * 26,
              width: 268,
              height: 22,
              text: `${isDefault ? '★' : ' '} ${item.label}`,
              verticalAlign: 'middle',
              style: { fontSize: 13, fillStyle: isDefault ? theme.colors.primary : theme.colors.textSecondary },
            });
            sideBody.addChild(label, false);
          });
          setHelpRows(
            phase === 'post'
              ? [
                  ['任意键', '跳过自检'],
                  ['F2', 'BIOS 菜单'],
                  ['Enter', '（自检结束后确认）'],
                  ['★', '默认卡带'],
                ]
              : phase === 'settings'
              ? [
                  ['↑ / ↓', '选择设置项'],
                  ['Enter', '切换取值'],
                  ['Esc', '返回菜单'],
                  ['★', '默认卡带'],
                ]
              : [
                  ['↑ / ↓', '选择卡带 / 菜单'],
                  ['Enter', '启动 / 确认'],
                  ['F2', '回到游戏'],
                  ['★', '默认卡带'],
                ],
          );
          ice.dirty = true;
        };

        /** 清掉卡带、把 BIOS 层摆上屏幕。 */
        const showBios = () => {
          if (detach) {
            detach();
            detach = null;
          }
          if (runtime && runtime.destroy) runtime.destroy();
          runtime = null;
          currentKey = null;
          pauseText = '';
          screen.removeChildren([...screen.childNodes]);
          sideBody.removeChildren([...sideBody.childNodes]);
          biosNodes = buildBiosLayer();
          screen.addChild(biosNodes.layer, false);
          bindBiosScope(); // 键盘也交给 BIOS 层（自检任意键跳过 / 菜单上下选择）
          biosSignature = '';
          biosHudSignature = '';
          renderBios();
          refreshBios();
          renderCartridges();
          pauseButton.setEnabled(false);
          restartButton.setEnabled(false);
          leaderboardButton.setEnabled(false);
          window.__arcade.model = null;
          window.__arcade.runtime = null;
          window.__arcade.game = null;
          ice.dirty = true;
        };

        /** 从游戏回到 BIOS 菜单（掌机的「复位」）。 */
        const openBios = () => {
          bios.openMenu();
          biosSettingsCursor = 0;
          showBios();
        };

        /** 把控制权交给一块卡带（BIOS 层随之消失）。 */
        const bootCartridge = (key) => {
          if (!GAMES[key]) key = bios.getDefaultCartridge();
          biosNodes = null;
          biosSignature = '';
          biosHudSignature = '';
          selectGame(key);
          pauseButton.setEnabled(true);
          restartButton.setEnabled(true);
          leaderboardButton.setEnabled(true);
        };

        const scores = {
          tetris: new W.ICEHighScoreModel({ key: 'tetris', maxEntries: 5 }),
          snake: new W.ICEHighScoreModel({ key: 'snake', maxEntries: 5 }),
          '2048': new W.ICEHighScoreModel({ key: '2048', maxEntries: 5 }),
        };
        /** 有没有排行榜：CHIP-8 是台机器，跑的是 ROM，没有"分数"这回事。 */
        const hasScores = (key) => !!scores[key];
        const pad2 = (value) => String(value).padStart(2, '0');
        const formatAt = (at) => {
          const date = new Date(Number(at) || Date.now());
          return `${date.getMonth() + 1}/${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
        };
        /** 排行榜内容：ICETable 装在 ICEScrollPane 里（榜长了能滚），建在内容工厂里。 */
        const leaderboardContent = (key) => () => {
          const pane = new W.ICEWidget({ width: 400, height: 232, fill: false, stroke: false });
          const entries = scores[key].getScores();
          const rows = entries.length
            ? entries.map((entry, index) => ({
                rank: `#${index + 1}`,
                score: String(entry.score),
                at: formatAt(entry.at),
              }))
            : [{ rank: '—', score: '还没有成绩', at: '——' }];
          const table = new W.ICETable({
            id: 'arcade-leaderboard-table',
            left: 0,
            top: 0,
            width: 400,
            rowHeight: 34,
            columns: [
              { key: 'rank', title: '名次' },
              { key: 'score', title: '得分', align: 'right' },
              { key: 'at', title: '时间' },
            ],
            data: rows,
          });
          const scroll = new W.ICEScrollPane({
            id: 'arcade-leaderboard-scroll',
            left: 0,
            top: 0,
            width: 400,
            height: 232,
            fill: false,
            stroke: false,
            style: { fillStyle: 'transparent', strokeStyle: 'transparent' },
          });
          scroll.setContent(table);
          scroll.setContentSize(400, Math.max(232, rows.length * 34 + 44));
          pane.addChild(scroll, false);
          return pane;
        };
        const openLeaderboard = () => {
          if (!currentKey) return null;
          const game = GAMES[currentKey];
          if (!hasScores(currentKey)) {
            toast('CHIP-8 卡带没有排行榜 · 它只负责跑 ROM', 'info');
            return null;
          }
          const modal = W.openModal(ice, {
            title: `排行榜 · ${game.name}`,
            width: 460,
            height: 380,
            content: leaderboardContent(currentKey),
            confirmText: '再来一局',
            cancelText: '关闭',
            onConfirm: () => restart(),
          });
          window.__arcade.leaderboard = { modal, key: currentKey, entries: scores[currentKey].getScores() };
          return modal;
        };

        /**
         * 游戏里同时堆三四条气泡会盖住下面的卡带行（QA 抓到过：点卡带被气泡吃掉）。
         * 掌机只需要一条状态线：新提示先关掉上一条，气泡永远不会叠起来。
         */
        let statusToast = null;
        const toast = (text, type = 'success') => {
          if (statusToast && typeof statusToast.close === 'function') statusToast.close();
          statusToast = W.ICEMessage.show(ice, text, { type });
          return statusToast;
        };
        let currentKey = null;
        let runtime = null;
        let pauseText = '';

        const refresh = () => {
          if (!runtime) return;
          const hud = runtime.hud();
          scoreCard.value.setText(hud.score);
          midCard.value.setText(hud.mid);
          rightCard.value.setText(hud.right);
          progressBar.setValue(hud.progress.value);
          progressLabel.setText(hud.progress.text);
          const over = runtime.model.isGameOver();
          const paused = runtime.model.isPaused() && !over;
          const nextPauseText = paused ? '继续 (P)' : '暂停 (P)';
          if (nextPauseText !== pauseText) {
            pauseText = nextPauseText;
            pauseButton.setText(nextPauseText);
          }
          runtime.setOverlay(paused, over);
          bestLabel.setText(hasScores(currentKey) ? `最高分 ${scores[currentKey].getBest()}` : 'CHIP-8 · 无排行榜');
          runtime.paint();
          ice.dirty = true;
        };

        // 结束时的最高分落盘（每个卡带各记一份）
        let announcedOver = false;
        const watch = () => {
          const model = runtime.model;
          const off = model.addChangeListener(() => {
            if (model.isGameOver() && !announcedOver && hasScores(currentKey)) {
              announcedOver = true;
              const score = model.getScore();
              const inTop = scores[currentKey].isInTop(score);
              scores[currentKey].add(score, { at: Date.now() });
              toast(`游戏结束 · 得分 ${model.getScore()}`, 'error');
              if (inTop) toast('进榜啦！按 L 看排行榜', 'info');
            }
            refresh();
          });
          return off;
        };
        let detach = null;

        function selectGame(key) {
          const game = GAMES[key];
          if (!game) return;
          if (detach) detach();
          if (runtime && runtime.destroy) runtime.destroy();
          screen.removeChildren([...screen.childNodes]);
          biosNodes = null; // BIOS 层已经随 screen 一起被清掉
          sideBody.removeChildren([...sideBody.childNodes]);
          currentKey = key;
          announcedOver = false;
          pauseText = '';
          subtitle.setText(game.subtitle);
          scoreCard.caption.setText(game.hud.scoreCaption || '得分 SCORE');
          midCard.caption.setText(game.hud.mid);
          rightCard.caption.setText(game.hud.right);
          progressCaption.setText(game.hud.progressCaption || '升级进度');
          sideCaption.setText(game.side);
          setHelpRows(game.help);
          renderCartridges();
          runtime = game.mount({
            ice,
            screen,
            sideBody,
            messageBox,
            toast,
          });
          unbindBiosScope();      // 交棒给卡带：BIOS 层让出键盘
          bindCartridgeScope();
          detach = watch();
          // 换卡带的仪式感：新棋盘淡入（引擎的子树不透明度，一个 tween 搞定）
          if (runtime.board) W.fadeIn(runtime.board, { duration: 260 });
          refresh();
          window.__arcade.model = runtime.model;
          window.__arcade.runtime = runtime;
          window.__arcade.game = key;
        }

        const restart = () => {
          if (!runtime) return;
          runtime.restart();
          announcedOver = false;
          refresh();
        };
        const togglePause = () => {
          if (!runtime || runtime.model.isGameOver()) return;
          if (runtime.model.isPaused()) runtime.model.resume();
          else runtime.model.pause();
        };

        pauseButton.on('click', togglePause);
        restartButton.on('click', restart);
        leaderboardButton.on('click', () => openLeaderboard());
        biosButton.on('click', () => openBios());

        /* --------------------------------- 循环与键盘 --------------------------------- */

        let last = 0;
        const frame = (now) => {
          const dt = last ? Math.min(120, now - last) : 0;
          last = now;
          const phase = bios.getPhase();
          if (phase === 'post') {
            // 自检按时序推进：每通过一项响一声（真机也这么「哔」）
            const before = bios.getSteps().filter((step) => step.state === 'ok').length;
            bios.tick(dt);
            const after = bios.getSteps().filter((step) => step.state === 'ok').length;
            if (after > before) playCue('eat');
            if (bios.getPhase() !== 'post') {
              playCue('turn');
              refreshBios();
            }
          } else if (phase === 'boot') {
            // 交棒：自检完（快速启动）或菜单里选了卡带，就把控制权给卡带
            if (!runtime) bootCartridge(bios.getDefaultCartridge());
          }
          if (runtime) runtime.frame(dt, now);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);

        /** 掌机键：方向键 + 空格，任何卡带都收。 */
        const PAD_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar'];
        /** 卡带常用字母/数字键（俄罗斯方块 ZX、贪吃蛇 WASD、2048 用方向键）。 */
        const LETTER_KEYS = ['w', 'a', 's', 'd', 'z', 'x', 'c', 'v', 'q', 'e', 'f', '1', '2', '3', '4'];

        /**
         * 键位归属交给「键盘作用域」模型（`ICEKeyScopeModel`）—— 这台掌机正好是它的活标本：
         * 卡带要用 R 当机器键 7，外壳却想用 R 重开；自检期间「任意键跳过」又要吃掉一切。
         * 现在是三层声明：cartridge（最内层，卡带自己声明 keys）→ bios（菜单/自检）→ shell（P/R/L）。
         * 谁占哪个键一目了然，`keyScope.detectConflicts()` 还能把冲突列出来，不必靠猜。
         */
        const keyScope = new W.ICEKeyScopeModel();
        keyScope.push('shell');
        keyScope.bind({
          scope: 'shell',
          keys: ['p', 'r', 'l'],
          handler: (key, event) => {
            if (event && event.repeat === true) return true; // 长按不重复触发
            if (key === 'p') togglePause();
            else if (key === 'r') restart();
            else openLeaderboard();
            return true;
          },
        });
        /** BIOS 层：只在 BIOS 激活期间存在，且吃掉所有键（自检任意键跳过 / 菜单上下选择）。 */
        let biosUnbind = null;
        const bindBiosScope = () => {
          keyScope.push('bios');
          biosUnbind = keyScope.bind({
            scope: 'bios',
            keys: ['*'],
            handler: (_key, event) => {
              handleBiosKey(event);
              return true;
            },
          });
        };
        const unbindBiosScope = () => {
          if (biosUnbind) {
            biosUnbind();
            biosUnbind = null;
          }
          keyScope.pop('bios');
        };
        /** 卡带层：换卡带时重绑（卡带声明了 keys 就用它的，否则用掌机的默认键位）。 */
        let cartridgeUnbind = null;
        const bindCartridgeScope = () => {
          if (cartridgeUnbind) {
            cartridgeUnbind();
            cartridgeUnbind = null;
          }
          if (!runtime) return;
          const declared = Array.isArray(runtime.keys) && runtime.keys.length ? runtime.keys : null;
          keyScope.push('cartridge');
          cartridgeUnbind = keyScope.bind({
            scope: 'cartridge',
            keys: declared || [...PAD_KEYS, ...LETTER_KEYS],
            handler: (key, event) => {
              runtime.keydown(key, event && event.repeat === true);
              return true;
            },
          });
        };

        /**
         * BIOS 的按键语义（真机上的老式控制台交互）：
         * 自检中按任意键跳过；菜单里 ↑↓ 走（循环）、Enter 确认；设置页 Enter 切换取值、Esc 回菜单。
         */
        const handleBiosKey = (event) => {
          const key = event.key;
          const phase = bios.getPhase();
          if (phase === 'post') {
            bios.tick(bios.getPostDuration()); // 跳过剩下的自检
            playCue('turn');
            return;
          }
          if (phase === 'menu') {
            if (key === 'ArrowUp') bios.moveCursor(-1);
            else if (key === 'ArrowDown') bios.moveCursor(1);
            else if (key === 'Enter' || key === ' ') {
              const action = bios.confirm();
              if (action.type === 'boot') {
                playCue('turn');
                bootCartridge(action.cartridge);
              }
            }
            return;
          }
          if (phase === 'settings') {
            if (key === 'ArrowUp') {
              biosSettingsCursor = (biosSettingsCursor + 2) % 3;
              biosSignature = '';
              renderBios();
            } else if (key === 'ArrowDown') {
              biosSettingsCursor = (biosSettingsCursor + 1) % 3;
              biosSignature = '';
              renderBios();
            } else if (key === 'Enter' || key === ' ') {
              if (biosSettingsCursor === 0) {
                bios.toggleQuickBoot();
                toast(`快速启动：${bios.isQuickBoot() ? '开' : '关'}`, 'info');
              } else if (biosSettingsCursor === 1) {
                // 在卡带列表里循环切默认卡带
                const list = bios.getCartridges();
                const index = list.findIndex((item) => item.key === bios.getDefaultCartridge());
                bios.setDefaultCartridge(list[(index + 1) % list.length].key);
              } else {
                bios.back();
                biosSettingsCursor = 0;
              }
              biosSignature = '';
              biosHudSignature = '';
              renderBios();
              refreshBios();
            } else if (key === 'Escape') {
              bios.back();
              biosSettingsCursor = 0;
            }
            return;
          }
        };

        window.addEventListener('keydown', (event) => {
          // F2 是全局硬快捷键（唯一的例外）：游戏里按它 = 复位回 BIOS 菜单，不进作用域栈
          if (event.key === 'F2') {
            event.preventDefault();
            openBios();
            return;
          }
          // 其余键按「内层优先」交给作用域栈：cartridge → bios → shell
          const result = keyScope.dispatch(event.key, event);
          if (result.handled) event.preventDefault();
        });

        // CHIP-8 需要「按下 / 松开」两个事件（其它卡带用不到 keyup，实现了也没关系）
        window.addEventListener('keyup', (event) => {
          if (!runtime || typeof runtime.keyup !== 'function') return;
          runtime.keyup(event.key.length === 1 ? event.key.toLowerCase() : event.key);
        });

        // 切走标签页自动暂停，回来接着玩（游戏机也这么干）
        window.addEventListener('blur', () => {
          if (!runtime || bios.getPhase() !== 'boot') return;
          // 失焦时按键的「松开」事件会丢，机器键盘得手动清（否则 FX0A 会一直等）
          if (typeof runtime.model.clearKeys === 'function') runtime.model.clearKeys();
          if (!runtime.model.isGameOver() && !runtime.model.isPaused()) runtime.model.pause();
        });

        /* --------------------------------- 组装 --------------------------------- */

        ice.addChild(shell);
        ice.addChild(shellHighlight);
        ice.addChild(bezel);
        ice.addChild(screen);
        [
          title,
          subtitle,
          cartridgeBar,
          scoreCard.panel,
          midCard.panel,
          rightCard.panel,
          progressPanel,
          sidePanel,
          helpPanel,
          actionRow,
          soundSwitch,
          soundLabel,
          bestLabel,
          footer,
        ].forEach((node) => ice.addChild(node));

        /** 浏览器 QA / 调试用的句柄（和 XP 示例的 window.__result 同一套路）。 */
        window.__arcade = {
          ice,
          sound,
          GAMES,
          bios,
          keyScope,
          selectGame,
          openBios,
          showBios,
          bootCartridge,
          restart,
          togglePause,
          cartridges,
          game: null,
          runtime: null,
          model: null,
          buttons: { pauseButton, restartButton, leaderboardButton, biosButton, soundSwitch },
          scoreCard: scoreCard.value,
          midCard: midCard.value,
          rightCard: rightCard.value,
          captions: { score: scoreCard.caption, mid: midCard.caption, right: rightCard.caption, progress: progressCaption },
          bestLabel,
          scores,
          openLeaderboard,
          leaderboard: null,
          nodes: {
            shell,
            bezel,
            screen,
            sidePanel,
            helpPanel,
            progressBar,
            sideBody,
            helpBody,
            cartridgeBar,
            get biosNodes() {
              return biosNodes;
            },
          },
        };
        // 开机：先跑 BIOS 自检（快速启动开着的话自检完自动进上次那块卡带）
        bios.addChangeListener(() => {
          if (bios.getPhase() === 'boot') return;
          renderBios();
          refreshBios();
        });
        showBios();
      })();
    