import { createStore, type KVStorage } from '../../src/kit/storage';

/**
 * `kit/storage` 的容错单测。
 *
 * 容错代码是最该被测的一类：它的失败方式是"平时好好的、某个用户的浏览器里就崩"。
 * 这里用**注入的内存后端**造出各种坏情况（读抛、写抛、坏 JSON、非 JSON 旧值），
 * 断言游戏侧永远拿到可用的值、且永不抛错。
 */

/** 一个可控的内存后端：可以按需让读/写抛异常。 */
function makeStorage(seed: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(seed));
  const storage: KVStorage & { failRead?: boolean; failWrite?: boolean; data: Map<string, string> } = {
    data,
    getItem(key: string) {
      if (storage.failRead) throw new Error('SecurityError: 读取被拒绝');
      return data.has(key) ? (data.get(key) as string) : null;
    },
    setItem(key: string, value: string) {
      if (storage.failWrite) throw new Error('QuotaExceededError');
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
  return storage;
}

describe('createStore', () => {
  it('读写带命名空间：不同游戏的键互不干扰', () => {
    const backend = makeStorage();
    const a = createStore('breakout', backend);
    const b = createStore('snake2', backend);

    expect(a.set('sound', false)).toBe(true);
    expect(b.set('sound', true)).toBe(true);

    expect(a.get('sound', true)).toBe(false);
    expect(b.get('sound', true)).toBe(true);
    // 键名确实带了前缀（不是裸的 "sound"）
    expect([...backend.data.keys()].sort()).toEqual(['ice-game:breakout:sound', 'ice-game:snake2:sound']);
  });

  it('读不到时返回兜底值', () => {
    const store = createStore('breakout', makeStorage());
    expect(store.get('missing', 42)).toBe(42);
    expect(store.get('missing', 'x')).toBe('x');
  });

  it('存储不可用（null）时：读走兜底、写返回 false、绝不抛', () => {
    const store = createStore('breakout', null);
    expect(store.available).toBe(false);
    expect(store.get('sound', true)).toBe(true);
    expect(store.set('sound', false)).toBe(false);
    expect(() => store.remove('sound')).not.toThrow();
  });

  it('读取抛异常（隐私模式）时不炸，返回兜底值', () => {
    const backend = makeStorage({ 'ice-game:breakout:sound': 'false' });
    const store = createStore('breakout', backend);
    backend.failRead = true;
    expect(() => store.get('sound', true)).not.toThrow();
    expect(store.get('sound', true)).toBe(true);
  });

  it('写入抛异常（配额满）时返回 false，且不影响已存的值', () => {
    const backend = makeStorage();
    const store = createStore('breakout', backend);
    store.set('score', 10);

    backend.failWrite = true;
    expect(store.set('score', 999)).toBe(false);
    expect(store.get('score', 0)).toBe(10); // 旧值还在
  });

  it('存档是坏 JSON 时返回兜底值，不抛', () => {
    const store = createStore('breakout', makeStorage({ 'ice-game:breakout:state': '{坏掉的 json' }));
    expect(store.get('state', null)).toBeNull();
    expect(store.get('state', 'fallback')).toBe('fallback');
  });

  it('非 JSON 的存档值一律当损坏处理，不把原始字符串透给游戏', () => {
    // 本层写入一律走 JSON.stringify，所以读出来不是合法 JSON 就说明数据坏了。
    // 退回原始字符串会把"读不到"的小问题变成游戏侧"类型错乱"的大问题。
    const store = createStore('breakout', makeStorage({ 'ice-game:breakout:name': 'felix' }));
    expect(store.get('name', '')).toBe('');
    expect(store.get('name', 'fallback')).toBe('fallback');
  });

  it('存进去 undefined / null 时按"没有值"处理，返回兜底', () => {
    const backend = makeStorage();
    const store = createStore('breakout', backend);
    store.set('nothing', undefined);
    expect(store.get('nothing', 'fallback')).toBe('fallback');
    store.set('nil', null);
    expect(store.get('nil', 'fallback')).toBe('fallback');
  });

  it('对象与数组能原样往返', () => {
    const store = createStore('breakout', makeStorage());
    store.set('progress', { level: 3, muted: false });
    expect(store.get('progress', null)).toEqual({ level: 3, muted: false });
    store.set('list', [1, 2, 3]);
    expect(store.get('list', [])).toEqual([1, 2, 3]);
  });

  it('remove 清掉键（后端不支持 removeItem 时静默跳过）', () => {
    const backend = makeStorage();
    const store = createStore('breakout', backend);
    store.set('temp', 1);
    store.remove('temp');
    expect(store.get('temp', 'gone')).toBe('gone');

    const noRemove: KVStorage = {
      getItem: () => null,
      setItem: () => {},
    };
    const store2 = createStore('breakout', noRemove);
    expect(() => store2.remove('x')).not.toThrow();
  });
});
