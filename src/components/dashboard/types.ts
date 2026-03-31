import type { LucideIcon } from 'lucide-react';
import type { DashboardAnnouncement } from '@/types/dashboard';

export interface DashboardAccountSummary {
  key: string;
  source: 'classic' | 'codex';
  sourceLabel: string;
  name: string;
  secondary: string;
  status: string;
  summary: string;
  icon: LucideIcon;
}

export interface LocalizedAnnouncementItem extends DashboardAnnouncement {
  titleText: string;
  bodyText: string;
  levelLabel: string;
}
