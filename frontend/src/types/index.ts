export type ProductSlug = 'caspel' | 'erp' | 'pms' | 'irissea';

export interface ProductConfig {
  slug: ProductSlug;
  name: string;
  descriptor: string;
  description: string;
  presentationUrl: string;
  downloadFilename: string;
}

export interface LeadFormData {
  name: string;
  company: string;
  business_email: string;
  interest: string;
  message?: string;
  honeypot?: string;
}

export interface ChatSource {
  document: string;
  product?: string;
  page: number;
  /** Presentation registry slug, supplied and validated by the server. */
  slug?: string;
  score?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  timestamp: string;
}

export interface AnalyticsEventPayload {
  session_id: string;
  event_name: string;
  product?: string;
  metadata?: Record<string, unknown>;
}
