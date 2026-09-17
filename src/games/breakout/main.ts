/**
 * 打砖块 · 页面类 —— 把 `model.ts`（纯规则）接到画布上。
 *
 * 这一层只做四件事，逻辑一律不在这里：
 *  1. `kit/page` 起画布与引擎，`kit/shell` 搭外壳；
 *  2. 把 `model` 的快照画出来；
 *  3. 把键盘与指针翻译成 model 调用；
 *  4. 按 model 返回的事件播声音。
 *
 * 它是 `src/kit` 的第一个真实用户 —— 底座里每个能力（循环 / 键盘 / 外壳 / 存档 / 音效）
 * 在这里都必须真的用上；用不上的能力说明设计错了，该从 kit 里拿掉而不是留着。
 *
 * **一页 = 一个类**（家族约定，见 AGENTS「应用层写法」）：构造期把存档 / 音效 / 模型 / 节点池 /
 * 外壳 / 输入 / 循环一次建好；`render()` 是唯一的"重画一遍"入口，外壳状态走 `syncShell()`。
 */
import { ICECircle, ICERect } from 'ice-render';
import { ICEPanel } from 'ice-web-components';
import { GamePage, createAudio, createHighScores, createInput, createStore, GameShell, startLoop } from '../../kit';
import { BreakoutModel, type Brick, type BreakoutEvent } from './model';

class BreakoutPage extends GamePage {
  /**
   * 游戏区（stage 局部坐标系的原点在这里）。
   *
   * 纵向位置**不是随便定的**：外壳（`kit/shell`）从 `stage` 向上倒推标题带与数值卡、
   * 向下排按钮行与操作说明，任一条带越界或互相重叠都会在构造期抛错并报出所需数值。
   * breakout 的预算是：
   *   上方 16(边距) + 55(标题带) + 16 + 68(数值卡) + 20 = **175** → 取 178 留 3px 余量；
   *   下方 22 + 40(按钮行) + 12 + 96(4 行说明) = 170 → 178 + 440 + 170 = 788 ≤ 800 ✓
   *
   * ⚠️ 这三行数字改之前先跑一遍 `npm run dev` —— 自检会把"至少需要多少"直接打出来。
   * 早先这里是 170（比需求的 175 少 5px），结果是数值卡压住游戏区 18px，
   * 只有翻截图才看得出来。
   */
  static STAGE = { left: 230, top: 178, width: 720, height: 440 };

  private store: ReturnType<typeof createStore>;
  private audio: ReturnType<typeof createAudio>;
  private scores: ReturnType<typeof createHighScores>;
  private model: BreakoutModel;
  private shell: GameShell;
  private input: ReturnType<typeof createInput>;
  private loop: ReturnType<typeof startLoop>;
  /** 砖块节点池：与 model 的砖块一一对应，按 index 复用（不每帧重建节点）。 */
  private brickNodes: any[];
  private ballNode: ICECircle;
  private paddleNode: ICERect;
  /** 上一帧的相位（相位跳变时才刷外壳、记分） */
  private lastPhase: string;

  constructor() {
    super();
    const STAGE = BreakoutPage.STAGE;
    const theme = this.theme;

    /* -------------------------------- 存档与音效 -------------------------------- */
    this.store = createStore('breakout');
    this.audio = createAudio({ enabled: this.store.get('sound', true) });
    this.scores = createHighScores('breakout', { maxEntries: 5 });

    /* --------------------------------- 模型 --------------------------------- */
    this.model = new BreakoutModel({ width: STAGE.width, height: STAGE.height });

    /**
     * stage 内的所有画面节点都挂在这个容器上：容器自己在 `(STAGE.left, STAGE.top)`，
     * 于是子节点直接用 model 的**局部坐标**，不必逐个加偏移
     * （逐个加偏移的话，改版面要动每一处 —— 漏一个就错位）。
     */
    const stageRoot = new ICEPanel({
      id: 'breakout-stage',
      left: STAGE.left,
      top: STAGE.top,
      width: STAGE.width,
      height: STAGE.height,
      radius: 10,
      interactive: false,
      style: { fillStyle: '#0b1018', strokeStyle: theme.colors.borderSecondary },
    });
    this.ice.addChild(stageRoot);

    this.brickNodes = this.model.getSnapshot().bricks.map((brick) => {
      const node = new ICERect({
        interactive: false,
        left: brick.x,
        top: brick.y,
        width: brick.width,
        height: brick.height,
        style: { fillStyle: '', strokeStyle: '' },
      });
      stageRoot.addChild(node, false);
      return node;
    });

    this.ballNode = new ICECircle({
      id: 'breakout-ball',
      left: 0,
      top: 0,
      width: this.model.getBall().radius * 2,
      height: this.model.getBall().radius * 2,
      style: { fillStyle: '#ffffff', strokeStyle: 'rgba(0,0,0,0)' },
    });
    stageRoot.addChild(this.ballNode, false);

    this.paddleNode = new ICERect({
      id: 'breakout-paddle',
      left: 0,
      top: 0,
      width: this.model.getPaddle().width,
      height: this.model.getPaddle().height,
      style: { fillStyle: '#0dcaf0', strokeStyle: 'rgba(0,0,0,0)' },
    });
    stageRoot.addChild(this.paddleNode, false);

    /* --------------------------------- 外壳 --------------------------------- */
    this.shell = new GameShell({
      page: this,
      title: '打砖块',
      subtitle: '挡板接球 · 清空所有砖块 · 越靠上的砖越值钱',
      stage: STAGE,
      stats: [
        { id: 'score', label: '分数' },
        { id: 'best', label: '最高分', accent: '#ffc107' },
        { id: 'level', label: '关卡' },
        { id: 'lives', label: '命数', accent: '#dc3545' },
      ],
      // 回调必须包一层箭头函数：直接传 this.togglePause 会丢 this
      actions: [{ id: 'pause', text: '暂停 (P)', variant: 'default', onClick: () => this.togglePause() }],
      help: [
        ['← →', '移动挡板（也支持鼠标）'],
        ['空格', '发球'],
        ['P / 按钮', '暂停与继续'],
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
        left: ['ArrowLeft', 'a', 'A'],
        right: ['ArrowRight', 'd', 'D'],
        launch: [' ', 'Spacebar', 'ArrowUp', 'Enter'],
        pause: ['p', 'P'],
        restart: ['r', 'R'],
      },
    });
    this.input.on('launch', () => this.advanceOrLaunch());
    this.input.on('pause', () => this.togglePause());
    this.input.on('restart', () => this.restart());

    /** 鼠标也能玩：挡板中心跟随指针（比键盘更符合这个游戏的直觉）。 */
    this.canvas.addEventListener('mousemove', (event: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const localX = (event.clientX - rect.left) * scaleX - STAGE.left;
      this.model.movePaddleTo(localX);
      if (this.model.getPhase() === 'ready') this.render();
    });
    this.canvas.addEventListener('click', () => {
      if (this.model.getPhase() === 'ready' || this.model.getPhase() === 'win') this.advanceOrLaunch();
    });

    /* --------------------------------- 循环 --------------------------------- */
    this.lastPhase = this.model.getPhase();
    this.loop = startLoop(this, (dt) => {
      // 挡板：按住键时按"速度上限 × dt"移动（不用按键的 repeat，手感才跟手）
      const step = this.model.paddleStep(dt);
      if (this.input.isDown('left') && !this.input.isDown('right')) this.model.movePaddleBy(-step);
      else if (this.input.isDown('right') && !this.input.isDown('left')) this.model.movePaddleBy(step);

      const events = this.model.step(dt);
      if (events.length) this.playEvents(events);

      const phase = this.model.getPhase();
      if (phase !== this.lastPhase) {
        this.lastPhase = phase;
        this.syncShell();
        if (phase === 'over' || phase === 'win') this.recordScore();
      }
      this.render();
    });

    /* --------------------------------- 首屏 --------------------------------- */
    this.syncShell();
    this.render();
    this.ice.dirty = true;

    /**
     * 调试 / e2e 句柄。刻意暴露**模型本身**：断言状态机与物理不需要靠像素猜，
     * 而像素断言另有其一席之地（见 `e2e/breakout.spec.ts` 的三层判据）。
     *
     * 同时挂到 **`window.__game`** —— 那是本仓小游戏的**统一句柄约定**（脚手架生成的游戏也是它），
     * 于是 `e2e/catalog.spec.ts` 能对所有小游戏做同一批通用断言（外壳不越界、覆盖层状态…），
     * 新游戏不用额外登记就自动被覆盖。`__breakout` 是本游戏的别名，便于用例里写清楚是谁。
     */
    const debugHandle = {
      page: this,
      model: this.model,
      shell: this.shell,
      loop: this.loop,
      input: this.input,
      audio: this.audio,
      scores: this.scores,
      stage: STAGE,
      brickNodes: this.brickNodes,
      // 方法要包一层：e2e 直接把它们当函数调，不能丢 this
      worldRect: (node: any) => this.worldRect(node),
      togglePause: () => this.togglePause(),
      restart: () => this.restart(),
      render: () => this.render(),
      /**
       * 手动把 model 状态同步到外壳（收起/显示覆盖层 + 刷新状态文字）。
       * 对外暴露是因为**改动 model 后不一定有相位跳变**：循环只在相位变化时自动同步，
       * 而封面抓取 / e2e 会直接改 model（如 `launch()`），此时覆盖层还停在"待发球"。
       */
      syncShell: () => this.syncShell(),
    };
    (window as any).__game = debugHandle;
    (window as any).__breakout = debugHandle;
  }

  /** 最高分（空榜为 0）。`ICEHighScoreModel.getBest()` 已经处理了"空 / 坏存档"。 */
  private bestScore(): number {
    return this.scores.getBest();
  }

  /** 砖块耐久 → 颜色：满耐久用高亮色，打残后变暗（一眼看出"这块还剩几下"）。 */
  private brickStyle(brick: Brick): { fillStyle: string; strokeStyle: string } {
    const heat = brick.maxHp > 1 ? brick.hp / brick.maxHp : 1;
    if (heat > 0.75) return { fillStyle: '#f97316', strokeStyle: '#a4510d' };
    if (heat > 0.4) return { fillStyle: '#0dcaf0', strokeStyle: '#097e96' };
    return { fillStyle: '#198754', strokeStyle: '#0f5634' };
  }

  /** 唯一"重画一遍"入口：把 model 快照写到节点池与外壳数值卡上。 */
  render(): void {
    const snapshot = this.model.getSnapshot();

    snapshot.bricks.forEach((brick, index) => {
      const node = this.brickNodes[index];
      if (!node) return;
      if (brick.hp <= 0) {
        if (node.state.display !== false) node.setState({ display: false });
        return;
      }
      const style = this.brickStyle(brick);
      node.setState({
        display: true,
        left: brick.x,
        top: brick.y,
        width: brick.width,
        height: brick.height,
        style: { fillStyle: style.fillStyle, strokeStyle: style.strokeStyle },
      });
    });

    const ball = snapshot.ball;
    this.ballNode.setState({ left: ball.x - ball.radius, top: ball.y - ball.radius });

    const paddle = snapshot.paddle;
    this.paddleNode.setState({
      left: paddle.x,
      top: paddle.y,
      width: paddle.width,
      height: paddle.height,
    });

    this.shell.setStat('score', snapshot.score);
    this.shell.setStat('best', Math.max(this.bestScore(), snapshot.score));
    this.shell.setStat('level', snapshot.level);
    this.shell.setStat('lives', snapshot.lives);
  }

  /** 把 model 的相位映射到外壳的状态文字与覆盖层（这是"游戏状态"与"界面"的唯一接口）。 */
  syncShell(): void {
    const snapshot = this.model.getSnapshot();
    switch (snapshot.phase) {
      case 'ready':
        this.shell.setStatus('待发球');
        this.shell.showOverlay({
          kind: 'ready',
          title: snapshot.level > 1 ? `第 ${snapshot.level} 关` : '准备好了吗',
          subtitle: `按 空格 发球 · 剩 ${snapshot.lives} 条命`,
          hint: '← → 移动挡板',
        });
        break;
      case 'playing':
        this.shell.setStatus('进行中');
        this.shell.hideOverlay();
        break;
      case 'paused':
        this.shell.setStatus('已暂停');
        this.shell.showOverlay({ kind: 'paused', title: '已暂停', subtitle: '按 P 或点「暂停」继续', hint: '' });
        break;
      case 'win':
        this.shell.setStatus('过关');
        this.shell.showOverlay({
          kind: 'win',
          title: `第 ${snapshot.level} 关通过！`,
          subtitle: `当前得分 ${snapshot.score}`,
          hint: '按 空格 进入下一关',
        });
        break;
      case 'over':
        this.shell.setStatus('已结束');
        this.shell.showOverlay({
          kind: 'over',
          title: '游戏结束',
          subtitle: `得分 ${snapshot.score} · 最高分 ${Math.max(this.bestScore(), snapshot.score)}`,
          hint: '按 R 重新开始',
        });
        break;
    }
    this.ice.dirty = true;
  }

  togglePause(): void {
    if (this.model.getPhase() === 'win') return; // 过关界面不该被 P 键顶掉
    this.model.togglePause();
    this.loop.setPaused(this.model.isPaused());
    this.syncShell();
  }

  restart(): void {
    this.model.reset();
    this.loop.setPaused(false);
    this.audio.cue('blip');
    this.syncShell();
    this.render();
  }

  /** 过关后按空格进下一关。 */
  advanceOrLaunch(): void {
    const phase = this.model.getPhase();
    if (phase === 'win') {
      this.model.nextLevel();
      this.loop.setPaused(false);
      this.audio.cue('levelup');
      this.syncShell();
      this.render();
      return;
    }
    if (phase === 'ready') {
      if (this.model.launch()) {
        this.audio.cue('launch');
        this.syncShell();
      }
    }
  }

  /** 事件 → 音效：规则层只报"发生了什么"，声音是表现层的事。 */
  private playEvents(events: BreakoutEvent[]): void {
    for (const event of events) {
      switch (event) {
        case 'paddle':
          this.audio.cue('hit');
          break;
        case 'wall':
          this.audio.cue('blip');
          break;
        case 'brick':
          this.audio.cue('score');
          break;
        case 'life':
          this.audio.cue('life');
          break;
        case 'win':
          this.audio.cue('win');
          break;
        case 'over':
          this.audio.cue('over');
          break;
        default:
          break;
      }
    }
  }

  /**
   * 一局结束时把分数写进最高分榜。`ICEHighScoreModel` 自己负责排序、截断与存档容错
   * （坏 JSON / 配额满 / 隐私模式都不会抛），这里只管"什么时候记"。
   *
   * 时机是**相位跳变**（见构造期里的循环）：一局结束时记一次就够了；
   * 用"分数是否变化"当判据是错的 —— 两局都拿 40 分时第二次就不会记。
   */
  private recordScore(): void {
    const score = this.model.getScore();
    if (score <= 0) return;
    this.scores.add(score);
  }
}

new BreakoutPage();
