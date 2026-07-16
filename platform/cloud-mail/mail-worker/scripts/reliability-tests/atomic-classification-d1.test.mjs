import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';

async function rows(sql, ...bindings) {
  return (await env.db.prepare(sql).bind(...bindings).all()).results;
}

beforeEach(async () => {
  await env.db.batch([
    env.db.prepare(`DROP TABLE IF EXISTS atomic_test_heads`),
    env.db.prepare(`DROP TABLE IF EXISTS atomic_test_snapshot`),
    env.db.prepare(`DROP TABLE IF EXISTS atomic_test_projection`),
    env.db.prepare(`DROP TABLE IF EXISTS atomic_test_item`),
    env.db.prepare(`CREATE TABLE atomic_test_heads(conversation_id TEXT, category TEXT, state TEXT NOT NULL, PRIMARY KEY(conversation_id,category))`),
    env.db.prepare(`CREATE TABLE atomic_test_snapshot(conversation_id TEXT PRIMARY KEY, category TEXT NOT NULL)`),
    env.db.prepare(`CREATE TABLE atomic_test_projection(conversation_id TEXT PRIMARY KEY, category TEXT NOT NULL, all_mail INTEGER NOT NULL)`),
    env.db.prepare(`CREATE TABLE atomic_test_item(id TEXT PRIMARY KEY, state TEXT NOT NULL)`)
  ]);
  await env.db.prepare(`CREATE TRIGGER atomic_test_category_exclusive BEFORE INSERT ON atomic_test_heads WHEN EXISTS(SELECT 1 FROM atomic_test_heads WHERE conversation_id=NEW.conversation_id AND category<>NEW.category AND state='current') BEGIN SELECT RAISE(ABORT,'atomic_test_category_exclusive'); END`).run();
  await env.db.batch([
    env.db.prepare(`INSERT INTO atomic_test_heads VALUES('c1','general','current')`),
    env.db.prepare(`INSERT INTO atomic_test_snapshot VALUES('c1','general')`),
    env.db.prepare(`INSERT INTO atomic_test_projection VALUES('c1','general',1)`),
    env.db.prepare(`INSERT INTO atomic_test_item VALUES('item-1','pending')`)
  ]);
});

describe('D1 atomic primary category batch', () => {
  it('rolls back every current-state change when a late item-result statement fails', async () => {
    await expect(env.db.batch([
      env.db.prepare(`DELETE FROM atomic_test_heads WHERE conversation_id=?1 AND state='current'`).bind('c1'),
      env.db.prepare(`INSERT INTO atomic_test_heads VALUES(?1,?2,'current')`).bind('c1', 'promotions'),
      env.db.prepare(`UPDATE atomic_test_snapshot SET category=?1 WHERE conversation_id=?2`).bind('promotions', 'c1'),
      env.db.prepare(`UPDATE atomic_test_projection SET category=?1,all_mail=1 WHERE conversation_id=?2`).bind('promotions', 'c1'),
      env.db.prepare(`UPDATE atomic_test_item SET state='completed' WHERE id='item-1'`),
      env.db.prepare(`INSERT INTO atomic_test_item VALUES('item-1','completed-again')`)
    ])).rejects.toThrow();
    expect(await rows(`SELECT category FROM atomic_test_heads WHERE conversation_id='c1'`)).toEqual([{ category: 'general' }]);
    expect(await rows(`SELECT category FROM atomic_test_snapshot WHERE conversation_id='c1'`)).toEqual([{ category: 'general' }]);
    expect(await rows(`SELECT category,all_mail FROM atomic_test_projection WHERE conversation_id='c1'`)).toEqual([{ category: 'general', all_mail: 1 }]);
    expect(await rows(`SELECT state FROM atomic_test_item WHERE id='item-1'`)).toEqual([{ state: 'pending' }]);
  });

  it('rejects a duplicate current category head and preserves the original category', async () => {
    await expect(env.db.batch([
      env.db.prepare(`INSERT INTO atomic_test_heads VALUES('c1','promotions','current')`)
    ])).rejects.toThrow('atomic_test_category_exclusive');
    expect(await rows(`SELECT category FROM atomic_test_heads WHERE conversation_id='c1'`)).toEqual([{ category: 'general' }]);
  });

  it('commits a delete-and-replace transition with All Mail retained', async () => {
    await env.db.batch([
      env.db.prepare(`DELETE FROM atomic_test_heads WHERE conversation_id='c1' AND state='current'`),
      env.db.prepare(`INSERT INTO atomic_test_heads VALUES('c1','promotions','current')`),
      env.db.prepare(`UPDATE atomic_test_snapshot SET category='promotions' WHERE conversation_id='c1'`),
      env.db.prepare(`UPDATE atomic_test_projection SET category='promotions',all_mail=1 WHERE conversation_id='c1'`),
      env.db.prepare(`UPDATE atomic_test_item SET state='completed' WHERE id='item-1'`)
    ]);
    expect(await rows(`SELECT category FROM atomic_test_heads WHERE conversation_id='c1'`)).toEqual([{ category: 'promotions' }]);
    expect(await rows(`SELECT category,all_mail FROM atomic_test_projection WHERE conversation_id='c1'`)).toEqual([{ category: 'promotions', all_mail: 1 }]);
    expect(await rows(`SELECT state FROM atomic_test_item WHERE id='item-1'`)).toEqual([{ state: 'completed' }]);
  });
});
