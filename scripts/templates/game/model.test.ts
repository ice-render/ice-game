import { __NAME__Model } from '../../../src/games/__SLUG__/model';

/**
 * __TITLE__ 的**规则**单测（纯逻辑，不需要浏览器 / 引擎产物，跑得飞快）。
 *
 * 脚手架给的是占位玩法（限时计分）的测试。改玩法时把断言换成你自己规则里
 * "最容易写错、又最难在浏览器里复现"的那几条 —— 通常就是：
 * 边界条件、状态跳变、计分口径。
 */
describe('__NAME__Model', () => {
  const makeModel = (options: Partial<ConstructorParameters<typeof __NAME__Model>[0]> = {}) =>
    new __NAME__Model({ width: 720, height: 470, ...options });

  it('初始是 ready：分数为 0、时间满格、不推进', () => {
    const model = makeModel();
    const snapshot = model.getSnapshot();
    expect(snapshot.phase).toBe('ready');
    expect(snapshot.score).toBe(0);
    expect(snapshot.remainingRatio).toBe(1);
    // ready 时 step 不该走时间
    model.step(500);
    expect(model.getRemainingMs()).toBe(snapshot.remainingMs);
  });

  it('start 进入 playing；重复 start 无副作用', () => {
    const model = makeModel();
    expect(model.start()).toEqual(['start']);
    expect(model.getPhase()).toBe('playing');
    expect(model.start()).toEqual([]);
  });

  it('tap 在 playing 时计分，其它状态下无效', () => {
    const model = makeModel();
    expect(model.tap()).toEqual([]); // ready 时不计分
    model.start();
    expect(model.tap()).toEqual(['tap']);
    expect(model.tap()).toEqual(['tap']);
    expect(model.getScore()).toBe(2);
    model.togglePause();
    expect(model.tap()).toEqual([]); // 暂停时不计分
    expect(model.getScore()).toBe(2);
  });

  it('时间耗尽 = 结束，且只报一次 over', () => {
    const model = makeModel({ durationMs: 100 });
    model.start();
    expect(model.step(60)).toEqual([]);
    expect(model.getPhase()).toBe('playing');
    const events = model.step(60);
    expect(events).toEqual(['over']);
    expect(model.getPhase()).toBe('over');
    expect(model.getRemainingMs()).toBe(0);
    // 已结束：再推进不再报事件
    expect(model.step(500)).toEqual([]);
  });

  it('暂停时时间冻结，恢复后继续走', () => {
    const model = makeModel({ durationMs: 1000 });
    model.start();
    model.step(200);
    expect(model.getRemainingMs()).toBe(800);
    model.togglePause();
    model.step(500); // 暂停期间不计时
    expect(model.getRemainingMs()).toBe(800);
    model.togglePause();
    model.step(100);
    expect(model.getRemainingMs()).toBe(700);
  });

  it('reset 回到初始状态', () => {
    const model = makeModel({ durationMs: 500 });
    model.start();
    model.tap();
    model.step(600);
    expect(model.isOver()).toBe(true);
    model.reset();
    expect(model.getPhase()).toBe('ready');
    expect(model.getScore()).toBe(0);
    expect(model.getRemainingMs()).toBe(500);
  });
});
