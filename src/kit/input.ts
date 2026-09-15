/**
 * 键盘输入：把物理按键映射成**语义动作**（`left` / `launch` / `pause`…），
 * 游戏代码只跟动作打交道，换键位不用改玩法。
 *
 * ```ts
 * const input = createInput(page, {
 *   bindings: {
 *     left: ['ArrowLeft', 'a', 'A'],
 *     right: ['ArrowRight', 'd', 'D'],
 *     launch: [' ', 'Spacebar', 'ArrowUp'],
 *     pause: ['p', 'P'],
 *     restart: ['r', 'R'],
 *   },
 * });
 * input.on('pause', () => togglePause());     // 离散动作
 * // 每帧读"按住"状态（挡板这类连续控制）
 * if (input.isDown('left')) paddle.vx = -PADDLE_SPEED;
 * ```
 *
 * 四个必须做对的地方（都是"做错了很难查"的类型）：
 *
 * 1. **`repeat` 默认被吞掉**：按住不放时浏览器会连续发 `keydown`，用它触发"发射/暂停"
 *    会一秒开几十次。离散动作用 `once`（默认），确实想收 repeat 的动作显式声明 `repeatable`。
 * 2. **失焦要清空按键**：切到别的标签页时 `keyup` 会丢，回来后"按住"状态永远卡住
 *    （挡板自己往一边跑）。监听 `blur` 清空。
 * 3. **preventDefault 只对已绑定的键**：方向键/空格会滚动页面、`/` 会触发快速查找；
 *    但对没绑定的键不要拦（不然用户按 F5、Cmd+R 都没反应）。
 * 4. **大小写**：`event.key` 对大写字母是 `'A'`，所以绑定时两种都列上（或用 `key.toLowerCase()`）。
 *    这里统一按"原样 + 小写"双匹配，绑一次就够。
 */
import type { GamePageHandle } from './page';

export interface InputOptions {
  /** 动作 → 物理按键列表（`event.key` 的取值）。 */
  bindings?: Record<string, string[]>;
  /** 这些动作会收 repeat 的 keydown（默认都不收）。 */
  repeatable?: string[];
  /** 是否对已绑定的键 preventDefault（默认 true）。 */
  preventDefault?: boolean;
}

export interface InputHandle {
  /** 注册离散动作处理器（按下时触发一次）。返回取消注册的函数。 */
  on(action: string, handler: (event: KeyboardEvent) => void): () => void;
  /** 该动作对应的键当前是否被按住（连续控制用）。 */
  isDown(action: string): boolean;
  /** 当前按住的动作列表（调试 / e2e 用）。 */
  downActions(): string[];
  /** 触发一次动作（测试与"点击也能玩"的场合用）。 */
  trigger(action: string): boolean;
  /** 重新绑定（换键位 / 换关卡时用）。 */
  bind(bindings: Record<string, string[]>): void;
  destroy(): void;
}

export function createInput(page: GamePageHandle, options: InputOptions = {}): InputHandle {
  const preventDefault = options.preventDefault !== false;
  const repeatable = new Set(options.repeatable || []);

  /** 动作 → 键集合（小写规范化）。 */
  const actionKeys = new Map<string, Set<string>>();
  /** 键 → 动作（反向索引，keydown 时 O(1)）。 */
  const keyAction = new Map<string, string>();
  const handlers = new Map<string, Set<(event: KeyboardEvent) => void>>();
  const held = new Set<string>();

  const normalize = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

  function bind(bindings: Record<string, string[]>): void {
    actionKeys.clear();
    keyAction.clear();
    for (const [action, keys] of Object.entries(bindings)) {
      const set = new Set<string>();
      for (const key of keys) {
        const norm = normalize(key);
        set.add(norm);
        keyAction.set(norm, action);
      }
      actionKeys.set(action, set);
    }
    // 键位变了：之前"按住"的动作可能已经不存在，清掉免得卡住
    held.clear();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const key = normalize(event.key);
    const action = keyAction.get(key);
    if (!action) return; // 没绑定的键一律不碰（F5 / Cmd+R 等要留给浏览器）
    if (preventDefault) event.preventDefault();
    held.add(action);
    if (event.repeat && !repeatable.has(action)) return;
    const set = handlers.get(action);
    if (set) for (const handler of [...set]) handler(event);
    // 有些键（空格 / 方向键）在部分浏览器里 keydown 后还会冒泡成滚动，再挡一次
    page.ice.dirty = true;
  }

  function onKeyUp(event: KeyboardEvent): void {
    const action = keyAction.get(normalize(event.key));
    if (!action) return;
    if (preventDefault) event.preventDefault();
    held.delete(action);
  }

  /** 失焦：keyup 会丢，不清空的话"按住"状态会永久卡住（挡板自己往一边跑）。 */
  function onBlur(): void {
    held.clear();
  }

  bind(options.bindings || {});

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    on(action, handler) {
      if (!handlers.has(action)) handlers.set(action, new Set());
      handlers.get(action)!.add(handler);
      return () => {
        const set = handlers.get(action);
        if (set) set.delete(handler);
      };
    },
    isDown(action) {
      return held.has(action);
    },
    downActions() {
      return [...held];
    },
    trigger(action) {
      const set = handlers.get(action);
      if (!set || !set.size) return false;
      for (const handler of [...set]) handler(new KeyboardEvent('keydown', { key: '' }));
      return true;
    },
    bind,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      handlers.clear();
      held.clear();
    },
  };
}
