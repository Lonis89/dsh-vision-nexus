/**
 * dsh-vision-nexus — 面板实时统计聚合
 *
 * 轻量、进程内的调用计数器：按「今日」聚合 vision_* 工具调用次数、
 * 降级次数、置信度均值、队列/运行任务数。供设置面板「当前运行状态」展示。
 * 不落盘、不含任何敏感信息；跨会话计数只汇总数量，不记录内容。
 */
import type { AuditRecord } from '../types.js';

export interface StatsSnapshot {
  todayCalls: number;
  todayDegrades: number;
  avgConfidence: number;
  sumConfidence: number;
  confidenceSamples: number;
  queuedTasks: number;
  runningTasks: number;
}

export class PanelStats {
  private dayKey = '';
  private todayCalls = 0;
  private todayDegrades = 0;
  private sumConfidence = 0;
  private confidenceSamples = 0;
  private queuedTasks = 0;
  private runningTasks = 0;

  /** 记录一次工具审计结果（由 AuditLog 提交后调用）。 */
  record(rec: AuditRecord): void {
    this.rollDay();
    this.todayCalls++;
    if (rec.degraded) this.todayDegrades++;
    if (rec.status === 'ok') {
      this.sumConfidence += rec.confidence;
      this.confidenceSamples++;
    }
  }

  /** 由 SessionManager 的并发状态驱动。 */
  setLoad(queued: number, running: number): void {
    this.queuedTasks = Math.max(0, queued);
    this.runningTasks = Math.max(0, running);
  }

  snapshot(): StatsSnapshot {
    this.rollDay();
    return {
      todayCalls: this.todayCalls,
      todayDegrades: this.todayDegrades,
      avgConfidence: this.confidenceSamples ? this.sumConfidence / this.confidenceSamples : 0,
      sumConfidence: this.sumConfidence,
      confidenceSamples: this.confidenceSamples,
      queuedTasks: this.queuedTasks,
      runningTasks: this.runningTasks,
    };
  }

  private rollDay(): void {
    const key = new Date().toISOString().slice(0, 10);
    if (key === this.dayKey) return;
    this.dayKey = key;
    this.todayCalls = 0;
    this.todayDegrades = 0;
    this.sumConfidence = 0;
    this.confidenceSamples = 0;
  }
}
