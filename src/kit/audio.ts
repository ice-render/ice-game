/**
 * 音效：WebAudio **现场合成**，不带任何音频文件。
 *
 * 为什么不用音频文件：小游戏是"单页、无服务端"的，一个 `.mp3` 就是一次额外的网络请求
 * 与一份要跟着页面走的资源；而这些老游戏机的声音本来就是方波/三角波，
 * 用 `OscillatorNode` 合成几毫秒就够，画面里连一个位图都没有，声音也不该有资源。
 *
 * ```ts
 * const audio = createAudio({ enabled: store.get('sound', true) });
 * audio.cue('hit');                 // 用内置音
 * audio.addCue('combo', (n) => {    // 自定义：复用 beep 的封装能力
 *   audio.beep(660 + n * 80, 60);
 * });
 * audio.setEnabled(false);          // 静音（游戏外壳的音效按钮接这里）
 * ```
 *
 * 三个细节：
 *
 * - **AudioContext 必须在用户操作后创建/恢复**：浏览器自动播放策略会让它在页面加载时处于
 *   `suspended`。这里做成懒创建 + 每次发声前尝试 `resume()`，所以"第一次按键才有声音"是正常的。
 * - **没有音频设备时静默降级**：headless / CI 里 `AudioContext` 可能不存在或抛错，
 *   绝不能因此让游戏挂掉（e2e 就跑在无头环境）。
 * - **同一个音太密会糊**：连续撞击每帧都响会变成噪音，调用方自行节流；这里只保证单次发声不抛错。
 */

/** 波形：与前两代整机（掌机 / XP）保持一致，都用这几种。 */
export type WaveType = 'square' | 'triangle' | 'sawtooth' | 'sine';

export interface BeepOptions {
  /** 频率（Hz）。 */
  freq: number;
  /** 时长（毫秒）。 */
  ms: number;
  type?: WaveType;
  /** 音量（0~1），默认 0.04（游戏音效宜轻不宜响）。 */
  gain?: number;
  /** 延迟多少毫秒后发声（用来拼和弦/音阶）。 */
  delay?: number;
}

export interface GameAudio {
  /** 播放内置音效；名字不存在时静默忽略。 */
  cue(name: string, arg?: number): void;
  /** 注册自定义音效（回调里可以用 `beep` 拼多个音）。 */
  addCue(name: string, fn: (arg?: number) => void): void;
  /** 直接发一个单音（默认音色）。 */
  beep(freq: number, ms: number, type?: WaveType, gain?: number, delay?: number): void;
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
  /** 切换开关并返回新状态。 */
  toggle(): boolean;
  /** 已发过多少次声（e2e 断言"音效真的触发了"用；无头环境也会计数）。 */
  readonly plays: number;
  /** 最后一次播放的音效名。 */
  readonly lastCue: string | null;
}

/**
 * 内置音效集：覆盖小游戏通用的几类反馈。
 * 命名按"语义"而非音色，换音色时调用方不用改。
 */
const BUILTIN_CUES: Record<string, (audio: GameAudio, arg?: number) => void> = {
  /** 极短点击：菜单/按钮。 */
  blip: (a) => a.beep(520, 30, 'square', 0.02),
  /** 挡板/物体碰撞。 */
  hit: (a) => a.beep(320, 34, 'square', 0.03),
  /** 撞到砖块/得分物。 */
  score: (a) => a.beep(720, 50, 'triangle', 0.04),
  /** 发射。 */
  launch: (a) => a.beep(240, 60, 'triangle', 0.035),
  /** 加分连击（`arg` = 连击数，音高递增）。 */
  combo: (a, n) => a.beep(560 + Math.min(6, n || 1) * 90, 60, 'square', 0.04),
  /** 升级 / 加分项。 */
  levelup: (a) => {
    a.beep(520, 90, 'square', 0.04);
    a.beep(780, 120, 'square', 0.04, 90);
  },
  /** 失去一条命。 */
  life: (a) => a.beep(200, 180, 'sawtooth', 0.04),
  /** 游戏结束。 */
  over: (a) => {
    a.beep(220, 200, 'sawtooth', 0.05);
    a.beep(150, 320, 'sawtooth', 0.05, 180);
  },
  /** 通关。 */
  win: (a) => {
    [523, 659, 784, 1047].forEach((freq, i) => a.beep(freq, 130, 'triangle', 0.045, i * 110));
  },
};

export type CueName = keyof typeof BUILTIN_CUES | (string & {});

export interface CreateAudioOptions {
  /** 初始是否开启（游戏通常从存档里读上次的选择）。 */
  enabled?: boolean;
}

export function createAudio(options: CreateAudioOptions = {}): GameAudio {
  let enabled = options.enabled !== false;
  let ctx: AudioContext | null = null;
  let plays = 0;
  let lastCue: string | null = null;

  /** 懒创建 + 尝试恢复：自动播放策略下首次发声可能要等一次用户交互。 */
  const audioCtx = (): AudioContext | null => {
    try {
      if (!ctx) {
        const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor() as AudioContext;
      }
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        void ctx.resume();
      }
      return ctx;
    } catch (err) {
      return null;
    }
  };

  const audio: GameAudio = {
    beep(freq, ms, type = 'square', gain = 0.04, delay = 0) {
      if (!enabled) return;
      try {
        const c = audioCtx();
        if (!c) return;
        const osc = c.createOscillator();
        const amp = c.createGain();
        const startAt = c.currentTime + delay / 1000;
        const endAt = startAt + ms / 1000;
        osc.type = type;
        osc.frequency.value = freq;
        // 用指数衰减包络（起音 12ms）：直接开关会"咔"一下
        amp.gain.setValueAtTime(0.0001, startAt);
        amp.gain.exponentialRampToValueAtTime(gain, startAt + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, endAt);
        osc.connect(amp);
        amp.connect(c.destination);
        osc.start(startAt);
        osc.stop(endAt + 0.02);
      } catch (err) {
        /* 没有音频设备（headless）时静默降级 —— 绝不能因此让游戏挂掉 */
      }
    },
    cue(name, arg) {
      if (!enabled) return;
      const fn = BUILTIN_CUES[name];
      if (!fn) return;
      lastCue = name;
      plays += 1;
      fn(audio, arg);
    },
    addCue(name, fn) {
      BUILTIN_CUES[name] = (a, arg) => fn(arg);
    },
    setEnabled(on) {
      enabled = !!on;
      // 关掉时顺便挂起音频上下文（省电；下次开启会 resume）
      if (!enabled && ctx && ctx.state === 'running' && typeof ctx.suspend === 'function') {
        void ctx.suspend();
      }
    },
    get enabled() {
      return enabled;
    },
    toggle() {
      audio.setEnabled(!enabled);
      return enabled;
    },
    get plays() {
      return plays;
    },
    get lastCue() {
      return lastCue;
    },
  };

  return audio;
}
