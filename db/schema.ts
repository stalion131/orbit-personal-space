import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import type { Task } from '../lib/tasks';
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  payload: text('payload', { mode: 'json' }).$type<Task>().notNull(),
  revision: integer('revision').notNull(),
  demo: integer('demo', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
}, table => [index('idx_tasks_demo_updated').on(table.demo, table.updatedAt)]);
