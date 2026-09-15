import { BreakoutModel } from '../../../src/games/breakout/model';

/**
 * 打砖块的**规则**单测。
 *
 * 这一层不需要浏览器、不需要引擎产物（model 是零运行时依赖的纯逻辑），
 * 所以跑得飞快，而且能把"最容易写错、又最难在浏览器里复现"的判定精确钉住：
 * 穿透、反弹轴、扣命时机、过关条件。
 */
describe('BreakoutModel', () => {
  /** 一个够小的场地，砖块在上方，球在下方活动 —— 便于构造碰撞。 */
  const makeModel = (options: Partial<ConstructorParameters<typeof BreakoutModel>[0]> = {}) =>
    new BreakoutModel({ width: 400, height: 300, ...options });

  it('初始是 ready：砖块铺满、球贴在挡板上、没开始计分', () => {
    const model = makeModel({ rows: 3, cols: 5 });
    const snapshot = model.getSnapshot();
    expect(snapshot.phase).toBe('ready');
    expect(snapshot.bricks).toHaveLength(15);
    expect(snapshot.bricksLeft).toBe(15);
    expect(snapshot.score).toBe(0);
    expect(snapshot.lives).toBe(3);
    expect(snapshot.level).toBe(1);
    // 球在挡板正上方（未发球时球速为 0）
    expect(snapshot.ball.vx).toBe(0);
    expect(snapshot.ball.vy).toBe(0);
    expect(snapshot.ball.x).toBeCloseTo(snapshot.paddle.x + snapshot.paddle.width / 2);
  });

  it('发球后进入 playing 并有了速度', () => {
    const model = makeModel();
    expect(model.launch()).toBe(true);
    expect(model.getPhase()).toBe('playing');
    const ball = model.getBall();
    expect(Math.hypot(ball.vx, ball.vy)).toBeGreaterThan(0);
    // 方向朝上（不能一发球就往下掉）
    expect(ball.vy).toBeLessThan(0);
    // 重复发球无效
    expect(model.launch()).toBe(false);
  });

  it('ready 状态下 step 不推进（球不该自己动）', () => {
    const model = makeModel();
    const before = model.getBall();
    model.step(100);
    const after = model.getBall();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('撞左墙反弹：vx 反向且球被推回场内', () => {
    const model = makeModel();
    model.launch();
    const radius = model.getBall().radius;
    model.setBallForTest(radius + 1, 150, -200, 0);
    const events = model.step(16);
    const ball = model.getBall();
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.x).toBeGreaterThanOrEqual(radius);
    expect(events).toContain('wall');
  });

  it('撞右墙反弹', () => {
    const model = makeModel();
    model.launch();
    const radius = model.getBall().radius;
    model.setBallForTest(400 - radius - 1, 150, 200, 0);
    model.step(16);
    expect(model.getBall().vx).toBeLessThan(0);
  });

  it('撞顶墙反弹：vy 反向', () => {
    const model = makeModel();
    model.launch();
    const radius = model.getBall().radius;
    model.setBallForTest(200, radius + 1, 0, -200);
    model.step(16);
    expect(model.getBall().vy).toBeGreaterThan(0);
  });

  it('撞挡板反弹向上，且击中位置决定水平分量', () => {
    const model = makeModel();
    model.launch();
    const paddle = model.getPaddle();
    const radius = model.getBall().radius;

    // 打在挡板**正中**：水平分量应当接近 0
    model.setBallForTest(paddle.x + paddle.width / 2, paddle.y - radius - 1, 0, 240);
    model.step(16);
    let ball = model.getBall();
    expect(ball.vy).toBeLessThan(0);
    expect(Math.abs(ball.vx)).toBeLessThan(1);

    // 打在挡板**最右**：应当往右上飞（这是让玩家能"控制"球的关键手感）
    model.setBallForTest(paddle.x + paddle.width - 1, paddle.y - radius - 1, 0, 240);
    model.step(16);
    ball = model.getBall();
    expect(ball.vy).toBeLessThan(0);
    expect(ball.vx).toBeGreaterThan(0);
  });

  it('撞砖块：扣耐久、加分、报事件；耐久归零后再撞不再加分', () => {
    const model = makeModel({ rows: 1, cols: 1 });
    model.launch();
    const brick = model.getAliveBricks()[0];
    expect(brick.maxHp).toBe(2); // 第一行是双层砖（设计如此）

    const aim = () =>
      model.setBallForTest(brick.x + brick.width / 2, brick.y + brick.height + model.getBall().radius + 1, 0, -300);

    aim();
    let events = model.step(16);
    expect(events).toContain('brick');
    expect(model.getScore()).toBeGreaterThan(0);
    expect(model.getAliveBricks()).toHaveLength(1); // 还剩（双层砖打了一下）

    const scoreAfterFirst = model.getScore();
    aim();
    events = model.step(16);
    expect(events).toContain('break');
    expect(model.getAliveBricks()).toHaveLength(0);
    expect(model.getScore()).toBeGreaterThan(scoreAfterFirst);
  });

  it('清空砖块 = 过关（phase 变 win）', () => {
    const model = makeModel({ rows: 1, cols: 1 });
    model.launch();
    const brick = model.getAliveBricks()[0];
    const radius = model.getBall().radius;
    // 双层砖，打两次
    for (let i = 0; i < 2; i += 1) {
      model.setBallForTest(brick.x + brick.width / 2, brick.y + brick.height + radius + 1, 0, -300);
      model.step(16);
    }
    expect(model.hasWon()).toBe(true);
    expect(model.isOver()).toBe(false);
  });

  it('球掉出底部：扣一条命并回到 ready 等发球', () => {
    const model = makeModel();
    model.launch();
    model.setBallForTest(200, 295, 0, 400);
    const events = model.step(50);
    expect(events).toContain('life');
    expect(model.getLives()).toBe(2);
    expect(model.getPhase()).toBe('ready');
    // 球被摆回挡板上，速度清零
    expect(model.getBall().vy).toBe(0);
  });

  it('命数用完 = 游戏结束，且不会变成负数', () => {
    const model = makeModel();
    for (let life = 3; life > 0; life -= 1) {
      model.launch();
      model.setBallForTest(200, 295, 0, 400);
      model.step(50);
    }
    expect(model.getLives()).toBe(0);
    expect(model.isOver()).toBe(true);
    // 结束后再推进也不该有任何变化
    const snapshot = model.getSnapshot();
    model.step(100);
    expect(model.getSnapshot().score).toBe(snapshot.score);
    expect(model.getLives()).toBe(0);
  });

  it('高速球不会穿砖（固定子步的意义）', () => {
    const model = makeModel({ rows: 1, cols: 1 });
    model.launch();
    const brick = model.getAliveBricks()[0];
    const radius = model.getBall().radius;
    expect(brick.hp).toBe(2);

    // 一帧 dt=100ms、速度 3000px/s → 位移 300px，而砖块只有 26px 厚、场地才 300px 高。
    // 不做固定子步的话球会直接"飞过"砖块（穿透），hp 与分数都不会变。
    model.setBallForTest(brick.x + brick.width / 2, brick.y + brick.height + radius + 1, 0, -3000);
    model.step(100);

    // 断言"撞到了"而不是"弹向哪边"：这一帧里球会在砖块与挡板之间来回弹好几次，
    // 最终方向取决于弹了几次（奇偶），拿方向做判据会写成一条随实现细节漂移的脆弱测试。
    const after = model.getSnapshot().bricks[0];
    expect(after.hp).toBeLessThan(brick.hp);
    expect(model.getScore()).toBeGreaterThan(0);
  });

  it('挡板被夹在场地内，球贴挡板时会跟着走', () => {
    const model = makeModel();
    model.movePaddleTo(-500);
    expect(model.getPaddle().x).toBe(0);
    model.movePaddleTo(99999);
    expect(model.getPaddle().x).toBeCloseTo(400 - model.getPaddle().width);
    // ready 时球跟着挡板
    expect(model.getBall().x).toBeCloseTo(model.getPaddle().x + model.getPaddle().width / 2);
  });

  it('暂停 / 恢复：暂停时 step 不推进', () => {
    const model = makeModel();
    model.launch();
    model.setBallForTest(200, 150, 100, -100);
    model.pause();
    expect(model.isPaused()).toBe(true);
    const before = model.getBall();
    model.step(50);
    expect(model.getBall().x).toBe(before.x);
    model.resume();
    model.step(50);
    expect(model.getBall().x).not.toBe(before.x);
  });

  it('reset 回到初始；nextLevel 保留分数与命数但加速、重建砖块', () => {
    const model = makeModel({ rows: 2, cols: 3 });
    model.launch();
    const brick = model.getAliveBricks()[0];
    model.setBallForTest(brick.x + brick.width / 2, brick.y + brick.height + 9, 0, -300);
    model.step(16);
    const scoreBefore = model.getScore();
    expect(scoreBefore).toBeGreaterThan(0);

    const paddleBefore = model.getPaddle().width;
    model.nextLevel();
    expect(model.getLevel()).toBe(2);
    expect(model.getScore()).toBe(scoreBefore); // 分数保留
    expect(model.getLives()).toBe(3); // 命数保留（没丢过命）
    expect(model.getAliveBricks()).toHaveLength(6); // 砖块重建
    expect(model.getPaddle().width).toBeLessThan(paddleBefore); // 挡板变窄
    expect(model.getPhase()).toBe('ready');

    model.reset();
    expect(model.getScore()).toBe(0);
    expect(model.getLevel()).toBe(1);
    expect(model.getLives()).toBe(3);
  });

  it('越靠上的砖块越值钱', () => {
    const model = new BreakoutModel({ width: 400, height: 400, rows: 3, cols: 1 });
    model.launch();
    const bricks = model.getAliveBricks();
    const top = bricks[0];
    const bottom = bricks[bricks.length - 1];
    const radius = model.getBall().radius;

    model.setBallForTest(bottom.x + bottom.width / 2, bottom.y + bottom.height + radius + 1, 0, -300);
    model.step(16);
    const bottomScore = model.getScore();

    const fresh = new BreakoutModel({ width: 400, height: 400, rows: 3, cols: 1 });
    fresh.launch();
    fresh.setBallForTest(top.x + top.width / 2, top.y + top.height + radius + 1, 0, -300);
    fresh.step(16);
    expect(fresh.getScore()).toBeGreaterThan(bottomScore);
  });
});
