# Havenhold — Implementation Plan

> **"Care, together."**
> A family care coordination platform for managing an elderly parent's health — appointments, medications, doctor's notes, and family communication in one shared space.

---

## Context

This is an MVP. It does not need to be production-ready, but should demonstrate:
- Multi-step AI pipeline design (not just a single prompt)
- Thoughtful frontend architecture
- Engineering tradeoffs worth discussing

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Already scaffolded |
| Styling | Tailwind CSS + shadcn/ui |
| Data fetching | TanStack Query | Already in project |
| Routing | React Router v6 | Already in project |
| Backend | Express + TypeScript |
| ORM | Prisma | Best DX for Postgres + TypeScript |
| Database | PostgreSQL (Docker) | `docker compose up -d` |
| AI | Anthropic Claude API | Multi-step pipeline |
| File upload | Multer | Doctor's note upload |
| Real-time | SSE (Server-Sent Events) | Simpler than WebSockets for server → client updates |
| Icons | Lucide React | Already in project |

---

## Data Model (Prisma)

```prisma
model User {
  id           String         @id @default(cuid())
  name         String
  email        String         @unique
  role         Role           @default(FAMILY_MEMBER)
  avatarUrl    String?
  createdAt    DateTime       @default(now())
  comments     Comment[]
  patient      Patient?       @relation(fields: [patientId], references: [id])
  patientId    String?
}

enum Role {
  PRIMARY_CAREGIVER
  FAMILY_MEMBER
}

model Patient {
  id           String         @id @default(cuid())
  name         String
  dateOfBirth  DateTime?
  createdAt    DateTime       @default(now())
  users        User[]
  appointments Appointment[]
  medications  Medication[]
  documents    Document[]
  interactions MedicationInteraction[]
}

model Appointment {
  id               String    @id @default(cuid())
  patientId        String
  patient          Patient   @relation(fields: [patientId], references: [id])
  title            String
  doctor           String?
  specialty        String?
  datetime         DateTime
  location         String?
  notes            String?
  source           Source    @default(MANUAL)
  sourceDocumentId String?
  document         Document? @relation(fields: [sourceDocumentId], references: [id])
  createdAt        DateTime  @default(now())
  comments         Comment[]
}

model Medication {
  id               String    @id @default(cuid())
  patientId        String
  patient          Patient   @relation(fields: [patientId], references: [id])
  name             String
  dosage           String?
  frequency        String?
  prescribingDoctor String?
  aiDescription    String?   // plain-language explanation
  aiSideEffects    String?   // AI-generated side effects summary
  source           Source    @default(MANUAL)
  sourceDocumentId String?
  document         Document? @relation(fields: [sourceDocumentId], references: [id])
  active           Boolean   @default(true)
  createdAt        DateTime  @default(now())
  comments         Comment[]
  interactionsA    MedicationInteraction[] @relation("MedicationA")
  interactionsB    MedicationInteraction[] @relation("MedicationB")
}

model MedicationInteraction {
  id            String   @id @default(cuid())
  patientId     String
  patient       Patient  @relation(fields: [patientId], references: [id])
  medicationAId String
  medicationA   Medication @relation("MedicationA", fields: [medicationAId], references: [id])
  medicationBId String
  medicationB   Medication @relation("MedicationB", fields: [medicationBId], references: [id])
  severity      Severity
  description   String
  checkedAt     DateTime @default(now())
}

enum Severity {
  MILD
  MODERATE
  SEVERE
}

model Document {
  id               String            @id @default(cuid())
  patientId        String
  patient          Patient           @relation(fields: [patientId], references: [id])
  filename         String
  fileUrl          String
  processingStatus ProcessingStatus  @default(PENDING)
  aiSummary        String?
  aiQuestions      Json?             // string[]
  rawText          String?           // extracted text (de-identified before AI)
  uploadedAt       DateTime          @default(now())
  comments         Comment[]
  appointments     Appointment[]
  medications      Medication[]
}

enum ProcessingStatus {
  PENDING
  EXTRACTING
  SIMPLIFYING
  CHECKING_INTERACTIONS
  GENERATING_QUESTIONS
  COMPLETE
  FAILED
}

enum Source {
  MANUAL
  AI_EXTRACTED
}

model Comment {
  id             String       @id @default(cuid())
  authorId       String
  author         User         @relation(fields: [authorId], references: [id])
  body           String
  createdAt      DateTime     @default(now())
  documentId     String?
  document       Document?    @relation(fields: [documentId], references: [id])
  appointmentId  String?
  appointment    Appointment? @relation(fields: [appointmentId], references: [id])
  medicationId   String?
  medication     Medication?  @relation(fields: [medicationId], references: [id])
}
```

---

## AI Pipeline

The crown jewel of the demo. Triggered on document upload.

```
[Upload] Doctor's note (PDF or image)
    ↓
[Pre-process] De-identification — strip PHI patterns (SSN, phone, email, dates) server-side before any AI call
    ↓
[Step 1] EXTRACTING — Claude extracts structured data as JSON:
         { appointments[], medications[], diagnosis, instructions }
         → auto-creates Appointment + Medication records (source: AI_EXTRACTED)
    ↓
[Step 2] SIMPLIFYING — Claude rewrites each section in plain language
         → stored as document.aiSummary
    ↓
[Step 3] CHECKING_INTERACTIONS — Claude cross-references new medications
         against patient's existing medication list
         → stored as MedicationInteraction records
    ↓
[Step 4] GENERATING_QUESTIONS — Claude generates "questions to ask your doctor"
         based on the full note + medication context
         → stored as document.aiQuestions
    ↓
[Complete] SSE event pushed to all family members → feed updates live
```

**Key design decisions to discuss in interview:**
- Steps 1–4 are separate prompts, not one. Step 1 produces structured data; steps 2–4 reason over it. Separating extraction from interpretation improves reliability.
- Step 3 requires patient's full medication list as context — not just the current note. Cross-document reasoning.
- De-identification happens before any network call to Claude. Production path: Anthropic BAA.
- `processingStatus` on Document drives the pipeline visualization UI — each step updates it, SSE pushes the change.
- Failed step: mark document as FAILED, surface error to user, allow retry.

---

## API Endpoints

### Documents
```
POST   /api/documents/upload          — upload + trigger AI pipeline
GET    /api/documents/:id             — fetch document with AI results
GET    /api/documents/events/:patientId — SSE stream for pipeline status

```

### Appointments
```
GET    /api/appointments/:patientId   — list appointments
POST   /api/appointments             — create manually
PATCH  /api/appointments/:id         — update
GET    /api/appointments/:id/ical    — export single appointment as .ics
```

### Medications
```
GET    /api/medications/:patientId    — list with interactions
POST   /api/medications              — create manually
PATCH  /api/medications/:id          — update
```

### Feed
```
GET    /api/feed/:patientId          — unified timeline (appointments + documents + medications)
GET    /api/feed/events/:patientId   — SSE stream for new feed items
```

### Comments
```
POST   /api/comments                 — add comment to any entity
GET    /api/comments/:entityType/:entityId
```

### Family
```
GET    /api/family/:patientId        — list family members
POST   /api/family/invite            — invite by email
```

---

## Frontend Pages (already scaffolded)

| Page | Key work needed |
|---|---|
| `FeedPage` | Connect to `/api/feed`, SSE subscription for live updates, render feed cards |
| `DocumentUploadPage` | File upload, trigger pipeline, poll/SSE for `processingStatus`, animated step cards |
| `DocumentDetailPage` | AI summary sections, extracted appointments/medications, threaded comments |
| `AppointmentsPage` | Fetch from API, iCal export button |
| `MedicationsPage` | Fetch from API, interaction warnings (amber highlight for MODERATE, red for SEVERE) |
| `AddAppointmentPage` | Form → POST to API |
| `FamilyPage` | List members, invite flow |

### Key frontend components to build
- `PipelineVisualizer` — 4 animated step cards, streams status updates via SSE
- `FeedCard` — polymorphic card for appointments, medications, documents
- `CommentThread` — threaded comments on any entity
- `InteractionBadge` — severity-colored pill for medication interactions
- `ReviewBanner` — shown on AI-extracted items before user confirms them

---

## Build Phases

### Phase 1 — Backend foundation (2–3 hrs)
- [ ] `docker-compose.yml` in project root (Postgres 16)
- [ ] Init Express + TypeScript project in `/server`
- [ ] Prisma setup + schema + first migration
- [ ] Basic CRUD endpoints (appointments, medications, comments)
- [ ] Seed script with realistic demo data (patient: "Margaret", 3 family members, 2 medications, 2 appointments)

### Phase 2 — AI pipeline (2–3 hrs)
- [ ] Multer file upload endpoint
- [ ] De-identification utility
- [ ] 4-step Claude pipeline with `processingStatus` updates
- [ ] SSE endpoint for pipeline + feed events

### Phase 3 — Frontend integration (3–4 hrs)
- [ ] TanStack Query hooks for all resources
- [ ] `PipelineVisualizer` component wired to SSE
- [ ] Feed page with live updates
- [ ] Document detail with AI sections + comments
- [ ] Medication interactions display

### Phase 4 — Polish (1–2 hrs)
- [ ] iCal export
- [ ] Review/confirm flow for AI-extracted appointments + medications
- [ ] Empty states
- [ ] Demo seed data that tells a coherent story

---

## Engineering Tradeoffs (interview talking points)

- **SSE vs WebSockets** — SSE is unidirectional (server → client) which is all we need for feed updates. Simpler protocol, native browser support, no extra library.
- **Separate extraction vs interpretation prompts** — more reliable structured output from step 1; step 2+ can be richer because they don't have to be JSON-safe.
- **AI as data entry layer** — the pipeline doesn't just summarize, it populates the app's data model. Appointments and medications come from the document, not a form.
- **Review before commit** — AI-extracted records are marked `AI_EXTRACTED` and shown with a review banner. Users confirm before they're treated as canonical. Handles AI errors gracefully.
- **MedicationInteraction caching** — interactions are stored and only re-checked when the medication list changes. Avoids redundant expensive AI calls.
- **HIPAA consideration** — de-identification layer before Claude; production path is Anthropic BAA + encrypted storage.
- **Express over NestJS** — NestJS is excellent for large teams and long-lived services. For a focused demo at this scope, the module/provider ceremony adds scaffolding time without architectural benefit.

---

## Out of Scope (would build next)
- Auth (hardcoded user context for demo)
- Push notifications / email
- Mobile app (PWA wrapper)
- Full HIPAA compliance (BAA, audit logging, encrypted storage)
- Offline support
- PDF rendering in-browser
