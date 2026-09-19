// @ts-nocheck
/**
 * **自维护源码（可手改）**：本文件已从 `scripts/sync-upstream.mjs` 的抽取链路中迁出，
 * 收归 `src/machines/windows-xp/` 由 ice-game 自己维护，不再被 `npm run sync:upstream` 覆盖。
 *
 * 来历：最初由 `sync-upstream` 从 `../ice-web-components/examples/windows-xp.html` 的内联
 * `<script>` 正文**逐字**抽取（含本仓在组件库里做的两处视觉修正：开始按钮画旗 + 托盘用
 * 喇叭/盾牌/ WiFi 图标代替 emoji，避免画布 emoji 乱码）。迁出后，这份 `main.ts` 就是真相来源，
 * 要改玩法**直接改这里**即可，不用回头改上游。
 *
 * 与上游页的差异 = 下面两行 import：上游靠 `<script src="…umd.js">` 把 `ICE` / `ICEWEB`
 * 挂在 window 上，这里改成模块引入 —— `import * as` 拿到的命名空间对象与 UMD 全局**形状一致**
 * （`ICE.ICE`、`ICE.ICEBoxLayout`、`ICEWEB.ICEPanel` 照旧），所以正文一字不用改。
 *
 * 类型检查用 `@ts-nocheck` 关掉：这是上游的 JS 正文，"保持逐字"比"通过 strict 检查"重要。
 * 本仓的类型门禁落在 `src/domain`（纯逻辑）与 `src/home`（自己写的画布首页）上。
 */
import * as ICE from 'ice-render';
import * as ICEWEB from 'ice-web-components';

      // 高分屏：让引擎把 backing store 按 dpr 放大，文字/描边不发虚（Retina 上尤其明显）
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const ice = new ICE.ICE().init('canvas', { dpr });
      const W = ICEWEB;
      // 先切主题、再建组件（本机是"启动即定死"的一套 XP 主题，运行期不切）
      W.iceUIManager.registerTheme('xp', W.ICE_XP_THEME).setTheme('xp', ice); // 第二个参数 = 顺带把主题同步到引擎（选中框 / 手柄 / 插槽等外壳 token）
      const theme = W.iceUIManager.getTheme();
      new W.ICEHoverManager(ice).start();
      W.getICEFocusManager(ice).start();

      const SCREEN_W = 1440;
      const SCREEN_H = 900;
      const TASKBAR_H = 36;
      const DESKTOP_H = SCREEN_H - TASKBAR_H;

      /**
       * ★ 信箱边（letterbox）下点击错位修复（2026-09-15）
       *
       * 根因：本页画布缓冲固定 1440×900（设计分辨率），但 index.html 用 CSS 把「显示尺寸」等比缩成
       * 视口内 1.6 矩形（letterbox）。引擎的点击映射是 `clientX - rect.left`（CSS 像素）直接当世界坐标
       * 用（见 ice-render/src/event/input-normalize.ts），前提是「缓冲 == 显示尺寸」。letterbox 下
       * 缓冲(1440) ≠ 显示(如 1229)，于是点哪偏哪 —— 非 1.6 视口双击全落空。
       *
       * 修复（不动引擎源码，符合 ice-render 铁律）：让画布缓冲**始终等于显示尺寸**（fitCanvasToDisplaySize
       * 已含 dpr），再用引擎视口把 1440×900 设计世界等比缩放进缓冲。这样点击 CSS 像素与缓冲 1:1，
       * screenToWorld 再逆变换回设计坐标，命中正确。显示尺寸的数学与 index.html 的 CSS 完全一致。
       */
      const DESIGN_ASPECT = SCREEN_W / SCREEN_H; // 1.6
      const applyLayout = () => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // 取「塞进视口且保持 1.6 比例」的最大矩形（与 index.html 的 CSS min() 同一条数学）
        const boxW = Math.min(vw, vh * DESIGN_ASPECT);
        const boxH = boxW / DESIGN_ASPECT;
        // 缓冲 = 显示尺寸（含 dpr）：点击映射的 CSS 像素与缓冲 1:1，信箱边不再错位
        ice.fitCanvasToDisplaySize(boxW, boxH);
        // 把 1440×900 设计世界等比缩放进缓冲；screenToWorld 会逆变换回设计坐标
        ice.viewport.scale = boxW / SCREEN_W;
        ice.viewport.tx = 0;
        ice.viewport.ty = 0;
        ice.requestRepaint(); // 触发整帧重绘（视口变化也会让静态层缓存失效）
      };
      applyLayout();
      let __layoutRaf = 0;
      window.addEventListener('resize', () => {
        if (__layoutRaf) cancelAnimationFrame(__layoutRaf);
        __layoutRaf = requestAnimationFrame(applyLayout);
      });

      const toast = (text, type = 'success') => W.ICEMessage.show(ice, text, { type });
      const desktopBox = { left: 0, top: 0, width: SCREEN_W, height: DESKTOP_H };
      const XPFONT = 'Tahoma, "Microsoft YaHei", sans-serif';
      /** 给浏览器 QA / 调试用的句柄（各应用自己往里塞） */
      const handles = {};

      /**
       * 桌面外壳里两处「永远在最上面」的**显式钉子**：
       * - 任务栏：要一直压在窗口层之上（开始菜单走 `ICEOverlayManager` = 工具层，仍在任务栏之上）；
       * - 会话幕布（开机 / 登录 / 关机）：要盖住包括任务栏在内的一切。
       *
       * ⚠️ 引擎 2026-09 起 `zIndex` **只在兄弟之间比较**、子永远画在父之上，所以
       * ① 只给这一层设值就够了（不再递归整棵子树）；② 窗口的"点谁谁在最上"改用引擎的
       * `bringToFront()`（它把同层重编号成 `-(n-1) … 'auto'`，不再需要自己维护 `topZ` 计数器）。
       */
      const TASKBAR_Z_INDEX = 9000;
      const SESSION_ROOT_Z_INDEX = 9800;
      const mixHex = (from, to, t) => {
        const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const [r1, g1, b1] = parse(from);
        const [r2, g2, b2] = parse(to);
        const ch = (a, b) => Math.round(a + (b - a) * t).toString(16).padStart(2, '0');
        return `#${ch(r1, r2)}${ch(g1, g2)}${ch(b1, b2)}`;
      };

      /* ------------------------ XP 风格图标（自绘，不引外部贴图） ------------------------
       * 用引擎图元拼出拟物小图标：离线可用、任意尺寸都清晰、没有版权问题。
       * Windows 的原版图标是微软版权素材，这里一律自己画。
       */
      const iconBox = (size, children) => {
        const box = new W.ICEWidget({
          left: 0,
          top: 0,
          width: size,
          height: size,
          fill: false,
          stroke: false,
          interactive: false,
        });
        children.filter(Boolean).forEach((child) => box.addChild(child, false));
        return box;
      };
      const pixel = (left, top, width, height, color, radius = 0, extra = {}) =>
        new W.ICEWidget({
          left,
          top,
          width,
          height,
          radius,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: color },
          ...extra,
        });
      const outlined = (left, top, width, height, fill, stroke, radius = 0) =>
        new W.ICEWidget({
          left,
          top,
          width,
          height,
          radius,
          fill: true,
          stroke: true,
          interactive: false,
          style: { fillStyle: fill, strokeStyle: stroke, lineWidth: 1 },
        });
      const disc = (left, top, radius, fill, stroke) =>
        new ICE.ICECircle({
          left,
          top,
          radius,
          fill: true,
          stroke: !!stroke,
          interactive: false,
          style: { fillStyle: fill, strokeStyle: stroke || fill, lineWidth: 1 },
        });

      /** kind: computer | folder | notepad | paint | mine | ie | display | recycle | windows | arcade */
      const xpIcon = (kind, size = 32) => {
        const s = size;
        const r = (ratio) => Math.round(s * ratio);
        switch (kind) {
          case 'computer':
            return iconBox(s, [
              outlined(r(0.08), r(0.14), r(0.84), r(0.55), '#e6e6e6', '#8a8a8a', 2),
              pixel(r(0.14), r(0.2), r(0.72), r(0.42), '#1f6fd0'),
              pixel(r(0.44), r(0.69), r(0.12), r(0.1), '#d0d0d0'),
              outlined(r(0.28), r(0.79), r(0.44), r(0.08), '#c8c8c8', '#8a8a8a'),
            ]);
          case 'folder':
            return iconBox(s, [
              pixel(r(0.1), r(0.2), r(0.36), r(0.14), '#e0a92e', 1),
              outlined(r(0.06), r(0.28), r(0.86), r(0.5), '#ffd35c', '#c9a227', 2),
              pixel(r(0.12), r(0.34), r(0.74), r(0.1), '#ffe9a3'),
            ]);
          case 'notepad':
            return iconBox(s, [
              outlined(r(0.16), r(0.1), r(0.68), r(0.78), '#ffffff', '#8a8a8a', 1),
              pixel(r(0.16), r(0.1), r(0.68), r(0.14), '#316ac5'),
              pixel(r(0.24), r(0.36), r(0.5), r(0.05), '#9a9a9a'),
              pixel(r(0.24), r(0.5), r(0.5), r(0.05), '#9a9a9a'),
              pixel(r(0.24), r(0.64), r(0.34), r(0.05), '#9a9a9a'),
            ]);
          case 'paint':
            return iconBox(s, [
              new ICE.ICEEllipse({
                left: r(0.08),
                top: r(0.16),
                radiusX: r(0.42),
                radiusY: r(0.34),
                fill: true,
                stroke: true,
                interactive: false,
                style: { fillStyle: '#f2ead0', strokeStyle: '#b9a06a', lineWidth: 1 },
              }),
              disc(r(0.2), r(0.24), r(0.06), '#c1272d'),
              disc(r(0.34), r(0.22), r(0.06), '#1f6fd0'),
              disc(r(0.26), r(0.38), r(0.06), '#198754'),
              disc(r(0.42), r(0.36), r(0.06), '#ffc107'),
              pixel(r(0.5), r(0.52), r(0.42), r(0.1), '#8a5a2b', 2, { transform: { rotate: 35 } }),
            ]);
          case 'mine':
            return iconBox(s, [
              pixel(r(0.44), r(0.08), r(0.12), r(0.84), '#1b1b1b', 2),
              pixel(r(0.08), r(0.44), r(0.84), r(0.12), '#1b1b1b', 2),
              pixel(r(0.2), r(0.2), r(0.6), r(0.6), '#1b1b1b', 2, { transform: { rotate: 45 } }),
              disc(r(0.28), r(0.28), r(0.22), '#2b2b2b'),
              disc(r(0.32), r(0.3), r(0.07), '#f2f2f2'),
            ]);
          case 'ie':
            return iconBox(s, [
              disc(r(0.12), r(0.12), r(0.38), 'rgba(0,0,0,0)', '#1f6fd0'),
              new W.ICELabel({
                interactive: false,
                left: 0,
                top: 0,
                width: s,
                height: s,
                text: 'e',
                align: 'center',
                verticalAlign: 'middle',
                style: { fontSize: Math.round(s * 0.66), fontWeight: '700', fontStyle: 'italic', fillStyle: '#1f6fd0' },
              }),
            ]);
          case 'display':
            return iconBox(s, [
              outlined(r(0.06), r(0.16), r(0.88), r(0.58), '#e6e6e6', '#8a8a8a', 2),
              pixel(r(0.12), r(0.22), r(0.24), r(0.46), '#c1272d'),
              pixel(r(0.38), r(0.22), r(0.24), r(0.46), '#198754'),
              pixel(r(0.64), r(0.22), r(0.24), r(0.46), '#1f6fd0'),
              outlined(r(0.3), r(0.78), r(0.4), r(0.08), '#c8c8c8', '#8a8a8a'),
            ]);
          case 'recycle':
            return iconBox(s, [
              outlined(r(0.24), r(0.18), r(0.52), r(0.12), '#b8b8b8', '#7a7a7a', 2),
              outlined(r(0.28), r(0.3), r(0.44), r(0.54), '#d0d0d0', '#7a7a7a', 2),
              pixel(r(0.36), r(0.4), r(0.28), r(0.06), '#a8a8a8'),
              pixel(r(0.36), r(0.52), r(0.28), r(0.06), '#a8a8a8'),
            ]);
          case 'windows':
            return iconBox(s, [
              pixel(r(0.06), r(0.2), r(0.4), r(0.34), '#e8443a', 1, { transform: { rotate: -8 } }),
              pixel(r(0.5), r(0.16), r(0.4), r(0.34), '#7ab648', 1, { transform: { rotate: -8 } }),
              pixel(r(0.06), r(0.56), r(0.4), r(0.34), '#2f7bd6', 1, { transform: { rotate: -8 } }),
              pixel(r(0.5), r(0.52), r(0.4), r(0.34), '#f2c33d', 1, { transform: { rotate: -8 } }),
            ]);
          case 'arcade':
            // 掌机：机身 + 屏幕 + 十字键 + 两个按钮
            return iconBox(s, [
              outlined(r(0.16), r(0.06), r(0.68), r(0.88), '#2b3340', '#141a24', 3),
              pixel(r(0.26), r(0.16), r(0.48), r(0.3), '#7fd4ff'),
              pixel(r(0.28), r(0.56), r(0.18), r(0.07), '#d8d8d8'),
              pixel(r(0.34), r(0.5), r(0.06), r(0.19), '#d8d8d8'),
              disc(r(0.36), r(0.74), r(0.08), '#c1272d'),
              disc(r(0.62), r(0.6), r(0.08), '#e0a92e'),
            ]);
          default:
            return iconBox(s, [disc(r(0.16), r(0.16), r(0.34), '#8a8a8a', '#5a5a5a')]);
        }
      };
      /** 用横向色带拼出渐变（引擎的 fillStyle 只吃纯色）。 */
      const gradient = (parent, left, top, width, height, from, to, bands = 12, radius = 0) => {
        const nodes = [];
        for (let i = 0; i < bands; i += 1) {
          const band = new W.ICEWidget({
            left,
            top: top + (i * height) / bands,
            width,
            height: height / bands + 1,
            radius,
            fill: true,
            stroke: false,
            // 纯装饰色带：不参与命中，否则会把容器的点击吃掉
            interactive: false,
            style: { fillStyle: mixHex(from, to, i / (bands - 1)) },
          });
          parent.addChild(band, false);
          nodes.push(band);
        }
        return nodes;
      };

      /** 微软四色小旗（自绘，非官方素材）。任务栏开始按钮也要用，所以提到图标辅助区。 */
      const xpFlag = (parent, left, top, size) => {
        const gap = Math.max(2, Math.round(size * 0.07));
        const cell = (size - gap) / 2;
        const skew = Math.round(size * 0.08);
        const colors = ['#f65314', '#7cbb00', '#00a1f1', '#ffbb00'];
        [[0, 0, 0], [1, 0, skew], [0, 1, 0], [1, 1, skew]].forEach(([cx, cy, dy], index) => {
          parent.addChild(
            new W.ICEWidget({
              left: Math.round(left + cx * (cell + gap)),
              top: Math.round(top + cy * (cell + gap) - dy),
              width: Math.ceil(cell),
              height: Math.ceil(cell),
              radius: Math.max(2, Math.round(size * 0.08)),
              fill: true,
              stroke: false,
              interactive: false,
              style: { fillStyle: colors[index] },
            }),
            false,
          );
        });
      };
      /** 托盘小图标：离屏 canvas 自绘（避开画布内禁用彩色 emoji 的铁律）。返回 dataURL。 */
      const trayGlyphSrc = (kind, opts = {}) => {
        const S = 16;
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        const g = c.getContext('2d');
        if (!g) return '';
        g.lineWidth = 1.4;
        g.strokeStyle = '#eaf1fb';
        g.fillStyle = '#eaf1fb';
        if (kind === 'speaker') {
          g.beginPath();
          g.moveTo(3, 6); g.lineTo(6, 6); g.lineTo(9, 3); g.lineTo(9, 13); g.lineTo(6, 10); g.lineTo(3, 10); g.closePath();
          g.fill();
          if (opts.muted) {
            g.strokeStyle = '#ff6b6b'; g.lineWidth = 1.8;
            g.beginPath(); g.moveTo(11, 5); g.lineTo(15, 11); g.moveTo(15, 5); g.lineTo(11, 11); g.stroke();
          } else {
            g.beginPath(); g.arc(9.5, 8, 3, -0.7, 0.7); g.stroke();
            g.beginPath(); g.arc(9.5, 8, 5.5, -0.7, 0.7); g.stroke();
          }
        } else if (kind === 'shield') {
          g.beginPath();
          g.moveTo(8, 2.5); g.lineTo(13, 4.5); g.lineTo(13, 8.5);
          g.quadraticCurveTo(13, 12, 8, 14); g.quadraticCurveTo(3, 12, 3, 8.5); g.lineTo(3, 4.5); g.closePath();
          g.fillStyle = 'rgba(120,200,255,0.45)'; g.fill();
          g.strokeStyle = '#eaf1fb'; g.stroke();
        } else if (kind === 'wifi') {
          [4, 6.5, 9].forEach((r) => { g.beginPath(); g.arc(8, 14, r, Math.PI + 0.6, 2 * Math.PI - 0.6); g.stroke(); });
          g.beginPath(); g.arc(8, 14, 1.2, 0, 2 * Math.PI); g.fill();
        }
        return c.toDataURL('image/png');
      };

      /* ============================ 桌面壁纸 ============================ */
      /* ------------------------------ 壁纸（按真实 Bliss 采样数据程序化生成） ------------------------------
       * 参考图只用来量数据（天空渐变取样、山脊每列高度、草地的明暗带），不随仓库分发：
       * Windows XP 的 Bliss 是微软的版权照片，我们不能打包它。这里按量到的构图/配色
       * 用 canvas 自己"画"一张，1280×960 的原图数据折算成下面的常量。
       */
      const WALLPAPERS = {
        bliss: {
          name: '蓝天绿地（经典）',
          // 天空：顶部深蓝 → 中段 → 近地平线泛白（实测 #4680F2 / #6095F2 / #94BCF3）
          sky: ['#3d76ec', '#6095f2', '#9cc2f5'],
          // 山脊下方是暗绿，中间受光带亮黄绿，底部再转深（实测 #38511C / #74992B / #364C0A）
          hill: ['#3a5320', '#74992b', '#364c0a'],
          cloud: 'rgba(255,255,255,0.92)',
          crest: [0.55, 0.5, 0.57, 0.645],   // 起 / 控制1 / 控制2 / 终（相对高度）
          clouds: [
            [0.13, 0.07, 0.085, 0.9],
            [0.32, 0.17, 0.055, 0.7],
            [0.74, 0.05, 0.1, 0.85],
            [0.9, 0.15, 0.06, 0.6],
          ],
        },
        sunset: {
          name: '落日余晖',
          sky: ['#c95a1e', '#f2953f', '#ffe6b0'],
          hill: ['#4a3418', '#8a6a30', '#2a1c0a'],
          cloud: 'rgba(255,236,200,0.9)',
          crest: [0.58, 0.54, 0.6, 0.66],
          clouds: [
            [0.18, 0.14, 0.16, 0.55],
            [0.62, 0.08, 0.12, 0.4],
            [0.86, 0.2, 0.11, 0.35],
          ],
        },
        ocean: {
          name: '深海夜蓝',
          sky: ['#0a2450', '#14487f', '#3f83b5'],
          hill: ['#08131f', '#1c4a3a', '#040a12'],
          cloud: 'rgba(207,230,255,0.42)',
          crest: [0.6, 0.56, 0.62, 0.68],
          clouds: [
            [0.24, 0.12, 0.15, 0.3],
            [0.7, 0.18, 0.12, 0.25],
          ],
        },
      };

      // 桌面根容器与各层都是「纯布局」：interactive:false，避免挡住内部的图标/窗口/任务栏按钮
      const desktop = new W.ICEWidget({
        left: 0,
        top: 0,
        width: SCREEN_W,
        height: DESKTOP_H,
        fill: false,
        stroke: false,
        interactive: false,
      });
      // 壁纸：一层可交互的容器（点它取消图标选中）+ 一张离屏生成的位图
      const wallpaper = new W.ICEWidget({ left: 0, top: 0, width: SCREEN_W, height: DESKTOP_H, fill: false, stroke: false });
      const wallpaperImage = new ICE.ICEImage({
        left: 0,
        top: 0,
        width: SCREEN_W,
        height: DESKTOP_H,
        src: '',
      });
      wallpaper.addChild(wallpaperImage, false);
      desktop.addChild(wallpaper, false);

      /** 用离屏 canvas 生成壁纸（原生渐变 + 贝塞尔山脊 → 比自己铺色带平滑得多）。 */
      const renderWallpaper = (presetKey) => {
        const preset = WALLPAPERS[presetKey] || WALLPAPERS.bliss;
        const canvas = document.createElement('canvas');
        const scale = Math.max(1, dpr);
        canvas.width = Math.round(SCREEN_W * scale);
        canvas.height = Math.round(DESKTOP_H * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';
        ctx.scale(scale, scale);
        const W = SCREEN_W;
        const H = DESKTOP_H;

        // 1) 天空：竖向线性渐变
        const sky = ctx.createLinearGradient(0, 0, 0, H * preset.crest[0]);
        sky.addColorStop(0, preset.sky[0]);
        sky.addColorStop(0.55, preset.sky[1]);
        sky.addColorStop(1, preset.sky[2]);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        // 2) 云：径向渐变（软边），比椭圆拼块自然
        preset.clouds.forEach(([cx, cy, r, alpha]) => {
          const cxPx = cx * W;
          const cyPx = cy * H;
          const rPx = r * W;
          const puff = (dx, dy, scaleR, a) => {
            const grad = ctx.createRadialGradient(cxPx + dx * rPx, cyPx + dy * rPx * 1.6, 0, cxPx + dx * rPx, cyPx + dy * rPx * 1.6, rPx * scaleR);
            grad.addColorStop(0, `rgba(255,255,255,${(alpha * a).toFixed(3)})`);
            grad.addColorStop(0.55, `rgba(255,255,255,${(alpha * a * 0.7).toFixed(3)})`);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            const span = rPx * scaleR * 1.05;
            ctx.fillRect(cxPx + dx * rPx - span, cyPx + dy * rPx * 1.6 - span, span * 2, span * 2);
          };
          puff(0, 0, 1, 1);
          puff(-0.7, 0.25, 0.7, 0.85);
          puff(0.75, 0.2, 0.75, 0.8);
        });

        // 3) 山脊：三次贝塞尔（数据来自参考图逐列测量的脊线）
        const [c0, c1, c2, c3] = preset.crest;
        ctx.beginPath();
        ctx.moveTo(0, H * c0);
        ctx.bezierCurveTo(W * 0.2, H * c1, W * 0.62, H * c2, W, H * c3);
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();

        // 4) 草地：受光带 + 底部压暗
        const grass = ctx.createLinearGradient(0, H * 0.5, 0, H);
        grass.addColorStop(0, preset.hill[0]);
        grass.addColorStop(0.12, preset.hill[1]);
        grass.addColorStop(0.34, preset.hill[1]);
        grass.addColorStop(0.72, preset.hill[2]);
        grass.addColorStop(1, preset.hill[2]);
        ctx.fillStyle = grass;
        ctx.fill();

        // 5) 光照：右侧更亮（参考图右半边明显更亮），用一层斜向白色柔光
        const light = ctx.createLinearGradient(W, H * 0.45, W * 0.1, H);
        light.addColorStop(0, 'rgba(255,255,210,0.26)');
        light.addColorStop(0.55, 'rgba(255,255,210,0.06)');
        light.addColorStop(1, 'rgba(0,0,0,0.16)');
        ctx.fillStyle = light;
        ctx.fill();

        // 5.5) 草地颗粒：几百条极淡的短笔触，避免大片纯色显得像塑料
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, H * c0);
        ctx.bezierCurveTo(W * 0.2, H * c1, W * 0.62, H * c2, W, H * c3);
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.clip();
        let seed = 20260912;
        const rand = () => {
          seed = (seed * 1103515245 + 12345) % 2147483648;
          return seed / 2147483648;
        };
        for (let i = 0; i < 2200; i += 1) {
          const x = rand() * W;
          const y = H * 0.52 + rand() * H * 0.48;
          const len = 2 + rand() * 5;
          ctx.strokeStyle = rand() > 0.5 ? 'rgba(255,255,190,0.05)' : 'rgba(20,40,10,0.06)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (rand() - 0.5) * 3, y - len);
          ctx.stroke();
        }
        ctx.restore();

        // 6) 脊线高光：一条细的亮绿，把草地和天空的边界"点亮"
        ctx.save();
        ctx.strokeStyle = 'rgba(190,235,120,0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, H * c0);
        ctx.bezierCurveTo(W * 0.2, H * c1, W * 0.62, H * c2, W, H * c3);
        ctx.stroke();
        ctx.restore();

        return canvas.toDataURL('image/png');
      };

      const paintWallpaper = (presetKey) => {
        wallpaperImage.setState({ src: renderWallpaper(presetKey) });
        if (ice) ice.requestRepaint();
      };
      paintWallpaper('bliss');

      /* ============================ 任务栏 ============================ */
      const taskbar = new W.ICEWidget({
        id: 'taskbar',
        left: 0,
        top: DESKTOP_H,
        width: SCREEN_W,
        height: TASKBAR_H,
        fill: false,
        stroke: false,
        interactive: false,
      });
      gradient(taskbar, 0, 0, SCREEN_W, TASKBAR_H, '#245edb', '#3f8cf3', 8);
      const taskbarTop = new W.ICEWidget({
        left: 0,
        top: 0,
        width: SCREEN_W,
        height: 2,
        fill: true,
        stroke: false,
        style: { fillStyle: '#7aa9f7' },
      });
      taskbar.addChild(taskbarTop, false);

      const startButton = new W.ICEWidget({
        id: 'start-button',
        left: 0,
        top: 0,
        width: 108,
        height: TASKBAR_H,
        fill: false,
        stroke: false,
      });
      gradient(startButton, 2, 2, 92, TASKBAR_H - 4, '#3c8c1e', '#7ad04a', 8, 10);
      // 真实四色波浪旗（替代原来的 ⊞ 近似符）
      xpFlag(startButton, 12, (TASKBAR_H - 18) / 2, 18);
      startButton.addChild(
        new W.ICELabel({
          interactive: false,
          left: 36,
          top: 0,
          width: 68,
          height: TASKBAR_H,
          text: '开始',
          verticalAlign: 'middle',
          style: { fontSize: 14, fontWeight: '700', fontStyle: 'normal', fillStyle: '#ffffff', fontFamily: XPFONT },
        }),
        false,
      );
      taskbar.addChild(startButton, false);

      const clockLabel = new W.ICELabel({
        id: 'tray-clock',
        interactive: false,
        left: SCREEN_W - 86,
        top: 0,
        width: 78,
        height: TASKBAR_H,
        text: '00:00',
        align: 'center',
        verticalAlign: 'middle',
        style: { fontSize: 12, fillStyle: '#ffffff', fontFamily: XPFONT },
      });
      const tray = new W.ICEWidget({
        left: SCREEN_W - 190,
        top: 2,
        width: 186,
        height: TASKBAR_H - 4,
        radius: 4,
        fill: true,
        stroke: false,
        interactive: false,
        style: { fillStyle: 'rgba(255,255,255,0.14)' },
      });
      // 托盘图标：自绘（不用 emoji，避免画布内渲染成方框，也符合禁 emoji 铁律）
      const trayLabel = new W.ICEWidget({
        id: 'tray-icons',
        left: 6,
        top: 0,
        width: 96,
        height: TASKBAR_H - 4,
        fill: false,
        stroke: false,
        interactive: false,
      });
      const glyphY = (TASKBAR_H - 4 - 16) / 2;
      const speakerImg = new ICE.ICEImage({ left: 2, top: glyphY, width: 16, height: 16, src: trayGlyphSrc('speaker', { muted: false }) });
      const shieldImg = new ICE.ICEImage({ left: 24, top: glyphY, width: 16, height: 16, src: trayGlyphSrc('shield') });
      const wifiImg = new ICE.ICEImage({ left: 46, top: glyphY, width: 16, height: 16, src: trayGlyphSrc('wifi') });
      trayLabel.addChild(speakerImg, false);
      trayLabel.addChild(shieldImg, false);
      trayLabel.addChild(wifiImg, false);
      tray.addChild(trayLabel, false);
      /** 点托盘里的喇叭静音 / 取消静音（开机音、注销音都归它管）。 */
      const traySoundToggle = new W.ICEWidget({
        id: 'tray-sound',
        left: 0,
        top: 0,
        width: 26,
        height: TASKBAR_H - 4,
        radius: 3,
        fill: false,
        stroke: false,
      });
      traySoundToggle.on('click', () => {
        sound.enabled = !sound.enabled;
        speakerImg.setState({ src: trayGlyphSrc('speaker', { muted: !sound.enabled }) });
        if (sound.enabled) playCue('click');
        toast(sound.enabled ? '音效已开启' : '音效已关闭', 'info');
      });
      tray.addChild(traySoundToggle, false);
      taskbar.addChild(tray, false);
      taskbar.addChild(clockLabel, false);

      // 任务栏按钮区（打开窗口后往里加按钮）
      const taskButtons = new W.ICEWidget({
        left: 116,
        top: 4,
        width: SCREEN_W - 314,
        height: TASKBAR_H - 8,
        fill: false,
        stroke: false,
        interactive: false,
      });
      taskbar.addChild(taskButtons, false);

      /* ============================ 窗口系统 ============================ */
      const iconLayer = new W.ICEWidget({ left: 0, top: 0, width: SCREEN_W, height: DESKTOP_H, fill: false, stroke: false, interactive: false });
      desktop.addChild(iconLayer, false);
      // ⚠️ `interactive: false` 不能漏：全屏容器可命中就会吞掉下面整层（桌面图标点不动）。
      // 引擎 2.13.0 起渲染/命中是「树序 + 兄弟按 zIndex」——后加的兄弟在上面，漏掉立刻暴露。
      const windowLayer = new W.ICEWidget({ left: 0, top: 0, width: SCREEN_W, height: DESKTOP_H, fill: false, stroke: false, interactive: false });
      desktop.addChild(windowLayer, false);

      const openWindows = new Map();
      let activeKey = null;

        const refreshTaskButtons = () => {
          taskButtons.removeChildren([...taskButtons.childNodes]);
          // 任务栏按钮区夹在「开始按钮」与「托盘/时钟」之间；窗口多了就按真实 XP 那样把按钮压窄，
          // 避免第 8 个按钮溢出 1440 桌面宽（之前因此被 e2e 排除，现已修好可正常排布）。
          const gap = 4;
          const areaLeft = taskButtons.state.left;
          const areaRight = SCREEN_W - 198;
          const count = openWindows.size;
          const btnW = count > 0 ? Math.max(96, Math.min(168, Math.floor((areaRight - areaLeft - (count - 1) * gap) / count))) : 168;
          let left = 0;
        openWindows.forEach((entry, key) => {
          const active = activeKey === key && !entry.minimized;
          const button = new W.ICEWidget({
            id: 'task-' + key,
            left,
            top: 0,
            width: btnW,
            height: TASKBAR_H - 8,
            radius: 3,
            fill: true,
            stroke: true,
            style: {
              fillStyle: active ? '#1c4fbd' : 'rgba(255,255,255,0.22)',
              strokeStyle: active ? '#0a246a' : 'rgba(255,255,255,0.35)',
              lineWidth: 1,
            },
          });
          button.addChild(
            new W.ICELabel({
              interactive: false,
              left: 30,
              top: 0,
              width: Math.max(20, btnW - 36),
              height: TASKBAR_H - 8,
              text: entry.title,
              verticalAlign: 'middle',
              style: { fontSize: 12, fillStyle: '#ffffff', fontFamily: XPFONT },
            }),
            false,
          );
          const buttonIcon = xpIcon(entry.iconKind, 16);
          buttonIcon.setState({ left: 8, top: Math.round((TASKBAR_H - 8 - 16) / 2) });
          button.addChild(buttonIcon, false);
          button.on('click', () => {
            if (entry.minimized) {
              showWindow(key);
            } else if (activeKey === key) {
              minimizeWindow(key);
            } else {
              focusWindow(key);
            }
          });
          taskButtons.addChild(button, false);
          // 任务按钮是动态创建的：它在 `taskButtons` 里没有兄弟竞争，而 `taskButtons` 本身
          // 是在任务栏的渐变带**之后**加入的 → 同层按加入顺序就在色带之上，不需要再抬 zIndex
          //（曾经写死 9001 是为了绕开"整棵子树递归设成 9000"那个历史写法）。
          left += btnW + gap;
        });
        ice.requestRepaint();
      };

      const focusWindow = (key) => {
        const entry = openWindows.get(key);
        if (!entry) return;
        entry.minimized = false;
        entry.window.setState({ display: true });
        activeKey = key;
        entry.window.bringToFront();
        openWindows.forEach((other, otherKey) => other.window.setActive(otherKey === key));
        refreshTaskButtons();
      };

      const minimizeWindow = (key) => {
        const entry = openWindows.get(key);
        if (!entry) return;
        entry.minimized = true;
        entry.window.setState({ display: false });
        if (activeKey === key) activeKey = null;
        refreshTaskButtons();
      };

      const showWindow = (key) => focusWindow(key);

      const closeWindow = (key) => {
        const entry = openWindows.get(key);
        if (!entry) return;
        // 应用自己的收尾（比如 Arcade 要停掉它那个 60ms 的步进定时器）
        if (typeof entry.onClosed === 'function') entry.onClosed();
        windowLayer.removeChild(entry.window);
        openWindows.delete(key);
        if (activeKey === key) activeKey = null;
        refreshTaskButtons();
        toast(`已关闭：${entry.title}`, 'info');
      };

      const openApp = (app) => {
        const existing = openWindows.get(app.key);
        if (existing) {
          focusWindow(app.key);
          return;
        }
        const offset = openWindows.size * 26;
        const win = new W.ICEWindow({
          id: 'window-' + app.key,
          title: app.title,
          iconNode: xpIcon(app.iconKind, 16),
          left: Math.min(360, 120 + offset),
          top: 60 + offset,
          width: app.width,
          height: app.height,
          bounds: desktopBox,
          minWidth: 320,
          minHeight: 220,
          content: app.build(),
          onClose: () => closeWindow(app.key),
          onMinimize: () => minimizeWindow(app.key),
          onActivate: () => {
            activeKey = app.key;
            win.bringToFront();
            openWindows.forEach((other, otherKey) => other.window.setActive(otherKey === app.key));
            refreshTaskButtons();
          },
        });
        windowLayer.addChild(win, false);
        openWindows.set(app.key, {
          window: win,
          title: app.title,
          icon: app.icon,
          iconKind: app.iconKind,
          minimized: false,
          onClosed: app.onClosed,
        });
        focusWindow(app.key);
        // 应用可以在窗口就绪后调整自身尺寸（例如扫雷按难度换棋盘大小）
        if (typeof app.onOpened === 'function') {
          app.onOpened(win);
        }
      };

      /* ============================ 应用：我的电脑 ============================ */
      const buildMyComputer = () => {
        const pane = new W.ICEWidget({ width: 100, height: 100, fill: false, stroke: false, interactive: false });
        const leftPanel = new W.ICEPanel({ left: 0, top: 0, width: 220, height: 100, style: { fillStyle: '#d6e5fb' } });
        leftPanel.addChild(
          new W.ICELabel({
            left: 12,
            top: 12,
            width: 196,
            text: '系统任务',
            style: { fontSize: 12, fontWeight: '700', fillStyle: '#0a246a' },
          }),
          false,
        );
        const tree = new W.ICETree({
          left: 12,
          top: 38,
          width: 196,
          height: 220,
          defaultExpandAll: true,
          nodes: [
            {
              key: 'desktop',
              label: '桌面',
              children: [
                { key: 'local', label: '本地磁盘 (C:)' },
                { key: 'data', label: '数据盘 (D:)' },
                { key: 'cdrom', label: 'DVD 驱动器 (E:)' },
              ],
            },
          ],
          onSelect: (node) => node && toast('选中：' + node.label, 'info'),
        });
        leftPanel.addChild(tree, false);
        const rightPanel = new W.ICEPanel({ left: 0, top: 0, width: 100, height: 100, style: { fillStyle: '#ffffff' } });
        const drives = new W.ICETable({
          left: 0,
          top: 0,
          width: 100,
          rowHeight: 34,
          columns: [
            { key: 'name', title: '名称' },
            { key: 'type', title: '类型' },
            { key: 'total', title: '总大小', align: 'right' },
            { key: 'free', title: '可用空间', align: 'right' },
          ],
          data: [
            { name: '本地磁盘 (C:)', type: '系统盘', total: '120 GB', free: '38.4 GB' },
            { name: '数据盘 (D:)', type: '本地磁盘', total: '512 GB', free: '221 GB' },
            { name: 'DVD 驱动器 (E:)', type: '光驱', total: '—', free: '—' },
            { name: 'U 盘 (F:)', type: '可移动磁盘', total: '32 GB', free: '12.6 GB' },
          ],
          onSelect: (row) => row && toast('打开：' + row.name, 'info'),
        });
        const info = new W.ICEDescriptions({
          left: 0,
          top: 0,
          width: 100,
          // 两列（XP 风格）：长值现在会被自动截断成省略号（ICEDescriptions 的超宽省略）
          column: 2,
          labelWidth: 66,
          items: [
            { label: '处理器', value: 'Intel Pentium 4 2.4GHz' },
            { label: '内存', value: '512 MB' },
            { label: '操作系统', value: 'Microsoft Windows XP' },
            { label: 'Service Pack', value: 'Service Pack 3' },
          ],
        });
        const splitter = new W.ICESplitter({
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          size: 228,
          min: 160,
          first: leftPanel,
          second: rightPanel,
        });
        rightPanel.addChildren([drives, info], { align: 'top' });
        rightPanel.addChild(
          new W.ICELabel({
            left: 12,
            top: 348,
            width: 320,
            text: '驱动器列表可以直接点行选中（表格），右侧显示系统信息（描述列表）。',
            style: { fontSize: 11, fillStyle: '#6c757d' },
          }),
          false,
        );
        drives.setState({ left: 12, top: 12 });
        info.setState({ left: 12, top: 196 });
        const layout = () => {
          const width = Number(pane.state.width) || 600;
          const height = Number(pane.state.height) || 400;
          splitter.setState({ width, height });
          rightPanel.setState({});
          const second = Math.max(200, width - 228 - 6);
          drives.setState({ width: second - 24 });
          info.setState({ width: second - 24 });
        };
        pane.addChild(splitter, false);
        pane.revalidate = function () {
          W.ICEWidget.prototype.revalidate.call(this);
          layout();
          return this;
        };
        setTimeout(layout, 0);
        handles.computer = { splitter, drives, tree };
        return pane;
      };

      /* ============================ 应用：记事本 ============================ */
      const buildNotepad = () => {
        const pane = new W.ICEWidget({
          width: 100,
          height: 100,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#ffffff' },
        });
        const menus = ['文件', '编辑', '格式', '查看', '帮助'];
        let left = 6;
        menus.forEach((label) => {
          const button = new W.ICEButton({ left, top: 4, width: 52, height: 22, text: label, size: 'small', variant: 'text' });
          pane.addChild(button, false);
          left += 54;
          if (label === '文件') {
            W.attachDropdown(ice, button, {
              items: [
                { key: 'new', label: '新建' },
                { key: 'save', label: '保存' },
                { key: 'exit', label: '退出' },
              ],
              onSelect: (item) => {
                if (item.key === 'exit') {
                  closeWindow('notepad');
                  return;
                }
                toast(item.key === 'new' ? '已新建文档' : '已保存到 C:\\我的文档\\未命名.txt', 'info');
              },
            });
          }
        });
        const editor = new W.ICETextArea({
          id: 'notepad-editor',
          left: 6,
          top: 30,
          width: 100,
          height: 100,
          value:
            '欢迎使用 ICE 记事本\r\n' +
            '\r\n' +
            '这个窗口里的所有像素都是 canvas 画的：\r\n' +
            '  · 标题栏、按钮、菜单、状态栏 —— 用组件库拼出来\r\n' +
            '  · 拖动标题栏可以移动窗口，双击任务栏按钮可以最小化\r\n' +
            '  · 右下角拖动可以改窗口大小\r\n',
        });
        const status = new W.ICELabel({
          left: 6,
          top: 100,
          width: 100,
          height: 20,
          text: '第 1 行，第 1 列    |    UTF-8    |    12 KB',
          style: { fontSize: 11, fillStyle: '#6c757d' },
        });
        pane.addChild(editor, false);
        pane.addChild(status, false);
        const layout = () => {
          const width = Number(pane.state.width) || 500;
          const height = Number(pane.state.height) || 400;
          const w = width - 12;
          editor.setState({ width: w, height: height - 56 });
          // 引擎文本节点按初始 width(100) 量过一次，改宽后必须重算，否则首行被省略号截断
          if (typeof editor.__sync === 'function') editor.__sync();
          status.setState({ top: height - 24, width: w });
          // 状态栏同理：标签内文字节点宽度要跟着改，否则「第 1 行…」被截成省略号
          const statusText = status.getText();
          if (status.textNode) status.textNode.setState({ width: w });
          status.setText(statusText);
        };
        pane.revalidate = function () {
          W.ICEWidget.prototype.revalidate.call(this);
          layout();
          return this;
        };
        setTimeout(layout, 0);
        handles.notepad = { editor, status };
        return pane;
      };

      /* ============================ 应用：画图 ============================ */
      class XPaintCanvas extends W.ICEWidget {
        constructor(props) {
          super({ fill: true, stroke: true, style: { fillStyle: '#ffffff', strokeStyle: '#a0a0a0' }, ...props });
          this.strokes = [];
          this.color = '#c1272d';
          this.brushWidth = 3;
          this.drawing = false;
          this.bound = false;
        }

        setColor(color) {
          this.color = color;
        }

        setBrushWidth(width) {
          this.brushWidth = width;
        }

        clear() {
          this.strokes = [];
          this.removeChildren([...this.childNodes]);
          this.revalidate();
        }

        getStrokeCount() {
          return this.strokes.length;
        }

        afterAddHandler() {
          super.afterAddHandler();
          if (this.bound || !this.ice || !this.ice.evtBus) return;
          this.bound = true;
          this.ice.evtBus.on('mousedown', this.__down, this);
          this.ice.evtBus.on('mousemove', this.__move, this);
          this.ice.evtBus.on('mouseup', this.__up, this);
        }

        __local(evt) {
          if (!this.ice || typeof this.ice.screenToWorld !== 'function') return null;
          const [wx, wy] = this.ice.screenToWorld(evt.offsetX, evt.offsetY);
          let left = 0;
          let top = 0;
          let node = this;
          while (node && node.state) {
            left += Number(node.state.left) || 0;
            top += Number(node.state.top) || 0;
            node = node.parentNode;
          }
          const x = wx - left;
          const y = wy - top;
          if (x < 0 || y < 0 || x > Number(this.state.width) || y > Number(this.state.height)) return null;
          return [x, y];
        }

        __down(evt) {
          const point = this.__local(evt);
          if (!point) return;
          this.drawing = true;
          this.current = [point];
          this.currentLine = new ICE.ICEPolyLine({
            points: [point, [point[0] + 0.5, point[1] + 0.5]],
            stroke: true,
            fill: false,
            style: { strokeStyle: this.color, lineWidth: this.brushWidth, lineCap: 'round' },
          });
          this.addChild(this.currentLine, false);
        }

        __move(evt) {
          if (!this.drawing) return;
          const point = this.__local(evt);
          if (!point) return;
          this.current.push(point);
          this.currentLine.setState({ points: this.current.slice() });
          if (this.ice) this.ice.requestRepaint();
        }

        __up() {
          if (!this.drawing) return;
          this.drawing = false;
          this.strokes.push({ points: this.current, color: this.color, width: this.brushWidth });
          this.current = null;
          this.currentLine = null;
          this.revalidate();
        }
      }

      const buildPaint = () => {
        const pane = new W.ICEWidget({ width: 100, height: 100, fill: false, stroke: false, interactive: false });
        const toolPanel = new W.ICEPanel({
          left: 0,
          top: 0,
          width: 150,
          height: 100,
          interactive: false,
          style: { fillStyle: '#ece9d8' },
        });
        const canvas = new XPaintCanvas({ left: 0, top: 0, width: 100, height: 100 });
        const colors = ['#000000', '#c1272d', '#0d6efd', '#198754', '#ffc107', '#fd7e14'];
        /** 调色板是 3 列的格子（28×28，间距 6）→ 等分网格交给 ICEGridLayout。 */
        const swatchGrid = new W.ICEWidget({ left: 12, top: 14, width: 3 * 28 + 2 * 6, height: 2 * 28 + 6, fill: false, stroke: false, interactive: false });
        swatchGrid.setLayout(new ICE.ICEGridLayout({ cols: 3, gapX: 6, gapY: 6 }));
        toolPanel.addChild(swatchGrid, false);
        colors.forEach((color, index) => {
          const swatch = new W.ICEWidget({
            id: 'paint-color-' + index,
            width: 28,
            height: 28,
            radius: 4,
            fill: true,
            stroke: true,
            style: { fillStyle: color, strokeStyle: '#8a8a8a', lineWidth: 1 },
          });
          swatch.on('click', () => {
            canvas.setColor(color);
            toast('画笔颜色：' + color, 'info');
          });
          swatchGrid.addChild(swatch, false);
        });
        const widthLabel = new W.ICELabel({
          left: 12,
          top: 96,
          width: 108,
          height: 18,
          text: '笔刷粗细',
          style: { fontSize: 11, fillStyle: '#333333' },
        });
        const brush = new W.ICESlider({
          left: 12,
          top: 116,
          width: 108,
          height: 18,
          min: 1,
          max: 12,
          value: 3,
          onChange: (value) => {
            canvas.setBrushWidth(Number(value));
            widthLabel.setText('笔刷粗细：' + value);
          },
        });
        const clearButton = new W.ICEButton({ left: 12, top: 146, width: 108, height: 26, text: '清空画布', size: 'small' });
        clearButton.on('click', () => {
          canvas.clear();
          toast('画布已清空', 'info');
        });
        const hint = new W.ICELabel({
          left: 12,
          top: 182,
          width: 126,
          text: '左键拖动即可作画',
          style: { fontSize: 11, fillStyle: '#6c757d' },
        });
        toolPanel.addChildren([widthLabel, brush, clearButton, hint], { align: 'top' });
        pane.addChild(toolPanel, false);
        pane.addChild(canvas, false);
        const layout = () => {
          const width = Number(pane.state.width) || 600;
          const height = Number(pane.state.height) || 400;
          toolPanel.setState({ height });
          canvas.setState({ left: 156, top: 8, width: width - 164, height: height - 16 });
        };
        pane.revalidate = function () {
          W.ICEWidget.prototype.revalidate.call(this);
          layout();
          return this;
        };
        setTimeout(layout, 0);
        handles.paint = { canvas, toolPanel };
        return pane;
      };

      /* ============================ 应用：扫雷（ICEMinesweeperModel 驱动） ============================ */
      const buildMinesweeper = () => {
        const CELL = 22;
        const pane = new W.ICEWidget({
          width: 100,
          height: 100,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#ece9d8' },
        });

        /** 每档难度的最佳成绩（存 localStorage，按难度分开记）。 */
        const bestTimes = {};
        const BEST_KEY = 'ice-xp-minesweeper-best';
        const loadBest = () => {
          try {
            Object.assign(bestTimes, JSON.parse(localStorage.getItem(BEST_KEY) || '{}'));
          } catch (err) {
            /* file:// 下不可用时忽略 */
          }
        };
        const saveBest = () => {
          try {
            localStorage.setItem(BEST_KEY, JSON.stringify(bestTimes));
          } catch (err) {
            /* 忽略 */
          }
        };
        loadBest();

        let difficulty = 'beginner';
        let preset = W.ICE_MINESWEEPER_DIFFICULTIES.find((d) => d.key === difficulty);
        let model = new W.ICEMinesweeperModel({ rows: preset.rows, cols: preset.cols, mines: preset.mines });
        let cells = [];
        let timerHandle = null;

        /* ---- 顶部：难度 / LED 计数器 / 笑脸 / 计时 ---- */
        const difficultyBar = new W.ICEWidget({
          left: 6,
          top: 6,
          width: 100,
          height: 24,
          fill: false,
          stroke: false,
          interactive: false,
        });
        /** 难度档位是一行按钮（58 宽 + 4 间距）→ 横向 BoxLayout。 */
        difficultyBar.setLayout(new ICE.ICEBoxLayout({ axis: 'x', gap: 4 }));
        const difficultyButtons = W.ICE_MINESWEEPER_DIFFICULTIES.map((item) => {
          const button = new W.ICEButton({
            id: 'mine-difficulty-' + item.key,
            width: 58,
            height: 22,
            text: item.label,
            size: 'small',
            variant: item.key === difficulty ? 'primary' : 'default',
          });
          button.on('click', () => setDifficulty(item.key));
          difficultyBar.addChild(button, false);
          return { key: item.key, button };
        });
        const bestLabel = new W.ICELabel({
          id: 'mine-best',
          interactive: false,
          left: 196,
          top: 0,
          width: 140,
          height: 22,
          verticalAlign: 'middle',
          text: '',
          style: { fontSize: 11, fillStyle: '#4a4a4a' },
        });
        difficultyBar.addChild(bestLabel, false);

        const led = (left, width, id) =>
          new W.ICELabel({
            id,
            interactive: false,
            left,
            top: 5,
            width,
            height: 24,
            text: '000',
            align: 'center',
            verticalAlign: 'middle',
            style: { fontSize: 18, fontWeight: '700', fillStyle: '#ff2a2a', fontFamily: '"Courier New", monospace' },
          });
        const panelTop = new W.ICEWidget({
          left: 6,
          top: 36,
          width: 100,
          height: 34,
          radius: 3,
          fill: true,
          stroke: true,
          interactive: false,
          style: { fillStyle: '#bdbdbd', strokeStyle: '#8a8a8a', lineWidth: 1 },
        });
        const counterLed = led(10, 60, 'mine-counter');
        const timerLed = led(100, 60, 'mine-timer');
        const counterBack = new W.ICEWidget({
          left: 8,
          top: 3,
          width: 64,
          height: 28,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#1b1b1b' },
        });
        const timerBack = new W.ICEWidget({
          left: 96,
          top: 3,
          width: 64,
          height: 28,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#1b1b1b' },
        });
        const face = new W.ICEButton({ id: 'mine-reset', left: 60, top: 3, width: 34, height: 28, text: '🙂', size: 'small' });
        panelTop.addChildren([counterBack, timerBack, counterLed, timerLed, face], { align: 'top' });

        const board = new W.ICEWidget({
          left: 6,
          top: 76,
          width: 100,
          height: 100,
          fill: false,
          stroke: false,
          interactive: false,
        });
        const hint = new W.ICELabel({
          interactive: false,
          left: 6,
          top: 100,
          width: 100,
          text: '左键掀开 · 右键插旗（🚩/❓ 循环）· 双击数字快速展开',
          style: { fontSize: 11, fillStyle: '#5a5a5a' },
        });
        pane.addChildren([difficultyBar, panelTop, board, hint], { align: 'top' });

        const NUMBER_COLORS = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];
        const pad3 = (value) => {
          const clamped = Math.max(-99, Math.min(999, Math.round(value)));
          const text = String(Math.abs(clamped)).padStart(2, '0');
          return (clamped < 0 ? '-' : '') + text.padStart(clamped < 0 ? 2 : 3, '0');
        };
        const smiley = () => {
          if (model.isWon()) return '😎';
          if (model.isLost()) return '😵';
          return '🙂';
        };

        /** 按模型状态画一个格子（只改必要属性，避免每次全量重建）。 */
        const paintCell = (entry) => {
          const cell = model.getCell(entry.row, entry.col);
          if (!cell) return;
          const unrevealed = !cell.revealed;
          entry.node.setState({
            style: {
              ...entry.node.state.style,
              fillStyle: cell.revealed ? (cell.mine ? '#ff6b6b' : '#e6e6e6') : '#c0c0c0',
              strokeStyle: cell.revealed ? '#b0b0b0' : '#8a8a8a',
            },
          });
          if (cell.flagged) {
            entry.label.setText('🚩');
            entry.label.setState({ style: { ...entry.label.state.style, fillStyle: '#c1272d' } });
          } else if (cell.question) {
            entry.label.setText('❓');
            entry.label.setState({ style: { ...entry.label.state.style, fillStyle: '#0a246a' } });
          } else if (cell.revealed && cell.mine) {
            entry.label.setText('💣');
            entry.label.setState({ style: { ...entry.label.state.style, fillStyle: '#1b1b1b' } });
          } else if (cell.revealed && cell.adjacent > 0) {
            entry.label.setText(String(cell.adjacent));
            entry.label.setState({ style: { ...entry.label.state.style, fillStyle: NUMBER_COLORS[cell.adjacent] } });
          } else {
            entry.label.setText('');
          }
          void unrevealed;
        };

        /** 全量刷新：LED / 笑脸 / 每个格子。 */
        const sync = () => {
          counterLed.setText(pad3(model.getMinesLeft()));
          timerLed.setText(pad3(model.getElapsed()));
          face.setText(smiley());
          cells.forEach(paintCell);
          if (model.isWon()) {
            const best = bestTimes[difficulty];
            const elapsed = model.getElapsed();
            if (best === undefined || elapsed < best) {
              bestTimes[difficulty] = elapsed;
              saveBest();
            }
            onWin();
          }
          if (model.isLost()) {
            onLose();
          }
          updateBestLabel();
          ice.requestRepaint();
        };

        let announced = null;
        const onWin = () => {
          if (announced === 'won') return;
          announced = 'won';
          W.ICENotification.open(ice, {
            title: '扫雷胜利！',
            description: `${preset.label} · 用时 ${model.getElapsed()} 秒`,
            type: 'success',
          });
        };
        const onLose = () => {
          if (announced === 'lost') return;
          announced = 'lost';
          toast('踩到雷了，点笑脸重开', 'error');
        };
        const updateBestLabel = () => {
          const best = bestTimes[difficulty];
          bestLabel.setText(best === undefined ? '最佳成绩：--' : `最佳成绩：${best} 秒`);
        };

        /** 按当前难度重建棋盘（难度切换 / 重开都会走这里）。 */
        const rebuild = () => {
          board.removeChildren([...board.childNodes]);
          cells = [];
          const { rows, cols } = { rows: model.getRows(), cols: model.getCols() };
          for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
              const node = new W.ICEWidget({
                id: `mine-${row}-${col}`,
                left: col * CELL,
                top: row * CELL,
                width: CELL - 1,
                height: CELL - 1,
                radius: 0,
                fill: true,
                stroke: true,
                style: { fillStyle: '#c0c0c0', strokeStyle: '#8a8a8a', lineWidth: 1 },
              });
              const label = new W.ICELabel({
                interactive: false,
                left: 0,
                top: 0,
                width: CELL - 1,
                height: CELL - 1,
                text: '',
                align: 'center',
                verticalAlign: 'middle',
                style: { fontSize: 13, fontWeight: '700', fillStyle: '#000000', fontFamily: 'Tahoma, sans-serif' },
              });
              node.addChild(label, false);
              const entry = { row, col, node, label };
              node.on('click', () => {
                model.reveal(row, col);
              });
              node.on('dblclick', () => {
                model.chord(row, col);
              });
              node.on('contextmenu', () => {
                model.toggleFlag(row, col);
              });
              board.addChild(node, false);
              cells.push(entry);
            }
          }
          board.setState({ width: cols * CELL, height: rows * CELL });
          layout();
          sync();
        };

        const layout = () => {
          const rows = model.getRows();
          const cols = model.getCols();
          const boardWidth = cols * CELL;
          const boardHeight = rows * CELL;
          // 顶部栏需要容下「3 个难度按钮(58+4 间距≈182) + 最佳成绩标签(left190,宽140)≈336」，
          // 比 beginner 棋盘(198)更宽；窗口默认 minWidth:320 会把它钳回去，导致 bestLabel 越界。
          // 这里把窗宽下限抬到 348，确保顶部栏完整落在窗口框内（不再依赖被钳的 minWidth）。
          const width = Math.max(240, boardWidth + 12, 348);
          const height = 76 + boardHeight + 34;
          pane.setState({ width, height });
          panelTop.setState({ width: width - 12 });
          difficultyBar.setState({ width: width - 12 });
          timerLed.setState({ left: width - 76 });
          timerBack.setState({ left: width - 78 });
          hint.setState({ top: 76 + boardHeight + 8, width: width - 12 });
          bestLabel.setState({ left: 190 });
          // 让外面的窗口跟着棋盘尺寸走（XP 的扫雷窗口也是随难度变的）
          const entry = openWindows.get('minesweeper');
          if (entry && entry.window) {
            entry.window.setSize(width + 6, height + 34);
          }
        };

        const setDifficulty = (key) => {
          const next = W.ICE_MINESWEEPER_DIFFICULTIES.find((item) => item.key === key);
          if (!next || next.key === difficulty) return;
          difficulty = next.key;
          preset = next;
          difficultyButtons.forEach((item) => item.button.setState({ variant: item.key === difficulty ? 'primary' : 'default' }));
          model.reset({ rows: next.rows, cols: next.cols, mines: next.mines });
          announced = null;
          rebuild();
        };

        const restart = () => {
          model.reset({ rows: preset.rows, cols: preset.cols, mines: preset.mines });
          announced = null;
          rebuild();
        };
        face.on('click', restart);

        // 模型变化 → 刷新界面（点击、插旗、胜负都走这里）
        model.addChangeListener(() => sync());
        // 计时：每秒 tick 一次；模型结束后自己不再累加
        timerHandle = setInterval(() => {
          if (model.getState() === 'playing') {
            model.tick();
            timerLed.setText(pad3(model.getElapsed()));
          }
        }, 1000);

        rebuild();
        handles.mines = {
          model,
          cells: () => cells,
          counter: counterLed,
          timer: timerLed,
          face,
          board,
          bestLabel,
          restart,
          setDifficulty,
          getDifficulty: () => difficulty,
          cellAt: (row, col) => cells.find((entry) => entry.row === row && entry.col === col),
          stopTimer: () => timerHandle && clearInterval(timerHandle),
          fit: layout,
        };
        return pane;
      };

      /* ============================ 应用：显示属性 ============================ */
      const buildDisplayProperties = () => {
        const pane = new W.ICEWidget({
          width: 100,
          height: 100,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#ece9d8' },
        });
        const preview = new W.ICEWidget({
          left: 16,
          top: 16,
          width: 200,
          height: 130,
          radius: 4,
          fill: true,
          stroke: true,
          style: { fillStyle: '#1b4fa8', strokeStyle: '#808080' },
        });
        const previewBand = new W.ICEWidget({
          left: 0,
          top: 78,
          width: 200,
          height: 52,
          radius: 4,
          fill: true,
          stroke: false,
          style: { fillStyle: '#3f8c22' },
        });
        preview.addChild(previewBand, false);
        const label = new W.ICELabel({
          left: 16,
          top: 156,
          width: 200,
          text: '在下面挑一张壁纸，点「应用」立即生效。',
          style: { fontSize: 11, fillStyle: '#4a4a4a' },
        });
        const group = new W.ICERadioGroup({
          id: 'wallpaper-choice',
          left: 236,
          top: 24,
          width: 220,
          direction: 'vertical',
          value: currentWallpaper,
          options: [
            { value: 'bliss', label: '蓝天绿地（经典）' },
            { value: 'sunset', label: '落日余晖' },
            { value: 'ocean', label: '深海夜蓝' },
          ],
          onChange: (value) => {
            const preset = WALLPAPERS[value];
            preview.setState({ style: { ...preview.state.style, fillStyle: preset.sky[0] } });
            previewBand.setState({ style: { ...previewBand.state.style, fillStyle: preset.hill[0] } });
          },
        });
        const applyButton = new W.ICEButton({ left: 236, top: 196, width: 92, height: 26, text: '应用' });
        const cancelButton = new W.ICEButton({ left: 336, top: 196, width: 92, height: 26, text: '取消', variant: 'default' });
        applyButton.on('click', () => {
          setWallpaper(group.getValue());
          toast('壁纸已应用：' + WALLPAPERS[group.getValue()].name, 'success');
          closeWindow('display');
        });
        cancelButton.on('click', () => closeWindow('display'));
        pane.addChildren([preview, label, group, applyButton, cancelButton], { align: 'top' });
        handles.display = { group, applyButton, preview };
        return pane;
      };

      /* ============================ 应用：我的文档 ============================ */
      const buildMyDocuments = () => {
        const pane = new W.ICEWidget({
          width: 100,
          height: 100,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#ffffff' },
        });
        const toolbar = new W.ICEButton({ left: 12, top: 10, width: 108, height: 26, text: '新建文件夹', size: 'small' });
        toolbar.on('click', () => toast('已新建文件夹', 'success'));
        const table = new W.ICETable({
          id: 'documents-table',
          left: 12,
          top: 46,
          width: 100,
          rowHeight: 32,
          columns: [
            { key: 'name', title: '名称' },
            { key: 'type', title: '类型', width: 110 },
            { key: 'size', title: '大小', width: 90, align: 'right' },
            { key: 'date', title: '修改日期', width: 130 },
          ],
          data: [
            { name: '季度总结.doc', type: 'Word 文档', size: '248 KB', date: '2026-09-10' },
            { name: '预算表.xls', type: 'Excel 工作表', size: '96 KB', date: '2026-09-08' },
            { name: '产品图.jpg', type: 'JPEG 图像', size: '1.2 MB', date: '2026-09-06' },
            { name: '安装说明.txt', type: '文本文档', size: '4 KB', date: '2026-09-04' },
            { name: '会议纪要.doc', type: 'Word 文档', size: '132 KB', date: '2026-09-02' },
            { name: '归档.zip', type: '压缩文件', size: '18.4 MB', date: '2026-08-30' },
            { name: '通讯录.csv', type: 'CSV 文件', size: '12 KB', date: '2026-08-28' },
            { name: '桌面截图.png', type: 'PNG 图像', size: '860 KB', date: '2026-08-26' },
            { name: '备份.bak', type: '备份文件', size: '204 MB', date: '2026-08-20' },
          ],
          pagination: { pageSize: 5, showTotal: true },
          onSelect: (row) => row && toast('打开：' + row.name, 'info'),
        });
        pane.addChild(toolbar, false);
        pane.addChild(table, false);
        const layout = () => {
          const width = Number(pane.state.width) || 600;
          const height = Number(pane.state.height) || 400;
          table.setState({ width: width - 24 });
        };
        pane.revalidate = function () {
          W.ICEWidget.prototype.revalidate.call(this);
          layout();
          return this;
        };
        setTimeout(layout, 0);
        handles.documents = { table, toolbar };
        return pane;
      };

      /* ============================ 应用：IE 浏览器 ============================ */
      /* ============================ 应用：IE 浏览器（真的会去 fetch 网页） ============================
       * 说明：这是"真的"浏览器 —— 地址栏回车/点「转到」会 `fetch()` 那个 URL，
       * 用 DOMParser 解析 HTML，再把标题/段落/链接/图片用 canvas 组件画出来。
       *
       * 现实中受浏览器同源策略限制（和真 IE 的差别）：
       * - 同源 / CORS 友好的页面（含本目录下的示例页）能直接抓；
       * - 大多数网站没开 CORS，`fetch` 会被拦（就像没网一样）→ 走 XP 风格的错误页；
       * - 页面必须是 http(s) 打开（file:// 下 fetch 一律失败），示例建议 `npx serve .` 后再点。
       */
      const buildIE = () => {
        const pane = new W.ICEWidget({
          width: 100,
          height: 100,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#ffffff' },
        });
        const toolbar = new W.ICEWidget({
          left: 0,
          top: 0,
          width: 100,
          height: 34,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#ece9d8' },
        });
        const backButton = new W.ICEButton({ id: 'ie-back', left: 6, top: 5, width: 28, height: 24, text: '←', size: 'small', variant: 'default' });
        const forwardButton = new W.ICEButton({ id: 'ie-forward', left: 36, top: 5, width: 28, height: 24, text: '→', size: 'small', variant: 'default' });
        const refreshButton = new W.ICEButton({ id: 'ie-refresh', left: 66, top: 5, width: 44, height: 24, text: '刷新', size: 'small', variant: 'default' });
        const address = new W.ICETextField({
          id: 'ie-address',
          left: 118,
          top: 5,
          width: 300,
          height: 24,
          value: './gallery.html',
          style: { fontSize: 12 },
        });
        const go = new W.ICEButton({ id: 'ie-go', left: 424, top: 5, width: 54, height: 24, text: '转到', size: 'small' });
        const bookmarks = new W.ICEButton({ id: 'ie-bookmarks', left: 484, top: 5, width: 62, height: 24, text: '收藏夹', size: 'small', variant: 'default' });
        toolbar.addChildren([backButton, forwardButton, refreshButton, address, go, bookmarks], { align: 'top' });
        W.attachDropdown(ice, bookmarks, {
          items: [
            { key: 'gallery', label: '组件总览 gallery' },
            { key: 'workbench', label: '客服工作台 workbench' },
            { key: 'admin', label: '六页后台 admin' },
            { key: 'xp', label: '关于本页 about:xp' },
          ],
          onSelect: (item) => {
            const targets = { gallery: './gallery.html', workbench: './workbench.html', admin: './admin.html', xp: 'about:xp' };
            goTo(targets[item.key] || './gallery.html');
          },
        });

        const viewport = new W.ICEPanel({
          left: 0,
          top: 34,
          width: 100,
          height: 100,
          radius: 0,
          interactive: false,
          style: { fillStyle: '#ffffff', strokeStyle: '#a0a0a0' },
        });
        const page = new W.ICEWidget({ width: 100, height: 100, fill: false, stroke: false, interactive: false });
        const scroll = new W.ICEScrollPane({ id: 'ie-viewport', left: 1, top: 1, width: 100, height: 100 });
        scroll.setContent(page);
        viewport.addChild(scroll, false);
        const status = new W.ICELabel({
          id: 'ie-status',
          interactive: false,
          left: 6,
          top: 100,
          width: 100,
          height: 20,
          text: '完成',
          verticalAlign: 'middle',
          style: { fontSize: 11, fillStyle: '#4a4a4a' },
        });
        pane.addChildren([toolbar, viewport, status], { align: 'top' });

        const history = [];
        let cursor = -1;
        let currentUrl = '';
        let loading = false;
        const origin = (() => {
          try {
            return new URL('.', location.href).href;
          } catch (err) {
            return '';
          }
        })();

        const setStatus = (text) => status.setText(text);
        const syncButtons = () => {
          backButton.setEnabled(cursor > 0);
          forwardButton.setEnabled(cursor >= 0 && cursor < history.length - 1);
        };
        const clearPage = () => {
          page.removeChildren([...page.childNodes]);
        };

        /** 把一段纯文本按宽度折成若干行（复用库里的折行工具）。 */
        const paragraphLines = (text, maxWidth, fontSize) =>
          W.truncateTextLines(text.replace(/\s+/g, ' ').trim(), { maxWidth, fontSize, maxLines: 40 });

        const renderBlocks = (blocks, title) => {
          clearPage();
          const width = Math.max(200, Number(scroll.getViewportSize()[0]) - 24);
          let top = 14;
          if (title) {
            page.addChild(
              new W.ICETypography({ left: 14, top, width, text: title, variant: 'title', level: 2 }),
              false,
            );
            top += 34;
          }
          blocks.forEach((block) => {
            if (block.kind === 'heading') {
              const node = new W.ICETypography({ left: 14, top, width, text: block.text, variant: 'title', level: block.level });
              page.addChild(node, false);
              top += Number(node.state.height) + 8;
              return;
            }
            if (block.kind === 'link') {
              const node = new W.ICETypography({ left: 14, top, width, text: '→ ' + block.text, variant: 'link' });
              node.on('click', () => goTo(block.href));
              page.addChild(node, false);
              top += Number(node.state.height) + 6;
              return;
            }
            if (block.kind === 'image') {
              const node = new W.ICEImageView({ left: 14, top, width: Math.min(width, 260), height: 150, fit: 'contain', src: block.src });
              page.addChild(node, false);
              top += 158;
              return;
            }
            if (block.kind === 'hr') {
              const node = new W.ICESeparator({ left: 14, top, width, height: 1 });
              page.addChild(node, false);
              top += 14;
              return;
            }
            if (block.kind === 'table') {
              // 表格渲染成真正的 ICETable（列排序/悬停/斑马纹都白送）
              const node = new W.ICETable({
                left: 14,
                top,
                width,
                rowHeight: 28,
                columns: block.columns.map((title, index) => ({
                  key: 'c' + index,
                  title: title || '列' + (index + 1),
                })),
                data: block.rows,
              });
              page.addChild(node, false);
              top += Number(node.state.height) + 10;
              return;
            }
            const lines = paragraphLines(block.text, width - 28, 12);
            const node = new W.ICETypography({ left: 14, top, width, rows: Math.max(1, lines.length), text: block.text, variant: 'paragraph' });
            page.addChild(node, false);
            top += Number(node.state.height) + 8;
          });
          const height = Math.max(Number(scroll.getViewportSize()[1]), top + 20);
          page.setState({ width: Number(scroll.getViewportSize()[0]), height });
          scroll.setContentSize(Number(scroll.getViewportSize()[0]), height);
          scroll.setScroll(0, 0);
          ice.requestRepaint();
        };

        const renderError = (url, reason) => {
          renderBlocks(
            [
              { kind: 'heading', level: 3, text: '无法显示该网页' },
              { kind: 'paragraph', text: `地址：${url}` },
              { kind: 'paragraph', text: reason },
              { kind: 'paragraph', text: '可能的原因：该站点没有开放跨域访问（CORS）、网络不可用，或者页面是用 file:// 打开的（fetch 在 file:// 下不可用）。' },
              { kind: 'paragraph', text: '可以试试本目录下的示例页（同源、一定能打开）：' },
              { kind: 'link', text: 'gallery.html · 组件总览', href: './gallery.html' },
              { kind: 'link', text: 'workbench.html · 客服工作台', href: './workbench.html' },
              { kind: 'link', text: 'admin.html · 六页后台', href: './admin.html' },
              { kind: 'link', text: 'windows-xp.html · 就是本页', href: './windows-xp.html' },
            ],
            'Internet Explorer',
          );
        };

        const extractBlocks = (doc, baseUrl) => {
          const blocks = [];
          const pushText = (el, kind = 'paragraph', level = 3) => {
            const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) blocks.push({ kind, text, level });
          };
          // 只看主要内容区，避免把 <style>/<script>/导航噪声都塞进来
          const scope = doc.querySelector('main') || doc.body || doc.documentElement;
          if (!scope) return blocks;
          let count = 0;
          const visit = (el) => {
            if (count > 60) return;
            Array.from(el.children || []).forEach((child) => {
              const tag = child.tagName.toLowerCase();
              if (['script', 'style', 'noscript', 'svg', 'canvas', 'iframe'].indexOf(tag) !== -1) return;
              if (tag === 'hr') {
                blocks.push({ kind: 'hr' });
                return;
              }
              if (tag === 'table') {
                const rows = Array.from(child.querySelectorAll('tr'))
                  .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((cell) => String(cell.textContent || '').replace(/\s+/g, ' ').trim()))
                  .filter((cells) => cells.length);
                if (rows.length) {
                  const headerCell = child.querySelector('th');
                  const columns = headerCell ? rows[0] : rows[0].map((_v, index) => '列' + (index + 1));
                  const bodyRows = headerCell ? rows.slice(1) : rows;
                  blocks.push({
                    kind: 'table',
                    columns,
                    rows: bodyRows.map((cells) => {
                      const row = {};
                      cells.forEach((value, index) => (row['c' + index] = value));
                      return row;
                    }),
                  });
                  count += 1 + bodyRows.length;
                }
                return;
              }
              if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
                pushText(child, 'heading', tag === 'h1' ? 3 : tag === 'h2' ? 4 : 5);
                count += 1;
                return;
              }
              if (tag === 'p' || tag === 'li' || tag === 'blockquote') {
                pushText(child);
                count += 1;
                return;
              }
              if (tag === 'a' && child.getAttribute('href')) {
                const text = String(child.textContent || '').trim();
                if (text) {
                  try {
                    blocks.push({ kind: 'link', text: text.slice(0, 60), href: new URL(child.getAttribute('href'), baseUrl).href });
                  } catch (err) {
                    /* 忽略坏链接 */
                  }
                  count += 1;
                }
                return;
              }
              if (tag === 'img' && child.getAttribute('src')) {
                try {
                  blocks.push({ kind: 'image', src: new URL(child.getAttribute('src'), baseUrl).href });
                } catch (err) {
                  /* 忽略 */
                }
                return;
              }
              visit(child);
            });
          };
          visit(scope);
          return blocks;
        };

        const load = async (url, options = {}) => {
          if (loading) return;
          loading = true;
          setStatus('正在打开 ' + url + ' …');
          currentUrl = url;
          address.setValue(url);
          // 本地彩蛋页：不联网也能玩（about:xp）
          if (String(url).trim().toLowerCase() === 'about:xp') {
            renderBlocks(
              [
                { kind: 'heading', level: 3, text: '欢迎来到 ICE 桌面' },
                { kind: 'paragraph', text: '这是一个用 canvas 画出来的网页浏览器：地址栏里输入本目录下的示例页（比如 gallery.html），或者直接打开 about:xp。' },
                { kind: 'hr' },
                { kind: 'heading', level: 4, text: '这个「浏览器」能做什么' },
                { kind: 'paragraph', text: 'fetch 真实网页 → DOMParser 解析 → 标题/段落/列表/链接/图片/表格 用 canvas 组件渲染；带前进后退与刷新。' },
                { kind: 'table', columns: ['能力', '实现'], rows: [
                  { c0: '标题与正文', c1: 'ICETypography（自动折行）' },
                  { c0: '链接', c1: 'ICETypography link + 点击导航' },
                  { c0: '图片', c1: 'ICEImageView' },
                  { c0: '表格', c1: 'ICETable（还能点表头排序）' },
                  { c0: '滚动', c1: 'ICEScrollPane' },
                ] },
                { kind: 'hr' },
                { kind: 'paragraph', text: '受同源策略限制：同源或 CORS 友好的站点能抓，其它站点会落到错误页 —— 和真浏览器一样。' },
                { kind: 'link', text: '去 gallery.html 看看', href: './gallery.html' },
              ],
              'about:xp — ICE 桌面',
            );
            setStatus('完成    |    本地页面');
            loading = false;
            return;
          }
          let absolute = url;
          try {
            absolute = new URL(url, origin || location.href).href;
          } catch (err) {
            renderError(url, '地址格式不正确。');
            setStatus('完成');
            loading = false;
            return;
          }
          try {
            const response = await fetch(absolute);
            if (!response.ok) {
              throw new Error('HTTP ' + response.status + ' ' + response.statusText);
            }
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const title = (doc.querySelector('title') && doc.querySelector('title').textContent) || absolute;
            const blocks = extractBlocks(doc, absolute);
            renderBlocks(blocks.length ? blocks : [{ kind: 'paragraph', text: '（这个页面没有可直接渲染的文本内容）' }], title);
            setStatus('完成    |    已连接到 ' + new URL(absolute).host);
            if (options.history !== false) {
              history.splice(cursor + 1);
              history.push(absolute);
              cursor = history.length - 1;
              syncButtons();
            }
          } catch (err) {
            const reason = '错误信息：' + ((err && err.message) || '未知错误');
            renderError(absolute, reason);
            setStatus('完成，但有错误');
          } finally {
            loading = false;
          }
        };

        const goTo = (url) => load(String(url || '').trim() || './gallery.html');

        go.on('click', () => goTo(address.getValue()));
        address.on('keydown', (evt) => {
          const raw = evt && (evt.originalEvent || evt);
          if (raw && (raw.key === 'Enter' || raw.code === 'Enter')) {
            goTo(address.getValue());
          }
        });
        // 地址栏里按回车也走全局键盘（ICETextField 内部不吞 Enter）
        ice.evtBus.on('keydown', (evt) => {
          const raw = evt && (evt.originalEvent || evt);
          if (!raw || raw.key !== 'Enter') return;
          const focused = W.getICEFocusManager(ice).getFocused();
          if (focused === address) {
            goTo(address.getValue());
          }
        });
        backButton.on('click', () => {
          if (cursor > 0) {
            cursor -= 1;
            load(history[cursor], { history: false });
            syncButtons();
          }
        });
        forwardButton.on('click', () => {
          if (cursor < history.length - 1) {
            cursor += 1;
            load(history[cursor], { history: false });
            syncButtons();
          }
        });
        refreshButton.on('click', () => goTo(currentUrl || address.getValue()));

        const layout = () => {
          const width = Number(pane.state.width) || 600;
          const height = Number(pane.state.height) || 400;
          toolbar.setState({ width });
          address.setState({ width: Math.max(120, width - 560) });
          go.setState({ left: width - 130 });
          bookmarks.setState({ left: width - 70 });
          viewport.setState({ width, height: height - 58 });
          scroll.setState({ width: width - 2, height: height - 60 });
          status.setState({ top: height - 24, width: width - 12 });
          syncButtons();
        };
        pane.revalidate = function () {
          W.ICEWidget.prototype.revalidate.call(this);
          layout();
          return this;
        };
        setTimeout(() => {
          layout();
          goTo('./gallery.html');
        }, 0);

        handles.ie = {
          address,
          go,
          page,
          scroll,
          status,
          load,
          goTo,
          backButton,
          forwardButton,
          refreshButton,
          bookmarks,
          getUrl: () => currentUrl,
        };
        return pane;
      };

      /* ============================ 应用注册表 ============================ */
      /* ============================ 应用：ICE Arcade（把掌机塞进 XP 窗口） ============================
       * 复用组件库里的两个纯逻辑模型（ICETetrisModel / ICESnakeModel）+ ICETileMap 自绘棋盘：
       * 整块棋盘仍然只是一个节点，XP 这边只做「窗口 + 键盘路由 + 每帧步进」三件事。
       */
      const buildArcade = () => {
        const PANE_W = 620;
        const PANE_H = 372;
        const pane = new W.ICEWidget({
          width: PANE_W,
          height: PANE_H,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#1b2130' },
        });
        const screenBox = new W.ICEWidget({
          id: 'xp-arcade-screen',
          left: 12,
          top: 12,
          width: 340,
          height: 348,
          radius: 10,
          fill: true,
          stroke: true,
          interactive: false,
          style: { fillStyle: '#0d1117', strokeStyle: '#2b3340', lineWidth: 2 },
        });
        pane.addChild(screenBox, false);

        const hud = new W.ICEWidget({ left: 366, top: 12, width: PANE_W - 378, height: PANE_H - 24, fill: false, stroke: false, interactive: false });
        pane.addChild(hud, false);
        const titleLabel = new W.ICELabel({
          interactive: false,
          left: 0,
          top: 0,
          width: 220,
          height: 24,
          text: 'ICE ARCADE',
          style: { fontSize: 18, fontWeight: '700', fillStyle: '#f8f9fa' },
        });
        const scoreLabel = new W.ICELabel({
          id: 'xp-arcade-score',
          interactive: false,
          left: 0,
          top: 34,
          width: 220,
          height: 30,
          text: '0',
          style: { fontSize: 24, fontWeight: '700', fontFamily: '"Courier New", monospace', fillStyle: '#f8f9fa' },
        });
        const infoLabel = new W.ICELabel({
          id: 'xp-arcade-info',
          interactive: false,
          left: 0,
          top: 68,
          width: 220,
          height: 60,
          text: '',
          style: { fontSize: 12, fontFamily: '"Courier New", monospace', fillStyle: '#adb5bd' },
        });
        /** 卡带按钮列（32 高 + 6 间距）→ 纵向 BoxLayout。 */
        const cartridgeList = new W.ICEWidget({ left: 0, top: 140, width: 224, height: 2 * 32 + 6, fill: false, stroke: false, interactive: false });
        cartridgeList.setLayout(new ICE.ICEBoxLayout({ axis: 'y', gap: 6 }));
        hud.addChild(cartridgeList, false);
        const cartridgeButtons = ['tetris', 'snake'].map((key) => {
          const button = new W.ICEButton({
            id: `xp-arcade-cart-${key}`,
            width: 224,
            height: 32,
            text: key === 'tetris' ? '俄罗斯方块' : '贪吃蛇',
            variant: key === 'tetris' ? 'primary' : 'default',
            size: 'small',
          });
          button.on('click', () => switchGame(key));
          cartridgeList.addChild(button, false);
          return { key, button };
        });
        const hintLabel = new W.ICELabel({
          interactive: false,
          left: 0,
          top: 226,
          width: 224,
          height: 100,
          text: '← → 移动 · 空格硬降\n↑/X 旋转 · Z 反转\n贪吃蛇用方向键 / WASD\nP 暂停 · R 重开\n（本窗口激活时键盘才归游戏）',
          style: { fontSize: 11, fillStyle: '#8a93a0' },
        });
        hud.addChild(titleLabel, false);
        hud.addChild(scoreLabel, false);
        hud.addChild(infoLabel, false);
        hud.addChild(hintLabel, false);

        const PALETTE = W.ICE_ARCADE_PALETTE;
        const TETRIS = { rows: 20, cols: 10, cell: 16 };
        const SNAKE = { rows: 20, cols: 20, cell: 16 };
        const state = { key: null, model: null, board: null, runtime: null, accumulator: 0, last: 0 };

        const makeBoard = (rows, cols, cell) => {
          const width = cols * cell;
          const height = rows * cell;
          const board = new W.ICETileMap({
            id: 'xp-arcade-board',
            left: Math.round((screenBox.state.width - width) / 2),
            top: Math.round((screenBox.state.height - height) / 2),
            rows,
            cols,
            cellSize: cell,
            gap: 2,
            cellRadius: 3,
            palette: PALETTE,
            fill: true,
            stroke: true,
            style: { fillStyle: '#12161d', strokeStyle: '#1f2733', lineWidth: 1 },
          });
          screenBox.addChild(board, false);
          return board;
        };
        const clearBoard = () => {
          screenBox.removeChildren([...screenBox.childNodes]);
          state.board = null;
          state.runtime = null;
        };

        const mountTetris = () => {
          clearBoard();
          const board = makeBoard(TETRIS.rows, TETRIS.cols, TETRIS.cell);
          const model = new W.ICETetrisModel({ rows: TETRIS.rows, cols: TETRIS.cols });
          const local = { piece: null, accumulator: 0 };
          const allCells = [];
          for (let row = 0; row < TETRIS.rows; row += 1) {
            for (let col = 0; col < TETRIS.cols; col += 1) allCells.push({ row, col });
          }
          const paint = () => {
            const boardRows = model.getBoard();
            const tiles = new Array(TETRIS.rows * TETRIS.cols).fill('empty');
            for (let row = 0; row < TETRIS.rows; row += 1) {
              for (let col = 0; col < TETRIS.cols; col += 1) {
                if (boardRows[row][col]) tiles[row * TETRIS.cols + col] = boardRows[row][col];
              }
            }
            const highlights = [];
            if (!model.isGameOver()) {
              const type = model.getCurrent().type;
              const color = (PALETTE[type] || {}).fillStyle || '#adb5bd';
              model.getGhost().forEach(([row, col]) => {
                const index = row * TETRIS.cols + col;
                if (index >= 0 && index < tiles.length && !tiles[index]) {
                  highlights.push({ row, col, fillStyle: 'rgba(0,0,0,0)', strokeStyle: color, lineWidth: 1 });
                }
              });
              model.getCurrent().cells.forEach(([row, col]) => {
                if (row < 0) return;
                tiles[row * TETRIS.cols + col] = type;
              });
            }
            board.setTiles(tiles);
            board.setHighlights(highlights);
          };
          model.addChangeListener(() => {
            if (model.getLastClearedLines() > 0) {
              board.pulse(allCells, { duration: 220, color: 'rgba(255,255,255,0.45)' });
              playCue('eat');
            }
            syncHud();
            paint();
          });
          return {
            model,
            board,
            paint,
            keydown(key, repeating) {
              switch (key) {
                case 'ArrowLeft': model.moveLeft(); return true;
                case 'ArrowRight': model.moveRight(); return true;
                case 'ArrowDown': model.softDrop(); return true;
                case 'ArrowUp':
                case 'x':
                case 'X':
                  if (!repeating) { model.rotateCW(); playCue('click'); }
                  return true;
                case 'z':
                case 'Z':
                  if (!repeating) { model.rotateCCW(); playCue('click'); }
                  return true;
                case ' ':
                  if (!repeating) { model.hardDrop(); playCue('click'); }
                  return true;
                default:
                  return false;
              }
            },
            frame(dt) {
              const piece = model.getCurrent();
              if (piece !== local.piece) {
                local.piece = piece;
                local.accumulator = 0;
              }
              if (model.isPaused() || model.isGameOver()) {
                local.accumulator = 0;
                return;
              }
              local.accumulator += dt;
              const interval = model.getDropInterval();
              while (local.accumulator >= interval) {
                local.accumulator -= interval;
                model.tick();
              }
            },
            hud() {
              return {
                score: String(model.getScore()),
                info: `消行 ${model.getLines()} · 等级 ${model.getLevel()}`,
              };
            },
          };
        };

        const mountSnake = () => {
          clearBoard();
          const board = makeBoard(SNAKE.rows, SNAKE.cols, SNAKE.cell);
          const model = new W.ICESnakeModel({ rows: SNAKE.rows, cols: SNAKE.cols });
          const local = { accumulator: 0 };
          board.on('cellclick', (evt) => {
            const cell = evt && evt.param ? evt.param : null;
            if (!cell) return;
            const head = model.getHead();
            const dRow = cell.row - head[0];
            const dCol = cell.col - head[1];
            if (!dRow && !dCol) return;
            const direction = Math.abs(dRow) >= Math.abs(dCol) ? (dRow > 0 ? 'down' : 'up') : dCol > 0 ? 'right' : 'left';
            model.setDirection(direction);
          });
          const paint = () => {
            const tiles = new Array(SNAKE.rows * SNAKE.cols).fill('empty');
            const food = model.getFood();
            if (food) tiles[food[0] * SNAKE.cols + food[1]] = 'food';
            model.getBody().forEach(([row, col], index) => {
              if (row < 0 || row >= SNAKE.rows || col < 0 || col >= SNAKE.cols) return;
              tiles[row * SNAKE.cols + col] = index === 0 ? 'snakeHead' : index % 2 === 0 ? 'snakeBody' : 'snakeBodyAlt';
            });
            board.setTiles(tiles);
          };
          const DIRECTIONS = {
            ArrowUp: 'up', w: 'up', W: 'up',
            ArrowDown: 'down', s: 'down', S: 'down',
            ArrowLeft: 'left', a: 'left', A: 'left',
            ArrowRight: 'right', d: 'right', D: 'right',
          };
          model.addChangeListener(() => {
            syncHud();
            paint();
          });
          return {
            model,
            board,
            paint,
            keydown(key) {
              const direction = DIRECTIONS[key];
              if (!direction) return false;
              if (model.setDirection(direction)) playCue('click');
              return true;
            },
            frame(dt) {
              if (model.isPaused() || model.isGameOver()) {
                local.accumulator = 0;
                return;
              }
              local.accumulator += dt;
              const interval = model.getTickInterval();
              while (local.accumulator >= interval) {
                local.accumulator -= interval;
                const before = model.getScore();
                model.tick();
                if (model.getScore() > before) {
                  playCue('eat');
                  const head = model.getHead();
                  board.pulse([{ row: head[0], col: head[1] }], { duration: 180, color: 'rgba(255,255,255,0.35)' });
                }
              }
            },
            hud() {
              return {
                score: String(model.getScore()),
                info: `长度 ${model.getLength()} · ${model.getTickInterval()}ms/格`,
              };
            },
          };
        };

        const api = {
          get key() {
            return state.key;
          },
          get model() {
            return state.model;
          },
          get board() {
            return state.board;
          },
          keydown(key, repeating) {
            if (!state.runtime) return false;
            if (key === 'p' || key === 'P') {
              if (!repeating) {
                if (state.model.isPaused()) state.model.resume();
                else state.model.pause();
              }
              return true;
            }
            if (key === 'r' || key === 'R') {
              if (!repeating) {
                state.model.reset();
                state.runtime.paint();
                syncHud();
              }
              return true;
            }
            return state.runtime.keydown(key, repeating);
          },
          frame(dt) {
            if (state.runtime) state.runtime.frame(dt);
          },
          switchTo: switchGame,
          sync: () => {
            if (state.runtime) state.runtime.paint();
            syncHud();
          },
        };
        function syncHud() {
          if (!state.runtime || !state.model) return;
          const hudState = state.runtime.hud();
          scoreLabel.setText(hudState.score);
          infoLabel.setText(hudState.info);
        }
        function switchGame(key) {
          state.key = key;
          state.runtime = key === 'snake' ? mountSnake() : mountTetris();
          state.model = state.runtime.model;
          state.board = state.runtime.board;
          state.accumulator = 0;
          if (state.board) W.fadeIn(state.board, { duration: 220 });
          cartridgeButtons.forEach((item) => {
            item.button.setEnabled(true);
            item.button.setText(item.key === key ? `▶ ${item.key === 'tetris' ? '俄罗斯方块' : '贪吃蛇'}` : item.key === 'tetris' ? '俄罗斯方块' : '贪吃蛇');
          });
          scoreLabel.setText('0');
          state.runtime.paint();
          syncHud();
          ice.requestRepaint();
        }

        handles.arcade = api;
        switchGame('tetris');
        // 每帧推进（窗口关掉/最小化时自动停摆，见下面的守卫）
        const timer = setInterval(() => {
          const entry = openWindows.get('arcade');
          if (!entry || entry.minimized) return;
          const now = Date.now();
          const dt = state.last ? Math.min(120, now - state.last) : 0;
          state.last = now;
          api.frame(dt);
        }, 60);
        handles.arcade.timer = timer;
        return pane;
      };

      let currentWallpaper = 'bliss';
      const setWallpaper = (key) => {
        currentWallpaper = key;
        paintWallpaper(key);
      };
      const APPS = [
        { key: 'computer', title: '我的电脑', icon: '🖥', iconKind: 'computer', width: 720, height: 460, build: buildMyComputer },
        { key: 'documents', title: '我的文档', icon: '📁', iconKind: 'folder', width: 640, height: 420, build: buildMyDocuments },
        { key: 'notepad', title: '未命名 - 记事本', icon: '📝', iconKind: 'notepad', width: 560, height: 420, build: buildNotepad },
        { key: 'paint', title: '未命名 - 画图', icon: '🎨', iconKind: 'paint', width: 720, height: 520, build: buildPaint },
        {
          key: 'minesweeper',
          title: '扫雷',
          icon: '💣',
          iconKind: 'mine',
          width: 260,
          height: 360,
          build: buildMinesweeper,
          onOpened: () => handles.mines && handles.mines.fit(),
        },
        { key: 'ie', title: 'ICE 桌面 - Microsoft Internet Explorer', icon: '🌐', iconKind: 'ie', width: 700, height: 460, build: buildIE },
        { key: 'display', title: '显示 属性', icon: '⚙', iconKind: 'display', width: 500, height: 300, build: buildDisplayProperties },
        { key: 'arcade', title: 'ICE Arcade', icon: '🕹', iconKind: 'arcade', width: 664, height: 460, build: buildArcade, onClosed: () => clearInterval(handles.arcade.timer) },
      ];

      /* ============================ 桌面图标 ============================ */
      const iconTiles = [];
      const ICON_ORDER = ['computer', 'documents', 'notepad', 'paint', 'minesweeper', 'ie', 'display', 'arcade'];
      /** 桌面图标是一列（86×78 的磁贴 + 6 间距）→ 纵向 BoxLayout。 */
      const iconColumn = new W.ICEWidget({ left: 18, top: 18, width: 86, height: ICON_ORDER.length * 78 + (ICON_ORDER.length - 1) * 6, fill: false, stroke: false, interactive: false });
      iconColumn.setLayout(new ICE.ICEBoxLayout({ axis: 'y', gap: 6 }));
      iconLayer.addChild(iconColumn, false);
      ICON_ORDER.forEach((key) => {
        const app = APPS.find((item) => item.key === key);
        const tile = new W.ICEIconTile({
          id: 'icon-' + key,
          icon: '',
          iconNode: xpIcon(app.iconKind, 34),
          label: app.title.replace('未命名 - ', '').replace(' - Microsoft Internet Explorer', ''),
          width: 86,
          height: 78,
          onSelect: (selected) => {
            if (selected) {
              iconTiles.forEach((other) => other !== tile && other.setSelected(false));
            }
          },
          onOpen: () => openApp(app),
        });
        iconColumn.addChild(tile, false);
        iconTiles.push(tile);
      });

      const clearIconSelection = () => iconTiles.forEach((tile) => tile.setSelected(false));

      /* ============================ 开始菜单 ============================ */
      const buildStartMenuContent = () => {
        const pane = new W.ICEWidget({
          width: 360,
          height: 420,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#ffffff' },
        });
        const header = new W.ICEWidget({
          left: 0,
          top: 0,
          width: 360,
          height: 62,
          fill: false,
          stroke: false,
          interactive: false,
        });
        gradient(header, 0, 0, 360, 62, '#0a5cd8', '#3f8cf3', 8);
        header.addChild(new W.ICEAvatar({ left: 12, top: 12, text: 'FM', size: 38 }), false);
        header.addChild(
          new W.ICELabel({
            left: 60,
            top: 14,
            width: 280,
            text: 'Felix Morgan',
            style: { fontSize: 14, fontWeight: '700', fillStyle: '#ffffff', fontFamily: XPFONT },
          }),
          false,
        );
        pane.addChild(header, false);
        const programKeys = ['computer', 'documents', 'notepad', 'paint', 'minesweeper', 'ie', 'arcade'];
        /** 「所有程序」一列（32 高 + 2 间距）→ 纵向 BoxLayout。 */
        const programList = new W.ICEWidget({ left: 6, top: 72, width: 210, height: programKeys.length * 32 + (programKeys.length - 1) * 2, fill: false, stroke: false, interactive: false });
        programList.setLayout(new ICE.ICEBoxLayout({ axis: 'y', gap: 2 }));
        pane.addChild(programList, false);
        programKeys.forEach((key) => {
          const app = APPS.find((item) => item.key === key);
          const row = new W.ICEWidget({
            id: 'start-program-' + key,
            width: 210,
            height: 32,
            radius: 3,
            fill: false,
            stroke: false,
          });
          row.addChild(
            new W.ICELabel({
              interactive: false,
              left: 32,
              top: 0,
              width: 170,
              height: 36,
              text: app.title,
              verticalAlign: 'middle',
              style: { fontSize: 12, fillStyle: '#0a246a', fontFamily: XPFONT },
            }),
            false,
          );
          const rowIcon = xpIcon(app.iconKind, 20);
          rowIcon.setState({ left: 8, top: 8 });
          row.addChild(rowIcon, false);
          row.on('click', () => {
            startMenuHandle && startMenuHandle.close();
            openApp(app);
          });
          row.on('hoverchange', (evt) => {
            const hovered = !!(evt && evt.param ? evt.param.hovered : evt && evt.hovered);
            row.setState({ style: { fillStyle: hovered ? '#0a246a' : 'rgba(0,0,0,0)' } });
            const label = row.childNodes[0];
            if (label && label.childNodes[0]) {
              label.childNodes[0].setState({
                style: { ...label.childNodes[0].state.style, fillStyle: hovered ? '#ffffff' : '#0a246a' },
              });
            }
          });
          programList.addChild(row, false);
        });
        const separator = new W.ICESeparator({ left: 224, top: 72, width: 1, height: 250 });
        pane.addChild(separator, false);
        /** 右侧快捷项一列（28 高 + 4 间距）→ 同样交给纵向 BoxLayout。 */
        const quickLabels = ['我的文档', '我最近的文档', '我的电脑', '控制面板'];
        const quickList = new W.ICEWidget({ left: 236, top: 74, width: 116, height: quickLabels.length * 28 + (quickLabels.length - 1) * 4, fill: false, stroke: false, interactive: false });
        quickList.setLayout(new ICE.ICEBoxLayout({ axis: 'y', gap: 4 }));
        pane.addChild(quickList, false);
        quickLabels.forEach((label) => {
          const row = new W.ICEWidget({ width: 116, height: 28, radius: 3, fill: false, stroke: false });
          row.addChild(
            new W.ICELabel({
              interactive: false,
              left: 6,
              top: 0,
              width: 104,
              height: 28,
              text: label,
              verticalAlign: 'middle',
              style: { fontSize: 12, fontWeight: '700', fillStyle: '#0a246a', fontFamily: XPFONT },
            }),
            false,
          );
          row.on('click', () => {
            startMenuHandle && startMenuHandle.close();
            if (label === '我的文档' || label === '我最近的文档') openApp(APPS[1]);
            else if (label === '我的电脑') openApp(APPS[0]);
            else openApp(APPS[6]);
          });
          quickList.addChild(row, false);
        });
        const footer = new W.ICEWidget({
          left: 0,
          top: 362,
          width: 360,
          height: 58,
          fill: false,
          stroke: false,
          interactive: false,
        });
        gradient(footer, 0, 0, 360, 58, '#3f8cf3', '#0a5cd8', 8);
        footer.addChild(
          new W.ICELabel({
            left: 12,
            top: 0,
            width: 160,
            height: 58,
            text: '🔒  注销',
            verticalAlign: 'middle',
            style: { fontSize: 12, fontWeight: '700', fillStyle: '#ffffff', fontFamily: XPFONT },
          }),
          false,
        );
        const shutDown = new W.ICELabel({
          interactive: false,
          left: 190,
          top: 0,
          width: 160,
          height: 58,
          text: '⏻  关闭计算机',
          align: 'right',
          verticalAlign: 'middle',
          style: { fontSize: 12, fontWeight: '700', fillStyle: '#ffffff', fontFamily: XPFONT },
        });
        footer.addChild(shutDown, false);
        // 注销 / 关机入口（压在标签上的透明热区，hover 有高亮）
        const menuHotspot = (id, left, width, label, handler) => {
          const hit = new W.ICEWidget({
            id,
            left,
            top: 0,
            width,
            height: 58,
            radius: 4,
            fill: true,
            stroke: false,
            style: { fillStyle: 'rgba(255,255,255,0)' },
          });
          hit.on('click', handler);
          hit.on('hoverchange', (evt) => {
            const hovered = !!(evt && evt.param ? evt.param.hovered : evt && evt.hovered);
            hit.setState({ style: { ...hit.state.style, fillStyle: hovered ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0)' } });
            ice.requestRepaint();
          });
          footer.addChild(hit, false);
          return { label, hit };
        };
        const logoffHotspot = menuHotspot('menu-logoff', 4, 176, '注销', () => logoff());
        const shutdownHotspot = menuHotspot('menu-shutdown', 184, 172, '关闭计算机', () => shutdown());
        handles.menuLogoff = logoffHotspot.hit;
        handles.menuShutdown = shutdownHotspot.hit;
        pane.addChild(footer, false);
        return pane;
      };

      let startMenuHandle = null;
      startButton.on('click', () => {
        if (startMenuHandle) {
          startMenuHandle.close();
          return;
        }
        startMenuHandle = W.getICEOverlayManager(ice).open({
          anchor: startButton,
          content: buildStartMenuContent(),
          placement: 'topLeft',
          offset: 6,
          closeOnOutsideClick: true,
          enterAnimation: 'none',
          onClose: () => {
            startMenuHandle = null;
          },
        });
      });

      /* ============================ 桌面点击 & 时钟 ============================ */
      wallpaper.on('mousedown', () => clearIconSelection());
      const tick = () => {
        const now = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        clockLabel.setText(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
      };
      tick();
      setInterval(tick, 1000);

      /* ============================ 音效（WebAudio 合成，零音频文件） ============================
       * 开机 / 注销 / 关机音都是**现场合成的原创音型**，不是微软的原版开机声（那是版权素材）。
       * 浏览器不允许无手势自动播放：AudioContext 在第一次点击/回车之后才创建，所以开机
       * 画面里的声音要等用户按一下（这也正好符合「按任意键继续」）。
       */
      const sound = { enabled: true, ctx: null, lastCue: null };
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
      /** 一个带包络的正弦/三角音符。 */
      const note = (dest, freq, at, duration, options = {}) => {
        const ctx = sound.ctx;
        if (!ctx || !dest) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime + at;
        const peak = options.peak || 0.12;
        const attack = options.attack === undefined ? 0.02 : options.attack;
        osc.type = options.type || 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + Math.max(0.01, attack));
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(t);
        osc.stop(t + duration + 0.05);
      };
      /** 总线：给整段音型一个柔和的起音与收尾。 */
      const bus = (duration, peak = 0.6) => {
        const ctx = sound.ctx;
        const gain = ctx.createGain();
        const t = ctx.currentTime + 0.01;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        gain.connect(ctx.destination);
        return { gain, at: 0.02 };
      };
      const cues = {
        /** 开机音：低音铺底 + 四音上行钟声（原创，非微软原版）。 */
        startup: () => {
          const ctx = audioCtx();
          if (!ctx) return;
          const { gain } = bus(3.4, 0.5);
          note(gain, 110, 0, 3.2, { peak: 0.16, attack: 0.5 });
          note(gain, 164.81, 0.1, 3.0, { peak: 0.12, attack: 0.6 });
          [[659.25, 0.05], [830.61, 0.3], [987.77, 0.55], [1318.51, 0.8]].forEach(([freq, at]) => {
            note(gain, freq, at, 2.2, { peak: 0.14, attack: 0.03, type: 'triangle' });
          });
        },
        /** 注销：三音下行。 */
        logoff: () => {
          const ctx = audioCtx();
          if (!ctx) return;
          const { gain } = bus(1.4, 0.45);
          [[987.77, 0], [783.99, 0.18], [587.33, 0.36]].forEach(([freq, at]) => {
            note(gain, freq, at, 0.8, { peak: 0.12, type: 'triangle' });
          });
        },
        /** 关机：低沉收尾。 */
        shutdown: () => {
          const ctx = audioCtx();
          if (!ctx) return;
          const { gain } = bus(1.8, 0.45);
          [[440, 0], [329.63, 0.25], [220, 0.5]].forEach(([freq, at]) => {
            note(gain, freq, at, 1.3, { peak: 0.13, attack: 0.05 });
          });
        },
        /** 选用户 / 点按钮的小咔哒。 */
        click: () => {
          const ctx = audioCtx();
          if (!ctx) return;
          note(ctx.destination, 1320, 0, 0.06, { peak: 0.05, type: 'square' });
        },
      };
      const playCue = (name) => {
        if (!sound.enabled) return;
        sound.lastCue = name;
        try {
          if (cues[name]) cues[name]();
        } catch (err) {
          /* 没有音频设备（headless）时静默降级 */
        }
      };

      /* ============================ 开机 / 登录 / 注销 ============================
       * 会话状态机：boot → login → password → welcome → desktop →（注销）login
       *                                                └（关机）shutdown → boot
       * 登录规则是**故意宽松**的：任意用户名、任意密码、甚至空密码都能进 —— 这是玩具。
       */
      const session = { phase: 'boot', user: null, password: '', logins: 0, skips: 0 };
      const USERS = [
        { key: 'ice', name: 'ICE 用户', avatar: '🧊', accent: '#3f8cf3', note: '单击登录 · 任意密码' },
        { key: 'guest', name: '访客', avatar: '🙂', accent: '#2e9e5b', note: '无需密码 · 直接进入' },
      ];

      // xpFlag 已上移到图标辅助区（任务栏开始按钮也要用，需在其之前定义）。
      /** 建一个标签并挂上去（`addChild` 不返回子节点，所以这里自己返回，方便后面 setText）。 */
      const xpLabel = (parent, props) => {
        const label = new W.ICELabel({
          interactive: false,
          verticalAlign: 'middle',
          style: { color: '#ffffff', fillStyle: '#ffffff', fontFamily: XPFONT, fontSize: 12 },
          ...props,
        });
        parent.addChild(label, false);
        return label;
      };

      const sessionRoot = new W.ICEWidget({
        id: 'session-screen',
        left: 0,
        top: 0,
        width: SCREEN_W,
        height: SCREEN_H,
        fill: false,
        stroke: false,
        interactive: true,
      });

      /* ---------------------------- ① 开机画面 ---------------------------- */
      const bootLayer = new W.ICEWidget({
        id: 'boot-screen',
        left: 0,
        top: 0,
        width: SCREEN_W,
        height: SCREEN_H,
        fill: true,
        stroke: false,
        interactive: false,
        style: { fillStyle: '#000000' },
      });
      sessionRoot.addChild(bootLayer, false);
      xpFlag(bootLayer, 596, 328, 96);
      xpLabel(bootLayer, { left: 716, top: 322, width: 260, height: 24, text: 'Microsoft', style: { color: '#d8d8d8', fillStyle: '#d8d8d8', fontSize: 18 } });
      xpLabel(bootLayer, { left: 716, top: 344, width: 260, height: 46, text: 'Windows', style: { color: '#ffffff', fillStyle: '#ffffff', fontSize: 38, fontWeight: '700' } });
      xpLabel(bootLayer, { left: 896, top: 352, width: 90, height: 34, text: 'xp', style: { color: '#ff8c00', fillStyle: '#ff8c00', fontSize: 28, fontWeight: '700', fontStyle: 'italic' } });
      const bootTrack = new W.ICEWidget({
        left: 600,
        top: 520,
        width: 240,
        height: 12,
        radius: 6,
        fill: true,
        stroke: true,
        interactive: false,
        style: { fillStyle: '#141414', strokeStyle: '#3a3a3a', lineWidth: 1 },
      });
      bootLayer.addChild(bootTrack, false);
      const BOOT_BLOCK_W = 44;
      const bootBlocks = [0, 1, 2].map(() => {
        const block = new W.ICEWidget({
          left: 0,
          top: 0,
          width: BOOT_BLOCK_W,
          height: 12,
          radius: 6,
          fill: true,
          stroke: false,
          interactive: false,
          style: { fillStyle: '#3f8cf3' },
        });
        bootTrack.addChild(block, false);
        return block;
      });
      xpLabel(bootLayer, {
        left: 600,
        top: 552,
        width: 240,
        height: 20,
        text: '点击任意处 / 按任意键继续',
        align: 'center',
        style: { color: '#8a8f98', fillStyle: '#8a8f98', fontSize: 12 },
      });
      xpLabel(bootLayer, { left: 40, top: 860, width: 320, height: 20, text: 'Microsoft Corporation', style: { color: '#6a6f78', fillStyle: '#6a6f78', fontSize: 11 } });

      /* ---------------------------- ② 欢迎 / 登录界面 ---------------------------- */
      const loginLayer = new W.ICEWidget({
        id: 'login-screen',
        left: 0,
        top: 0,
        width: SCREEN_W,
        height: SCREEN_H,
        fill: false,
        stroke: false,
        display: false,
        interactive: false,
      });
      sessionRoot.addChild(loginLayer, false);
      // 色带数量给足，否则大屏上能看出横条分界
      gradient(loginLayer, 0, 0, SCREEN_W, SCREEN_H, '#0a52c0', '#032b73', 120);
      const loginBand = new W.ICEWidget({ left: 0, top: 0, width: SCREEN_W, height: 92, fill: false, stroke: false, interactive: false });
      loginLayer.addChild(loginBand, false);
      gradient(loginBand, 0, 0, SCREEN_W, 92, '#3f8cf3', '#1b5fc8', 30);
      loginBand.addChild(new W.ICEWidget({ left: 0, top: 90, width: SCREEN_W, height: 2, fill: true, stroke: false, interactive: false, style: { fillStyle: '#ffffff' } }), false);
      loginBand.addChild(new W.ICEWidget({ left: 0, top: 92, width: SCREEN_W, height: 3, fill: true, stroke: false, interactive: false, style: { fillStyle: '#ff8c00' } }), false);
      xpFlag(loginBand, 1174, 26, 40);
      xpLabel(loginBand, { left: 1224, top: 22, width: 200, height: 24, text: 'Microsoft', style: { color: '#dbe7ff', fillStyle: '#dbe7ff', fontSize: 12 } });
      xpLabel(loginBand, { left: 1224, top: 40, width: 140, height: 30, text: 'Windows', style: { color: '#ffffff', fillStyle: '#ffffff', fontSize: 22, fontWeight: '700' } });
      xpLabel(loginBand, { left: 1348, top: 44, width: 60, height: 26, text: 'xp', style: { color: '#ff8c00', fillStyle: '#ff8c00', fontSize: 18, fontWeight: '700', fontStyle: 'italic' } });

      loginLayer.addChild(
        new W.ICEWidget({ left: 380, top: 148, width: 1, height: 600, fill: true, stroke: false, interactive: false, style: { fillStyle: 'rgba(255,255,255,0.32)' } }),
        false,
      );
      xpLabel(loginLayer, { left: 64, top: 156, width: 300, height: 26, text: '要开始，请单击您的用户名', style: { color: '#ffffff', fillStyle: '#ffffff', fontSize: 15, fontWeight: '700' } });
      xpLabel(loginLayer, {
        left: 64,
        top: 192,
        width: 292,
        height: 80,
        text: '这是 ICE 玩具系统：账号随便点，密码随便写（不写也行），回车就进。音效是现场合成的，没有音频文件。',
        style: { color: 'rgba(255,255,255,0.78)', fillStyle: 'rgba(255,255,255,0.78)', fontSize: 12 },
      });
      const loginHint = xpLabel(loginLayer, {
        id: 'login-hint',
        left: 64,
        top: 700,
        width: 292,
        height: 60,
        text: '',
        style: { color: 'rgba(255,255,255,0.75)', fillStyle: 'rgba(255,255,255,0.75)', fontSize: 12 },
      });

      /** 用户磁贴：头像 + 名字 + 一行说明；hover 有高亮底，点击进密码页。 */
      /** 磁贴是一列（84 高 + 12 间距）→ 纵向 BoxLayout。 */
      const userTileList = new W.ICEWidget({ left: 460, top: 186, width: 560, height: USERS.length * 84 + (USERS.length - 1) * 12, fill: false, stroke: false, interactive: false });
      userTileList.setLayout(new ICE.ICEBoxLayout({ axis: 'y', gap: 12 }));
      loginLayer.addChild(userTileList, false);
      const userTiles = USERS.map((user) => {
        const tile = new W.ICEWidget({
          id: 'login-user-' + user.key,
          width: 560,
          height: 84,
          radius: 6,
          fill: true,
          stroke: false,
          style: { fillStyle: 'rgba(255,255,255,0)' },
        });
        const avatar = new W.ICEWidget({
          left: 12,
          top: 12,
          width: 60,
          height: 60,
          radius: 8,
          fill: true,
          stroke: true,
          interactive: false,
          style: { fillStyle: user.accent, strokeStyle: 'rgba(255,255,255,0.65)', lineWidth: 2 },
        });
        avatar.addChild(
          new W.ICELabel({
            interactive: false,
            left: 0,
            top: 0,
            width: 60,
            height: 60,
            text: user.avatar,
            align: 'center',
            verticalAlign: 'middle',
            style: { fontSize: 26 },
          }),
          false,
        );
        tile.addChild(avatar, false);
        xpLabel(tile, { left: 88, top: 18, width: 420, height: 28, text: user.name, style: { color: '#ffffff', fillStyle: '#ffffff', fontSize: 19, fontWeight: '700' } });
        xpLabel(tile, { left: 88, top: 46, width: 420, height: 22, text: user.note, style: { color: 'rgba(255,255,255,0.8)', fillStyle: 'rgba(255,255,255,0.8)', fontSize: 12 } });
        tile.on('click', () => pickUser(user));
        tile.on('hoverchange', (evt) => {
          const hovered = !!(evt && evt.param ? evt.param.hovered : evt && evt.hovered);
          tile.setState({ style: { ...tile.state.style, fillStyle: hovered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0)' } });
          ice.requestRepaint();
        });
        userTileList.addChild(tile, false);
        return tile;
      });

      /** 密码页：XP 会先让你选用户、再输密码 —— 这里任意内容都能过。 */
      const passwordPanel = new W.ICEWidget({
        id: 'login-password',
        left: 460,
        top: 186,
        width: 560,
        height: 240,
        radius: 8,
        fill: true,
        stroke: true,
        display: false,
        style: { fillStyle: 'rgba(255,255,255,0.12)', strokeStyle: 'rgba(255,255,255,0.5)', lineWidth: 2 },
      });
      loginLayer.addChild(passwordPanel, false);
      const passwordAvatar = new W.ICEWidget({
        left: 20,
        top: 22,
        width: 72,
        height: 72,
        radius: 10,
        fill: true,
        stroke: true,
        interactive: false,
        style: { fillStyle: '#3f8cf3', strokeStyle: 'rgba(255,255,255,0.65)', lineWidth: 2 },
      });
      const passwordAvatarLabel = new W.ICELabel({
        interactive: false,
        left: 0,
        top: 0,
        width: 72,
        height: 72,
        text: '🧊',
        align: 'center',
        verticalAlign: 'middle',
        style: { fontSize: 30 },
      });
      passwordAvatar.addChild(passwordAvatarLabel, false);
      passwordPanel.addChild(passwordAvatar, false);
      const passwordName = xpLabel(passwordPanel, { left: 108, top: 24, width: 420, height: 30, text: 'ICE 用户', style: { color: '#ffffff', fillStyle: '#ffffff', fontSize: 20, fontWeight: '700' } });
      xpLabel(passwordPanel, { left: 108, top: 56, width: 430, height: 22, text: '输入任意内容（或直接回车）即可登录', style: { color: 'rgba(255,255,255,0.8)', fillStyle: 'rgba(255,255,255,0.8)', fontSize: 12 } });
      const passwordField = new W.ICEPasswordField({
        id: 'login-password-field',
        left: 108,
        top: 92,
        width: 300,
        height: 32,
        placeholder: '密码（随便写）',
        showToggle: true,
      });
      passwordPanel.addChild(passwordField, false);
      const loginButton = new W.ICEButton({ id: 'login-submit', left: 420, top: 92, width: 120, height: 32, text: '登录', variant: 'primary' });
      loginButton.on('click', () => doLogin());
      passwordPanel.addChild(loginButton, false);
      const backLink = new W.ICELabel({
        id: 'login-back',
        interactive: true,
        left: 108,
        top: 140,
        width: 200,
        height: 24,
        text: '← 换一个用户',
        style: { color: '#cfe0ff', fillStyle: '#cfe0ff', fontSize: 13 },
      });
      backLink.on('click', () => showLogin());
      passwordPanel.addChild(backLink, false);
      xpLabel(passwordPanel, { left: 108, top: 176, width: 430, height: 40, text: '提示：这是演示用的假登录，输入什么都会被接受，不会离开这台电脑。', style: { color: 'rgba(255,255,255,0.6)', fillStyle: 'rgba(255,255,255,0.6)', fontSize: 11 } });

      const welcomeText = xpLabel(loginLayer, {
        id: 'login-welcome',
        left: 0,
        top: 380,
        width: SCREEN_W,
        height: 60,
        text: '',
        align: 'center',
        display: false,
        style: { color: '#ffffff', fillStyle: '#ffffff', fontSize: 34, fontWeight: '700' },
      });
      const welcomeSub = xpLabel(loginLayer, {
        left: 0,
        top: 444,
        width: SCREEN_W,
        height: 24,
        text: '',
        align: 'center',
        display: false,
        style: { color: 'rgba(255,255,255,0.78)', fillStyle: 'rgba(255,255,255,0.78)', fontSize: 13 },
      });

      const loginFooter = new W.ICEWidget({ left: 0, top: 828, width: SCREEN_W, height: 72, fill: false, stroke: false, interactive: false });
      loginLayer.addChild(loginFooter, false);
      gradient(loginFooter, 0, 0, SCREEN_W, 72, '#1b5fc8', '#0a3f9e', 8);
      loginFooter.addChild(new W.ICEWidget({ left: 0, top: -4, width: SCREEN_W, height: 2, fill: true, stroke: false, interactive: false, style: { fillStyle: '#ff8c00' } }), false);
      const shutdownEntry = new W.ICEWidget({ id: 'login-shutdown', left: 28, top: 8, width: 200, height: 56, radius: 6, fill: true, stroke: false, style: { fillStyle: 'rgba(255,255,255,0)' } });
      shutdownEntry.addChild(
        new W.ICELabel({
          interactive: false,
          left: 12,
          top: 0,
          width: 180,
          height: 56,
          text: '⏻  关闭计算机',
          verticalAlign: 'middle',
          style: { color: '#ffffff', fillStyle: '#ffffff', fontSize: 14, fontWeight: '700', fontFamily: XPFONT },
        }),
        false,
      );
      shutdownEntry.on('click', () => shutdown());
      shutdownEntry.on('hoverchange', (evt) => {
        const hovered = !!(evt && evt.param ? evt.param.hovered : evt && evt.hovered);
        shutdownEntry.setState({ style: { ...shutdownEntry.state.style, fillStyle: hovered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0)' } });
        ice.requestRepaint();
      });
      loginFooter.addChild(shutdownEntry, false);
      xpLabel(loginFooter, {
        left: 760,
        top: 0,
        width: 640,
        height: 72,
        text: '任意账号 · 任意密码 · 都能进',
        align: 'right',
        style: { color: 'rgba(255,255,255,0.75)', fillStyle: 'rgba(255,255,255,0.75)', fontSize: 12 },
      });

      /* ---------------------------- ③ 关机 / 重启 ---------------------------- */
      const shutLayer = new W.ICEWidget({
        id: 'shutdown-screen',
        left: 0,
        top: 0,
        width: SCREEN_W,
        height: SCREEN_H,
        fill: true,
        stroke: false,
        display: false,
        interactive: false,
        style: { fillStyle: '#000000' },
      });
      sessionRoot.addChild(shutLayer, false);
      xpLabel(shutLayer, {
        left: 0,
        top: 400,
        width: SCREEN_W,
        height: 40,
        text: '现在可以安全地关闭计算机了。',
        align: 'center',
        style: { color: '#ff8c00', fillStyle: '#ff8c00', fontSize: 22, fontWeight: '700' },
      });
      xpLabel(shutLayer, {
        left: 0,
        top: 448,
        width: SCREEN_W,
        height: 24,
        text: '（别担心，点下面的按钮就又能开机了）',
        align: 'center',
        style: { color: '#8a8f98', fillStyle: '#8a8f98', fontSize: 12 },
      });
      const powerButton = new W.ICEButton({ id: 'power-on', left: SCREEN_W / 2 - 80, top: 500, width: 160, height: 40, text: '⏻  重新开机', variant: 'primary' });
      powerButton.on('click', () => startBoot());
      shutLayer.addChild(powerButton, false);

      /* ---------------------------- 会话状态机 ---------------------------- */
      let bootTimer = null;
      let sessionTimer = null;
      const setPhase = (phase) => {
        session.phase = phase;
        ice.requestRepaint();
      };
      const showLogin = () => {
        clearTimeout(sessionTimer);
        clearInterval(bootTimer);
        setPhase('login');
        sessionRoot.setState({ display: true, opacity: 1, style: { ...sessionRoot.state.style, fillStyle: 'rgba(0,0,0,0)' } });
        bootLayer.setState({ display: false });
        shutLayer.setState({ display: false });
        loginLayer.setState({ display: true });
        passwordPanel.setState({ display: false });
        userTiles.forEach((tile) => tile.setState({ display: true }));
        welcomeText.setState({ display: false });
        welcomeSub.setState({ display: false });
        loginHint.setText(`上次登录：${session.logins ? session.user.name + '（第 ' + session.logins + ' 次）' : '还没有人登录过'}\n音效：${sound.enabled ? '开' : '关'}`);
      };
      const pickUser = (user) => {
        session.user = user;
        playCue('click');
        setPhase('password');
        passwordName.setText(user.name);
        passwordAvatarLabel.setText(user.avatar);
        passwordAvatar.setState({ style: { ...passwordAvatar.state.style, fillStyle: user.accent } });
        passwordField.setValue('');
        userTiles.forEach((tile) => tile.setState({ display: false }));
        welcomeText.setState({ display: false });
        welcomeSub.setState({ display: false });
        passwordPanel.setState({ display: true });
        // 直接给焦点，省得用户再点一下输入框
        W.getICEFocusManager(ice).focus(passwordField);
      };
      const doLogin = () => {
        if (session.phase !== 'password' || !session.user) return;
        session.password = passwordField.getValue();
        session.logins += 1;
        setPhase('welcome');
        userTiles.forEach((tile) => tile.setState({ display: false }));
        passwordPanel.setState({ display: false });
        // 登录层隐去前清掉 ICE 焦点：否则密码框的透明 input 代理残留在桌面，
        // Chrome 会给它画一圈 :focus-visible 蓝框（幽灵蓝框）。
        W.getICEFocusManager(ice).focus(null);
        welcomeText.setText(`欢迎 ${session.user.name}`);
        welcomeText.setState({ display: true });
        welcomeSub.setText(
          session.password
            ? `密码「${session.password}」已接受 —— 反正谁都放行 🙂`
            : '连密码都没输，照样进 —— 这就是玩具系统 🙂',
        );
        welcomeSub.setState({ display: true });
        playCue('startup');
        // 桌面在幕布后面就绪，等欢迎语亮一下再揭幕
        desktop.setState({ display: true });
        sessionTimer = setTimeout(() => {
          W.fadeOut(sessionRoot, {
            duration: 700,
            onFinish: () => {
              sessionRoot.setState({ display: false });
              setPhase('desktop');
              toast(`欢迎回来，${session.user.name}`, 'success');
              showSoundHint();
            },
          });
        }, 900);
      };
      const logoff = () => {
        startMenuHandle && startMenuHandle.close();
        playCue('logoff');
        setPhase('logoff');
        desktop.setState({ display: false });
        sessionRoot.setState({ display: true, opacity: 1 });
        bootLayer.setState({ display: false });
        shutLayer.setState({ display: false });
        loginLayer.setState({ display: true });
        passwordPanel.setState({ display: false });
        userTiles.forEach((tile) => tile.setState({ display: false }));
        welcomeText.setText('正在注销…');
        welcomeText.setState({ display: true });
        welcomeSub.setText(`正在保存 ${session.user ? session.user.name : ''} 的设置`);
        welcomeSub.setState({ display: true });
        sessionTimer = setTimeout(showLogin, 900);
      };
      const shutdown = () => {
        startMenuHandle && startMenuHandle.close();
        playCue('shutdown');
        setPhase('shutdown');
        desktop.setState({ display: false });
        sessionRoot.setState({ display: true, opacity: 1 });
        bootLayer.setState({ display: false });
        loginLayer.setState({ display: false });
        shutLayer.setState({ display: true });
      };
      const startBoot = () => {
        clearTimeout(sessionTimer);
        setPhase('boot');
        desktop.setState({ display: false });
        sessionRoot.setState({ display: true, opacity: 1 });
        bootLayer.setState({ display: true });
        loginLayer.setState({ display: false });
        shutLayer.setState({ display: false });
        let offset = 0;
        clearInterval(bootTimer);
        bootTimer = setInterval(() => {
          if (session.phase !== 'boot') return;
          offset = (offset + 7) % 200;
          bootBlocks.forEach((block, index) => {
            block.setState({ left: Math.min(196, offset + index * 24) });
          });
          ice.requestRepaint();
        }, 40);
        sessionTimer = setTimeout(showLogin, 2200);
      };
      const skipBoot = () => {
        if (session.phase !== 'boot') return false;
        session.skips += 1;
        showLogin();
        return true;
      };
      /** 第一次登入桌面时，把「音效可以关」这件事告诉用户（托盘里的喇叭）。 */
      let soundHintShown = false;
      const showSoundHint = () => {
        if (soundHintShown) return;
        soundHintShown = true;
        toast('托盘里的喇叭图标可以关掉音效', 'info');
      };

      /* ============================ 组装 ============================ */
      /* ============================ 组装 ============================ */
      // 壁纸 → 图标 → 窗口 → 任务栏，任务栏永远在最上面
      desktop.addChild(taskbar, false);
      ice.addChild(desktop);
      taskbar.setState({ zIndex: TASKBAR_Z_INDEX, paramsDirty: false });
      // 会话幕布（开机 / 登录 / 关机）盖在任务栏之上，登录完才揭幕
      ice.addChild(sessionRoot);
      sessionRoot.setState({ zIndex: SESSION_ROOT_Z_INDEX, paramsDirty: false });
      // 开场：自动打开「我的电脑」，让人一眼看到窗口的样子（登录前藏在幕布后面）
      openApp(APPS[0]);
      startBoot();

      /* 键盘：开机任意键跳过；登录页回车直接选第一个用户；密码页回车直接进。 */
      window.addEventListener('keydown', (event) => {
        if (session.phase === 'boot') {
          if (event.key === 'Tab' || event.key === 'Shift' || event.key === 'Escape' || event.key === 'CapsLock') return;
          event.preventDefault();
          skipBoot();
          return;
        }
        if (event.key !== 'Enter') return;
        if (session.phase === 'password') {
          event.preventDefault();
          doLogin();
        } else if (session.phase === 'login') {
          event.preventDefault();
          pickUser(USERS[0]);
        }
      });
      // 开机画面上点一下也算「任意键」（顺便解锁 AudioContext）
      sessionRoot.on('click', () => skipBoot());

      /* ICE Arcade 窗口激活时键盘归游戏（P/R 由应用自己处理）。 */
      window.addEventListener('keydown', (event) => {
        if (activeKey !== 'arcade') return;
        const entry = openWindows.get('arcade');
        if (!entry || entry.minimized || !handles.arcade) return;
        const known = [
          'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar',
          'w', 'W', 'a', 'A', 's', 'S', 'd', 'D', 'z', 'Z', 'x', 'X', 'p', 'P', 'r', 'R',
        ];
        if (known.indexOf(event.key) === -1) return;
        if (handles.arcade.keydown(event.key, event.repeat === true)) event.preventDefault();
      });

      window.__result = {
        ice,
        desktop,
        wallpaper,
        taskbar,
        taskButtons,
        startButton,
        clockLabel,
        openWindows,
        iconTiles,
        openApp,
        closeWindow,
        minimizeWindow,
        focusWindow,
        setWallpaper,
        APPS,
        WALLPAPERS,
        session,
        sound,
        sessionRoot,
        bootLayer,
        loginLayer,
        loginHint,
        shutLayer,
        passwordPanel,
        welcomeText,
        welcomeSub,
        trayLabel,
        userTiles,
        passwordField,
        loginButton,
        shutdownEntry,
        powerButton,
        traySoundToggle,
        pickUser,
        doLogin,
        logoff,
        shutdown,
        startBoot,
        skipBoot,
        USERS,
        handles,
      };
    
