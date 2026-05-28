import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MapPin, ChevronDown, ChevronUp, Download, Plus, StickyNote, Clock } from "lucide-react";
import { fetchAppointments, exportIcal, type Appointment } from "@/lib/api";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

export default function AppointmentsPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { user } = useAuth();
  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["appointments", user?.patientId],
    queryFn: () => fetchAppointments(user!.patientId),
    enabled: !!user?.patientId,
  });

  const grouped = appointments.reduce<Record<string, Appointment[]>>((acc, apt) => {
    const month = format(new Date(apt.datetime), "MMMM yyyy");
    (acc[month] = acc[month] || []).push(apt);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl">Appointments</h1>
        <p className="text-muted-foreground mt-1">Upcoming visits for Mom's care.</p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="havenhold-card animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 bg-secondary rounded w-2/3" />
                  <div className="h-3 bg-secondary rounded w-1/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && appointments.length === 0 && (
        <div className="havenhold-card text-center py-10 text-muted-foreground">
          <p className="font-semibold">No appointments yet</p>
          <p className="text-sm mt-1">Add one manually or upload a doctor's note.</p>
        </div>
      )}

      {Object.entries(grouped).map(([month, apts]) => (
        <div key={month}>
          <h2 className="havenhold-section-title mb-3">{month}</h2>
          <div className="space-y-3">
            {apts.map((apt) => {
              const isExpanded = expanded === apt.id;
              return (
                <div key={apt.id} className="havenhold-card">
                  <button onClick={() => setExpanded(isExpanded ? null : apt.id)} className="w-full text-left">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                        <CalendarDays className="w-5 h-5 text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-base">{apt.title}</h3>
                          {apt.source === "AI_EXTRACTED" && (
                            <span className="havenhold-badge-primary text-xs">AI</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {[apt.doctor, apt.specialty].filter(Boolean).join(" · ")}
                        </p>
                        <div className="flex items-center gap-1 mt-2 text-sm text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{format(new Date(apt.datetime), "MMMM d, yyyy 'at' h:mm a")}</span>
                        </div>
                      </div>
                      <div className="text-muted-foreground">
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-border/50 space-y-3 animate-fade-up">
                      {apt.location && (
                        <div className="flex items-start gap-2 text-sm">
                          <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                          <span>{apt.location}</span>
                        </div>
                      )}
                      {apt.notes && (
                        <div className="flex items-start gap-2 text-sm">
                          <StickyNote className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                          <span className="text-muted-foreground">{apt.notes}</span>
                        </div>
                      )}
                      <button
                        onClick={() => exportIcal(apt.id)}
                        className="havenhold-btn-outline w-full text-sm py-2"
                      >
                        <Download className="w-4 h-4" />
                        Export to Calendar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <Link to="/appointments/add" className="havenhold-fab">
        <Plus className="w-6 h-6" />
      </Link>
    </div>
  );
}
