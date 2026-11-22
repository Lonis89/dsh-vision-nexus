export class PanelStats {
    dayKey = '';
    todayCalls = 0;
    todayDegrades = 0;
    sumConfidence = 0;
    confidenceSamples = 0;
    queuedTasks = 0;
    runningTasks = 0;
    /** 记录一次工具审计结果（由 AuditLog 提交后调用）。 */
    record(rec) {
        this.rollDay();
        this.todayCalls++;
        if (rec.degraded)
            this.todayDegrades++;
        if (rec.status === 'ok') {
            this.sumConfidence += rec.confidence;
            this.confidenceSamples++;
        }
    }
    /** 由 SessionManager 的并发状态驱动。 */
    setLoad(queued, running) {
        this.queuedTasks = Math.max(0, queued);
        this.runningTasks = Math.max(0, running);
    }
    snapshot() {
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
    rollDay() {
        const key = new Date().toISOString().slice(0, 10);
        if (key === this.dayKey)
            return;
        this.dayKey = key;
        this.todayCalls = 0;
        this.todayDegrades = 0;
        this.sumConfidence = 0;
        this.confidenceSamples = 0;
    }
}
