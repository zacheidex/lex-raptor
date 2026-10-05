import {sqliteTable, text, integer, index} from 'drizzle-orm/sqlite-core';
export const calls = sqliteTable('demo_calls', {
  id: text('id').primaryKey(),
  visitor: text('visitor').notNull(),
  session: text('session').notNull(),
  created: integer('created').notNull(),
  state: text('state').notNull(),
  charged: integer('charged').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  // Existing ledger entries used the original model; new calls set this explicitly.
  model: text('model').notNull().default('gpt-5.3-codex'),
}, t => [index('calls_visitor_time').on(t.visitor, t.created), index('calls_session_time').on(t.session, t.created)]);
export const attempts = sqliteTable('demo_attempts', {
  id: text('id').primaryKey(), count: integer('count').notNull(), expires: integer('expires').notNull()
});
