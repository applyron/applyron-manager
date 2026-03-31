import { z } from 'zod';

export const AppUpdateStatusSchema = z.object({
  status: z.enum([
    'idle',
    'checking',
    'up_to_date',
    'update_available',
    'ready_to_install',
    'error',
    'unsupported',
  ]),
  currentVersion: z.string(),
  latestVersion: z.string().nullable(),
  lastCheckedAt: z.number().nullable(),
  message: z.string().nullable(),
});

export type AppUpdateStatus = z.infer<typeof AppUpdateStatusSchema>;

export const DashboardAnnouncementSchema = z.object({
  id: z.string(),
  publishedAt: z.string(),
  level: z.string(),
  url: z.string().url(),
  title: z.object({
    tr: z.string(),
    en: z.string(),
  }),
  body: z.object({
    tr: z.string(),
    en: z.string(),
  }),
});

export type DashboardAnnouncement = z.infer<typeof DashboardAnnouncementSchema>;

export const DashboardAnnouncementFeedSchema = z.object({
  announcements: z.array(DashboardAnnouncementSchema),
});

export const SERVICE_HEALTH_IDS = [
  'config',
  'security',
  'monitoring',
  'updater',
  'auth_server',
  'proxy_server',
  'cloud_monitor',
  'codex_monitor',
  'orpc_transport',
] as const;

export type ServiceHealthId = (typeof SERVICE_HEALTH_IDS)[number];

export const ServiceHealthStateSchema = z.enum([
  'idle',
  'starting',
  'ready',
  'error',
  'degraded',
  'unsupported',
]);

export type ServiceHealthState = z.infer<typeof ServiceHealthStateSchema>;

export const ServiceHealthItemSchema = z.object({
  id: z.enum(SERVICE_HEALTH_IDS),
  label: z.string(),
  state: ServiceHealthStateSchema,
  message: z.string().nullable(),
  updatedAt: z.number(),
});

export type ServiceHealthItem = z.infer<typeof ServiceHealthItemSchema>;

export const ServiceHealthSummarySchema = z.object({
  services: z.array(ServiceHealthItemSchema),
  hasErrors: z.boolean(),
  updatedAt: z.number().nullable(),
});

export type ServiceHealthSummary = z.infer<typeof ServiceHealthSummarySchema>;
