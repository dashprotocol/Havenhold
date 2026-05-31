import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, Eye, User, UserPlus } from 'lucide-react';
import { fetchFamily, fetchPendingInvites, type FamilyMember, type MemberRole } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import InviteDialog from '@/components/InviteDialog';
import PendingInviteRow from '@/components/PendingInviteRow';

const roleLabel: Record<MemberRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

export default function FamilyPage() {
  const { activePatientId, memberships } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);

  const isOwner = memberships.find((m) => m.patient.id === activePatientId)?.role === 'OWNER';

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['family', activePatientId],
    queryFn: () => fetchFamily(activePatientId!),
    enabled: !!activePatientId,
  });

  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['invites', activePatientId],
    queryFn: () => fetchPendingInvites(activePatientId!),
    enabled: isOwner && !!activePatientId,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl">Family</h1>
          <p className="text-muted-foreground mt-1">Everyone helping care for Mom.</p>
        </div>
        {isOwner && (
          <Button size="sm" onClick={() => setInviteOpen(true)} className="flex items-center gap-1.5">
            <UserPlus className="w-4 h-4" />
            Invite
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="havenhold-card animate-pulse">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-full bg-secondary shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 bg-secondary rounded w-1/3" />
                  <div className="h-3 bg-secondary rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {members.map((member: FamilyMember) => (
          <div key={member.id} className="havenhold-card flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center text-lg font-bold shrink-0">
              {member.user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-base">{member.user.name}</h3>
              <p className="text-sm text-muted-foreground">{member.user.email}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {member.role === 'OWNER' ? (
                <span className="flex items-center gap-1 text-xs text-primary font-semibold">
                  <Shield className="w-3.5 h-3.5" />
                  {roleLabel.OWNER}
                </span>
              ) : member.role === 'EDITOR' ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="w-3.5 h-3.5" />
                  {roleLabel.EDITOR}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Eye className="w-3.5 h-3.5" />
                  {roleLabel.VIEWER}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {isOwner && pendingInvites.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Pending Invites
          </h2>
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <PendingInviteRow key={invite.id} invite={invite} patientId={activePatientId!} />
            ))}
          </div>
        </div>
      )}

      {activePatientId && (
        <InviteDialog
          patientId={activePatientId}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
        />
      )}
    </div>
  );
}
