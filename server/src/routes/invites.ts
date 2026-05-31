import { Router } from 'express';
import { MemberRole, InviteStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { auth } from '../lib/auth';
import { generateToken, hashToken, INVITE_TTL_MS } from '../lib/token';
import { sendInviteEmail } from '../lib/email';
import {
  requireAuth,
  requirePatientAccess,
  requireOwnerAccess,
  assertPatientMembership,
} from '../middleware/sessionAuth';

export const invitesRouter = Router();

class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

function isPrismaConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
}

function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\r\n]/g, '');
}

// Double-cast to bypass better-auth's complex inferred API types while keeping
// a local contract that matches what the admin plugin actually returns.
type AdminApi = {
  createUser(opts: { body: { email: string; name: string; password: string; role: string } }): Promise<{ user: { id: string } }>;
  signInEmail(opts: { body: { email: string; password: string }; asResponse: true }): Promise<Response>;
};
const adminApi = auth.api as unknown as AdminApi;

const INVITE_ROLE_ALLOWLIST: MemberRole[] = [MemberRole.VIEWER, MemberRole.EDITOR];
const MAX_PENDING_INVITES = 20;
const MIN_PASSWORD_LENGTH = 8;

async function acceptInviteTx(
  tx: Prisma.TransactionClient,
  inviteId: string,
  userId: string,
  invite: { patientId: string; role: MemberRole; invitedById: string },
): Promise<string> {
  const now = new Date();
  const updated = await tx.patientInvite.updateMany({
    where: { id: inviteId, status: InviteStatus.PENDING, expiresAt: { gt: now } },
    data: { status: InviteStatus.ACCEPTED },
  });
  if (updated.count === 0) throw new ConflictError('Invite status changed');
  const member = await tx.patientMember.create({
    data: { patientId: invite.patientId, userId, role: invite.role, invitedBy: invite.invitedById },
    select: { id: true },
  });
  return member.id;
}
function isValidEmail(email: string): boolean {
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot >= 1 && dot < domain.length - 1;
}

// ── POST /api/invites — create invite (OWNER only) ────────────────────────────

invitesRouter.post('/', requireAuth, requirePatientAccess, requireOwnerAccess, async (req, res) => {
  try {
    const { patientId, email: rawEmail, role } = req.body as {
      patientId?: string;
      email?: string;
      role?: string;
    };

    if (!rawEmail || typeof rawEmail !== 'string' || !rawEmail.trim()) {
      return res.status(400).json({ code: 'INVALID_INPUT', error: 'email is required' });
    }
    if (!isValidEmail(rawEmail.trim())) {
      return res.status(400).json({ code: 'INVALID_INPUT', error: 'email is invalid' });
    }
    if (!role || !INVITE_ROLE_ALLOWLIST.includes(role as MemberRole)) {
      return res.status(400).json({ code: 'INVALID_INPUT', error: 'role must be VIEWER or EDITOR' });
    }

    const normalizedEmail = rawEmail.trim().toLowerCase();
    const now = new Date();

    // Sweep expired PENDING invites for this (patient, email) to unblock re-invite
    const swept = await prisma.patientInvite.updateMany({
      where: { patientId: patientId!, email: normalizedEmail, status: InviteStatus.PENDING, expiresAt: { lte: now } },
      data: { status: InviteStatus.REVOKED },
    });
    if (swept.count > 0) {
      console.info(`[invite] auto-revoked ${swept.count} expired invite(s) for patient=${sanitizeForLog(patientId)}`);
    }

    // Check invitee is not already a member
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existingUser) {
      const existingMember = await prisma.patientMember.findUnique({
        where: { patientId_userId: { patientId: patientId!, userId: existingUser.id } },
        select: { id: true },
      });
      if (existingMember) {
        return res.status(409).json({ code: 'ALREADY_MEMBER', error: 'Already a member' });
      }
    }

    // Check for duplicate active invite
    const activePending = await prisma.patientInvite.findFirst({
      where: { patientId: patientId!, email: normalizedEmail, status: InviteStatus.PENDING, expiresAt: { gt: now } },
      select: { id: true },
    });
    if (activePending) {
      return res.status(409).json({ code: 'ALREADY_PENDING', error: 'Invite already pending' });
    }

    // Abuse cap
    const pendingCount = await prisma.patientInvite.count({
      where: { patientId: patientId!, status: InviteStatus.PENDING, expiresAt: { gt: now } },
    });
    if (pendingCount >= MAX_PENDING_INVITES) {
      return res.status(409).json({ code: 'TOO_MANY_PENDING', error: 'Too many pending invites for this patient' });
    }

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    let invite: { id: string; patientId: string; email: string; role: MemberRole; expiresAt: Date };
    try {
      invite = await prisma.patientInvite.create({
        data: {
          patientId: patientId!,
          invitedById: req.user!.id,
          email: normalizedEmail,
          role: role as MemberRole,
          tokenHash,
          expiresAt,
        },
        select: { id: true, patientId: true, email: true, role: true, expiresAt: true },
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        return res.status(409).json({ code: 'ALREADY_PENDING', error: 'Invite already pending' });
      }
      return res.status(500).json({ error: 'Failed to create invite' });
    }

    try {
      await sendInviteEmail({
        to: normalizedEmail,
        inviterName: req.user!.name,
        token: rawToken,
        expiresAt,
      });
    } catch (emailErr) {
      console.error('[invite] email delivery failed, cleaning up invite row:', emailErr);
      try {
        await prisma.patientInvite.delete({ where: { id: invite.id } });
      } catch (deleteErr) {
        console.error('[invite] cleanup delete failed, falling back to REVOKED:', deleteErr);
        await prisma.patientInvite.update({
          where: { id: invite.id },
          data: { status: InviteStatus.REVOKED },
        }).catch(e => console.error('[invite] fallback revoke also failed:', e));
      }
      return res.status(500).json({ error: 'Failed to send invite email' });
    }

    return res.status(201).json(invite);
  } catch (err) {
    console.error('[invite] unexpected error in POST /api/invites:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/invites/token/:token — public invite preview (no auth) ───────────
// Must be registered before /:patientId to avoid param shadowing.

invitesRouter.get('/token/:token', async (req, res) => {
  try {
    const token = req.params.token as string;
    const tokenHash = hashToken(token);
    const invite = await prisma.patientInvite.findUnique({
      where: { tokenHash },
      select: {
        status: true,
        expiresAt: true,
        email: true,
        role: true,
        patient: { select: { name: true } },
      },
    });

    if (!invite) return res.status(404).json({ code: 'NOT_FOUND', error: 'Invite not found' });

    if (invite.status === InviteStatus.ACCEPTED) {
      return res.status(409).json({ code: 'ALREADY_ACCEPTED', error: 'Invite already accepted' });
    }
    if (invite.status === InviteStatus.REVOKED) {
      return res.status(410).json({ code: 'REVOKED', error: 'Invite has been revoked' });
    }
    if (invite.expiresAt < new Date()) {
      return res.status(410).json({ code: 'EXPIRED', error: 'Invite has expired' });
    }

    return res.json({
      email: invite.email,
      role: invite.role,
      patientName: invite.patient.name,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    console.error('[invite] unexpected error in GET /api/invites/token/:token:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/invites/:patientId — list pending invites (OWNER only) ───────────

invitesRouter.get('/:patientId', requireAuth, requirePatientAccess, async (req, res) => {
  try {
    if (req.membership!.role !== MemberRole.OWNER) {
      return res.status(403).json({ code: 'FORBIDDEN', error: 'Access denied' });
    }

    const patientId = req.params.patientId as string;
    const now = new Date();
    const invites = await prisma.patientInvite.findMany({
      where: {
        patientId,
        status: InviteStatus.PENDING,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        invitedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(invites);
  } catch (err) {
    console.error('[invite] unexpected error in GET /api/invites/:patientId:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/invites/:token/register — invite-gated signup (new users) ───────

invitesRouter.post('/:token/register', async (req, res) => {
  try {
    const token = req.params.token as string;
    const tokenHash = hashToken(token);
    const invite = await prisma.patientInvite.findUnique({ where: { tokenHash } });

    if (!invite) return res.status(404).json({ code: 'NOT_FOUND', error: 'Invite not found' });

    if (invite.status === InviteStatus.ACCEPTED) {
      return res.status(409).json({ code: 'ALREADY_ACCEPTED', error: 'Invite already accepted' });
    }
    if (invite.status === InviteStatus.REVOKED) {
      return res.status(410).json({ code: 'REVOKED', error: 'Invite has been revoked' });
    }
    if (invite.expiresAt < new Date()) {
      return res.status(410).json({ code: 'EXPIRED', error: 'Invite has expired' });
    }

    const { name, password } = req.body as { name?: string; password?: string };
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ code: 'INVALID_INPUT', error: 'name is required' });
    }
    if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ code: 'INVALID_INPUT', error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const existing = await prisma.user.findUnique({
      where: { email: invite.email },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({
        code: 'ACCOUNT_EXISTS',
        error: 'Account already exists — sign in and use the accept link',
      });
    }

    let newUser: { user: { id: string } };
    try {
      newUser = await adminApi.createUser({
        body: { email: invite.email, name: name.trim(), password, role: 'user' },
      });
    } catch (err) {
      console.error('[register] createUser failed:', err);
      return res.status(500).json({ error: 'Failed to create account' });
    }

    let membershipId: string;
    try {
      membershipId = await prisma.$transaction((tx) =>
        acceptInviteTx(tx, invite.id, newUser.user.id, invite)
      );
    } catch (txErr) {
      await prisma.user.delete({ where: { id: newUser.user.id } }).catch(e =>
        console.error('[register] user cleanup failed:', e)
      );
      if (txErr instanceof ConflictError) {
        return res.status(409).json({ code: 'STATUS_CHANGED', error: 'Invite status changed' });
      }
      if (isPrismaConflict(txErr)) {
        return res.status(409).json({ code: 'ALREADY_MEMBER', error: 'Already a member' });
      }
      return res.status(500).json({ error: 'Account setup failed' });
    }

    let sessionCreated = true;
    try {
      const signInRes = await adminApi.signInEmail({
        body: { email: invite.email, password },
        asResponse: true,
      });
      const cookies: string[] =
        typeof signInRes.headers.getSetCookie === 'function'
          ? signInRes.headers.getSetCookie()
          : (signInRes.headers.get('set-cookie') ? [signInRes.headers.get('set-cookie')!] : []);
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
    } catch {
      sessionCreated = false;
    }

    return res.status(201).json({
      membershipId,
      patientId: invite.patientId,
      role: invite.role,
      sessionCreated,
    });
  } catch (err) {
    console.error('[register] unexpected error in POST /api/invites/:token/register:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/invites/:token/accept — accept invite (existing users) ──────────

invitesRouter.post('/:token/accept', requireAuth, async (req, res) => {
  try {
    const token = req.params.token as string;
    const tokenHash = hashToken(token);
    const invite = await prisma.patientInvite.findUnique({ where: { tokenHash } });

    if (!invite) return res.status(404).json({ code: 'NOT_FOUND', error: 'Invite not found' });

    if (invite.status === InviteStatus.ACCEPTED) {
      return res.status(409).json({ code: 'ALREADY_ACCEPTED', error: 'Invite already accepted' });
    }
    if (invite.status === InviteStatus.REVOKED) {
      return res.status(410).json({ code: 'REVOKED', error: 'Invite has been revoked' });
    }
    if (invite.expiresAt < new Date()) {
      return res.status(410).json({ code: 'EXPIRED', error: 'Invite has expired' });
    }

    if (req.user!.email.toLowerCase() !== invite.email) {
      return res.status(403).json({ code: 'EMAIL_MISMATCH', error: 'This invite is for a different email address' });
    }

    const existingMember = await prisma.patientMember.findUnique({
      where: { patientId_userId: { patientId: invite.patientId, userId: req.user!.id } },
      select: { id: true },
    });
    if (existingMember) {
      return res.status(409).json({ code: 'ALREADY_MEMBER', error: 'Already a member' });
    }

    let membershipId: string;
    try {
      membershipId = await prisma.$transaction((tx) =>
        acceptInviteTx(tx, invite.id, req.user!.id, invite)
      );
    } catch (txErr) {
      if (txErr instanceof ConflictError) {
        return res.status(409).json({ code: 'STATUS_CHANGED', error: 'Invite status changed' });
      }
      if (isPrismaConflict(txErr)) {
        return res.status(409).json({ code: 'ALREADY_MEMBER', error: 'Already a member' });
      }
      return res.status(500).json({ error: 'Failed to accept invite' });
    }

    return res.status(201).json({
      membershipId,
      patientId: invite.patientId,
      role: invite.role,
    });
  } catch (err) {
    console.error('[accept] unexpected error in POST /api/invites/:token/accept:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/invites/:id — revoke invite (OWNER only, enumeration-safe) ────

invitesRouter.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const invite = await prisma.patientInvite.findUnique({ where: { id } });

    if (!invite) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found' });

    const membership = await assertPatientMembership(req.user!.id, invite.patientId);
    if (!membership || membership.role !== MemberRole.OWNER) {
      // Unified 404 — prevents authenticated non-owners from enumerating valid IDs
      return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found' });
    }

    if (invite.status === InviteStatus.ACCEPTED) {
      return res.status(409).json({ code: 'ALREADY_ACCEPTED', error: 'Cannot revoke an accepted invite' });
    }

    const result = await prisma.patientInvite.updateMany({
      where: { id: invite.id, status: InviteStatus.PENDING },
      data: { status: InviteStatus.REVOKED },
    });
    if (result.count === 0) {
      return res.status(409).json({ code: 'STATUS_CHANGED', error: 'Invite status changed' });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[invite] unexpected error in DELETE /api/invites/:id:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
