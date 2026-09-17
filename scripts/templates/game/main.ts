/**
 * __TITLE__ · 页面类 —— 把 `model.ts`（纯规则）接到画布上。
 *
 * 这一层只做四件事，玩法一律不在这里（都在 model 里）：
 *  1. `kit/page` 起画布与引擎，`kit/shell` 搭外壳；
 *  2. 把 model 的快照画出来；
 *  3. 把键盘与指针翻译成 model 调用；
 *  4. 按 model 返回的事件播声音、存分数。
 *
 * 这就是本仓小游戏的标准骨架（`src/kit` 的六件都用到了）。改玩法时通常只需要动
 * `model.ts` 与下面的 `onUpdate()`，其余部分可以原样保留。
 *
 * **一页 = 一个类**：`class XxxPage extends GamePage`，构造期把存档 / 音效 / 模型 / 外壳 / 输入 / 循环
 * 一次建好，`onUpdate()` 是这一页唯一的"重画一遍"入口（渲染、外壳状态、覆盖层都走它）。
 * 家族的应用层（smart-water 的 12 个页面、各仓示例页）都是这个形状 —— 游戏页不例外。
 */
import { ICEPanel } from 'ice-web-components';
import { GamePage, createAudio, createHighScores, createInput, createStore, GameShell, startLoop } from '../../kit';
import { __NAME__Model, type __NAME__Event } from './model';

class __NAME__Page extends GamePage {
  /** 游戏区（stage 局部坐标系的原点在这里）。 */
  static STAGE = { left: 230, top: 170, width: 720, height: 470 };

  private store: ReturnType<typeof createStore>;
  private audio: ReturnType<typeof createAudio>;
  private scores: ReturnType<typeof createHighScores>;
  private model: __NAME__Model;
  private shell: GameShell;
  private input: ReturnType<typeof createInput>;
  private loop: ReturnType<typeof startLoop>;
  /** 占位画面节点（真正的游戏画面挂在 stageRoot 上，这里保留是为了让骨架开箱可跑） */
  private progressNode: ICEPanel;
  /** 上一帧的相位（相位变化时才刷外壳，别每帧重建覆盖层） */
  private lastPhase: string;

  constructor() {
    super();
    const STAGE = __NAME__Page.STAGE;
    const theme = this.theme;

    /* ------------------------------ 存档与音效 ------------------------------ */
    this.store = createStore('__SLUG__');
    this.audio = createAudio({ enabled: this.store.get('sound', true) });
    this.scores = createHighScores('__SLUG__', { maxEntries: 5 });

    /* --------------------------------- 模型 --------------------------------- */
    this.model = new __NAME__Model({ width: STAGE.width, height: STAGE.height });

    /** stage 内的画面节点都挂在这个容器上：容器在 `(STAGE.left, STAGE.top)`，
     *  于是子节点直接用 model 的**局部坐标**，不必逐个加偏移（漏一个就错位）。 */
    const stageRoot = new ICEPanel({
      id: '__SLUG__-stage',
      left: STAGE.left,
      top: STAGE.top,
      width: STAGE.width,
      height: STAGE.height,
      radius: 10,
      interactive: false,
      style: { fillStyle: '#0b1018', strokeStyle: theme.colors.borderSecondary },
    });
    this.ice.addChild(stageRoot);

    /** 占位画面：一个随分数变化宽度的高亮块。换成你真正的游戏画面。 */
    this.progressNode = new ICEPanel({
      id: '__SLUG__-progress',
      left: 24,
      top: STAGE.height / 2 - 6,
      width: 0,
      height: 12,
      radius: 6,
      interactive: false,
      style: { fillStyle: '#0dcaf0', strokeStyle: '#0dcaf0' },
    });
    stageRoot.addChild(this.progressNode, false);

    /* --------------------------------- 外壳 --------------------------------- */
    this.shell = new GameShell({
      page: this,
      title: '__TITLE__',
      subtitle: '这是脚手架生成的骨架：改 meta.json / model.ts / main.ts 即可',
      stage: STAGE,
      stats: [
        { id: 'score', label: '分数' },
        { id: 'best', label: '最高分', accent: '#ffc107' },
        { id: 'time', label: '剩余', accent: '#0dcaf0' },
      ],
      // 注意：回调里必须用箭头函数包一层 —— 直接传 this.togglePause 会丢 this
      actions: [{ id: 'pause', text: '暂停 (P)', variant: 'default', onClick: () => this.togglePause() }],
      help: [
        ['空格', '计分 / 开始'],
        ['P', '暂停与继续'],
        ['R', '重新开始'],
      ],
      sound: {
        on: this.audio.enabled,
        onToggle: (on) => {
          this.audio.setEnabled(on);
          this.store.set('sound', on);
        },
      },
    });

    /* --------------------------------- 输入 --------------------------------- */
    this.input = createInput(this, {
      bindings: {
        tap: [' ', 'Spacebar', 'Enter'],
        pause: ['p', 'P'],
        restart: ['r', 'R'],
      },
    });
    this.input.on('tap', () => this.tapOrStart());
    this.input.on('pause', () => this.togglePause());
    this.input.on('restart', () => this.restart());

    /* --------------------------------- 循环 --------------------------------- */
    this.lastPhase = this.model.getPhase();
    this.loop = startLoop(this, (dt) => {
      this.applyEvents(this.model.step(dt));

      const phase = this.model.getPhase();
      if (phase !== this.lastPhase) {
        this.lastPhase = phase;
        this.syncShell();
      }
      this.onUpdate();
    });

    /* --------------------------------- 首屏 --------------------------------- */
    this.syncShell();
    this.onUpdate();
    this.ice.dirty = true;

    /** 调试 / e2e 句柄：暴露 model 便于断言状态机，不必靠像素猜。 */
    (window as any).__game = {
      page: this,
      model: this.model,
      shell: this.shell,
      loop: this.loop,
      input: this.input,
      audio: this.audio,
      scores: this.scores,
      stage: STAGE,
      // 方法要包一层：e2e 直接把它们当函数调，不能丢 this
      worldRect: (node: any) => this.worldRect(node),
      togglePause: () => this.togglePause(),
      restart: () => this.restart(),
      render: () => this.onUpdate(),
    };
  }

  /** 唯一刷新入口：画一遍当前快照 + 同步外壳状态。 */
  onUpdate(): void {
    const snapshot = this.model.getSnapshot();

    // 占位画面：进度块宽度跟着分数涨（分数越多越宽）
    const width = Math.min(__NAME__Page.STAGE.width - 48, snapshot.score * 24);
    this.progressNode.setState({ width });
    this.progressNode.setState({
      style: {
        fillStyle: snapshot.phase === 'over' ? '#dc3545' : '#0dcaf0',
        strokeStyle: snapshot.phase === 'over' ? '#dc3545' : '#0dcaf0',
      },
    });

    this.shell.setStat('score', snapshot.score);
    this.shell.setStat('best', Math.max(this.scores.getBest(), snapshot.score));
    this.shell.setStat('time', `${Math.ceil(snapshot.remainingMs / 1000)}s`);
  }

  /** 外壳状态 + 覆盖层（只在相位变化时调用）。 */
  syncShell(): void {
    const snapshot = this.model.getSnapshot();
    switch (snapshot.phase) {
      case 'ready':
        this.shell.setStatus('待开始');
        this.shell.showOverlay({ kind: 'ready', title: '准备好了吗', subtitle: '按 空格 开始', hint: '30 秒内尽可能多得分' });
        break;
      case 'playing':
        this.shell.setStatus('进行中');
        this.shell.hideOverlay();
        break;
      case 'paused':
        this.shell.setStatus('已暂停');
        this.shell.showOverlay({ kind: 'paused', title: '已暂停', subtitle: '按 P 继续' });
        break;
      case 'over':
        this.shell.setStatus('已结束');
        this.shell.showOverlay({
          kind: 'over',
          title: '时间到',
          subtitle: `得分 ${snapshot.score} · 最高分 ${Math.max(this.scores.getBest(), snapshot.score)}`,
          hint: '按 R 重新开始',
        });
        break;
    }
    this.ice.dirty = true;
  }

  togglePause(): void {
    this.applyEvents(this.model.togglePause());
    this.loop.setPaused(this.model.isPaused());
  }

  restart(): void {
    this.model.reset();
    this.loop.setPaused(false);
    this.audio.cue('blip');
    this.syncShell();
    this.onUpdate();
  }

  /** 空格：未开始时开始，进行中则计分。 */
  tapOrStart(): void {
    if (this.model.getPhase() === 'ready') {
      this.applyEvents(this.model.start());
      this.syncShell();
      return;
    }
    this.applyEvents(this.model.tap());
    this.onUpdate();
  }

  /** 事件 → 声音 + 副作用（表现层的事，规则层只负责"报事件"）。 */
  applyEvents(events: __NAME__Event[]): void {
    for (const event of events) {
      switch (event) {
        case 'tap':
          this.audio.cue('score');
          break;
        case 'start':
        case 'resume':
          this.audio.cue('launch');
          break;
        case 'pause':
          this.audio.cue('blip');
          break;
        case 'over':
          this.audio.cue('over');
          // 一局结束把分数写进最高分榜（模型自己负责排序、截断与存档容错）
          if (this.model.getScore() > 0) this.scores.add(this.model.getScore());
          break;
        default:
          break;
      }
    }
  }
}

new __NAME__Page();
