import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, FileText, Search, Languages, AlertTriangle,
  HelpCircle, CheckCircle2, CalendarPlus, Pill, Loader2,
} from "lucide-react";
import { uploadDocument, subscribeToFeed, type ProcessingStatus } from "@/lib/api";
import { flags } from "@/lib/flags";
import { useAuth } from "@/contexts/AuthContext";

const STEPS: { status: ProcessingStatus; icon: typeof Search; title: string; description: string }[] = [
  { status: "EXTRACTING", icon: Search, title: "Extracting Data", description: "Scanning for appointments, medications, and instructions…" },
  { status: "SIMPLIFYING", icon: Languages, title: "Simplifying Language", description: "Rewriting medical jargon into plain language…" },
  { status: "CHECKING_INTERACTIONS", icon: AlertTriangle, title: "Checking Interactions", description: "Cross-referencing with current medications for safety…" },
  { status: "GENERATING_QUESTIONS", icon: HelpCircle, title: "Generating Questions", description: "Creating smart questions for the next doctor's visit…" },
];

const STATUS_ORDER: ProcessingStatus[] = [
  "PENDING", "EXTRACTING", "SIMPLIFYING", "CHECKING_INTERACTIONS", "GENERATING_QUESTIONS", "COMPLETE",
];

function stepState(stepStatus: ProcessingStatus, currentStatus: ProcessingStatus): "pending" | "active" | "done" {
  const stepIdx = STATUS_ORDER.indexOf(stepStatus);
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);
  if (currentStatus === "COMPLETE") return "done";
  if (currentIdx > stepIdx) return "done";
  if (currentIdx === stepIdx) return "active";
  return "pending";
}

function StreamingText({ text, active }: { text: string; active: boolean }) {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    if (!active) return;
    setDisplayed("");
    let i = 0;
    const interval = setInterval(() => {
      if (i < text.length) { setDisplayed(text.slice(0, ++i)); }
      else clearInterval(interval);
    }, 18);
    return () => clearInterval(interval);
  }, [active, text]);
  if (!active && !displayed) return null;
  return (
    <p className="text-sm text-muted-foreground mt-2 font-mono leading-relaxed">
      {displayed}
      {active && displayed.length < text.length && (
        <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse" />
      )}
    </p>
  );
}

const STEP_STREAM_TEXT: Record<string, string> = {
  EXTRACTING: "Scanning document… found follow-up appointment… detected medication entries… extracting instructions and notes…",
  SIMPLIFYING: 'Converting medical terminology to plain language… rewriting diagnosis section… simplifying treatment instructions…',
  CHECKING_INTERACTIONS: "Loading current medication list… checking new medications against existing ones… reviewing severity levels…",
  GENERATING_QUESTIONS: 'Building questions based on findings… "What should we watch for with the new medication?"… finalizing list…',
};

type AnalysisType = "BALANCED" | "SCIENTIFIC" | "HOLISTIC" | "INTEGRATIVE";

const ANALYSIS_OPTIONS: { value: AnalysisType; label: string; description: string }[] = [
  { value: "BALANCED",    label: "Balanced",     description: "Plain language, easy for any family member" },
  { value: "SCIENTIFIC",  label: "Scientific",   description: "Clinical accuracy, medical terminology" },
  { value: "HOLISTIC",    label: "Holistic",     description: "Whole-person — lifestyle, sleep, stress, wellbeing" },
  { value: "INTEGRATIVE", label: "Integrative",  description: "Conventional + complementary approaches" },
];

export default function DocumentUploadPage() {
  const navigate = useNavigate();
  const { activePatientId } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [analysisType, setAnalysisType] = useState<AnalysisType>("BALANCED");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<ProcessingStatus>("PENDING");
  const [appointmentsAdded, setAppointmentsAdded] = useState(0);
  const [medicationsAdded, setMedicationsAdded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isProcessing = documentId !== null && currentStatus !== "COMPLETE" && currentStatus !== "FAILED";
  const isDone = currentStatus === "COMPLETE";

  // Subscribe to SSE once we have a documentId
  useEffect(() => {
    if (!documentId || !activePatientId) return;
    return subscribeToFeed(activePatientId, (event) => {
      if (event.type === "pipeline" && event.documentId === documentId) {
        if (event.step) setCurrentStatus(event.step);
        if (event.appointmentsAdded) setAppointmentsAdded(event.appointmentsAdded);
        if (event.medicationsAdded) setMedicationsAdded(event.medicationsAdded);
      }
    });
  }, [documentId, activePatientId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleUpload = async () => {
    if (!file || !activePatientId) return;
    setError(null);
    try {
      const { documentId: id } = await uploadDocument(activePatientId, file, analysisType);
      setDocumentId(id);
      setCurrentStatus("PENDING");
    } catch {
      setError("Upload failed. Please try again.");
    }
  };

  // Pipeline disabled — show a clear message instead of a broken upload form
  if (!flags.PIPELINE_ENABLED) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl">Upload Document</h1>
          <p className="text-muted-foreground mt-1">Upload a doctor's note and AI will extract the important details.</p>
        </div>
        <div className="havenhold-card text-center py-10 space-y-2">
          <p className="font-semibold text-muted-foreground">Document processing is currently unavailable.</p>
          <p className="text-sm text-muted-foreground">The AI pipeline has been temporarily disabled. Please check back later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl">Upload Document</h1>
        <p className="text-muted-foreground mt-1">Upload a doctor's note and AI will extract the important details.</p>
      </div>

      {/* Upload area */}
      {!documentId && (
        <div className="space-y-3">
          <button
            onClick={() => inputRef.current?.click()}
            className="havenhold-card-interactive w-full py-12 flex flex-col items-center gap-3 border-2 border-dashed border-primary/30"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Upload className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <p className="font-bold text-lg">{file ? file.name : "Tap to select a document"}</p>
              <p className="text-sm text-muted-foreground mt-1">PDF or plain text · max 10MB</p>
            </div>
          </button>
          <input ref={inputRef} type="file" accept=".pdf,.txt" className="hidden" onChange={handleFileChange} />
          {file && (
            <>
              <div className="space-y-2">
                <p className="text-sm font-semibold">Analysis Style</p>
                <div className="grid grid-cols-2 gap-2">
                  {ANALYSIS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setAnalysisType(opt.value)}
                      className={`havenhold-card text-left transition-all ${analysisType === opt.value ? "ring-2 ring-primary" : ""}`}
                    >
                      <p className="font-semibold text-sm">{opt.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleUpload} className="havenhold-btn-primary w-full">
                Upload & Process
              </button>
            </>
          )}
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
        </div>
      )}

      {/* Processing pipeline */}
      {documentId && (
        <div className="space-y-3">
          <div className="havenhold-card flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm">{file?.name ?? "Document"}</p>
              <p className="text-xs text-muted-foreground">{file ? `${(file.size / 1024).toFixed(0)} KB` : ""}</p>
            </div>
          </div>

          {STEPS.map((step) => {
            const state = stepState(step.status, currentStatus);
            const Icon = step.icon;
            return (
              <div
                key={step.status}
                className={`havenhold-card transition-all duration-500 ${state === "active" ? "ring-2 ring-primary/30" : ""} ${state === "pending" ? "opacity-40" : "opacity-100"}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300 ${state === "done" ? "bg-primary/15 text-primary" : state === "active" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
                    {state === "done" ? <CheckCircle2 className="w-5 h-5" /> : state === "active" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-base">{step.title}</h3>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                    <StreamingText text={STEP_STREAM_TEXT[step.status] ?? ""} active={state === "active"} />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Results */}
          {isDone && (
            <div className="space-y-3 animate-fade-up">
              <h2 className="havenhold-section-title mt-2">Auto-Extracted</h2>
              {appointmentsAdded > 0 && (
                <div className="havenhold-card flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                    <CalendarPlus className="w-5 h-5 text-accent" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-sm">{appointmentsAdded} appointment{appointmentsAdded > 1 ? "s" : ""} added</p>
                    <p className="text-xs text-muted-foreground">Check Appointments tab to review</p>
                  </div>
                  <span className="havenhold-badge-accent text-xs">New</span>
                </div>
              )}
              {medicationsAdded > 0 && (
                <div className="havenhold-card flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-warning-bg flex items-center justify-center">
                    <Pill className="w-5 h-5 text-warning" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-sm">{medicationsAdded} medication{medicationsAdded > 1 ? "s" : ""} added</p>
                    <p className="text-xs text-muted-foreground">Check Medications tab to review</p>
                  </div>
                  <span className="havenhold-badge-warning text-xs">New</span>
                </div>
              )}
              <button onClick={() => navigate(`/documents/${documentId}`)} className="havenhold-btn-primary w-full mt-2">
                View Full Summary
              </button>
            </div>
          )}

          {currentStatus === "FAILED" && (
            <div className="havenhold-card text-center py-6 text-red-500">
              <p className="font-semibold">Processing failed</p>
              <p className="text-sm mt-1 text-muted-foreground">Please try uploading again.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
