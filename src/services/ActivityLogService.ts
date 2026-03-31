import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getAgentDir } from '../utils/paths';
import {
  ActivityEvent,
  ActivityEventCategory,
  ActivityEventListResult,
  ActivityEventOutcome,
  ActivityEventSchema,
} from '../types/operations';
import { logger } from '../utils/logger';

const ACTIVITY_FILE_NAME = 'activity-events.jsonl';
const ACTIVITY_RETENTION_LIMIT = 1000;

type RecordInput = {
  category: ActivityEventCategory;
  action: string;
  target?: string | null;
  outcome?: ActivityEventOutcome;
  message: string;
  metadata?: Record<string, unknown> | null;
  occurredAt?: number;
};

function ensureActivityDirectory(): string {
  const directory = getAgentDir();
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function getActivityLogPath(): string {
  return path.join(ensureActivityDirectory(), ACTIVITY_FILE_NAME);
}

function parseActivityLines(lines: string[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = ActivityEventSchema.parse(JSON.parse(trimmed));
      events.push(parsed);
    } catch (error) {
      logger.warn('Skipping invalid activity event entry', error);
    }
  }
  return events;
}

function pruneActivityFileIfNeeded(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length <= ACTIVITY_RETENTION_LIMIT) {
    return;
  }

  const trimmedLines = lines.slice(-ACTIVITY_RETENTION_LIMIT);
  fs.writeFileSync(filePath, `${trimmedLines.join('\n')}\n`, 'utf8');
}

export class ActivityLogService {
  static getLogPath(): string {
    return getActivityLogPath();
  }

  static record(input: RecordInput): ActivityEvent {
    const event: ActivityEvent = {
      id: randomUUID(),
      occurredAt: input.occurredAt ?? Date.now(),
      category: input.category,
      action: input.action,
      target: input.target ?? null,
      outcome: input.outcome ?? 'info',
      message: input.message,
      metadata: input.metadata ?? null,
    };

    const filePath = getActivityLogPath();
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    pruneActivityFileIfNeeded(filePath);
    return event;
  }

  static list(options?: {
    limit?: number;
    offset?: number;
    categories?: ActivityEventCategory[];
  }): ActivityEventListResult {
    const filePath = getActivityLogPath();
    if (!fs.existsSync(filePath)) {
      return {
        events: [],
        nextOffset: null,
        total: 0,
      };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const events = parseActivityLines(content.split(/\r?\n/)).sort(
      (left, right) => right.occurredAt - left.occurredAt,
    );

    const filtered = options?.categories?.length
      ? events.filter((event) => options.categories?.includes(event.category))
      : events;
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
    const offset = Math.max(0, options?.offset ?? 0);
    const slice = filtered.slice(offset, offset + limit);
    const nextOffset = offset + limit < filtered.length ? offset + limit : null;

    return {
      events: slice,
      nextOffset,
      total: filtered.length,
    };
  }

  static clearForTesting(): void {
    const filePath = getActivityLogPath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
