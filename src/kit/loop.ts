/**
 * 帧循环：固定步长的 `dt` + 一个上限，并负责"暂停时真的停下来"。
 *
 * 为什么不用引擎的帧事件：引擎的 `FrameManager` 是**全局单例**（同一页面上多个 ICE 实例
 * 共享一条 rAF），而游戏循环要能被单独暂停/停止、还要有自己的 dt 上限；
 * 自己 rAF 更直接。arcade 与 XP 两台整机也是这么做的（`requestAnimationFrame` 手写循环）。
 *
 * ```ts
 * const loop = startLoop(page, (dt) => {
 *   world.step(dt);          // dt 单位毫秒
 *   render();
 * });
 * loop.setPaused(true);      // 暂停：不再推进，也关掉引擎的持续帧（省电、画面冻住）
 * ```
 *
 * 两个必须的细节（踩过）：
 *
 * - **`dt` 要有上限**：切到别的标签页再回来，`now - last` 可能是几十秒，
 *   一帧就把球送出边界（物理直接炸）。这里钳到 120ms。
 * - **暂停要连"持续帧"一起关**：只停 `onFrame` 的话，引擎仍在每帧重绘（白耗电）；
 *   恢复时再打开，`setContinuousFrames` 会自己唤醒 rAF 循环。
 */
import type { GamePageHandle } from './page';

export interface LoopHandle {
  /** 停止循环（不可恢复；页面卸载或换关卡重建时用）。 */
  stop(): void;
  /** 暂停 / 恢复。 */
  setPaused(paused: boolean): void;
  readonly paused: boolean;
  /** 已推进的帧数（e2e 断言"游戏真的在跑"用）。 */
  readonly frames: number;
  /** 累计运行毫秒（不含暂停时间）。 */
  readonly elapsed: number;
}

export interface LoopOptions {
  /** 单帧 `dt` 上限（毫秒）。默认 120。 */
  maxDelta?: number;
  /** 是否在每帧末尾强制置脏（默认 true，保证改动一定上屏）。 */
  markDirty?: boolean;
}

/** 单帧 dt 上限：切标签页回来时物理不会炸。 */
export const DEFAULT_MAX_DELTA = 120;

export function startLoop(
  page: GamePageHandle,
  onFrame: (dt: number, now: number) => void,
  options: LoopOptions = {},
): LoopHandle {
  const maxDelta = options.maxDelta || DEFAULT_MAX_DELTA;
  const markDirty = options.markDirty !== false;

  let last = 0;
  let rafId = 0;
  let stopped = false;
  let paused = false;
  let frames = 0;
  let elapsed = 0;

  const tick = (now: number) => {
    if (stopped) return;
    if (paused) {
      // 暂停期间不推进、不置脏；把 last 跟着走，恢复时不会攒出一个巨大的 dt
      last = now;
      rafId = requestAnimationFrame(tick);
      return;
    }
    const dt = last ? Math.min(maxDelta, now - last) : 0;
    last = now;
    frames += 1;
    elapsed += dt;
    onFrame(dt, now);
    // 显式置脏：游戏每帧都在改节点，但"每帧一定重绘"这件事由这里保证，
    // 免得某个游戏改了不触发失效链路的东西（如直接改 painter 状态）就不刷新。
    if (markDirty) page.ice.dirty = true;
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    stop() {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    setPaused(next: boolean) {
      if (stopped || paused === next) return;
      paused = next;
      // 暂停时让引擎空闲停帧（省电）；恢复时唤醒
      if (typeof page.ice.setContinuousFrames === 'function') {
        page.ice.setContinuousFrames(!next);
      }
      if (!next) page.ice.dirty = true;
    },
    get paused() {
      return paused;
    },
    get frames() {
      return frames;
    },
    get elapsed() {
      return elapsed;
    },
  };
}
