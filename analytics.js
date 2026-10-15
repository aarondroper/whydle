// Anonymous aggregate analytics (D-041). Everything about "has this browser been
// here before?" is decided on this device from local state; the server only ever
// receives a coarse event and adds one to a counter. Nothing here can throw into
// the game: every public function swallows its own failures.

export const ENDPOINT = "https://analytics.whydle.app/event";
const KEY = "whydle-analytics-v1";
const KEEP_DAYS = 7; // local state is pruned to the last few puzzle numbers
const MAX_PART = 32;
const MAX_HOST = 60;

// ---------- privacy controls ----------

// Global Privacy Control or Do Not Track switched on: send nothing, store nothing.
export function privacySignalOn(nav) {
  return nav?.globalPrivacyControl === true || nav?.doNotTrack === "1" || nav?.doNotTrack === "yes";
}

// ---------- acquisition source ----------

function cleanTag(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, MAX_PART);
}

// "utm:reddit/social/indiedev", "ref:news.ycombinator.com" or "direct".
// Only whitelisted UTM parameters and the referrer's hostname are ever read.
export function sourceFromVisit(search, referrer, ownHost) {
  try {
    const params = new URLSearchParams(search);
    const source = cleanTag(params.get("utm_source"));
    if (source) {
      const parts = [source, cleanTag(params.get("utm_medium")), cleanTag(params.get("utm_campaign"))];
      while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
      return `utm:${parts.join("/")}`;
    }
  } catch {}
  try {
    if (referrer) {
      const url = new URL(referrer);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      const plain = /^[a-z0-9.-]+$/.test(host) && !/^[\d.]+$/.test(host); // no IPs
      const own = host === String(ownHost).toLowerCase().replace(/^www\./, "");
      if (/^https?:$/.test(url.protocol) && plain && !own && host.length <= MAX_HOST) return `ref:${host}`;
    }
  } catch {}
  return "direct";
}

// ---------- the tracker ----------

// storage: localStorage-like. send: (payload) => void. history: the game's existing
// progress, used so players from before analytics existed aren't counted as new:
//   { hasPlayed(): bool, started(n): bool }  (a puzzle guessed on, solved(n): solved on its own day)
export function createAnalytics({ enabled = true, storage, send, source = "direct", history }) {
  const read = () => {
    try {
      const saved = JSON.parse(storage.getItem(KEY) || "null");
      if (saved && saved.v === 1) return saved;
    } catch {}
    return null;
  };

  // Atomic-enough check-and-set: re-reads storage each time (so two tabs rarely both
  // win) and marks BEFORE sending, so a retry or reload can never send twice. An
  // event whose marker can't be saved is not sent at all: without storage there's
  // no way to count once per day.
  function claim(list, number, mutate) {
    const state = read() ?? { v: 1, visited: [], started: [], completed: [], shared: [] };
    if (state[list].includes(number)) return null;
    mutate?.(state);
    state[list].push(number);
    for (const name of ["visited", "started", "completed", "shared"]) {
      state[name] = state[name].filter((value) => value > number - KEEP_DAYS);
    }
    try {
      storage.setItem(KEY, JSON.stringify(state));
      if (read() === null) return null;
    } catch {
      return null;
    }
    return state;
  }

  const has = (list, number) => read()?.[list].includes(number) ?? false;

  const guarded = (action) => {
    if (!enabled) return;
    try {
      action();
    } catch {}
  };

  const transmit = (payload) => {
    try {
      send(payload);
    } catch {}
  };

  return {
    // At most once per puzzle day per browser.
    trackDailyVisit(number) {
      guarded(() => {
        const before = read();
        const isNew = before === null && !history.hasPlayed();
        const playedYesterday = (before?.started.includes(number - 1) ?? false) || history.started(number - 1);
        const returnedNextDay = playedYesterday || (before?.visited.includes(number - 1) ?? false) || history.solved(number - 1);
        const state = claim("visited", number, (next) => {
          // Mid-puzzle when analytics first shipped: don't count a "start" that happened before.
          if (history.started(number) && !next.started.includes(number)) next.started.push(number);
          if (history.solved(number) && !next.completed.includes(number)) next.completed.push(number);
        });
        if (!state) return;
        transmit({
          event: "daily_visit",
          puzzle: number,
          visitor: isNew ? "new" : "returning",
          returned_next_day: returnedNextDay,
          played_yesterday: playedYesterday,
          source,
        });
      });
    },

    // First locked-in guess on today's puzzle.
    trackPuzzleStarted(number) {
      guarded(() => {
        if (claim("started", number)) transmit({ event: "puzzle_started", puzzle: number });
      });
    },

    // The puzzle was solved (the only way to finish). Only counted if it was started
    // as the daily puzzle, so archive plays never count and completed <= started.
    trackPuzzleCompleted(number, outcome = "solved") {
      guarded(() => {
        if (!has("started", number)) return;
        if (claim("completed", number)) transmit({ event: "puzzle_completed", puzzle: number, outcome });
      });
    },

    // A share that actually went out; at most once per puzzle. No share text is sent.
    trackShare(number) {
      guarded(() => {
        if (!has("completed", number)) return;
        if (claim("shared", number)) transmit({ event: "share", puzzle: number });
      });
    },
  };
}

// The real transport: fire and forget, no cookies, no referrer, never awaited.
export function httpSend(payload, fetchFn = globalThis.fetch) {
  fetchFn(ENDPOINT, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "text/plain;charset=UTF-8" }, // a "simple" request: no preflight
    keepalive: true,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }).catch(() => {});
}
