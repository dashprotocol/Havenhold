import { useQuery } from "@tanstack/react-query";
import { Shield, User, Clock } from "lucide-react";
import { fetchFamily, type User as FamilyMember } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const roleLabel: Record<FamilyMember["role"], string> = {
  PRIMARY_CAREGIVER: "Primary Caregiver",
  FAMILY_MEMBER: "Family Member",
};

export default function FamilyPage() {
  const { user } = useAuth();
  const { data: members = [], isLoading } = useQuery({
    queryKey: ["family", user?.patientId],
    queryFn: () => fetchFamily(user!.patientId),
    enabled: !!user?.patientId,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl">Family</h1>
        <p className="text-muted-foreground mt-1">Everyone helping care for Mom.</p>
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
        {members.map((member) => (
          <div key={member.id} className="havenhold-card flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center text-lg font-bold shrink-0">
              {member.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-base">{member.name}</h3>
              <p className="text-sm text-muted-foreground">{member.email}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {member.role === "PRIMARY_CAREGIVER" ? (
                <span className="flex items-center gap-1 text-xs text-primary font-semibold">
                  <Shield className="w-3.5 h-3.5" />
                  Caregiver
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="w-3.5 h-3.5" />
                  {roleLabel[member.role]}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="havenhold-card text-center py-6 text-muted-foreground border-dashed border-2 border-border">
        <p className="font-semibold text-sm">Invite a family member</p>
        <p className="text-xs mt-1">Share access with siblings or other caregivers</p>
        <button className="havenhold-btn-outline text-sm mt-3 mx-auto">
          <Clock className="w-4 h-4" />
          Coming soon
        </button>
      </div>
    </div>
  );
}
