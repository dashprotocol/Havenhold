import React from 'react';
import { Resend } from 'resend';
import { InviteEmail } from '../emails/InviteEmail';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface InviteEmailOptions {
  to: string;
  inviterName: string;
  token: string;
  expiresAt: Date;
}

export async function sendInviteEmail({
  to,
  inviterName,
  token,
  expiresAt,
}: InviteEmailOptions): Promise<void> {
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error('APP_URL env var is not set');

  const from = process.env.EMAIL_FROM ?? 'noreply@argonnehq.com';
  const acceptUrl = `${appUrl}/invite/${token}`;
  const expiresFormatted = expiresAt.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const { error } = await resend.emails.send({
    from,
    to,
    subject: "You've been invited to Havenhold",
    react: React.createElement(InviteEmail, { inviterName, acceptUrl, expiresFormatted }),
  });

  if (error) throw new Error(`Email delivery failed: ${error.message}`);
}
