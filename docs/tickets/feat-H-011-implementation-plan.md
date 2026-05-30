# feat/H-011 — Patient Membership / Roles Model

## Context

H-010 introduced real session auth, but left a structural problem in place: `User` had a direct FK `patientId → Patient`, meaning one user could only ever belong to one patient, and access was verified by a single string comparison (`patientId !== req.user.patientId`) with no DB lookup. The global `Role` enum (`PRIMARY_CAREGIVER | FAMILY_MEMBER`) sat on `User` and was not per-patient — a user carried the same role regardless of which patient was being accessed.

This model conflates two distinct concepts:

- **`Patient`** — the care recipient (the data subject: their appointments, medications, documents). A passive record.
- **`User`** — anyone with an app account: a caregiver, a family member, or the patient themselves if they want to log in.

Under the old model, a user *was* a patient, which is wrong. A patient who also has an account is simply a `User` with a membership row pointing at their own `Patient` record — no special treatment needed.

H-011 replaces the direct FK with a `PatientMember` junction table as the only link between `User` and `Patient`. This supports multi-patient access (a user caring for two family members), per-patient roles, and the invite flow coming in H-013.

## Scope

- Add `PatientMember` join table and `MemberRole` enum.
- Remove `User.patientId`, `User.patient`, `User.role`, `Patient.users`, and the old `Role` enum.
- Migration includes a data migration (existing `User.patientId` rows → `PatientMember` OWNER rows) and a pre-drop safety count check.
- Upgrade `requirePatientAccess` from a string comparison to a real DB lookup; attach `req.membership` (including role) for H-012 to consume.
- Add `assertPatientMembership` helper for route handlers that resolve `patientId` from an entity fetch.
- Add cross-patient entity guard to the comments route.
- Add `GET /api/me` endpoint returning the current user's memberships.
- Replace frontend `user.patientId` (session-derived) with `activePatientId` (derived from `/me` + localStorage).
- Update seed to create `PatientMember` rows instead of writing `patientId`/`role` on `User`.

## Acceptance Criteria

1. `PatientMember` table exists with `@@unique([patientId, userId])` and `@@index([userId])`.
2. `MemberRole` enum has `OWNER`, `EDITOR`, `VIEWER`.
3. No `patientId` or `role` column on `User` table; no `users` relation on `Patient`.
4. `Role` enum dropped from DB and schema.
5. Existing users with a `patientId` have a corresponding `PatientMember` row with `role = OWNER` after migration.
6. `requirePatientAccess` performs a DB lookup; returns 403 if no membership row exists.
7. `req.membership` is populated (`id`, `patientId`, `role`) after `requirePatientAccess` succeeds.
8. All `req.user.patientId` references removed from route handlers.
9. Comments route rejects requests where provided entities belong to different patients.
10. `GET /api/me` returns `{ id, name, email, memberships: [{ id, role, patient: { id, name } }] }`.
11. Frontend reads `activePatientId` from `/me` + localStorage; all patient-scoped queries use it.
12. `family.ts` returns `PatientMember` rows with nested user (not flat `User` rows).
13. Seed creates `PatientMember` rows (david=OWNER, sarah=EDITOR, michael=VIEWER); no longer writes `patientId`/`role` on `User`.
14. `better-auth` `additionalFields` no longer declares `patientId` or `role`.
15. Migrations apply cleanly on a fresh DB; TypeScript compiles with no errors.

## Deploy Gate

- Gate: `D1`
- This ticket is foundational for route-level authorization (H-012) and the invite flow (H-013). Neither can land before the membership table exists.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Model name | **`PatientMember`** | `PatientMembership` implies joining a club (awkward as a row noun). `CareTeamMember` is too clinical. `CareMember` doesn't convey patient scope. `PatientMember` reads naturally: "a member of this patient's record," scoped to the patient, row-as-noun works. |
| Role enum name | **`MemberRole`** | `PatientRole` collides with the model name. `UserRole` implies a global user property — exactly the ambiguity we're removing. `MemberRole` is scoped to membership, no collision risk. |
| Roles | **`OWNER / EDITOR / VIEWER`** | Three levels are sufficient through Phase G. OWNER = full access + membership management. EDITOR = read/write clinical data, no membership management. VIEWER = read-only. No split between OWNER and admin-granted-owner needed at MVP scale. |
| `invitedBy` | **`String?` (not a FK)** | Making it a proper FK creates circular concerns with the H-013 Invitation table. Intentionally a soft reference for now; will be revisited when the Invitation model lands. |
| Invitation lifecycle | **Deferred to H-013** | A separate `Invitation` model (token, email, role, expiresAt, status) is the correct structure. Do NOT model pending invites as `PatientMember` rows with a status field — different lifecycle, different cleanup concerns. On invite accept → create `PatientMember` row. |
| Active patient selection | **`localStorage` + `/me` endpoint** | Storing `activePatientId` server-side (e.g., in a user profile field) adds write overhead and sync complexity. Client-side localStorage is simple, survives refresh, and is validated against current memberships on every load — if the stored ID is no longer in the user's memberships, it falls back to the first one. No server state needed. |
| `requirePatientAccess` approach | **Async DB lookup, attaches `req.membership`** | The prior string comparison was not a real access check. The DB lookup now verifies membership exists and attaches the role to the request. H-012 can enforce role-level restrictions (`VIEWER` cannot PATCH) without an additional query. |
| `assertPatientMembership` helper | **Separate exported async function** | Route handlers that resolve `patientId` from an entity (e.g., `PATCH /appointments/:id` fetches the appointment first) can't use `requirePatientAccess` middleware directly. The helper provides the same check inline with the same return type, keeping `req.membership` consistent in middleware-covered routes. |
| Migration ID generation | **`md5(userId \|\| patientId \|\| 'owner-migration')`** | `gen_random_uuid()` requires the `pgcrypto` extension (not enabled). `md5()` is available in all Postgres versions without extensions; the deterministic input ensures uniqueness since `(userId, patientId)` pairs are already unique. |
| Cross-patient comment guard | **Resolve all entity patientIds, assert they form a single set** | With multi-patient membership, a user belonging to both Patient A and B could previously link entities from both in one comment. The guard resolves `patientId` for every provided entity ID, asserts all are identical, then checks membership once against that single `patientId`. |

## Assumptions and Clarifications

- A patient who has their own app account is just a `User` with a `PatientMember` row pointing at their own `Patient` record — role is typically `OWNER` if they set up their own profile.
- The "no memberships" state (a user who just registered and hasn't been added to any patient) is handled gracefully: `activePatientId` is `null`, all patient-scoped queries are disabled (`enabled: !!activePatientId`). The invite flow (H-013) will handle onboarding new users into a patient's circle.
- The `@@index([userId])` on `PatientMember` optimises the `/me` endpoint query (find all memberships for a given user). The `@@unique([patientId, userId])` covers the `requirePatientAccess` lookup (find by composite key).
- `prisma migrate dev` is interactive and fails in non-TTY environments. The migration SQL was written manually and applied via `prisma migrate deploy`, which is non-interactive. This is safe for a single-migration dev flow; CI and production should always use `migrate deploy`.
- better-auth `additionalFields` for `patientId` and `role` were surfaced on the session token in H-010. These are removed in H-011 since the membership table replaces both. The session token now carries only `id`, `name`, `email`.

## Deliverables

- [x] `server/prisma/schema.prisma` — `PatientMember` + `MemberRole` added; `User.patientId`, `User.role`, `Patient.users`, `Role` enum removed
- [x] `server/prisma/migrations/20260529000000_add_patient_member/migration.sql` — DDL + data migration + safety check + column drops
- [x] `server/src/lib/auth.ts` — `additionalFields` for `patientId`/`role` removed
- [x] `server/src/middleware/sessionAuth.ts` — `AuthUser` simplified; `requirePatientAccess` async + DB lookup; `assertPatientMembership` helper added; `PatientMemberInfo` interface + `req.membership` augmentation
- [x] `server/src/routes/me.ts` — new `GET /api/me` endpoint
- [x] `server/src/index.ts` — `meRouter` registered at `/api/me`
- [x] `server/src/routes/appointments.ts` — inline ownership checks updated to `assertPatientMembership`
- [x] `server/src/routes/medications.ts` — inline ownership checks updated to `assertPatientMembership`
- [x] `server/src/routes/documents.ts` — inline ownership checks updated to `assertPatientMembership`
- [x] `server/src/routes/comments.ts` — cross-patient guard added; ownership checks updated
- [x] `server/src/routes/family.ts` — queries `PatientMember` with nested user; returns new shape
- [x] `server/prisma/seed.ts` — `upsertMembership` helper; no longer writes `patientId`/`role` on `User`
- [x] `src/lib/api.ts` — `fetchMe`, `MeResponse`, `PatientMembership`, `FamilyMember` types added; `User.role` removed; `fetchFamily` return type updated
- [x] `src/contexts/AuthContext.tsx` — fetches `/me` post-login; manages `activePatientId` via localStorage with membership validation; exposes `memberships`, `activePatientId`, `setActivePatientId`
- [x] `src/pages/FeedPage.tsx` — `user.patientId` → `activePatientId`
- [x] `src/pages/FamilyPage.tsx` — `user.patientId` → `activePatientId`; member card updated for new `PatientMember` response shape and `MemberRole` values
- [x] `src/pages/AppointmentsPage.tsx` — `user.patientId` → `activePatientId`
- [x] `src/pages/MedicationsPage.tsx` — `user.patientId` → `activePatientId`
- [x] `src/pages/DocumentsPage.tsx` — `user.patientId` → `activePatientId`
- [x] `src/pages/DocumentUploadPage.tsx` — `user.patientId` → `activePatientId`
- [x] `src/pages/AddAppointmentPage.tsx` — `user.patientId` → `activePatientId`
- [x] `docs/tickets/feat-H-011-implementation-plan.md` — this plan

---

## Implementation Plan

### Phase 1: Schema Changes

**`server/prisma/schema.prisma`**

Remove from `User`:
```prisma
patientId String?
patient   Patient?  @relation(fields: [patientId], references: [id])
role      Role      @default(FAMILY_MEMBER)
```

Remove from `Patient`:
```prisma
users User[]
```

Remove enum:
```prisma
enum Role {
  PRIMARY_CAREGIVER
  FAMILY_MEMBER
}
```

Add to `User`:
```prisma
members PatientMember[]
```

Add to `Patient`:
```prisma
members PatientMember[]
```

Add model and enum:
```prisma
model PatientMember {
  id        String     @id @default(cuid())
  patientId String
  patient   Patient    @relation(fields: [patientId], references: [id], onDelete: Cascade)
  userId    String
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      MemberRole @default(VIEWER)
  invitedBy String?
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  @@unique([patientId, userId])
  @@index([userId])
}

enum MemberRole {
  OWNER
  EDITOR
  VIEWER
}
```

---

### Phase 2: Migration

The migration SQL is written manually (not generated interactively) because `prisma migrate dev` requires a TTY. Applied via `prisma migrate deploy`.

File: `server/prisma/migrations/20260529000000_add_patient_member/migration.sql`

Structure:
1. `CREATE TYPE "MemberRole"` + `CREATE TABLE "PatientMember"` + indexes + FKs
2. **Data migration**: insert one `PatientMember` row per `User` where `patientId IS NOT NULL`, with `role = 'OWNER'`. ID generated as `md5(userId || patientId || 'owner-migration')` — deterministic, unique, no extension required.
3. **Safety check**: `DO $$ ... IF COUNT(PatientMember) <> COUNT(User WHERE patientId IS NOT NULL) THEN RAISE EXCEPTION ... END IF;` — aborts the migration before column drops if the count doesn't match.
4. `ALTER TABLE "User" DROP COLUMN "patientId"` + `DROP COLUMN "role"` + `DROP TYPE "Role"`

Regenerate the Prisma client after applying: `npx prisma generate`

---

### Phase 3: Backend — Auth and Middleware

**`server/src/lib/auth.ts`**

Remove the `user.additionalFields` block entirely. The session token no longer carries `patientId` or `role`.

**`server/src/middleware/sessionAuth.ts`**

New interfaces:
```typescript
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface PatientMemberInfo {
  id: string;
  patientId: string;
  role: MemberRole;
}
```

`Request` augmentation adds `membership?: PatientMemberInfo`.

`requireAuth` — unchanged in behaviour; no longer extracts `patientId`/`role` from session.

`requirePatientAccess` — upgraded to async:
```typescript
export async function requirePatientAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  const patientId = req.params.patientId ?? req.body?.patientId;
  if (!patientId) return res.status(400).json({ error: 'patientId is required' });

  try {
    const membership = await prisma.patientMember.findUnique({
      where: { patientId_userId: { patientId, userId: req.user.id } },
      select: { id: true, patientId: true, role: true },
    });
    if (!membership) return res.status(403).json({ error: 'Access denied' });
    req.membership = membership;
    next();
  } catch (err) {
    next(err);
  }
}
```

`assertPatientMembership` — helper for inline use in route handlers:
```typescript
export async function assertPatientMembership(
  userId: string,
  patientId: string,
): Promise<PatientMemberInfo | null> {
  return prisma.patientMember.findUnique({
    where: { patientId_userId: { patientId, userId } },
    select: { id: true, patientId: true, role: true },
  });
}
```

---

### Phase 4: Backend — Routes

**`server/src/routes/me.ts`** (new)

`GET /` — requires `requireAuth` (mounted in `index.ts`):
```typescript
const memberships = await prisma.patientMember.findMany({
  where: { userId: req.user!.id },
  select: {
    id: true,
    role: true,
    patient: { select: { id: true, name: true } },
  },
  orderBy: { createdAt: 'asc' },
});
res.json({ id, name, email, memberships });
```

**`server/src/index.ts`**

Add: `import { meRouter } from './routes/me'` and `app.use('/api/me', requireAuth, meRouter)`.

**`server/src/routes/appointments.ts`**

Three inline ownership checks (`PATCH /:id`, `PATCH /:id/review`, `GET /:id/ical`) updated:
```typescript
// Before
if (appt.patientId !== req.user!.patientId) return res.status(403)...

// After
const membership = await assertPatientMembership(req.user!.id, appt.patientId);
if (!membership) return res.status(403)...
```

**`server/src/routes/medications.ts`**

Same pattern for `PATCH /:id/review` and `PATCH /:id`.

**`server/src/routes/documents.ts`**

Same pattern for `POST /upload` (after multer, before pipeline) and `GET /:id`.

**`server/src/routes/comments.ts`**

`POST /` rewritten with cross-patient guard:
1. Resolve `patientId` for every provided entity in parallel.
2. Assert all resolved `patientId`s form a single unique value — if `uniquePatientIds.size > 1`, return 400 `'All entities must belong to the same patient'`.
3. Check membership once against the single resolved `patientId`.

`GET /:entityType/:entityId` updated to use `assertPatientMembership`.

**`server/src/routes/family.ts`**

Query `PatientMember` with nested `user` select instead of `User` filtered by `patientId`:
```typescript
const members = await prisma.patientMember.findMany({
  where: { patientId: req.params.patientId as string },
  select: {
    id: true, role: true, createdAt: true,
    user: { select: { id: true, name: true, email: true, avatarUrl: true } },
  },
  orderBy: { role: 'asc' },
});
```

---

### Phase 5: Seed

**`server/prisma/seed.ts`**

`upsertUser` simplified — no longer writes `patientId` or `role` on `User`:
```typescript
async function upsertUser(name: string, email: string) { ... }
```

New `upsertMembership` helper:
```typescript
async function upsertMembership(userId: string, patientId: string, role: 'OWNER' | 'EDITOR' | 'VIEWER') {
  await prisma.patientMember.upsert({
    where: { patientId_userId: { patientId, userId } },
    update: { role },
    create: { patientId, userId, role },
  });
}
```

After creating users, create memberships:
```typescript
await upsertMembership(david.id,   margaret.id, 'OWNER');
await upsertMembership(sarah.id,   margaret.id, 'EDITOR');
await upsertMembership(michael.id, margaret.id, 'VIEWER');
```

---

### Phase 6: Frontend — Types and API

**`src/lib/api.ts`**

Add `fetchMe`:
```typescript
export const fetchMe = () => request<MeResponse>('/me');
```

Update `fetchFamily` return type:
```typescript
export const fetchFamily = (patientId: string) => request<FamilyMember[]>(`/family/${patientId}`);
```

New types:
```typescript
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
```

Remove `role` from `User` interface.

---

### Phase 7: Frontend — AuthContext

**`src/contexts/AuthContext.tsx`**

`AuthUser` simplified — no `patientId` or `role`.

New context values:
- `memberships: PatientMembership[]`
- `activePatientId: string | null`
- `setActivePatientId: (id: string) => void`

Boot logic on `session.user` change:
1. Call `fetchMe()`.
2. Read `localStorage.getItem('havenhold.activePatientId')`.
3. Validate stored ID is still present in returned memberships.
4. If valid → use it; if not → fall back to `memberships[0]?.patient.id ?? null`.
5. If `null` (zero memberships) → surfaces cleanly as `activePatientId = null`; all `enabled: !!activePatientId` queries are skipped.
6. Persist resolved ID to `localStorage`.

`setActivePatientId` updates both state and `localStorage` for manual patient switching (future patient-switcher UI).

---

### Phase 8: Frontend — Pages

All pages updated to destructure `activePatientId` from `useAuth()` instead of `user?.patientId`.

| Page | Change |
|---|---|
| `FeedPage` | `queryKey`, `queryFn`, `subscribeToFeed` call |
| `FamilyPage` | `queryKey`, `queryFn`; member card updated for `member.user.name/email` and `OWNER/EDITOR/VIEWER` role display |
| `AppointmentsPage` | `queryKey`, `queryFn`, `enabled` |
| `MedicationsPage` | `queryKey`, `queryFn`, `enabled` |
| `DocumentsPage` | `queryKey`, `queryFn`, `enabled` |
| `DocumentUploadPage` | `subscribeToFeed` call, `handleUpload` guard, `uploadDocument` call |
| `AddAppointmentPage` | `createAppointment` patientId arg |

---

## Validation Commands

```bash
# TypeScript — both must pass clean
cd server && npx tsc --noEmit
cd .. && npx tsc --noEmit

# Seed — verify output shows 3 members with roles
cd server && npx tsx prisma/seed.ts

# DB state — verify PatientMember rows
npx tsx -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.patientMember.findMany({ include: { user: { select: { email: true } } } })
  .then(r => r.forEach(m => console.log(m.user.email, m.role)))
  .finally(() => p.\$disconnect());
"

# GET /api/me — expect memberships array
curl -sb /tmp/cookies.txt http://localhost:3001/api/me | jq .

# Membership access control — expect 403 for non-member
curl -sb /tmp/cookies.txt http://localhost:3001/api/feed/some-other-patient-id | jq .

# Family endpoint — expect PatientMember shape with nested user
curl -sb /tmp/cookies.txt http://localhost:3001/api/family/seed-patient-margaret | jq .

# Cross-patient comment guard — provide entities from two different patients
# expect 400 "All entities must belong to the same patient"
```

---

## Risks and Mitigations

- **`prisma migrate dev` non-interactive failure** — the migration was written manually and applied via `prisma migrate deploy`. Future migrations in CI/CD should always use `migrate deploy`, never `migrate dev`.
- **`gen_random_bytes` unavailable** — `pgcrypto` extension not enabled. Resolved by using `md5(userId || patientId || salt)` which is available in all Postgres versions without extensions.
- **AuthContext double-fetch on session refresh** — the `useEffect` depends on `session.user.id`. If better-auth's `useSession` re-fires on every render, `/me` could be called excessively. The dependency on `session.user.id` (not the full `session.user` object) prevents this for identity-stable sessions.
- **Zero-membership state is silent** — a newly registered user with no memberships will see empty pages with no error. This is intentional; the invite flow (H-013) resolves it. Consider adding a "You haven't been added to any patient record yet" empty state before H-013 lands.
- **localStorage `activePatientId` can be stale** — handled by validating the stored ID against the current memberships on every `/me` response. A revoked membership correctly falls back to the first active one.

## Out of Scope

- Role *enforcement* (VIEWER blocked from PATCH) — H-012. The `req.membership.role` is already attached and available; H-012 adds the policy layer on top.
- Invite flow (token, accept, revoke) — H-013. A separate `Invitation` model is the right structure.
- Audit log entries for membership changes — H-014.
- Patient switcher UI — `setActivePatientId` is wired and ready; no UI needed until a user has more than one patient.
- Email verification gate before patient access — out of MVP scope; better-auth supports it if needed later.

## Suggested Follow-Ups

1. **H-012**: Add role enforcement middleware. `req.membership.role` is already on the request — `canEdit(req.membership.role)` helpers can gate PATCH/POST/DELETE routes without additional DB queries.
2. **H-013**: Separate `Invitation` model with `token`, `email`, `role`, `expiresAt`, `status`. On accept → create `PatientMember` row. The `invitedBy` field on `PatientMember` can be populated at that point.
3. **Zero-membership empty state**: Add a clear "You haven't been added to a patient record yet" UI before H-013 lands, so new registrations don't see blank dashboards with no guidance.
4. **Rate limiting**: `/api/me` will be called on every app boot. Ensure it's covered by any rate limiting added in H-016.
5. **Patient name in page headers**: Now that `activePatientId` resolves via memberships (which include `patient.name`), page headers like "Here's what's new with Mom's care" can be dynamic rather than hardcoded.
