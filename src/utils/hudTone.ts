import { getQuotaStatus } from '@/utils/quota-display';

export type HudTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

type HudTonePalette = {
  solid: string;
  text: string;
  softBackground: string;
  softBorder: string;
  contrastText: string;
  glow: string;
};

const HUD_TONE_MAP: Record<HudTone, HudTonePalette> = {
  success: {
    solid: 'var(--hud-success)',
    text: 'var(--hud-success-strong)',
    softBackground: 'var(--hud-success-soft-bg)',
    softBorder: 'var(--hud-success-soft-border)',
    contrastText: 'var(--hud-success-contrast)',
    glow: '0 0 8px var(--hud-success-soft-border)',
  },
  info: {
    solid: 'var(--hud-info)',
    text: 'var(--hud-info)',
    softBackground: 'var(--hud-info-soft-bg)',
    softBorder: 'var(--hud-info-soft-border)',
    contrastText: 'var(--hud-text-strong)',
    glow: '0 0 8px var(--hud-info-soft-border)',
  },
  warning: {
    solid: 'var(--hud-warning)',
    text: 'var(--hud-warning)',
    softBackground: 'var(--hud-warning-soft-bg)',
    softBorder: 'var(--hud-warning-soft-border)',
    contrastText: 'var(--hud-text-strong)',
    glow: '0 0 8px var(--hud-warning-soft-border)',
  },
  danger: {
    solid: 'var(--hud-danger)',
    text: 'var(--hud-danger)',
    softBackground: 'var(--hud-danger-soft-bg)',
    softBorder: 'var(--hud-danger-soft-border)',
    contrastText: 'var(--hud-text-strong)',
    glow: '0 0 8px var(--hud-danger-soft-border)',
  },
  neutral: {
    solid: 'var(--hud-neutral)',
    text: 'var(--hud-text-subtle)',
    softBackground: 'var(--hud-neutral-soft-bg)',
    softBorder: 'var(--hud-neutral-soft-border)',
    contrastText: 'var(--hud-text-strong)',
    glow: 'none',
  },
};

export function getHudTone(tone: HudTone): HudTonePalette {
  return HUD_TONE_MAP[tone];
}

export function getHudQuotaTone(percentage: number): HudTone {
  const status = getQuotaStatus(percentage);

  switch (status) {
    case 'high':
      return 'success';
    case 'medium':
      return 'warning';
    case 'low':
    default:
      return 'danger';
  }
}
