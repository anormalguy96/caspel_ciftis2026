import { AnalyticsEventPayload } from '../types';
import { apiUrl } from '../config/paths';

const SESSION_STORAGE_KEY = 'caspel_ciftis_sid';

export function getSessionId(): string {
  let sid = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!sid) {
    sid = 'ciftis_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
    sessionStorage.setItem(SESSION_STORAGE_KEY, sid);
  }
  return sid;
}

export async function trackAnalyticsEvent(
  eventName: string,
  product?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const sessionId = getSessionId();
  const payload: AnalyticsEventPayload = {
    session_id: sessionId,
    event_name: eventName,
    product,
    metadata,
  };

  try {
    await fetch(apiUrl('events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Analytics failure should be silent and never degrade user experience
  }
}
