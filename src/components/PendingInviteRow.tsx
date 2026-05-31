import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDistanceToNow, format, differenceInHours } from 'date-fns';
import { Eye, User, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { revokeInvite, type PendingInvite, type MemberRole } from '@/lib/api';

const roleLabel: Record<MemberRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

const RoleIcon = ({ role }: { role: MemberRole }) =>
  role === 'EDITOR' ? <User className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />;

interface PendingInviteRowProps {
  invite: PendingInvite;
  patientId: string;
}

export default function PendingInviteRow({ invite, patientId }: PendingInviteRowProps) {
  const queryClient = useQueryClient();
  const expiresAt = new Date(invite.expiresAt);
  const expiringSoon = differenceInHours(expiresAt, new Date()) < 24;

  const mutation = useMutation({
    mutationFn: () => revokeInvite(invite.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites', patientId] });
      toast.success('Invite revoked');
    },
    onError: () => toast.error('Failed to revoke invite'),
  });

  return (
    <div className="havenhold-card flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground shrink-0">
        {invite.email.charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{invite.email}</p>
        <p className="text-xs text-muted-foreground">
          Invited by {invite.invitedBy.name} · {formatDistanceToNow(new Date(invite.createdAt), { addSuffix: true })}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <RoleIcon role={invite.role} />
          {roleLabel[invite.role]}
        </span>
        <span className={`text-xs ${expiringSoon ? 'text-destructive' : 'text-muted-foreground'}`}>
          Expires {format(expiresAt, 'MMM d')}
        </span>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Revoke invite">
            <Trash2 className="w-4 h-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke invite?</AlertDialogTitle>
            <AlertDialogDescription>
              {invite.email} will no longer be able to use this invite link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {mutation.isPending ? 'Revoking…' : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
