// All money is integer microdollars. The cap is lifetime, across deployments,
// sessions and visitors. No automatic top-up or clock-based reset.
export const CAP = 10_000_000;
export const RESERVE = 20_000;
export const MAX_OUTPUT = 4096;
export const MAX_INPUT_BYTES = 32768;
export const MODEL = 'gpt-5.1-codex-mini';

export function database(env) {
  if (!env.DB) throw new Error('Database unavailable');
  return env.DB;
}

export async function reserve(db, id, visitor, session, now) {
  // One atomic SQLite INSERT ... SELECT: concurrent requests cannot all pass
  // a separate read/check. Unknown or interrupted calls retain their charge.
  const row = await db.prepare(`INSERT INTO demo_calls
    (id,visitor,session,created,state,charged,model)
    SELECT ?,?,?,?,'reserved',?,? WHERE
      (SELECT COALESCE(SUM(charged),0) FROM demo_calls) + ? <= ?
      AND (SELECT COUNT(*) FROM demo_calls WHERE visitor=? AND created>?) < 10
      AND (SELECT COUNT(*) FROM demo_calls WHERE session=? AND created>?) < 10
      AND (SELECT COUNT(*) FROM demo_calls WHERE visitor=? AND created>?) < 3
      AND (SELECT COUNT(*) FROM demo_calls WHERE state='reserved' AND created>?) < 2
    ON CONFLICT(id) DO NOTHING RETURNING id`).bind(
      id,visitor,session,now,RESERVE,MODEL,RESERVE,CAP,
      visitor,now-86400,session,now-86400,visitor,now-60,now-120
    ).first();
  return !!row;
}

export function cost(usage) {
  if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0 ||
      !Number.isSafeInteger(usage?.output_tokens) || usage.output_tokens < 0) return null;
  // Standard service, full uncached input price; reasoning included in output.
  // Rates verified 2026-10-05. Provider discounts are deliberately ignored.
  return Math.ceil(usage.input_tokens * .25 + usage.output_tokens * 2);
}

export async function settle(db,id,usage) {
  const amount=cost(usage);
  if (amount===null) return;
  await db.prepare(`UPDATE demo_calls SET charged=?,state='completed',input_tokens=?,output_tokens=?
    WHERE id=? AND state='reserved'`).bind(amount,usage.input_tokens,usage.output_tokens,id).run();
}

export async function attempt(db, key, now) {
  const row=await db.prepare(`INSERT INTO demo_attempts(id,count,expires) VALUES(?,1,?)
    ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count`).bind(key,now+1800).first();
  return row.count<=10;
}
