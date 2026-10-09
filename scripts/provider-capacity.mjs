/**
 * Classify only the LAST completed model request in a single router session.
 * Scanning the full log for "429"/"503" can incorrectly turn a genuine Canary
 * assertion failure into a provider fallback after an earlier recovered error.
 *
 * Input is kept in memory and never uploaded as portable evidence.
 */
export function terminalModelRequestStatus(routerLog) {
  const modelRequests = new Set();
  let lastCompleted;
  for (const line of routerLog.split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.reqId && event.req?.url?.startsWith('/v1/messages')) {
      modelRequests.add(event.reqId);
    }
    if (event.reqId && modelRequests.has(event.reqId) && Number.isInteger(event.res?.statusCode)) {
      lastCompleted = event.res.statusCode;
    }
  }
  return lastCompleted;
}

export function isTerminalProviderCapacityFailure(routerLog) {
  return [429, 503].includes(terminalModelRequestStatus(routerLog));
}

/**
 * Prefer providers that can tolerate the large context sent by Claude Code.
 * Groq is last-resort because its free tier may itself reject large contexts.
 */
export function configuredProviderOrder(configured) {
  return ['gemini', 'openrouter', 'groq'].filter((provider) => configured[provider] === true);
}

/** Only a definite provider capacity/availability failure is eligible for fallback. */
export function canFallbackAfter(result, hasNext) {
  return hasNext && result.ok === false && result.capacityFailure === true;
}
