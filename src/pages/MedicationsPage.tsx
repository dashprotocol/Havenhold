import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Pill, ChevronDown, ChevronUp, AlertTriangle, User, Clock, Info } from "lucide-react";
import { fetchMedications, type Medication } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const severityColor = {
  MILD: "text-yellow-600 bg-yellow-50 border-yellow-200",
  MODERATE: "text-orange-600 bg-orange-50 border-orange-200",
  SEVERE: "text-red-600 bg-red-50 border-red-200",
};

function getAllInteractions(med: Medication) {
  const a = med.interactionsA.map((i) => ({ ...i, otherMed: i.medicationB }));
  const b = med.interactionsB.map((i) => ({ ...i, otherMed: i.medicationA }));
  return [...a, ...b];
}

export default function MedicationsPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { user } = useAuth();
  const { data: medications = [], isLoading } = useQuery({
    queryKey: ["medications", user?.patientId],
    queryFn: () => fetchMedications(user!.patientId),
    enabled: !!user?.patientId,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl">Medications</h1>
        <p className="text-muted-foreground mt-1">Mom's current medications and what they do.</p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="havenhold-card animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 bg-secondary rounded w-1/2" />
                  <div className="h-3 bg-secondary rounded w-1/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && medications.length === 0 && (
        <div className="havenhold-card text-center py-10 text-muted-foreground">
          <p className="font-semibold">No medications yet</p>
          <p className="text-sm mt-1">Upload a doctor's note to add medications automatically.</p>
        </div>
      )}

      <div className="space-y-3">
        {medications.map((med) => {
          const isExpanded = expanded === med.id;
          const interactions = getAllInteractions(med);
          const worstSeverity = interactions.reduce<"MILD" | "MODERATE" | "SEVERE" | null>((acc, i) => {
            if (i.severity === "SEVERE") return "SEVERE";
            if (i.severity === "MODERATE" && acc !== "SEVERE") return "MODERATE";
            if (i.severity === "MILD" && !acc) return "MILD";
            return acc;
          }, null);

          return (
            <div key={med.id} className="havenhold-card">
              <button onClick={() => setExpanded(isExpanded ? null : med.id)} className="w-full text-left">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Pill className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-base">{med.name}</h3>
                      {med.dosage && <span className="havenhold-badge-primary text-xs">{med.dosage}</span>}
                      {med.source === "AI_EXTRACTED" && <span className="havenhold-badge-accent text-xs">AI</span>}
                    </div>
                    {med.frequency && (
                      <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" />
                        {med.frequency}
                      </div>
                    )}
                    {med.prescribingDoctor && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <User className="w-3 h-3" />
                        {med.prescribingDoctor}
                      </div>
                    )}
                  </div>
                  <div className="text-muted-foreground flex items-center gap-1">
                    {worstSeverity && <AlertTriangle className="w-4 h-4 text-warning" />}
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-border/50 space-y-3 animate-fade-up">
                  {med.aiDescription && (
                    <div className="rounded-xl bg-secondary/50 px-4 py-3">
                      <div className="flex items-center gap-1 mb-1">
                        <Info className="w-4 h-4 text-primary" />
                        <span className="text-sm font-bold">What This Does</span>
                      </div>
                      <div className="text-sm text-muted-foreground leading-relaxed">
                        <ReactMarkdown components={{
                          h1: ({ children }) => <p className="font-bold mb-1">{children}</p>,
                          h2: ({ children }) => <p className="font-bold mb-1">{children}</p>,
                          h3: ({ children }) => <p className="font-bold mb-1">{children}</p>,
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                        }}>{med.aiDescription}</ReactMarkdown>
                      </div>
                    </div>
                  )}

                  {med.aiSideEffects && (
                    <div className="rounded-xl bg-secondary/50 px-4 py-3">
                      <div className="flex items-center gap-1 mb-1">
                        <AlertTriangle className="w-4 h-4 text-accent" />
                        <span className="text-sm font-bold">Side Effects</span>
                      </div>
                      <div className="text-sm text-muted-foreground leading-relaxed">
                        <ReactMarkdown components={{
                          h1: ({ children }) => <p className="font-bold mb-1">{children}</p>,
                          h2: ({ children }) => <p className="font-bold mb-1">{children}</p>,
                          h3: ({ children }) => <p className="font-bold mb-1">{children}</p>,
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                        }}>{med.aiSideEffects}</ReactMarkdown>
                      </div>
                    </div>
                  )}

                  {interactions.map((interaction) => (
                    <div
                      key={interaction.id}
                      className={`rounded-xl px-4 py-3 border ${severityColor[interaction.severity]}`}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-sm font-bold">
                          {interaction.severity.charAt(0) + interaction.severity.slice(1).toLowerCase()} Interaction
                          {interaction.otherMed ? ` with ${interaction.otherMed.name}` : ""}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed">{interaction.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
