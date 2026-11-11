/** Détection des changements de « page » sans rechargement (SPA) : Navigation API, popstate/hashchange et, à défaut, surveillance de l'URL. */
export class RouteWatcher {
  private last = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private cleanup: Array<() => void> = [];
  constructor(private win: Window, private onChange: () => void, private debounceMs = 350, private pollMs = 1000) {}

  start(): void {
    this.last = this.win.location.href;
    const fire = () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.last = this.win.location.href; this.onChange(); }, this.debounceMs);
    };
    const nav = (this.win as any).navigation;
    if (nav?.addEventListener) { nav.addEventListener("navigatesuccess", fire); this.cleanup.push(() => nav.removeEventListener("navigatesuccess", fire)); }
    for (const ev of ["popstate", "hashchange"]) { this.win.addEventListener(ev, fire); this.cleanup.push(() => this.win.removeEventListener(ev, fire)); }
    if (!nav) this.poll = setInterval(() => { if (this.win.location.href !== this.last) fire(); }, this.pollMs);
  }
  stop(): void {
    for (const c of this.cleanup) c();
    this.cleanup = [];
    if (this.timer) clearTimeout(this.timer);
    if (this.poll) clearInterval(this.poll);
    this.timer = this.poll = null;
  }
}
