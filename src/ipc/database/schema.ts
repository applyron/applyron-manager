import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  email: text('email').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  tokenJson: text('token_json').notNull(),
  quotaJson: text('quota_json'),
  deviceProfileJson: text('device_profile_json'),
  deviceHistoryJson: text('device_history_json'),
  createdAt: integer('created_at').notNull(),
  lastUsed: integer('last_used').notNull(),
  status: text('status'),
  isActive: integer('is_active').notNull().default(0),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const codexAccounts = sqliteTable('codex_accounts', {
  id: text('id').primaryKey(),
  email: text('email'),
  label: text('label'),
  accountId: text('account_id').notNull(),
  authMode: text('auth_mode'),
  hydrationState: text('hydration_state').notNull().default('live'),
  workspaceId: text('workspace_id'),
  workspaceTitle: text('workspace_title'),
  workspaceRole: text('workspace_role'),
  workspaceIsDefault: integer('workspace_is_default').notNull().default(0),
  identityKey: text('identity_key').notNull(),
  encryptedAuthJson: text('encrypted_auth_json').notNull(),
  snapshotJson: text('snapshot_json'),
  isActive: integer('is_active').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastRefreshedAt: integer('last_refreshed_at'),
});

export const itemTable = sqliteTable('ItemTable', {
  key: text('key').primaryKey(),
  value: text('value'),
});
