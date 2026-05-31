import type { Meta, StoryObj } from '@storybook/react-vite';
import { InviteEmail } from '../../server/src/emails/InviteEmail';

const meta: Meta<typeof InviteEmail> = {
  title: 'Emails/InviteEmail',
  component: InviteEmail,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    inviterName: 'Dr. Sarah Chen',
    acceptUrl: 'https://app.havenhold.com/invite/abc123',
    expiresFormatted: 'June 15, 2026',
  },
};

export default meta;
type Story = StoryObj<typeof InviteEmail>;

export const Default: Story = {};

export const LongName: Story = {
  args: {
    inviterName: 'Dr. Alexandra Montgomery-Whitfield',
  },
};

export const SoonToExpire: Story = {
  args: {
    expiresFormatted: 'June 1, 2026',
  },
};
