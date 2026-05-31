import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createInvite, ApiError } from '@/lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  role: z.enum(['EDITOR', 'VIEWER']),
});

type FormValues = z.infer<typeof schema>;

interface InviteDialogProps {
  patientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function InviteDialog({ patientId, open, onOpenChange }: InviteDialogProps) {
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', role: 'VIEWER' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => createInvite({ patientId, ...values }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites', patientId] });
      toast.success('Invite sent');
      form.reset();
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        if (err.code === 'TOO_MANY_PENDING') {
          form.setError('root', { message: err.message });
        } else {
          form.setError('email', { message: err.message });
        }
      } else {
        toast.error('Failed to send invite');
      }
    },
  });

  const emailError = form.formState.errors.email?.message;
  const rootError = form.formState.errors.root?.message;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) form.reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="name@example.com"
              autoComplete="off"
              {...form.register('email')}
            />
            {emailError && <p className="text-xs text-destructive">{emailError}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              value={form.watch('role')}
              onValueChange={(v) => form.setValue('role', v as 'EDITOR' | 'VIEWER')}
            >
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VIEWER">Viewer — can read records</SelectItem>
                <SelectItem value="EDITOR">Editor — can add and edit records</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {rootError && <p className="text-xs text-destructive">{rootError}</p>}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
