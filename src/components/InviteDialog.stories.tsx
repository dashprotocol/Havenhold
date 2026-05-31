import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within, fn, spyOn } from 'storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InviteDialog from './InviteDialog';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';

const meta: Meta<typeof InviteDialog> = {
  title: 'Components/InviteDialog',
  component: InviteDialog,
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: {
    patientId: 'patient-1',
    open: true,
    onOpenChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof InviteDialog>;

export const Default: Story = {};

export const Submitting: Story = {
  play: async ({ canvasElement }) => {
    spyOn(api, 'createInvite').mockReturnValue(new Promise(() => {})); // never resolves
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Email address'), 'jane@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /sending/i })).toBeDisabled();
    });
  },
};

export const ConflictError: Story = {
  play: async ({ canvasElement }) => {
    spyOn(api, 'createInvite').mockRejectedValue(
      new ApiError(409, 'ALREADY_PENDING', 'Invite already pending'),
    );
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Email address'), 'jane@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => {
      expect(canvas.getByText('Invite already pending')).toBeInTheDocument();
    });
  },
};
