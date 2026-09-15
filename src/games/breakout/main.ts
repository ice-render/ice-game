/**
 * 打砖块 · 装配层 —— 把 `model.ts`（纯规则）接到画布上。
 *
 * 这一层只做四件事，逻辑一律不在这里：
 *  1. 用 `kit/page` 起画布与引擎，用 `kit/shell` 搭外壳；
 *  2. 把 `model` 的快照画出来（砖块 / 球 / 挡板）；
 *  3. 把键盘与指针翻译成 model 调用；
 *  4. 按 model 返回的事件播声音。
 *
 * 它是 `src/kit` 的第一个真实用户 —— 底座里每个能力（循环 / 键盘 / 外壳 / 存档 / 音效）
 * 在这里都必须真的用上；用不上的能力说明设计错了，该从 kit 里拿掉而不是留着。
 */
import { ICECircle, ICERect } from 'ice-render';
import { ICEPanel } from 'ice-web-components';
import { createAudio, createHighScores, createInput, createPage, createStore, GameShell, startLoop } from '../../kit';
import { BreakoutModel, type Brick, type BreakoutEvent } from './model';

/* --------------------------------- 版面 --------------------------------- */

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
const STAGE = { left: 230, top: 178, width: 720, height: 440 };

const page = createPage();
const theme = page.theme;

/* -------------------------------- 存档与音效 -------------------------------- */

const store = createStore('breakout');
const audio = createAudio({ enabled: store.get('sound', true) });
const scores = createHighScores('breakout', { maxEntries: 5 });
/** 最高分（空榜为 0）。`ICEHighScoreModel.getBest()` 已经处理了"空 / 坏存档"。 */
const bestScore = (): number => scores.getBest();

/* --------------------------------- 模型 --------------------------------- */

const model = new BreakoutModel({ width: STAGE.width, height: STAGE.height });

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
page.ice.addChild(stageRoot);

/* --------------------------------- 节点池 --------------------------------- */

/** 砖块节点：与 model 的砖块一一对应，按 index 复用（不每帧重建节点）。 */
const brickNodes: any[] = model.getSnapshot().bricks.map((brick) => {
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

const ballNode = new ICECircle({
  id: 'breakout-ball',
  left: 0,
  top: 0,
  width: model.getBall().radius * 2,
  height: model.getBall().radius * 2,
  style: { fillStyle: '#ffffff', strokeStyle: 'rgba(0,0,0,0)' },
});
stageRoot.addChild(ballNode, false);

const paddleNode = new ICERect({
  id: 'breakout-paddle',
  left: 0,
  top: 0,
  width: model.getPaddle().width,
  height: model.getPaddle().height,
  style: { fillStyle: '#0dcaf0', strokeStyle: 'rgba(0,0,0,0)' },
});
stageRoot.addChild(paddleNode, false);

/* --------------------------------- 外壳 --------------------------------- */

const shell = new GameShell({
  page,
  title: '打砖块',
  subtitle: '挡板接球 · 清空所有砖块 · 越靠上的砖越值钱',
  stage: STAGE,
  stats: [
    { id: 'score', label: '分数' },
    { id: 'best', label: '最高分', accent: '#ffc107' },
    { id: 'level', label: '关卡' },
    { id: 'lives', label: '命数', accent: '#dc3545' },
  ],
  actions: [{ id: 'pause', text: '暂停 (P)', variant: 'default', onClick: togglePause }],
  help: [
    ['← →', '移动挡板（也支持鼠标）'],
    ['空格', '发球'],
    ['P / 按钮', '暂停与继续'],
    ['R', '重新开始'],
  ],
  sound: { on: audio.enabled, onToggle: (on) => { audio.setEnabled(on); store.set('sound', on); } },
});

/* --------------------------------- 渲染 --------------------------------- */

/** 砖块耐久 → 颜色：满耐久用高亮色，打残后变暗（一眼看出"这块还剩几下"）。 */
function brickStyle(brick: Brick): { fillStyle: string; strokeStyle: string } {
  const heat = brick.maxHp > 1 ? brick.hp / brick.maxHp : 1;
  if (heat > 0.75) return { fillStyle: '#f97316', strokeStyle: '#a4510d' };
  if (heat > 0.4) return { fillStyle: '#0dcaf0', strokeStyle: '#097e96' };
  return { fillStyle: '#198754', strokeStyle: '#0f5634' };
}

function render(): void {
  const snapshot = model.getSnapshot();

  snapshot.bricks.forEach((brick, index) => {
    const node = brickNodes[index];
    if (!node) return;
    if (brick.hp <= 0) {
      if (node.state.display !== false) node.setState({ display: false });
      return;
    }
    const style = brickStyle(brick);
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
  ballNode.setState({ left: ball.x - ball.radius, top: ball.y - ball.radius });

  const paddle = snapshot.paddle;
  paddleNode.setState({
    left: paddle.x,
    top: paddle.y,
    width: paddle.width,
    height: paddle.height,
  });

  shell.setStat('score', snapshot.score);
  shell.setStat('best', Math.max(bestScore(), snapshot.score));
  shell.setStat('level', snapshot.level);
  shell.setStat('lives', snapshot.lives);
}

/* ------------------------------ 状态与覆盖层 ------------------------------ */

/** 把 model 的相位映射到外壳的状态文字与覆盖层（这是"游戏状态"与"界面"的唯一接口）。 */
function syncShell(): void {
  const snapshot = model.getSnapshot();
  switch (snapshot.phase) {
    case 'ready':
      shell.setStatus('待发球');
      shell.showOverlay({
        kind: 'ready',
        title: snapshot.level > 1 ? `第 ${snapshot.level} 关` : '准备好了吗',
        subtitle: `按 空格 发球 · 剩 ${snapshot.lives} 条命`,
        hint: '← → 移动挡板',
      });
      break;
    case 'playing':
      shell.setStatus('进行中');
      shell.hideOverlay();
      break;
    case 'paused':
      shell.setStatus('已暂停');
      shell.showOverlay({ kind: 'paused', title: '已暂停', subtitle: '按 P 或点「暂停」继续', hint: '' });
      break;
    case 'win':
      shell.setStatus('过关');
      shell.showOverlay({
        kind: 'win',
        title: `第 ${snapshot.level} 关通过！`,
        subtitle: `当前得分 ${snapshot.score}`,
        hint: '按 空格 进入下一关',
      });
      break;
    case 'over':
      shell.setStatus('已结束');
      shell.showOverlay({
        kind: 'over',
        title: '游戏结束',
        subtitle: `得分 ${snapshot.score} · 最高分 ${Math.max(bestScore(), snapshot.score)}`,
        hint: '按 R 重新开始',
      });
      break;
  }
  page.ice.dirty = true;
}

function togglePause(): void {
  if (model.getPhase() === 'win') return; // 过关界面不该被 P 键顶掉
  model.togglePause();
  loop.setPaused(model.isPaused());
  syncShell();
}

function restart(): void {
  model.reset();
  loop.setPaused(false);
  audio.cue('blip');
  syncShell();
  render();
}

/** 过关后按空格进下一关。 */
function advanceOrLaunch(): void {
  const phase = model.getPhase();
  if (phase === 'win') {
    model.nextLevel();
    loop.setPaused(false);
    audio.cue('levelup');
    syncShell();
    render();
    return;
  }
  if (phase === 'ready') {
    if (model.launch()) {
      audio.cue('launch');
      syncShell();
    }
  }
}

/* --------------------------------- 输入 --------------------------------- */

const input = createInput(page, {
  bindings: {
    left: ['ArrowLeft', 'a', 'A'],
    right: ['ArrowRight', 'd', 'D'],
    launch: [' ', 'Spacebar', 'ArrowUp', 'Enter'],
    pause: ['p', 'P'],
    restart: ['r', 'R'],
  },
});

input.on('launch', () => advanceOrLaunch());
input.on('pause', () => togglePause());
input.on('restart', () => restart());

/** 鼠标也能玩：挡板中心跟随指针（比键盘更符合这个游戏的直觉）。 */
page.canvas.addEventListener('mousemove', (event: MouseEvent) => {
  const rect = page.canvas.getBoundingClientRect();
  const scaleX = page.width / rect.width;
  const localX = (event.clientX - rect.left) * scaleX - STAGE.left;
  model.movePaddleTo(localX);
  if (model.getPhase() === 'ready') render();
});
page.canvas.addEventListener('click', () => {
  if (model.getPhase() === 'ready' || model.getPhase() === 'win') advanceOrLaunch();
});

/* --------------------------------- 循环 --------------------------------- */

/** 事件 → 音效：规则层只报"发生了什么"，声音是表现层的事。 */
function playEvents(events: BreakoutEvent[]): void {
  for (const event of events) {
    switch (event) {
      case 'paddle':
        audio.cue('hit');
        break;
      case 'wall':
        audio.cue('blip');
        break;
      case 'brick':
        audio.cue('score');
        break;
      case 'life':
        audio.cue('life');
        break;
      case 'win':
        audio.cue('win');
        break;
      case 'over':
        audio.cue('over');
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
 * 时机是**相位跳变**（见下面的循环）：一局结束时记一次就够了；
 * 用"分数是否变化"当判据是错的 —— 两局都拿 40 分时第二次就不会记。
 */
function recordScore(): void {
  const score = model.getScore();
  if (score <= 0) return;
  scores.add(score);
}

let lastPhase = model.getPhase();

const loop = startLoop(page, (dt) => {
  // 挡板：按住键时按"速度上限 × dt"移动（不用按键的 repeat，手感才跟手）
  const step = model.paddleStep(dt);
  if (input.isDown('left') && !input.isDown('right')) model.movePaddleBy(-step);
  else if (input.isDown('right') && !input.isDown('left')) model.movePaddleBy(step);

  const events = model.step(dt);
  if (events.length) playEvents(events);

  const phase = model.getPhase();
  if (phase !== lastPhase) {
    lastPhase = phase;
    syncShell();
    if (phase === 'over' || phase === 'win') recordScore();
  }
  render();
});

/* --------------------------------- 首屏 --------------------------------- */

syncShell();
render();
page.ice.dirty = true;

/**
 * 调试 / e2e 句柄。刻意暴露**模型本身**：断言状态机与物理不需要靠像素猜，
 * 而像素断言另有其一席之地（见 `e2e/breakout.spec.ts` 的三层判据）。
 *
 * 同时挂到 **`window.__game`** —— 那是本仓小游戏的**统一句柄约定**（脚手架生成的游戏也是它），
 * 于是 `e2e/catalog.spec.ts` 能对所有小游戏做同一批通用断言（外壳不越界、覆盖层状态…），
 * 新游戏不用额外登记就自动被覆盖。`__breakout` 是本游戏的别名，便于用例里写清楚是谁。
 */
const debugHandle = {
  page,
  model,
  shell,
  loop,
  input,
  audio,
  scores,
  stage: STAGE,
  brickNodes,
  worldRect: page.worldRect,
  togglePause,
  restart,
  render,
  /**
   * 手动把 model 状态同步到外壳（收起/显示覆盖层 + 刷新状态文字）。
   * 对外暴露是因为**改动 model 后不一定有相位跳变**：循环只在相位变化时自动同步，
   * 而封面抓取 / e2e 会直接改 model（如 `launch()`），此时覆盖层还停在"待发球"。
   */
  syncShell,
};
(window as any).__game = debugHandle;
(window as any).__breakout = debugHandle;
