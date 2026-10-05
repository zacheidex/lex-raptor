// All money is integer microdollars. The cap is lifetime, across deployments,
// sessions and visitors. No automatic top-up or clock-based reset.
export const CAP = 10_000_000;
export const RESERVE = 20_000;
// Up to four $0.01 web calls. Allow cumulative 128k tool contexts on each
// model turn (10 * 128k), five input/framing copies, planning and output.
// At conservative pinned rates this is below $0.40, including tool fees.
export const WEB_RESERVE = 400_000;
export const WEB_CALL_COST = 10_000;
export const MAX_OUTPUT = 6144;
export const MAX_INPUT_BYTES = 32768;
export const MODEL = 'gpt-6-luna';

export function database(env) {
  if (!env.DB) throw new Error('Database unavailable');
  return env.DB;
}

export async function reserve(db, id, visitor, session, now, amount=RESERVE) {
  if(![RESERVE,WEB_RESERVE].includes(amount))throw new Error('Invalid reservation');
  // One atomic SQLite INSERT ... SELECT: concurrent requests cannot all pass
  // a separate read/check. Unknown or interrupted calls retain their charge.
  const row = await db.prepare(`INSERT INTO demo_calls
    (id,visitor,session,created,state,charged,model)
    SELECT ?,?,?,?,'reserved',?,? WHERE
      (SELECT COALESCE(SUM(charged),0) FROM demo_calls) + ? <= ?
    ON CONFLICT(id) DO NOTHING RETURNING id`).bind(
      id,visitor,session,now,amount,MODEL,amount,CAP
    ).first();
  return !!row;
}

export async function upgradeReservation(db,id) {
  return !!await db.prepare(`UPDATE demo_calls SET charged=? WHERE id=? AND state='reserved'
    AND (SELECT COALESCE(SUM(charged),0) FROM demo_calls)+?-charged<=? RETURNING id`)
    .bind(WEB_RESERVE,id,WEB_RESERVE,CAP).first();
}

export function cost(usage) {
  if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0 ||
      !Number.isSafeInteger(usage?.output_tokens) || usage.output_tokens < 0 ||
      !Number.isSafeInteger(usage.web_search_calls??0) || (usage.web_search_calls??0)<0) return null;
  // Standard service, reasoning included in output. Rates verified 2026-10-05.
  // Conservatively allow BOTH the $0.10/M input rate and $0.125/M cache-write
  // rate on every input token. Cache discounts are deliberately ignored.
  return Math.ceil(usage.input_tokens * .225 + usage.output_tokens * .5)+(usage.web_search_calls??0)*WEB_CALL_COST;
}

export async function settle(db,id,usage) {
  const amount=cost(usage);
  if (amount===null) return;
  await db.prepare(`UPDATE demo_calls SET charged=?,state='completed',input_tokens=?,output_tokens=?,web_search_calls=?
    WHERE id=? AND state='reserved'`).bind(amount,usage.input_tokens,usage.output_tokens,usage.web_search_calls??0,id).run();
}
