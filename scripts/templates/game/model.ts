/**
 * __TITLE__ 的**规则**（纯逻辑：零运行时依赖，不 import 引擎、不碰 DOM）。
 *
 * 玩法判定放这里，画面与输入放 `main.ts` —— 这样规则能在 node 里单测
 * （见 `tests/games/__SLUG__/model.test.ts`），不需要浏览器、不需要引擎产物。
 *
 * 现在这个骨架是一个"限时计分"的占位玩法：`tap()` 计分，时间到了就结束。
 * 把它换成你真正的规则即可 —— **保持同样的三件事**：
 *   1. 状态全在 model 里（相位 / 分数 / 关卡…），外面只读不改；
 *   2. `step(dtMs)` 推进时间，返回"这一帧发生了什么"（事件交给表现层播音效/特效）；
 *   3. 想给表现层用的瞬时信息一律通过**返回值**暴露，不要在 model 里碰 UI。
 */
export type __NAME__Phase = 'ready' | 'playing' | 'paused' | 'over';

/** 一帧内发生的事：调用方据此播声音 / 触发特效。 */
export type __NAME__Event = 'tap' | 'start' | 'pause' | 'resume' | 'over';

export interface __NAME__Options {
  /** 游戏区宽（局部坐标）。 */
  width: number;
  /** 游戏区高。 */
  height: number;
  /** 一局时长（毫秒，默认 30 秒）。 */
  durationMs?: number;
}

export interface __NAME__Snapshot {
  phase: __NAME__Phase;
  score: number;
  /** 剩余毫秒（>0 时才有意义）。 */
  remainingMs: number;
  /** 剩余时间占比 0~1（给进度条用）。 */
  remainingRatio: number;
}

export class __NAME__Model {
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;

  private phase: __NAME__Phase = 'ready';
  private score = 0;
  private remainingMs: number;

  constructor(options: __NAME__Options) {
    this.width = options.width;
    this.height = options.height;
    this.durationMs = options.durationMs || 30_000;
    this.remainingMs = this.durationMs;
  }

  getSnapshot(): __NAME__Snapshot {
    return {
      phase: this.phase,
      score: this.score,
      remainingMs: this.remainingMs,
      remainingRatio: this.durationMs > 0 ? Math.max(0, this.remainingMs / this.durationMs) : 0,
    };
  }

  getPhase(): __NAME__Phase {
    return this.phase;
  }

  getScore(): number {
    return this.score;
  }

  getRemainingMs(): number {
    return this.remainingMs;
  }

  isOver(): boolean {
    return this.phase === 'over';
  }

  isPaused(): boolean {
    return this.phase === 'paused';
  }

  /** 开始（ready → playing）。重复调用无副作用。 */
  start(): __NAME__Event[] {
    if (this.phase !== 'ready') return [];
    this.phase = 'playing';
    return ['start'];
  }

  /** 计分（只有 playing 时有效）。 */
  tap(): __NAME__Event[] {
    if (this.phase !== 'playing') return [];
    this.score += 1;
    return ['tap'];
  }

  togglePause(): __NAME__Event[] {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      return ['pause'];
    }
    if (this.phase === 'paused') {
      this.phase = 'playing';
      return ['resume'];
    }
    return [];
  }

  /** 重开：分数与时间回到初始。 */
  reset(): void {
    this.phase = 'ready';
    this.score = 0;
    this.remainingMs = this.durationMs;
  }

  /**
   * 推进 `dtMs` 毫秒，返回本帧事件。
   * 只有 `playing` 会走时间；暂停/结束时不动（调用方也可能已经停了循环，这里是第二道保险）。
   */
  step(dtMs: number): __NAME__Event[] {
    const events: __NAME__Event[] = [];
    if (this.phase !== 'playing' || !(dtMs > 0)) return events;

    this.remainingMs -= dtMs;
    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      this.phase = 'over';
      events.push('over');
    }
    return events;
  }
}
