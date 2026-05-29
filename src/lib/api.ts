const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthenticated');
  }
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// Feed
export const fetchFeed = (patientId: string) =>
  request<FeedItem[]>(`/feed/${patientId}`);

// Appointments
export const fetchAppointments = (patientId: string) =>
  request<Appointment[]>(`/appointments/${patientId}`);

export const createAppointment = (data: CreateAppointmentInput) =>
  request<Appointment>('/appointments', { method: 'POST', body: JSON.stringify(data) });

export const exportIcal = (id: string) =>
  window.open(`${BASE_URL}/appointments/${id}/ical`, '_blank');

// Medications
export const fetchMedications = (patientId: string) =>
  request<Medication[]>(`/medications/${patientId}`);

// Documents
export const fetchDocuments = (patientId: string) =>
  request<Pick<Document, 'id' | 'filename' | 'processingStatus' | 'uploadedAt'>[]>(
    `/documents/list/${patientId}`
  );

export const fetchDocument = (id: string) =>
  request<Document>(`/documents/${id}`);

export const uploadDocument = async (
  patientId: string,
  file: File,
  analysisType = 'BALANCED'
): Promise<{ documentId: string }> => {
  const form = new FormData();
  form.append('file', file);
  form.append('patientId', patientId);
  form.append('analysisType', analysisType);
  const res = await fetch(`${BASE_URL}/documents/upload`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthenticated');
  }
  if (!res.ok) throw new Error(`Upload failed ${res.status}`);
  return res.json();
};

// Review AI-extracted items
export const reviewAppointment = (id: string, action: 'confirm' | 'reject') =>
  request<Appointment>(`/appointments/${id}/review`, { method: 'PATCH', body: JSON.stringify({ action }) });

export const reviewMedication = (id: string, action: 'confirm' | 'reject') =>
  request<Medication>(`/medications/${id}/review`, { method: 'PATCH', body: JSON.stringify({ action }) });

// Comments
export const createComment = (data: CreateCommentInput) =>
  request<Comment>('/comments', { method: 'POST', body: JSON.stringify(data) });

export const fetchComments = (entityType: string, entityId: string) =>
  request<Comment[]>(`/comments/${entityType}/${entityId}`);

// Me — current user with memberships
export const fetchMe = () => request<MeResponse>('/me');

// Family
export const fetchFamily = (patientId: string) =>
  request<FamilyMember[]>(`/family/${patientId}`);

// SSE helper — returns a cleanup function
export function subscribeToFeed(
  patientId: string,
  onEvent: (event: SSEEvent) => void
): () => void {
  const es = new EventSource(`${BASE_URL}/feed/events/${patientId}`, {
    withCredentials: true,
  });
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      // ignore malformed events
    }
  };
  return () => es.close();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface FeedItem {
  type: 'appointment' | 'medication' | 'document';
  createdAt: string;
  data: Appointment | Medication | Document;
}

export interface Appointment {
  id: string;
  patientId: string;
  title: string;
  doctor?: string;
  specialty?: string;
  datetime: string;
  location?: string;
  notes?: string;
  source: 'MANUAL' | 'AI_EXTRACTED';
  reviewStatus: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  sourceDocumentId?: string;
  createdAt: string;
}

export interface Medication {
  id: string;
  patientId: string;
  name: string;
  dosage?: string;
  frequency?: string;
  prescribingDoctor?: string;
  aiDescription?: string;
  aiSideEffects?: string;
  source: 'MANUAL' | 'AI_EXTRACTED';
  reviewStatus: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  active: boolean;
  createdAt: string;
  interactionsA: MedicationInteraction[];
  interactionsB: MedicationInteraction[];
}

export interface MedicationInteraction {
  id: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE';
  description: string;
  medicationA?: Medication;
  medicationB?: Medication;
}

export interface Document {
  id: string;
  patientId: string;
  filename: string;
  fileUrl: string;
  processingStatus: ProcessingStatus;
  aiSummary?: string;
  aiQuestions?: string[];
  uploadedAt: string;
  appointments?: Appointment[];
  medications?: Medication[];
  comments?: Comment[];
}

export type ProcessingStatus =
  | 'PENDING'
  | 'EXTRACTING'
  | 'SIMPLIFYING'
  | 'CHECKING_INTERACTIONS'
  | 'GENERATING_QUESTIONS'
  | 'COMPLETE'
  | 'FAILED';

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: User;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export type MemberRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface PatientMembership {
  id: string;
  role: MemberRole;
  patient: { id: string; name: string };
}

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  memberships: PatientMembership[];
}

export interface FamilyMember {
  id: string;
  role: MemberRole;
  createdAt: string;
  user: User;
}

export interface CreateAppointmentInput {
  patientId: string;
  title: string;
  doctor?: string;
  specialty?: string;
  datetime: string;
  location?: string;
  notes?: string;
}

export interface CreateCommentInput {
  body: string;
  documentId?: string;
  appointmentId?: string;
  medicationId?: string;
}

export interface SSEEvent {
  type: 'pipeline' | 'feed_refresh';
  documentId?: string;
  step?: ProcessingStatus;
  appointmentsAdded?: number;
  medicationsAdded?: number;
  patientId?: string;
}
