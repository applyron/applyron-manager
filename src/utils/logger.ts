import fs from 'fs';
import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getAgentDir } from './paths';
import { safeStringifyPacket, sanitizeObject } from './sensitiveDataMasking';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const LOG_WINDOW_MS = 30_000;
const MAX_LOG_ENTRIES = 200;
const LOG_RETENTION = '7d';
const LOG_MAX_SIZE = '10m';
const BEARER_TOKEN_PATTERN = /(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const INLINE_SECRET_PATTERN =
  /(\b(?:api[_-]?key|token|client[_-]?secret|refresh[_-]?token|access[_-]?token|authorization|password|secret|cookie|session[_-]?id)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  formatted: string;
}

function sanitizeLogText(value: string): string {
  const sanitized = sanitizeObject(value);
  const baseText =
    typeof sanitized === 'string' ? sanitized : safeStringifyPacket(sanitized ?? '[REDACTED]');

  return baseText
    .replace(BEARER_TOKEN_PATTERN, '$1 [REDACTED]')
    .replace(INLINE_SECRET_PATTERN, '$1[REDACTED]');
}

function stringifyLogArg(value: unknown): string {
  if (value instanceof Error) {
    return safeStringifyPacket({
      name: value.name,
      message: sanitizeLogText(value.message),
      stack: value.stack ? sanitizeLogText(value.stack) : undefined,
    });
  }

  if (typeof value === 'string') {
    return sanitizeLogText(value);
  }

  if (typeof value === 'object') {
    return safeStringifyPacket(value);
  }

  return String(value);
}

class Logger {
  private winstonLogger: winston.Logger;
  private recentLogs: LogEntry[] = [];

  constructor() {
    const agentDir = getAgentDir();

    if (!fs.existsSync(agentDir)) {
      try {
        fs.mkdirSync(agentDir, { recursive: true });
      } catch (e) {
        console.error('Failed to create agent directory for logs', e);
      }
    }

    const fileFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
      }),
    );

    const consoleFormat = winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.printf(({ level, message }) => {
        return `[${level.toUpperCase()}] ${message}`;
      }),
    );

    const rotateTransport = new DailyRotateFile({
      filename: path.join(agentDir, 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_RETENTION,
      zippedArchive: false,
      auditFile: path.join(agentDir, '.app-log-audit.json'),
      level: 'debug',
      format: fileFormat,
    });

    rotateTransport.on('error', (error) => {
      console.error('DailyRotateFile transport error', error);
    });

    const consoleTransport = new winston.transports.Console({
      level: 'debug',
      format: consoleFormat,
    });

    consoleTransport.on('error', (error) => {
      console.error('Console transport error', error);
    });

    this.winstonLogger = winston.createLogger({
      level: 'debug',
      transports: [consoleTransport, rotateTransport],
      exitOnError: false,
    });
  }

  private pruneLogs(now: number) {
    const cutoffIndex = this.recentLogs.findIndex(
      (entry) => now - entry.timestamp <= LOG_WINDOW_MS,
    );

    if (cutoffIndex === -1) {
      this.recentLogs.length = 0;
    } else if (cutoffIndex > 0) {
      this.recentLogs.splice(0, cutoffIndex);
    }

    if (this.recentLogs.length > MAX_LOG_ENTRIES) {
      this.recentLogs.splice(0, this.recentLogs.length - MAX_LOG_ENTRIES);
    }
  }

  private formatArgs(args: unknown[]): string {
    return args.map((arg) => stringifyLogArg(arg)).join(' ');
  }

  log(level: LogLevel, message: string, ...args: unknown[]) {
    const formattedArgs = this.formatArgs(args);
    const mergedMessage = formattedArgs
      ? `${sanitizeLogText(message)} ${formattedArgs}`
      : sanitizeLogText(message);
    const now = Date.now();
    const formattedMessage = `[${new Date(now).toISOString()}] [${level.toUpperCase()}] ${mergedMessage}`;

    this.recentLogs.push({
      timestamp: now,
      level,
      message: mergedMessage,
      formatted: formattedMessage,
    });
    this.pruneLogs(now);

    this.winstonLogger.log({
      level,
      message: mergedMessage,
    });
  }

  info(message: string, ...args: unknown[]) {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]) {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]) {
    this.log('error', message, ...args);
  }

  debug(message: string, ...args: unknown[]) {
    this.log('debug', message, ...args);
  }
}

export const logger = new Logger();
