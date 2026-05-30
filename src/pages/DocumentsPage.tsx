import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Upload, Clock, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { fetchDocuments } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

const statusIcon = {
  COMPLETE: <CheckCircle2 className="w-4 h-4 text-primary" />,
  FAILED: <AlertCircle className="w-4 h-4 text-destructive" />,
  PENDING: <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />,
  EXTRACTING: <Loader2 className="w-4 h-4 animate-spin text-primary" />,
  SIMPLIFYING: <Loader2 className="w-4 h-4 animate-spin text-primary" />,
  CHECKING_INTERACTIONS: <Loader2 className="w-4 h-4 animate-spin text-primary" />,
  GENERATING_QUESTIONS: <Loader2 className="w-4 h-4 animate-spin text-primary" />,
};

const statusLabel = {
  COMPLETE: "Processed",
  FAILED: "Failed",
  PENDING: "Pending",
  EXTRACTING: "Extracting…",
  SIMPLIFYING: "Simplifying…",
  CHECKING_INTERACTIONS: "Checking interactions…",
  GENERATING_QUESTIONS: "Generating questions…",
};

export default function DocumentsPage() {
  const { activePatientId } = useAuth();
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["documents", activePatientId],
    queryFn: () => fetchDocuments(activePatientId!),
    enabled: !!activePatientId,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl">Documents</h1>
        <p className="text-muted-foreground mt-1">All of Mom's medical documents in one place.</p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
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

      {!isLoading && documents.length === 0 && (
        <div className="havenhold-card text-center py-10 text-muted-foreground">
          <p className="font-semibold">No documents yet</p>
          <p className="text-sm mt-1">Upload a doctor's note to get started.</p>
        </div>
      )}

      <div className="space-y-3">
        {documents.map((doc) => (
          <Link
            key={doc.id}
            to={`/documents/${doc.id}`}
            className="havenhold-card-interactive flex items-center gap-3 block"
          >
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-sm truncate">{doc.filename}</h3>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(doc.uploadedAt), { addSuffix: true })}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              {statusIcon[doc.processingStatus]}
              <span>{statusLabel[doc.processingStatus]}</span>
            </div>
          </Link>
        ))}
      </div>

      <Link to="/documents/upload" className="havenhold-fab">
        <Upload className="w-6 h-6" />
      </Link>
    </div>
  );
}
