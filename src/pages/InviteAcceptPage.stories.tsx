import type { Meta, StoryObj } from '@storybook/react-vite';
import { beforeEach, waitFor, within, expect } from 'storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import InviteAcceptPage from './InviteAcceptPage';
import { AuthContext } from '@/contexts/AuthContext';
import type { InvitePreview } from '@/lib/api';
import { ApiError } from '@/lib/api';

const previewData: InvitePreview = {
  email: 'jane@example.com',
  role: 'VIEWER',
  patientName: 'Mom',
  expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(),
};

const noUser = {
  user: null,
  isLoading: false,
  memberships: [],
  activePatientId: null,
  setActivePatientId: () => {},
  refreshMe: async () => {},
};

const loggedInMatchingUser = {
  ...noUser,
  user: { id: 'u1', name: 'Jane Smith', email: 'jane@example.com' },
};

const loggedInMismatchUser = {
  ...noUser,
  user: { id: 'u2', name: 'Bob Jones', email: 'bob@example.com' },
};

function mockFetch(status: number, body: object) {
  const originalFetch = window.fetch;
  window.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  return () => { window.fetch = originalFetch; };
}

function Wrapper({ authValue }: { authValue: typeof noUser }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider value={authValue}>
        <MemoryRouter initialEntries={['/invite/test-token']}>
          <Routes>
            <Route path="/invite/:token" element={<InviteAcceptPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

const meta: Meta = {
  title: 'Pages/InviteAcceptPage',
};
export default meta;
type Story = StoryObj;

export const Loading: Story = {
  beforeEach: () => {
    const originalFetch = window.fetch;
    window.fetch = () => new Promise(() => {});
    return () => { window.fetch = originalFetch; };
  },
  render: () => <Wrapper authValue={noUser} />,
};

export const NotFound: Story = {
  beforeEach: () => mockFetch(404, { code: 'NOT_FOUND', error: 'Invite not found' }),
  render: () => <Wrapper authValue={noUser} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByText('Invalid invite link')).toBeInTheDocument()
    );
  },
};

export const Expired: Story = {
  beforeEach: () => mockFetch(410, { code: 'EXPIRED', error: 'Invite has expired' }),
  render: () => <Wrapper authValue={noUser} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByText('Invite expired')).toBeInTheDocument()
    );
  },
};

export const Revoked: Story = {
  beforeEach: () => mockFetch(410, { code: 'REVOKED', error: 'Invite has been revoked' }),
  render: () => <Wrapper authValue={noUser} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByText('Invite revoked')).toBeInTheDocument()
    );
  },
};

export const AlreadyAccepted: Story = {
  beforeEach: () => mockFetch(409, { code: 'ALREADY_ACCEPTED', error: 'Invite already accepted' }),
  render: () => <Wrapper authValue={noUser} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByText('Already accepted')).toBeInTheDocument()
    );
  },
};

export const GenericError: Story = {
  beforeEach: () => {
    const originalFetch = window.fetch;
    window.fetch = async () => { throw new Error('Network error'); };
    return () => { window.fetch = originalFetch; };
  },
  render: () => <Wrapper authValue={noUser} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByText('Something went wrong')).toBeInTheDocument()
    );
  },
};

export const ValidNewUser: Story = {
  beforeEach: () => mockFetch(200, previewData),
  render: () => <Wrapper authValue={noUser} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByText("You've been invited")).toBeInTheDocument()
    );
  },
};

export const ValidLoggedIn: Story = {
  beforeEach: () => mockFetch(200, previewData),
  render: () => <Wrapper authValue={loggedInMatchingUser} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByRole('button', { name: 'Accept invite' })).toBeInTheDocument()
    );
  },
};

export const ValidEmailMismatch: Story = {
  beforeEach: () => mockFetch(200, previewData),
  render: () => <Wrapper authValue={loggedInMismatchUser} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByText('Wrong account')).toBeInTheDocument()
    );
  },
};

// Keep ApiError in scope so it's not tree-shaken (used by the component under test)
void ApiError;
