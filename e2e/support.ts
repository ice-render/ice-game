import { expect, type Page } from '@playwright/test';

/**
 * e2e 公共件：错误收集、像素统计、画布坐标换算。
 *
 * 这些页面是**整屏画布应用**，所以断言只能落在「画布上真的有东西」与
 * 「真按键 / 真鼠标之后状态真的变了」这两件事上。这也是本仓 e2e 的判据口径：
 * 只有像素、或只有状态、或只有 URL，都可能"看起来通过其实没验证"。
 *
 * ## 画布按 **id** 定位，不按序号
 *
 * 首页现在有**三块画布**（吸顶导航 `#navbar` + 页面主体 `#canvas` + 背景效果层 `#bg`），
 * 其它页面各一块。早先这里用的是 `querySelectorAll('canvas')[index]` —— 那种写法在
 * "将来往 DOM 里插一块画布"时会**静默错位**（断言开始量另一块画布，还可能照样通过），
 * 属于本仓一直在防的"空门"。改成 id 之后，顺序怎么变都不影响，意图也写在调用处。
 */

/** 页面主体画布的 id（各页 index.html 里都是这个）。 */
export const MAIN_CANVAS = 'canvas';
/** 首页吸顶导航画布的 id。 */
export const NAVBAR_CANVAS = 'navbar';
/** 首页背景效果层画布的 id（粒子 / 网格 / 光斑，见 `src/home/effects-canvas.ts`）。 */
export const EFFECTS_CANVAS = 'bg';

/** 收集 pageerror 与 console error；用例收尾断言它是空的。 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`.slice(0, 300));
  });
  return errors;
}

export interface CanvasStats {
  width: number;
  height: number;
  /** 画上去的像素占比（`alpha >= 8`）。画布默认透明，不算这一条的话"背景色也算内容"。 */
  opaqueRatio: number;
  /** 画上去**且与主色明显不同**的像素占比 —— 只刷一层底色的空画布在这里会露馅。 */
  inkRatio: number;
  /** 不同颜色数：纹理/文字越多越大，用来区分"画了块底色"和"画了界面"。 */
  colors: number;
}

/** 采样统计画布内容。采样步长按面积自适应（约 1/16384 像素量级），够快也够稳。 */
export async function canvasStats(page: Page, canvasId = MAIN_CANVAS): Promise<CanvasStats> {
  return page.evaluate((id) => {
    const canvas = document.getElementById(id) as HTMLCanvasElement | null;
    if (!canvas) throw new Error(`页面上没有 #${id} 画布`);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('拿不到 2d context');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    const total = width * height;
    const step = Math.max(1, Math.round(Math.sqrt(total / 16384)));
    const stride = step * 4;

    const counts = new Map<string, number>();
    const samples: string[] = [];
    let sampled = 0;
    for (let p = 0; p < total; p += step) {
      sampled += 1;
      const i = p * 4;
      if (data[i + 3] < 8) continue;
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      samples.push(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    let modal = '0,0,0';
    let modalCount = 0;
    for (const [key, count] of counts) {
      if (count > modalCount) {
        modal = key;
        modalCount = count;
      }
    }
    const [mr, mg, mb] = modal.split(',').map(Number);
    let ink = 0;
    for (const key of samples) {
      const [r, g, b] = key.split(',').map(Number);
      if (Math.abs(r - mr) > 24 || Math.abs(g - mg) > 24 || Math.abs(b - mb) > 24) ink += 1;
    }

    return {
      width,
      height,
      opaqueRatio: sampled ? samples.length / sampled : 0,
      inkRatio: samples.length ? ink / samples.length : 0,
      colors: counts.size,
    };
  }, canvasId);
}

/**
 * 画布内部坐标 → 页面坐标。
 * 引擎按 `dpr` 把 backing store 放大过，所以不能直接拿内部坐标当 CSS 坐标点。
 */
export async function canvasPoint(page: Page, x: number, y: number, canvasId = MAIN_CANVAS) {
  const box = await page.locator(`#${canvasId}`).boundingBox();
  if (!box) throw new Error(`#${canvasId} 还没有布局盒子`);
  const size = await page.evaluate((id) => {
    const canvas = document.getElementById(id) as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  }, canvasId);
  return { x: box.x + (x * box.width) / size.width, y: box.y + (y * box.height) / size.height };
}

/** 点画布上的一个**内部坐标**点（自动换算成页面坐标）。 */
export async function clickCanvas(page: Page, x: number, y: number, canvasId = MAIN_CANVAS) {
  const point = await canvasPoint(page, x, y, canvasId);
  await page.mouse.click(point.x, point.y);
}

/**
 * 把画布内部坐标 `(x, y)` 滚到**视口中间**（纵向），并断言它真的进了视口。
 *
 * ## 为什么必须有这一步（实测结论，别删）
 *
 * **视口外的 `page.mouse.move` 不会生效**：坐标超出视口高度时浏览器直接忽略该事件，
 * 于是 hover 永远不触发、用例静默变成"空门"。
 *
 * 更绕的是**同坐标的 `mouse.click` 却生效**（实测：文档 y=1377、视口只有 900 高，
 * 点击仍精确命中卡片并触发了跳转）。两个看起来一样的坐标操作行为不同 ——
 * 所以"点击用例能过"**不能**当成"hover 用例也能过"的证据。
 *
 * 而首页在 hero 与精选展厅之后，第一张卡片的中心就已经在 `y≈1005`（视口 900）——
 * 也就是说"直接 hover 卡片中心"这种写法在本页**天然是坏的**，且失败时没有任何报错。
 *
 * 用途：hover 之类的**指针悬停**断言之前先调它。点击用例不强制，
 * 但为了贴近真实用户（能看到才会去点）也建议调。
 *
 * 顺带断言"滚动后目标真的在视口内"：将来版面再变高时**立刻报错**，
 * 而不是退回成一条永远不触发 hover 的假用例。
 */
export async function scrollCanvasPointIntoView(page: Page, x: number, y: number, canvasId = MAIN_CANVAS) {
  await page.evaluate(
    ({ id, px, py }) => {
      const canvas = document.getElementById(id) as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      // 画布在**文档**里的纵向位置：`getBoundingClientRect` 是视口坐标，要补上当前滚动量
      const canvasDocTop = box.top + window.scrollY;
      window.scrollTo(0, canvasDocTop + py - window.innerHeight / 2);
    },
    { id: canvasId, px: x, py: y },
  );
  await page.waitForTimeout(250);

  const viewportY = await page.evaluate(
    ({ id, px, py }) => {
      const canvas = document.getElementById(id) as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      return {
        y: box.top + (py * box.height) / canvas.height,
        innerHeight: window.innerHeight,
      };
    },
    { id: canvasId, px: x, py: y },
  );
  expect(
    viewportY.y,
    `滚动之后目标点仍在视口外（视口 y=${Math.round(viewportY.y)}，视口高 ${viewportY.innerHeight}）——` +
      `此时 mouse.move 会被浏览器忽略，用例会静默失效`,
  ).toBeLessThan(viewportY.innerHeight);
  expect(viewportY.y, '滚动之后目标点跑到视口上方去了').toBeGreaterThan(0);
}

/** 双击画布上的一个内部坐标点（桌面图标靠双击打开）。 */
export async function dblclickCanvas(page: Page, x: number, y: number, canvasId = MAIN_CANVAS) {
  const point = await canvasPoint(page, x, y, canvasId);
  await page.mouse.dblclick(point.x, point.y);
}

/**
 * 注入 `window.__rect(node)`：沿 `parentNode` 累加 `left/top` 得到**世界坐标**（相对画布）。
 *
 * 必须在 `goto` 之前 `addInitScript`。上游两个游戏页是从上游**逐字**抽取的，不能为了测试
 * 往里塞调试函数 —— 于是把这段走坐标的逻辑放在测试侧注入。
 *
 * 终止条件是 `cursor.state` 而不是 `cursor`：`ICE` 实例本身没有 `state`，
 * 写成 `while (cursor) { … }` 会在根上读 `state.left` 直接崩。
 */
export const RECT_HELPER = `
window.__rect = function (node) {
  let left = 0;
  let top = 0;
  let cursor = node;
  while (cursor && cursor.state) {
    left += cursor.state.left || 0;
    top += cursor.state.top || 0;
    cursor = cursor.parentNode;
  }
  return { left: left, top: top, width: (node.state && node.state.width) || 0, height: (node.state && node.state.height) || 0 };
};
`;

/**
 * 断言"画布上确实画出了界面"，而不是一片空白。
 *
 * @param minInk   与主色明显不同的像素占比下限（实测正常页面 0.5%~70%）
 * @param options.minOpaque 画上去的像素占比下限。**默认 0.5 只适用于"铺满画布"的页面**
 *   （整机、游戏页都有全屏底色或全屏遮罩）。像游戏厅首页那样"画布透明、只画卡片"的版面，
 *   卡片本身只占画布面积的两三成，必须把这个值调低 —— 否则断言会因为"正常留白"而误报。
 * @param options.canvasId 量哪块画布（默认页面主体；首页还有 `#navbar`）。
 */
export async function expectCanvasPainted(
  page: Page,
  minInk = 0.02,
  options: { minOpaque?: number; canvasId?: string } = {},
) {
  const minOpaque = options.minOpaque ?? 0.5;
  const stats = await canvasStats(page, options.canvasId ?? MAIN_CANVAS);
  expect(stats.opaqueRatio, '画上去的像素占比（画布默认透明）').toBeGreaterThan(minOpaque);
  expect(stats.inkRatio, `与主色不同的像素占比，实测 ${stats.inkRatio.toFixed(4)}`).toBeGreaterThan(minInk);
  expect(stats.colors, '不同颜色数').toBeGreaterThan(8);
  return stats;
}

/* ------------------------------ 版面体检 ------------------------------ */

export interface LayoutIssue {
  kind: 'overflow' | 'overlap';
  detail: string;
}

export interface LayoutAuditResult {
  canvas: string;
  nodeCount: number;
  overflow: string[];
  overlaps: string[];
}

/**
 * **版面体检**：在页面里跑，返回越界与"部分交叠"清单。
 *
 * 为什么要做成通用门禁：画布应用的版面错乱**没有天然的报错** ——
 * 两个卡片压在一起、数值卡压住游戏区，引擎照常绘制，只有人眼看截图才发现。
 * 实测就是这样抓到 kit/shell 的数值卡压住游戏区 18px 的。
 *
 * 用引擎现成的 `getAccessibilityTree()`（给出 id / box / visible / parentId），
 * 不自己遍历显示树。
 *
 * ⚠️ **实测确认**：`box` **已经是相对画布的坐标**（CSS 像素），不是相对视口 ——
 * 曾按"屏幕坐标"理解、又减了一次画布偏移，得到满屏假越界。
 *
 * 判据的四层排除（每一层都是被误报逼出来的）：
 *   1. **祖先-后代不算**（沿 `parentId` 链）：卡片包含文字是设计；
 *   2. **不占地的容器不算**：`fill === false && stroke === false` 的 widget
 *      （kit 的 `game-shell`、`game-overlay` 根）只是排版的透明层；
 *   3. **完全包含不算**：一方完整包住另一方 = 背景板 / 卡片含内容。
 *      要抓的是**部分交叠**（边界互相切入），那才是版面算错的典型症状；
 *   4. **尺寸 ≤2px 忽略**：细分隔线互相擦到没意义。
 */
export async function auditLayout(
  page: Page,
  options: {
    canvasId?: string;
    iceSource?: 'main' | 'navbar' | 'bg';
    allowIdPrefixes?: string[];
    tolerancePx?: number;
  } = {},
) {
  return page.evaluate(
    ({ canvasId, iceSource, allowIdPrefixes, tolerancePx }) => {
      const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
      if (!canvas) return { error: `没有 #${canvasId}` };

      /*
       * ICE 实例必须与画布**成对取**。
       *
       * 首页有三块画布、各自一个 ICE 实例：用"主画布的 ICE"去量"导航画布的尺寸"，
       * 会把主画布上 y > 60 的节点全判成越界（实测踩过：报了一屏假越界）。
       * 所以这里按来源显式选，不做"哪个能用就用哪个"的兜底。
       */
      const sources: Record<string, () => any> = {
        // 主画布：首页 / 小游戏 / 掌机 / XP 的句柄位置各不相同
        main: () =>
          ((window as any).__gameHome && (window as any).__gameHome.ice) ||
          ((window as any).__game && (window as any).__game.page && (window as any).__game.page.ice) ||
          ((window as any).__arcade && (window as any).__arcade.ice) ||
          ((window as any).__result && (window as any).__result.ice) ||
          null,
        // 吸顶导航（独立画布 + 独立 ICE 实例）
        navbar: () => (window as any).__gameHome?.navbar?.handle?.page?.ice ?? null,
        // 背景效果层（第三个独立实例）
        bg: () => (window as any).__gameHome?.effects?.handle?.page?.ice ?? null,
      };
      const ice = sources[iceSource] ? sources[iceSource]() : null;
      if (!ice || typeof ice.getAccessibilityTree !== 'function') {
        return { error: `拿不到 ice（来源 ${iceSource}）` };
      }

      const isSolid = (id: string) => {
        const node = typeof ice.findComponent === 'function' ? ice.findComponent(id) : null;
        if (!node || !node.state) return true; // 拿不到就保守当它占地（宁可多报）
        return node.state.fill !== false || node.state.stroke !== false;
      };
      const contains = (a: any, b: any) =>
        a.left <= b.left + 1 &&
        a.top <= b.top + 1 &&
        a.left + a.width >= b.left + b.width - 1 &&
        a.top + a.height >= b.top + b.height - 1;

      const nodes = ice
        .getAccessibilityTree()
        .filter((n: any) => n.visible)
        .map((n: any) => ({
          id: n.id,
          parentId: n.parentId,
          left: Math.round(n.box.x),
          top: Math.round(n.box.y),
          width: Math.round(n.box.width),
          height: Math.round(n.box.height),
        }));

      const byId = new Map<string, any>(nodes.map((n: any) => [n.id, n]));
      const isAncestor = (ancestorId: string, node: any) => {
        let cursor: string | null = node.parentId;
        let guard = 0;
        while (cursor && guard < 60) {
          if (cursor === ancestorId) return true;
          cursor = (byId.get(cursor)?.parentId as string | null) ?? null;
          guard += 1;
        }
        return false;
      };

      const overflow: string[] = [];
      /**
       * 是否属于"点名排除的子树"。
       *
       * 注意要**向上查祖先链**、不能只看自己的 id：任务按钮被排除时，
       * 它里面的图标与标题（匿名节点）也要跟着排除，否则会继续报越界
       * （实测：排除 `task-` 之后仍剩 `ICE_xxx (1350,868 130×28)` 两条）。
       */
      const isAllowed = (node: any) => {
        let cursor: any = node;
        let guard = 0;
        while (cursor && guard < 60) {
          if (cursor.id && allowIdPrefixes.some((prefix) => cursor.id.startsWith(prefix))) return true;
          cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
          guard += 1;
        }
        return false;
      };

      for (const n of nodes) {
        if (n.width <= 0 || n.height <= 0) continue;
        if (isAllowed(n)) continue;
        // `tolerancePx`：容忍画布边缘几像素的"出血"（实测 XP 任务栏底边有 2px 越界，
        // 属视觉上看不出来的装饰线）。几像素 ≠ 版面错乱，别让它把断言弄成噪音。
        if (
          n.left < -tolerancePx ||
          n.top < -tolerancePx ||
          n.left + n.width > canvas.width + tolerancePx ||
          n.top + n.height > canvas.height + tolerancePx
        ) {
          overflow.push(`${n.id} (${n.left},${n.top} ${n.width}×${n.height})`);
        }
      }

      const named = nodes.filter(
        (n: any) => n.id && !n.id.startsWith('ICE_') && n.width > 2 && n.height > 2 && !isAllowed(n) && isSolid(n.id),
      );
      /**
       * 节点所属的**窗口**（沿父链找 `window-*`）。没有则返回 null。
       *
       * 用来放行"**跨窗口交叠**"：桌面系统里窗口本来就可以互相遮挡（还能被拖动），
       * 两个窗口的内容重叠是**设计**而不是错乱。实测 XP 八窗全开时报出的
       * `documents-table ∩ notepad-editor` 之类全是这种情况。
       * 窗口**内部**的构件之间仍然严格检查。
       */
      const ownerWindow = (node: any) => {
        let cursor: any = node;
        let guard = 0;
        while (cursor && guard < 60) {
          if (cursor.id && cursor.id.startsWith('window-')) return cursor.id;
          cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
          guard += 1;
        }
        return null;
      };

      const overlaps: string[] = [];
      for (let i = 0; i < named.length; i += 1) {
        for (let j = i + 1; j < named.length; j += 1) {
          const a = named[i];
          const b = named[j];
          if (isAncestor(a.id, b) || isAncestor(b.id, a)) continue;
          if (contains(a, b) || contains(b, a)) continue;
          const ownerA = ownerWindow(a);
          const ownerB = ownerWindow(b);
          if (ownerA && ownerB && ownerA !== ownerB) continue; // 跨窗口：允许遮挡
          const overlapX = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
          if (overlapX > 2 && overlapY > 2) {
            overlaps.push(`${a.id} ∩ ${b.id} = ${overlapX}×${overlapY}px`);
          }
        }
      }

      return {
        canvas: `${canvas.width}×${canvas.height}`,
        nodeCount: nodes.length,
        overflow,
        overlaps,
      };
    },
    {
      canvasId: options.canvasId ?? MAIN_CANVAS,
      iceSource: options.iceSource ?? 'main',
      allowIdPrefixes: options.allowIdPrefixes ?? DEFAULT_ALLOW_ID_PREFIXES,
      tolerancePx: options.tolerancePx ?? DEFAULT_EDGE_TOLERANCE_PX,
    },
  );
}

/**
 * 设计上就该叠在别的构件之上的节点（按 id 前缀）。
 * `game-overlay` 是 kit 的暂停/结束遮罩 —— 它**就是**要盖住游戏画面。
 */
export const DEFAULT_ALLOW_ID_PREFIXES = ['game-overlay'];

/** 画布边缘的容忍像素（详见 `auditLayout` 里的说明）。 */
export const DEFAULT_EDGE_TOLERANCE_PX = 4;

/**
 * 断言版面干净：没有越界、没有意外交叠。
 *
 * **发现问题时重试一次**（间隔 300ms）再判失败：有些页面有入场动画，
 * 动画中间态的元素可能短暂越出画布（实测 XP 桌面淡入时见过一次，80 次高频采样都没再复现）。
 * 重试能容忍这种瞬态、又不放过"稳定越界"的真问题。
 */
export async function expectLayoutClean(
  page: Page,
  options: {
    canvasId?: string;
    iceSource?: 'main' | 'navbar' | 'bg';
    allowIdPrefixes?: string[];
    tolerancePx?: number;
  } = {},
): Promise<LayoutAuditResult> {
  let result = await auditLayout(page, options);
  if ('error' in result && result.error) {
    throw new Error(`版面体检失败：${result.error}`);
  }
  const clean = (r: typeof result) => r.overflow.length === 0 && r.overlaps.length === 0;
  if (!clean(result)) {
    await page.waitForTimeout(300);
    result = await auditLayout(page, options);
  }
  expect(result.overflow, '有节点越出画布（画布外的内容会被静默裁掉）').toEqual([]);
  expect(result.overlaps, '有构件互相压住（部分交叠 = 版面算错的典型症状）').toEqual([]);
  return result as LayoutAuditResult;
}
