import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, CalendarPlus, Pill, Upload, Users, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  fetchFeed, subscribeToFeed,
  type FeedItem, type Appointment, type Medication, type Document,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const iconMap = { document: FileText, appointment: CalendarPlus, medication: Pill };
const colorMap = {
  document: "text-primary bg-primary/10",
  appointment: "text-accent bg-accent/10",
  medication: "text-warning bg-warning-bg",
};

function feedTitle(item: FeedItem): string {
  if (item.type === "appointment") return (item.data as Appointment).title;
  if (item.type === "medication") return (item.data as Medication).name;
  return (item.data as Document).filename;
}

function feedDescription(item: FeedItem): string {
  if (item.type === "appointment") {
    const a = item.data as Appointment;
    const date = new Date(a.datetime).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    return [date, a.doctor, a.location].filter(Boolean).join(" · ");
  }
  if (item.type === "medication") {
    const m = item.data as Medication;
    return [m.dosage, m.frequency, m.prescribingDoctor].filter(Boolean).join(" · ");
  }
  const d = item.data as Document;
  if (d.processingStatus === "COMPLETE") return "AI processed — tap to view summary";
  if (d.processingStatus === "FAILED") return "Processing failed";
  return "Processing…";
}

export default function FeedPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: feed = [], isLoading } = useQuery({
    queryKey: ["feed", user?.patientId],
    queryFn: () => fetchFeed(user!.patientId),
    enabled: !!user?.patientId,
  });

  useEffect(() => {
    if (!user?.patientId) return;
    return subscribeToFeed(user.patientId, (event) => {
      if (event.type === "feed_refresh") {
        queryClient.invalidateQueries({ queryKey: ["feed"] });
      }
    });
  }, [user?.patientId, queryClient]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl">Good afternoon 👋</h1>
        <p className="text-muted-foreground mt-1">Here's what's new with Mom's care.</p>
      </div>

      <div className="flex gap-3">
        <Link to="/documents/upload" className="havenhold-card-interactive flex-1 flex flex-col items-center gap-2 py-4 text-center">
          <Upload className="w-6 h-6 text-primary" />
          <span className="text-sm font-semibold">Upload Doc</span>
        </Link>
        <Link to="/appointments/add" className="havenhold-card-interactive flex-1 flex flex-col items-center gap-2 py-4 text-center">
          <CalendarPlus className="w-6 h-6 text-accent" />
          <span className="text-sm font-semibold">Add Appt</span>
        </Link>
        <Link to="/family" className="havenhold-card-interactive flex-1 flex flex-col items-center gap-2 py-4 text-center">
          <Users className="w-6 h-6 text-muted-foreground" />
          <span className="text-sm font-semibold">Family</span>
        </Link>
      </div>

      <div>
        <h2 className="havenhold-section-title mb-3">Recent Activity</h2>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="havenhold-card animate-pulse">
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-xl bg-secondary shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-4 bg-secondary rounded w-3/4" />
                    <div className="h-3 bg-secondary rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && feed.length === 0 && (
          <div className="havenhold-card text-center py-10 text-muted-foreground">
            <p className="font-semibold">No activity yet</p>
            <p className="text-sm mt-1">Upload a document or add an appointment to get started.</p>
          </div>
        )}

        <div className="space-y-3">
          {feed.map((item, i) => {
            const Icon = iconMap[item.type];
            const isDoc = item.type === "document";
            const id = (item.data as Appointment).id;
            const isAI = !isDoc && (item.data as Appointment | Medication).source === "AI_EXTRACTED";

            return (
              <div
                key={`${item.type}-${id}`}
                className="havenhold-card animate-fade-up"
                style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
              >
                <div className="flex gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${colorMap[item.type]}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-base leading-snug">{feedTitle(item)}</h3>
                      {isAI && <span className="havenhold-badge-primary text-xs shrink-0">AI</span>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{feedDescription(item)}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</span>
                      <span>·</span>
                      <span className="font-semibold">{isAI ? "AI · from document" : "Family"}</span>
                    </div>
                    {isDoc && (
                      <Link to={`/documents/${id}`} className="text-xs text-primary font-semibold mt-2 inline-block">
                        View summary →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
