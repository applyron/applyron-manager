import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { TokenManagerService } from './token-manager.service';
import { GeminiClient } from './clients/gemini.client';
import { GeminiController } from './gemini.controller';
import { ProxyGuard } from './proxy.guard';
import { ProxyAccountCacheService } from './proxy-account-cache.service';
import { ProxyRateLimitService } from './proxy-rate-limit.service';
import { ProxySchedulingService } from './proxy-scheduling.service';
import { ProxyMetricsRegistry } from './proxy-metrics.registry';

@Module({
  imports: [],
  controllers: [ProxyController, GeminiController],
  providers: [
    ProxyService,
    TokenManagerService,
    ProxyAccountCacheService,
    ProxyRateLimitService,
    ProxySchedulingService,
    ProxyMetricsRegistry,
    GeminiClient,
    ProxyGuard,
  ],
  exports: [TokenManagerService, ProxyMetricsRegistry],
})
export class ProxyModule {}
