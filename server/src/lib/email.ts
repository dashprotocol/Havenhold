import { Resend } from 'resend';

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
  const link = `${appUrl}/invite/${token}`;
  const expires = expiresAt.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const { error } = await resend.emails.send({
    from,
    to,
    subject: "You've been invited to Havenhold",
    html: `
      <p>${inviterName} has invited you to collaborate on Havenhold.</p>
      <p><a href="${link}">Accept your invitation</a></p>
      <p>This link expires on ${expires}.</p>
    `.trim(),
  });

  if (error) throw new Error(`Email delivery failed: ${error.message}`);
}
