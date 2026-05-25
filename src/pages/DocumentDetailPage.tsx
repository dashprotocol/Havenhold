import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, FileText, CalendarDays, Pill, HelpCircle,
  MessageCircle, Send, Clock, Loader2, CheckCircle, XCircle,
} from "lucide-react";
import { fetchDocument, createComment, reviewAppointment, reviewMedication, type Document } from "@/lib/api";
import { formatDistanceToNow, format } from "date-fns";

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [showComments, setShowComments] = useState<Record<string, boolean>>({});

  const { data: doc, isLoading } = useQuery<Document>({
    queryKey: ["document", id],
    queryFn: () => fetchDocument(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.processingStatus;
      return status && !["COMPLETE", "FAILED"].includes(status) ? 2000 : false;
    },
  });

  const commentMutation = useMutation({
    mutationFn: createComment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["document", id] }),
  });

  const reviewApptMutation = useMutation({
    mutationFn: ({ apptId, action }: { apptId: string; action: 'confirm' | 'reject' }) =>
      reviewAppointment(apptId, action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["document", id] }),
  });

  const reviewMedMutation = useMutation({
    mutationFn: ({ medId, action }: { medId: string; action: 'confirm' | 'reject' }) =>
      reviewMedication(medId, action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["document", id] }),
  });

  const submitComment = (section: string) => {
    const body = commentInputs[section]?.trim();
    if (!body) return;
    commentMutation.mutate({ body, documentId: id });
    setCommentInputs((prev) => ({ ...prev, [section]: "" }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!doc) return <div className="havenhold-card text-center py-10">Document not found.</div>;

  const isProcessing = !["COMPLETE", "FAILED"].includes(doc.processingStatus);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/" className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl">{doc.filename}</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {format(new Date(doc.uploadedAt), "MMMM d, yyyy")}
          </p>
        </div>
      </div>

      {isProcessing && (
        <div className="havenhold-card flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">AI is processing this document…</p>
        </div>
      )}

      {/* AI Summary */}
      {doc.aiSummary && (
        <SectionCard
          icon={FileText}
          title="Summary"
          sectionId="summary"
          showComments={showComments}
          onToggleComments={setShowComments}
          comments={doc.comments ?? []}
          commentInput={commentInputs["summary"] ?? ""}
          onCommentChange={(v) => setCommentInputs((p) => ({ ...p, summary: v }))}
          onCommentSubmit={() => submitComment("summary")}
        >
          <div className="overflow-y-auto max-h-72 pr-1 prose prose-sm prose-neutral max-w-none leading-relaxed">
        <ReactMarkdown>{doc.aiSummary}</ReactMarkdown>
      </div>
        </SectionCard>
      )}

      {/* Review Extracted Appointments */}
      {(doc.appointments ?? []).length > 0 && (
        <SectionCard
          icon={CalendarDays}
          title="Extracted Appointments"
          sectionId="appointments"
          showComments={showComments}
          onToggleComments={setShowComments}
          comments={doc.comments ?? []}
          commentInput={commentInputs["appointments"] ?? ""}
          onCommentChange={(v) => setCommentInputs((p) => ({ ...p, appointments: v }))}
          onCommentSubmit={() => submitComment("appointments")}
        >
          <div className="space-y-2">
            {doc.appointments!.map((apt) => (
              <div key={apt.id} className={`rounded-xl px-4 py-3 ${
                apt.reviewStatus === 'CONFIRMED' ? 'bg-green-50 border border-green-200' :
                apt.reviewStatus === 'REJECTED' ? 'bg-red-50 border border-red-200 opacity-60' :
                'bg-secondary/50'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">{apt.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(apt.datetime), "MMMM d, yyyy 'at' h:mm a")}
                      {apt.doctor ? ` · ${apt.doctor}` : ""}
                      {apt.location ? ` · ${apt.location}` : ""}
                    </p>
                  </div>
                  {apt.reviewStatus === 'PENDING' && (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => reviewApptMutation.mutate({ apptId: apt.id, action: 'confirm' })}
                        className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 hover:bg-green-200 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Confirm
                      </button>
                      <button
                        onClick={() => reviewApptMutation.mutate({ apptId: apt.id, action: 'reject' })}
                        className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 hover:bg-red-200 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  )}
                  {apt.reviewStatus === 'CONFIRMED' && (
                    <span className="text-xs font-semibold text-green-700 shrink-0">✓ Confirmed</span>
                  )}
                  {apt.reviewStatus === 'REJECTED' && (
                    <span className="text-xs font-semibold text-red-500 shrink-0">✗ Rejected</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Review Extracted Medications */}
      {(doc.medications ?? []).length > 0 && (
        <SectionCard
          icon={Pill}
          title="Extracted Medications"
          sectionId="medications"
          showComments={showComments}
          onToggleComments={setShowComments}
          comments={doc.comments ?? []}
          commentInput={commentInputs["medications"] ?? ""}
          onCommentChange={(v) => setCommentInputs((p) => ({ ...p, medications: v }))}
          onCommentSubmit={() => submitComment("medications")}
        >
          <div className="space-y-2">
            {doc.medications!.map((med) => (
              <div key={med.id} className={`rounded-xl px-4 py-3 ${
                med.reviewStatus === 'CONFIRMED' ? 'bg-green-50 border border-green-200' :
                med.reviewStatus === 'REJECTED' ? 'bg-red-50 border border-red-200 opacity-60' :
                'bg-secondary/50'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">{med.name} {med.dosage ?? ""}</p>
                    {med.frequency && <p className="text-xs text-muted-foreground mt-0.5">{med.frequency}</p>}
                  </div>
                  {med.reviewStatus === 'PENDING' && (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => reviewMedMutation.mutate({ medId: med.id, action: 'confirm' })}
                        className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 hover:bg-green-200 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Confirm
                      </button>
                      <button
                        onClick={() => reviewMedMutation.mutate({ medId: med.id, action: 'reject' })}
                        className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 hover:bg-red-200 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  )}
                  {med.reviewStatus === 'CONFIRMED' && (
                    <span className="text-xs font-semibold text-green-700 shrink-0">✓ Confirmed</span>
                  )}
                  {med.reviewStatus === 'REJECTED' && (
                    <span className="text-xs font-semibold text-red-500 shrink-0">✗ Rejected</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Questions to Ask */}
      {(doc.aiQuestions as string[] | undefined)?.length ? (
        <SectionCard
          icon={HelpCircle}
          title="Questions to Ask"
          sectionId="questions"
          showComments={showComments}
          onToggleComments={setShowComments}
          comments={doc.comments ?? []}
          commentInput={commentInputs["questions"] ?? ""}
          onCommentChange={(v) => setCommentInputs((p) => ({ ...p, questions: v }))}
          onCommentSubmit={() => submitComment("questions")}
        >
          <div className="space-y-2">
            {(doc.aiQuestions as string[]).map((q, i) => (
              <div key={i} className="rounded-xl bg-secondary/50 px-4 py-3">
                <p className="text-sm">{q}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

// ── SectionCard ───────────────────────────────────────────────────────────────

interface SectionCardProps {
  icon: typeof FileText;
  title: string;
  sectionId: string;
  children: React.ReactNode;
  showComments: Record<string, boolean>;
  onToggleComments: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  comments: Array<{ id: string; body: string; createdAt: string; author: { name: string } }>;
  commentInput: string;
  onCommentChange: (v: string) => void;
  onCommentSubmit: () => void;
}

function SectionCard({
  icon: Icon, title, sectionId, children,
  showComments, onToggleComments, comments,
  commentInput, onCommentChange, onCommentSubmit,
}: SectionCardProps) {
  const isOpen = showComments[sectionId];

  return (
    <div className="havenhold-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-lg">{title}</h2>
        </div>
        <button
          onClick={() => onToggleComments((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }))}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          <span>{comments.length}</span>
        </button>
      </div>

      {children}

      {isOpen && (
        <div className="border-t border-border/50 pt-3 mt-3 space-y-3 animate-fade-up">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                {c.author.name.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold">{c.author.name}</span>
                  <span className="text-muted-foreground">
                    {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm mt-0.5">{c.body}</p>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Add a comment…"
              value={commentInput}
              onChange={(e) => onCommentChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onCommentSubmit()}
              className="havenhold-input text-sm py-2"
            />
            <button
              onClick={onCommentSubmit}
              className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
