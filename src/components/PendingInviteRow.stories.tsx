import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within, spyOn } from 'storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PendingInviteRow from './PendingInviteRow';
import * as api from '@/lib/api';
import type { PendingInvite } from '@/lib/api';

const baseInvite: PendingInvite = {
  id: 'inv-1',
  email: 'jane@example.com',
  role: 'VIEWER',
  createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2 days ago
  expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(), // 5 days from now
  invitedBy: { id: 'u1', name: 'Alice Smith' },
};

const meta: Meta<typeof PendingInviteRow> = {
  title: 'Components/PendingInviteRow',
  component: PendingInviteRow,
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <div className="max-w-xl p-4">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    invite: baseInvite,
    patientId: 'patient-1',
  },
};

export default meta;
type Story = StoryObj<typeof PendingInviteRow>;

export const Default: Story = {};

export const ExpiringSoon: Story = {
  args: {
    invite: {
      ...baseInvite,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 3).toISOString(), // 3 hours from now
    },
  },
};

export const Revoking: Story = {
  play: async ({ canvasElement }) => {
    spyOn(api, 'revokeInvite').mockReturnValue(new Promise(() => {})); // never resolves
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /revoke invite/i }));
    // Confirm in the AlertDialog
    const dialog = within(document.body);
    await waitFor(() => {
      expect(dialog.getByRole('alertdialog')).toBeInTheDocument();
    });
    await userEvent.click(dialog.getByRole('button', { name: /^revoke$/i }));
    await waitFor(() => {
      expect(dialog.getByRole('button', { name: /revoking/i })).toBeDisabled();
    });
  },
};
