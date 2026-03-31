import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch, mockGetStatus, mockCheckForUpdatesManual, mockInstallDownloadedUpdate } =
  vi.hoisted(() => ({
    mockFetch: vi.fn(),
    mockGetStatus: vi.fn(),
    mockCheckForUpdatesManual: vi.fn(),
    mockInstallDownloadedUpdate: vi.fn(),
  }));

vi.stubGlobal('fetch', mockFetch);

vi.mock('../../services/AppUpdateService', () => ({
  AppUpdateService: {
    getStatus: mockGetStatus,
    checkForUpdatesManual: mockCheckForUpdatesManual,
    installDownloadedUpdate: mockInstallDownloadedUpdate,
  },
}));

vi.mock('../../services/ServiceHealthRegistry', () => ({
  ServiceHealthRegistry: {
    getSummary: vi.fn(() => ({
      services: [],
      hasErrors: false,
      updatedAt: null,
    })),
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { fetchDashboardAnnouncements } from '../../ipc/app/handlers';

describe('app handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats a missing announcements feed as an empty list', async () => {
    mockFetch.mockResolvedValue({
      status: 404,
      ok: false,
    });

    const result = await fetchDashboardAnnouncements();

    expect(result).toEqual([]);
  });

  it('throws for non-404 announcement feed failures', async () => {
    mockFetch.mockResolvedValue({
      status: 503,
      ok: false,
    });

    await expect(fetchDashboardAnnouncements()).rejects.toThrow('Announcements feed returned 503');
  });

  it('parses the tracked announcements feed object contract', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: vi.fn(async () => ({
        announcements: [
          {
            id: 'release-2026-03-25',
            publishedAt: '2026-03-25T12:00:00Z',
            level: 'info',
            url: 'https://github.com/applyron/Applyron-Manager/releases',
            title: {
              tr: 'Baslik',
              en: 'Title',
            },
            body: {
              tr: 'Icerik',
              en: 'Body',
            },
          },
        ],
      })),
    });

    const result = await fetchDashboardAnnouncements();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('release-2026-03-25');
  });
});
