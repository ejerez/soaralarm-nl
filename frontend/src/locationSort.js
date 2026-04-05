/**
 * Shared location ranking logic.
 *
 * Sort hierarchy (best first):
 *   1. Confidence score   – higher is better
 *   2. Priority           – lower is better
 *   3. Good heading hours – higher is better  (good + gusty)
 *   4. Flyable hours      – higher is better  (good + gusty + cross + cross_gusty)
 */

/** Compare two scored locations.  Returns < 0 when a is better. */
export function compareLocations(a, b) {
  return (b.agree - a.agree)
      || (a.priority - b.priority)
      || (b.quality - a.quality)
      || (b.fly - a.fly)
}

/** Return the index of the best location for a day (only considers locations with flyable hours). */
export function findBestLocationIndex(dayPf, certDi, points) {
  let best = 0, bestScore = null
  dayPf.forEach((pf, pi) => {
    const fly = pf.good_hours + pf.cross_hours + pf.gusty_hours + pf.cross_gusty_hours
    if (fly <= 0) return
    const score = {
      agree:    certDi?.by_point?.[pi] ?? certDi?.agree ?? 0,
      priority: points[pi]?.priority ?? 0,
      quality:  pf.good_hours + pf.gusty_hours,
      fly,
    }
    if (!bestScore || compareLocations(score, bestScore) < 0) {
      bestScore = score; best = pi
    }
  })
  return best
}
