import { LeadFormData, ChatSource } from '../types';

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

export async function submitLead(data: LeadFormData): Promise<LeadApiResponse> {
  const response = await fetch('/api/leads', {
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
      // fallback to generic message
    }
    throw new Error(errorDetail);
  }

  return response.json();
}

export async function sendChatMessage(sessionId: string, message: string): Promise<ChatApiResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message }),
  });

  if (!response.ok) {
    throw new Error('Chat service encountered a network issue.');
  }

  return response.json();
}
