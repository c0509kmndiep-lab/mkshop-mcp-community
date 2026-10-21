// One timer, named tasks run in order; a throwing task is reported once and never blocks the ones after it (the permission clicker must survive a UI render error).
class PageLoop {
  constructor(intervalMs, tasks) {
    this.intervalMs = intervalMs;
    this.tasks = tasks;
    this.lastError = {};
  }

  start() {
    this.tick();
    window.__pmMasterInterval = setInterval(() => this.tick(), this.intervalMs);
  }

  tick() {
    for (const [name, run] of this.tasks) {
      try {
        run();
      } catch (e) {
        const signature = String(e && e.message);
        if (this.lastError[name] !== signature) console.error(`[⚡ AutoRun] task "${name}" failed:`, e);
        this.lastError[name] = signature;
      }
    }
  }
}
