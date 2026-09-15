/**
 * 打砖块 —— **纯逻辑**（零运行时依赖：不 import 引擎、不碰 DOM）。
 *
 * 玩法规则全在这里，画面与输入在 `main.ts`。这么分的好处是规则可以在 node 里单测：
 * 撞墙反弹、消砖加分、掉球扣命、清屏过关这些最容易写错的判定，
 * 不需要浏览器、不需要引擎产物就能钉住（见 `tests/games/breakout/`）。
 *
 * 坐标系统：**stage 局部坐标**（0,0 = 游戏区左上角）。渲染时由 `main.ts` 加上 stage 偏移，
 * 于是版面调整不会影响这里的物理与测试。
 *
 * ## 两个容易写错的地方
 *
 * 1. **必须分固定子步推进**。直接把一帧的 `dt`（可能 30ms）一次性乘进速度，球一帧能走
 *    十几个像素，会**穿过**砖块（穿透），表现为"明明看着撞上了却没消"。这里固定 1/240s 一步，
 *    一帧拆多步。
 * 2. **反弹轴要按穿透深度选**，不能一律 `vy = -vy`：球从侧面擦到砖块时只该换水平方向，
 *    否则斜着撞一排砖会出现"弹回自己来的方向"的诡异轨迹。
 */

export type BreakoutPhase = 'ready' | 'playing' | 'paused' | 'over' | 'win';

export interface Brick {
  row: number;
  col: number;
  /** 局部坐标（左上角）。 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 剩余耐久（>0 表示还活着）。 */
  hp: number;
  /** 满耐久，用来算受击后的颜色。 */
  maxHp: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface Paddle {
  /** 左边缘 x。 */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一帧内发生的事：调用方据此播声音 / 触发特效（也可以什么都不做）。 */
export type BreakoutEvent = 'paddle' | 'wall' | 'brick' | 'break' | 'life' | 'levelup' | 'win' | 'over';

export interface BreakoutOptions {
  /** 游戏区宽（局部坐标）。 */
  width: number;
  /** 游戏区高。 */
  height: number;
  rows?: number;
  cols?: number;
  brickTop?: number;
  brickHeight?: number;
  brickGap?: number;
  ballRadius?: number;
  /** 球速（像素/秒）。 */
  ballSpeed?: number;
  paddleWidth?: number;
  paddleHeight?: number;
  /** 挡板跟随速度上限（像素/秒）。 */
  paddleSpeed?: number;
  lives?: number;
  /** 初始球与挡板之间发球方向（弧度，0 = 正右，负 π/2 = 正上）。 */
  launchAngle?: number;
}

export interface BreakoutSnapshot {
  phase: BreakoutPhase;
  score: number;
  lives: number;
  level: number;
  bricksLeft: number;
  ball: Ball;
  paddle: Paddle;
  bricks: Brick[];
}

const DEFAULTS = {
  rows: 5,
  cols: 9,
  brickTop: 24,
  brickHeight: 26,
  brickGap: 6,
  ballRadius: 8,
  ballSpeed: 420,
  paddleWidth: 118,
  paddleHeight: 14,
  paddleSpeed: 760,
  lives: 3,
  launchAngle: -Math.PI / 2 + 0.35,
};

/** 每关的加速系数：球越来越快，挡板越来越窄（有难度曲线，但不至于失控）。 */
const LEVEL_SPEEDUP = 1.06;
const LEVEL_PADDLE_SHRINK = 0.94;
const MIN_PADDLE_WIDTH = 70;

/** 物理子步（毫秒）：球一帧不能跨过一块砖。 */
const SUBSTEP_MS = 1000 / 240;

/** 每次消除砖块的得分（按行：越靠上的砖越值钱）。 */
function scoreForRow(row: number, rows: number): number {
  return (rows - row) * 10;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class BreakoutModel {
  readonly width: number;
  readonly height: number;
  readonly rows: number;
  readonly cols: number;

  private options: Required<BreakoutOptions>;
  private bricks: Brick[] = [];
  private ball: Ball;
  private paddle: Paddle;

  private ballSpeed: number;
  private level = 1;
  private score = 0;
  private lives: number;
  private phase: BreakoutPhase = 'ready';
  /** 发球前球贴在挡板上：跟着挡板走。 */
  private ballStuckToPaddle = true;

  constructor(options: BreakoutOptions) {
    const merged = { ...DEFAULTS, ...options } as Required<BreakoutOptions>;
    this.options = merged;
    this.width = merged.width;
    this.height = merged.height;
    this.rows = merged.rows;
    this.cols = merged.cols;
    this.lives = merged.lives;
    this.ballSpeed = merged.ballSpeed;
    this.ball = { x: this.width / 2, y: 0, vx: 0, vy: 0, radius: merged.ballRadius };
    this.paddle = {
      x: this.width / 2 - merged.paddleWidth / 2,
      y: this.height - merged.paddleHeight - 18,
      width: merged.paddleWidth,
      height: merged.paddleHeight,
    };
    this.buildBricks();
    this.settleBallOnPaddle();
  }

  /* ------------------------------- 只读快照 ------------------------------- */

  getSnapshot(): BreakoutSnapshot {
    return {
      phase: this.phase,
      score: this.score,
      lives: this.lives,
      level: this.level,
      bricksLeft: this.bricks.filter((b) => b.hp > 0).length,
      ball: { ...this.ball },
      paddle: { ...this.paddle },
      bricks: this.bricks.map((b) => ({ ...b })),
    };
  }

  getPhase(): BreakoutPhase {
    return this.phase;
  }

  getScore(): number {
    return this.score;
  }

  getLives(): number {
    return this.lives;
  }

  getLevel(): number {
    return this.level;
  }

  getBall(): Ball {
    return { ...this.ball };
  }

  getPaddle(): Paddle {
    return { ...this.paddle };
  }

  getAliveBricks(): Brick[] {
    return this.bricks.filter((b) => b.hp > 0).map((b) => ({ ...b }));
  }

  /**
   * **仅测试用**：直接摆球的位置与速度。
   *
   * 生产的物理永远走 `launch()` + `step()`；但"撞墙反弹""擦到砖块侧面该翻转哪个轴"
   * 这类判定要构造精确的初始条件，靠真实物理碰运气既慢又不稳。
   * 库里同类模型也有这个惯例（`ICETetrisModel.setCellForTest` / `ICESnakeModel.setBodyForTest`）。
   */
  setBallForTest(x: number, y: number, vx: number, vy: number): void {
    this.ball.x = x;
    this.ball.y = y;
    this.ball.vx = vx;
    this.ball.vy = vy;
    this.ballStuckToPaddle = false;
    if (this.phase === 'ready') this.phase = 'playing';
  }

  isPaused(): boolean {
    return this.phase === 'paused';
  }

  isOver(): boolean {
    return this.phase === 'over';
  }

  hasWon(): boolean {
    return this.phase === 'win';
  }

  /* -------------------------------- 生命周期 -------------------------------- */

  /** 重开：分数、命数、关卡、砖块全部回到初始。 */
  reset(): void {
    this.score = 0;
    this.lives = this.options.lives;
    this.level = 1;
    this.ballSpeed = this.options.ballSpeed;
    this.paddle.width = this.options.paddleWidth;
    this.paddle.x = this.width / 2 - this.paddle.width / 2;
    this.buildBricks();
    this.phase = 'ready';
    this.settleBallOnPaddle();
  }

  /** 下一关：砖块重建、球加速、挡板变窄（命数与分数保留）。 */
  nextLevel(): void {
    this.level += 1;
    this.ballSpeed = Math.min(900, this.ballSpeed * LEVEL_SPEEDUP);
    this.paddle.width = Math.max(MIN_PADDLE_WIDTH, this.paddle.width * LEVEL_PADDLE_SHRINK);
    this.paddle.x = clamp(this.paddle.x, 0, this.width - this.paddle.width);
    this.buildBricks();
    this.phase = 'ready';
    this.settleBallOnPaddle();
  }

  /** 发球（ready 状态下才有意义）。 */
  launch(): boolean {
    if (this.phase !== 'ready') return false;
    const angle = this.options.launchAngle;
    this.ball.vx = Math.cos(angle) * this.ballSpeed;
    this.ball.vy = Math.sin(angle) * this.ballSpeed;
    this.ballStuckToPaddle = false;
    this.phase = 'playing';
    return true;
  }

  pause(): void {
    if (this.phase === 'playing') this.phase = 'paused';
  }

  resume(): void {
    if (this.phase === 'paused') this.phase = 'playing';
  }

  togglePause(): BreakoutPhase {
    if (this.phase === 'playing') this.phase = 'paused';
    else if (this.phase === 'paused') this.phase = 'playing';
    return this.phase;
  }

  /* --------------------------------- 输入 --------------------------------- */

  /** 把挡板中心移到 `x`（会自动夹在游戏区内）。 */
  movePaddleTo(centerX: number): void {
    this.paddle.x = clamp(centerX - this.paddle.width / 2, 0, this.width - this.paddle.width);
    if (this.ballStuckToPaddle) this.settleBallOnPaddle();
  }

  /** 相对移动（按住左右键时每帧调用）。`dx` 单位像素。 */
  movePaddleBy(dx: number): void {
    this.movePaddleTo(this.paddle.x + this.paddle.width / 2 + dx);
  }

  /** 挡板速度上限（像素/秒）→ 每帧的 dx。 */
  paddleStep(dtMs: number): number {
    return (this.options.paddleSpeed * dtMs) / 1000;
  }

  /* --------------------------------- 推进 --------------------------------- */

  /**
   * 推进 `dtMs` 毫秒。返回本帧发生的事件（可能为空）。
   *
   * 只有 `playing` 状态会动；`ready` 时球贴挡板（由输入带着走）。
   */
  step(dtMs: number): BreakoutEvent[] {
    const events: BreakoutEvent[] = [];
    if (this.phase !== 'playing') return events;
    if (!(dtMs > 0)) return events;

    // 固定子步：球一帧不能跨过一块砖（穿透问题）
    let remaining = Math.min(dtMs, 100); // 上限再保一层，切标签页回来不会瞬移
    while (remaining > 0) {
      const stepMs = Math.min(SUBSTEP_MS, remaining);
      remaining -= stepMs;
      this.substep(stepMs / 1000, events);
      if (this.phase !== 'playing') break; // 丢命/过关会中断本帧剩余子步
    }
    return events;
  }

  private substep(seconds: number, events: BreakoutEvent[]): void {
    const ball = this.ball;
    const radius = ball.radius;

    // ① 位移
    ball.x += ball.vx * seconds;
    ball.y += ball.vy * seconds;

    // ② 左右墙
    if (ball.x - radius <= 0 && ball.vx < 0) {
      ball.x = radius;
      ball.vx = -ball.vx;
      events.push('wall');
    } else if (ball.x + radius >= this.width && ball.vx > 0) {
      ball.x = this.width - radius;
      ball.vx = -ball.vx;
      events.push('wall');
    }

    // ③ 顶墙
    if (ball.y - radius <= 0 && ball.vy < 0) {
      ball.y = radius;
      ball.vy = -ball.vy;
      events.push('wall');
    }

    // ④ 挡板
    const p = this.paddle;
    if (
      ball.vy > 0 &&
      ball.y + radius >= p.y &&
      ball.y - radius <= p.y + p.height &&
      ball.x >= p.x - radius &&
      ball.x <= p.x + p.width + radius
    ) {
      ball.y = p.y - radius;
      // 击中位置决定水平分量：越靠边角度越斜（经典手感，也让玩家能"控制"球）
      const relative = (ball.x - (p.x + p.width / 2)) / (p.width / 2);
      const speed = Math.hypot(ball.vx, ball.vy) || this.ballSpeed;
      const angle = clamp(relative, -1, 1) * (Math.PI / 3); // ±60°
      ball.vx = Math.sin(angle) * speed;
      ball.vy = -Math.abs(Math.cos(angle) * speed);
      events.push('paddle');
    }

    // ⑤ 砖块（只处理一次碰撞：一子步内同时命中两块砖的概率极低，且连消两块会显得"穿透"）
    const hit = this.bricks.find(
      (brick) =>
        brick.hp > 0 &&
        ball.x + radius > brick.x &&
        ball.x - radius < brick.x + brick.width &&
        ball.y + radius > brick.y &&
        ball.y - radius < brick.y + brick.height,
    );
    if (hit) {
      const overlapX = radius + hit.width / 2 - Math.abs(ball.x - (hit.x + hit.width / 2));
      const overlapY = radius + hit.height / 2 - Math.abs(ball.y - (hit.y + hit.height / 2));
      // 穿透浅的那个轴才是真正的碰撞面（斜着撞到砖块侧面时不能翻转 vy）
      if (overlapX < overlapY) {
        ball.vx = -ball.vx;
        ball.x += ball.vx > 0 ? overlapX : -overlapX;
      } else {
        ball.vy = -ball.vy;
        ball.y += ball.vy > 0 ? overlapY : -overlapY;
      }
      hit.hp -= 1;
      this.score += scoreForRow(hit.row, this.rows);
      events.push('brick');
      if (hit.hp <= 0) events.push('break');

      if (this.bricks.every((b) => b.hp <= 0)) {
        this.phase = 'win';
        events.push('win');
        return;
      }
    }

    // ⑥ 掉出底部：扣命
    if (ball.y - radius > this.height) {
      this.lives -= 1;
      events.push('life');
      if (this.lives <= 0) {
        this.lives = 0;
        this.phase = 'over';
        events.push('over');
        return;
      }
      this.phase = 'ready';
      this.settleBallOnPaddle();
    }
  }

  /* -------------------------------- 内部工具 -------------------------------- */

  private buildBricks(): void {
    const { rows, cols, brickTop, brickHeight, brickGap } = this.options;
    const gap = brickGap;
    const brickWidth = (this.width - gap * (cols + 1)) / cols;
    const bricks: Brick[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        // 越靠上的行耐久越高（打两下才碎），给一点层次
        const hp = row < 1 ? 2 : 1;
        bricks.push({
          row,
          col,
          x: gap + col * (brickWidth + gap),
          y: brickTop + row * (brickHeight + gap),
          width: brickWidth,
          height: brickHeight,
          hp,
          maxHp: hp,
        });
      }
    }
    this.bricks = bricks;
  }

  /** 把球摆回挡板上方中央（ready 状态）。 */
  private settleBallOnPaddle(): void {
    this.ball.x = this.paddle.x + this.paddle.width / 2;
    this.ball.y = this.paddle.y - this.ball.radius - 1;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ballStuckToPaddle = true;
  }
}
