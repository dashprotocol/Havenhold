import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Heart, Link2Off, Clock, Ban, CheckCircle2, AlertTriangle } from 'lucide-react';
import { previewInvite, acceptInvite, registerViaInvite, ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type RegisterValues = z.infer<typeof registerSchema>;

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-5">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <Heart className="w-7 h-7 text-accent" fill="hsl(var(--accent))" />
          <span className="text-2xl font-extrabold text-foreground tracking-tight">
            Tend<span className="text-primary">Well</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function IconBadge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <div className={`w-11 h-11 rounded-full flex items-center justify-center ${className}`}>
      {children}
    </div>
  );
}

interface StatusCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

function StatusCard({ icon, title, description, action }: StatusCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="mb-2">{icon}</div>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {action && <CardContent>{action}</CardContent>}
    </Card>
  );
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, refreshMe } = useAuth();

  const { data: preview, error, isLoading, refetch } = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => previewInvite(token!),
    enabled: !!token,
    retry: false,
  });

  const apiError = error instanceof ApiError ? error : null;

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvite(token!),
    onSuccess: async () => {
      await refreshMe();
      navigate('/');
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to accept invite');
    },
  });

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
  });

  const registerMutation = useMutation({
    mutationFn: (body: RegisterValues) => registerViaInvite(token!, body),
    onSuccess: async (result) => {
      if (!result.sessionCreated) {
        navigate('/login?redirect=/');
        toast.info('Account created — please sign in to continue.');
        return;
      }
      await refreshMe();
      navigate('/');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.code === 'ACCOUNT_EXISTS') {
          form.setError('root', { message: 'An account already exists for this email. Sign in instead.' });
        } else {
          form.setError('root', { message: err.message });
        }
      } else {
        toast.error('Registration failed. Please try again.');
      }
    },
  });

  if (isLoading) {
    return (
      <PageShell>
        <Card>
          <CardContent className="pt-6 space-y-3 animate-pulse">
            <div className="w-11 h-11 rounded-full bg-secondary" />
            <div className="h-5 bg-secondary rounded w-2/3" />
            <div className="h-4 bg-secondary rounded w-1/2" />
            <div className="h-9 bg-secondary rounded mt-4" />
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (apiError?.code === 'NOT_FOUND') {
    return (
      <PageShell>
        <StatusCard
          icon={
            <IconBadge className="bg-secondary">
              <Link2Off className="w-5 h-5 text-muted-foreground" />
            </IconBadge>
          }
          title="Invalid invite link"
          description="This invite link is not valid. It may have been miscopied or never existed."
        />
      </PageShell>
    );
  }

  if (apiError?.code === 'EXPIRED') {
    return (
      <PageShell>
        <StatusCard
          icon={
            <IconBadge className="bg-amber-100 dark:bg-amber-900/30">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </IconBadge>
          }
          title="Invite expired"
          description="This invite link has expired. Ask the owner to send you a new one."
        />
      </PageShell>
    );
  }

  if (apiError?.code === 'REVOKED') {
    return (
      <PageShell>
        <StatusCard
          icon={
            <IconBadge className="bg-red-100 dark:bg-red-900/30">
              <Ban className="w-5 h-5 text-destructive" />
            </IconBadge>
          }
          title="Invite revoked"
          description="This invite has been revoked by the owner."
        />
      </PageShell>
    );
  }

  if (apiError?.code === 'ALREADY_ACCEPTED') {
    return (
      <PageShell>
        <StatusCard
          icon={
            <IconBadge className="bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            </IconBadge>
          }
          title="Already accepted"
          description="This invite has already been used."
          action={
            <Link to="/login">
              <Button className="w-full">Sign in</Button>
            </Link>
          }
        />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <StatusCard
          icon={
            <IconBadge className="bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </IconBadge>
          }
          title="Something went wrong"
          description="We couldn't load this invite. Please try again."
          action={
            <Button variant="outline" className="w-full" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (!preview) return null;

  if (user && user.email.toLowerCase() !== preview.email.toLowerCase()) {
    return (
      <PageShell>
        <StatusCard
          icon={
            <IconBadge className="bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </IconBadge>
          }
          title="Wrong account"
          description="This invite was sent to a different email address. Sign out and sign in with the correct account to accept it."
          action={
            <Link to={`/login?redirect=/invite/${token}`}>
              <Button variant="outline" className="w-full">Sign in with a different account</Button>
            </Link>
          }
        />
      </PageShell>
    );
  }

  if (user && user.email.toLowerCase() === preview.email.toLowerCase()) {
    return (
      <PageShell>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">You've been invited</CardTitle>
            <CardDescription>
              Join <strong>{preview.patientName}</strong> as a{' '}
              {preview.role === 'EDITOR' ? 'Editor' : 'Viewer'}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              onClick={() => acceptMutation.mutate()}
              disabled={acceptMutation.isPending}
            >
              {acceptMutation.isPending ? 'Accepting…' : 'Accept invite'}
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  // Not logged in — show register form
  const rootError = form.formState.errors.root?.message;
  return (
    <PageShell>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">You've been invited</CardTitle>
          <CardDescription>
            Create an account to join <strong>{preview.patientName}</strong> as a{' '}
            {preview.role === 'EDITOR' ? 'Editor' : 'Viewer'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={form.handleSubmit((v) => registerMutation.mutate(v))}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="reg-email">Email</Label>
              <Input id="reg-email" type="email" value={preview.email} readOnly className="bg-muted" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reg-name">Your name</Label>
              <Input
                id="reg-name"
                type="text"
                autoComplete="name"
                placeholder="Jane Smith"
                {...form.register('name')}
              />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reg-password">Password</Label>
              <Input
                id="reg-password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                {...form.register('password')}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>

            {rootError && <p className="text-sm text-destructive">{rootError}</p>}

            <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
              {registerMutation.isPending ? 'Creating account…' : 'Create account & join'}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-4">
            Already have an account?{' '}
            <Link to={`/login?redirect=/invite/${token}`} className="text-primary underline underline-offset-2">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
