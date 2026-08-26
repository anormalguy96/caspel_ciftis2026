import { LeadFormData, ChatSource } from '../types';
import { apiUrl } from '../config/paths';

export interface LeadApiResponse {
  success: boolean;
  message: string;
  id?: number;
}

export interface ChatApiResponse {
  answer: string;
  sources: ChatSource[];
  session_id: string;
}

/**
 * The assistant's backing provider is down, rate limited, or misconfigured.
 *
 * The server answers 503 for these rather than wrapping an apology in a 200,
 * so the UI can offer a retry instead of presenting a failure as an answer.
 */
export class ChatUnavailableError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('CASPEL AI is temporarily unavailable.');
    this.name = 'ChatUnavailableError';
    this.status = status;
  }
}

/** Too many questions from one visitor in a short window. */
export class ChatRateLimitedError extends Error {
  constructor() {
    super('Too many questions in a short time. Please wait a moment and try again.');
    this.name = 'ChatRateLimitedError';
  }
}

export async function submitLead(data: LeadFormData): Promise<LeadApiResponse> {
  const response = await fetch(apiUrl('leads'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    let errorDetail = 'Failed to submit request. Please check your inputs.';
    try {
      const errJson = await response.json();
      if (errJson.detail) {
        if (typeof errJson.detail === 'string') {
          errorDetail = errJson.detail;
        } else if (Array.isArray(errJson.detail)) {
          errorDetail = errJson.detail.map((d: { msg?: string }) => d.msg || '').join(', ');
        }
      }
    } catch {
      // Keep the generic message; a non-JSON error body tells the visitor nothing.
    }
    throw new Error(errorDetail);
  }

  return response.json();
}

export async function sendChatMessage(sessionId: string, message: string): Promise<ChatApiResponse> {
  const response = await fetch(apiUrl('chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message }),
  });

  if (response.status === 429) throw new ChatRateLimitedError();
  if (!response.ok) throw new ChatUnavailableError(response.status);

  return response.json();
}
