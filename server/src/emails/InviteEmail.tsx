import React from 'react';

export interface InviteEmailProps {
  inviterName: string;
  acceptUrl: string;
  expiresFormatted: string;
}

const container: React.CSSProperties = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  maxWidth: '480px',
  margin: '40px auto',
  padding: '32px',
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  color: '#111827',
};

const heading: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: '600',
  margin: '0 0 16px',
};

const body: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  margin: '0 0 24px',
  color: '#374151',
};

const button: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 20px',
  backgroundColor: '#111827',
  color: '#ffffff',
  borderRadius: '6px',
  textDecoration: 'none',
  fontWeight: '500',
  fontSize: '14px',
};

const footer: React.CSSProperties = {
  marginTop: '32px',
  fontSize: '13px',
  color: '#6b7280',
};

export function InviteEmail({ inviterName, acceptUrl, expiresFormatted }: InviteEmailProps) {
  return (
    <div style={container}>
      <h1 style={heading}>You've been invited to Havenhold</h1>
      <p style={body}>
        <strong>{inviterName}</strong> has invited you to collaborate on Havenhold.
      </p>
      <a href={acceptUrl} style={button}>
        Accept invitation
      </a>
      <p style={footer}>This invitation expires on {expiresFormatted}.</p>
    </div>
  );
}
