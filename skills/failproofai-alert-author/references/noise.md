# Noise — reading a replay and repairing once

A replay gives: fires in 7 days, fires in 30 days, the last time it fired, and the
distribution of the alert's own per-check value (p50 / p95 / p99 / max). One page per hour
at most while the condition keeps breaching (whoever is paged resolves it; if it is still
true, it pages again).

| verdict | when | repair (pick ONE, smallest change first) |
|---|---|---|
| noisy | > 1 fire/day over 7 days (or the user's target) | raise the threshold toward the p99 of the per-check value; require "2 of 3" / "3 of 3"; lengthen the window (15m → 1h smooths bursts); for an `error` alert on a busy signal, switch to a count with a threshold (`query`, or `metric` when no agent is involved) |
| silent | 0 fires in 30 days and the user named no number | lower the threshold to just under the observed max / p99.9; check the filters match real names (an env or agent the org does not have matches nothing) |
| broken | the query errors | fix the predicate's columns (see `triggers` for the column list) |
| ok | within target and fired at least once in 30 days (or the user's number) | keep it |

Rules:
- Repair in place: keep the trigger, filters and names the user asked for; change the one
  thing the replay points at. Never redraft from scratch.
- A threshold the user NAMED stays. If it is noisy, keep it and tighten "sure" or the
  window instead, and say what it would do.
- Silence is fine when the condition genuinely never happened (a score that has never
  dropped below the user's line): say so instead of loosening it.
- An error RATE needs volume: 1 error in 2 events is 50%. The replay widens a rate
  alert's window (to 1h, 6h, 24h) until nearly every check sees ≥ 20 events and says so;
  if even 24h is too thin, use an error count instead.
- Report the replay with the draft: "would have fired N× in 7 days (last: …)".
