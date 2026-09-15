/**
 * __TITLE__ · 装配层 —— 把 `model.ts`（纯规则）接到画布上。
 *
 * 这一层只做四件事，玩法一律不在这里（都在 model 里）：
 *  1. `kit/page` 起画布与引擎，`kit/shell` 搭外壳；
 *  2. 把 model 的快照画出来；
 *  3. 把键盘与指针翻译成 model 调用；
 *  4. 按 model 返回的事件播声音、存分数。
 *
 * 这就是本仓小游戏的标准骨架（`src/kit` 的六件都用到了）。改玩法时通常只需要动
 * `model.ts` 与下面的 `render()`，其余部分可以原样保留。
 */
import { ICEPanel } from 'ice-web-components';
import { createAudio, createHighScores, createInput, createPage, createStore, GameShell, startLoop } from '../../kit';
import { __NAME__Model, type __NAME__Event } from './model';

/* --------------------------------- 版面 --------------------------------- */

/** 游戏区（stage 局部坐标系的原点在这里）。 */
const STAGE = { left: 230, top: 170, width: 720, height: 470 };

const page = createPage();
const theme = page.theme;

/* ------------------------------ 存档与音效 ------------------------------ */

const store = createStore('__SLUG__');
const audio = createAudio({ enabled: store.get('sound', true) });
const scores = createHighScores('__SLUG__', { maxEntries: 5 });

/* --------------------------------- 模型 --------------------------------- */

const model = new __NAME__Model({ width: STAGE.width, height: STAGE.height });

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
page.ice.addChild(stageRoot);

/** 占位画面：一个随分数变化宽度的高亮块。换成你真正的游戏画面。 */
const progressNode = new ICEPanel({
  id: '__SLUG__-progress',
  left: 24,
  top: STAGE.height / 2 - 6,
  width: 0,
  height: 12,
  radius: 6,
  interactive: false,
  style: { fillStyle: '#0dcaf0', strokeStyle: '#0dcaf0' },
});
stageRoot.addChild(progressNode, false);

/* --------------------------------- 外壳 --------------------------------- */

const shell = new GameShell({
  page,
  title: '__TITLE__',
  subtitle: '这是脚手架生成的骨架：改 meta.json / model.ts / main.ts 即可',
  stage: STAGE,
  stats: [
    { id: 'score', label: '分数' },
    { id: 'best', label: '最高分', accent: '#ffc107' },
    { id: 'time', label: '剩余', accent: '#0dcaf0' },
  ],
  actions: [{ id: 'pause', text: '暂停 (P)', variant: 'default', onClick: togglePause }],
  help: [
    ['空格', '计分 / 开始'],
    ['P', '暂停与继续'],
    ['R', '重新开始'],
  ],
  sound: {
    on: audio.enabled,
    onToggle: (on) => {
      audio.setEnabled(on);
      store.set('sound', on);
    },
  },
});

/* --------------------------------- 渲染 --------------------------------- */

function render(): void {
  const snapshot = model.getSnapshot();

  // 占位画面：进度块宽度跟着分数涨（分数越多越宽）
  const width = Math.min(STAGE.width - 48, snapshot.score * 24);
  progressNode.setState({ width });
  progressNode.setState({
    style: {
      fillStyle: snapshot.phase === 'over' ? '#dc3545' : '#0dcaf0',
      strokeStyle: snapshot.phase === 'over' ? '#dc3545' : '#0dcaf0',
    },
  });

  shell.setStat('score', snapshot.score);
  shell.setStat('best', Math.max(scores.getBest(), snapshot.score));
  shell.setStat('time', `${Math.ceil(snapshot.remainingMs / 1000)}s`);
}

/* ------------------------------ 状态与覆盖层 ------------------------------ */

function syncShell(): void {
  const snapshot = model.getSnapshot();
  switch (snapshot.phase) {
    case 'ready':
      shell.setStatus('待开始');
      shell.showOverlay({ kind: 'ready', title: '准备好了吗', subtitle: '按 空格 开始', hint: '30 秒内尽可能多得分' });
      break;
    case 'playing':
      shell.setStatus('进行中');
      shell.hideOverlay();
      break;
    case 'paused':
      shell.setStatus('已暂停');
      shell.showOverlay({ kind: 'paused', title: '已暂停', subtitle: '按 P 继续' });
      break;
    case 'over':
      shell.setStatus('已结束');
      shell.showOverlay({
        kind: 'over',
        title: '时间到',
        subtitle: `得分 ${snapshot.score} · 最高分 ${Math.max(scores.getBest(), snapshot.score)}`,
        hint: '按 R 重新开始',
      });
      break;
  }
  page.ice.dirty = true;
}

function togglePause(): void {
  applyEvents(model.togglePause());
  loop.setPaused(model.isPaused());
}

function restart(): void {
  model.reset();
  loop.setPaused(false);
  audio.cue('blip');
  syncShell();
  render();
}

/** 空格：未开始时开始，进行中则计分。 */
function tapOrStart(): void {
  if (model.getPhase() === 'ready') {
    applyEvents(model.start());
    syncShell();
    return;
  }
  applyEvents(model.tap());
  render();
}

/* --------------------------------- 输入 --------------------------------- */

const input = createInput(page, {
  bindings: {
    tap: [' ', 'Spacebar', 'Enter'],
    pause: ['p', 'P'],
    restart: ['r', 'R'],
  },
});

input.on('tap', () => tapOrStart());
input.on('pause', () => togglePause());
input.on('restart', () => restart());

/* --------------------------------- 循环 --------------------------------- */

/** 事件 → 声音 + 副作用（表现层的事，规则层只负责"报事件"）。 */
function applyEvents(events: __NAME__Event[]): void {
  for (const event of events) {
    switch (event) {
      case 'tap':
        audio.cue('score');
        break;
      case 'start':
      case 'resume':
        audio.cue('launch');
        break;
      case 'pause':
        audio.cue('blip');
        break;
      case 'over':
        audio.cue('over');
        // 一局结束把分数写进最高分榜（模型自己负责排序、截断与存档容错）
        if (model.getScore() > 0) scores.add(model.getScore());
        break;
      default:
        break;
    }
  }
}

let lastPhase = model.getPhase();

const loop = startLoop(page, (dt) => {
  applyEvents(model.step(dt));

  const phase = model.getPhase();
  if (phase !== lastPhase) {
    lastPhase = phase;
    syncShell();
  }
  render();
});

/* --------------------------------- 首屏 --------------------------------- */

syncShell();
render();
page.ice.dirty = true;

/** 调试 / e2e 句柄：暴露 model 便于断言状态机，不必靠像素猜。 */
(window as any).__game = {
  page,
  model,
  shell,
  loop,
  input,
  audio,
  scores,
  stage: STAGE,
  worldRect: page.worldRect,
  togglePause,
  restart,
  render,
};
