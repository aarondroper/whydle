// Pure daily-puzzle and stats logic (D-019, D-020). No DOM, no storage access.

const MS_PER_DAY = 86_400_000;

// "2026-10-01" -> days since the Unix epoch, for a calendar date (no time zone).
function epochDay(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

// The player's local calendar date as "YYYY-MM-DD" (D-019: local midnight rollover).
export function localIsoDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Puzzle number for a date: 1 on the launch date. Zero or negative before launch.
export function puzzleNumber(isoDate, launchDate) {
  return epochDay(isoDate) - epochDay(launchDate) + 1;
}

export function dateOfPuzzle(number, launchDate) {
  const date = new Date((epochDay(launchDate) + number - 1) * MS_PER_DAY);
  return date.toISOString().slice(0, 10);
}

// Milliseconds until the next local midnight.
export function msUntilTomorrow(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight - now;
}

// Stats from completed daily games: { [puzzleNumber]: tries }.
// Archive plays are stored elsewhere and never count here.
export function computeStats(completed, today) {
  const numbers = Object.keys(completed).map(Number).sort((a, b) => a - b);
  const distribution = [0, 0, 0, 0, 0];
  let totalTries = 0;
  for (const number of numbers) {
    const tries = completed[number];
    distribution[Math.min(tries, 5) - 1] += 1;
    totalTries += tries;
  }
  const played = numbers.length;

  let maxStreak = 0;
  let run = 0;
  let previous = null;
  for (const number of numbers) {
    run = previous !== null && number === previous + 1 ? run + 1 : 1;
    maxStreak = Math.max(maxStreak, run);
    previous = number;
  }

  // The current streak survives until today's puzzle is missed: it may end
  // today (already played) or yesterday (today not yet played).
  let currentStreak = 0;
  let cursor = completed[today] !== undefined ? today : today - 1;
  while (completed[cursor] !== undefined) {
    currentStreak += 1;
    cursor -= 1;
  }

  return {
    played,
    firstTryPercent: played ? Math.round((distribution[0] / played) * 100) : 0,
    averageTries: played ? Math.round((totalTries / played) * 10) / 10 : 0,
    distribution,
    currentStreak,
    maxStreak,
  };
}
