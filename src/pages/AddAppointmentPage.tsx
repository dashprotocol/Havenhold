import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { createAppointment, PATIENT_ID } from "@/lib/api";

export default function AddAppointmentPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: "", doctor: "", specialty: "", datetime: "", location: "", notes: "",
  });

  const mutation = useMutation({
    mutationFn: () => createAppointment({ ...form, patientId: PATIENT_ID }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      navigate("/appointments");
    },
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/appointments" className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl">Add Appointment</h1>
      </div>

      <div className="havenhold-card space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-semibold">Title *</label>
          <input className="havenhold-input" placeholder="e.g. Cardiology Follow-up" value={form.title} onChange={set("title")} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-semibold">Date & Time *</label>
          <input className="havenhold-input" type="datetime-local" value={form.datetime} onChange={set("datetime")} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-semibold">Doctor</label>
          <input className="havenhold-input" placeholder="e.g. Dr. Patricia Wong" value={form.doctor} onChange={set("doctor")} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-semibold">Specialty</label>
          <input className="havenhold-input" placeholder="e.g. Cardiology" value={form.specialty} onChange={set("specialty")} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-semibold">Location</label>
          <input className="havenhold-input" placeholder="e.g. Sunrise Medical Center" value={form.location} onChange={set("location")} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-semibold">Notes</label>
          <textarea className="havenhold-input min-h-[80px] resize-none" placeholder="Any preparation notes…" value={form.notes} onChange={set("notes")} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-red-500">Failed to save. Please try again.</p>
        )}

        <button
          onClick={() => mutation.mutate()}
          disabled={!form.title || !form.datetime || mutation.isPending}
          className="havenhold-btn-primary w-full disabled:opacity-50"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Appointment"}
        </button>
      </div>
    </div>
  );
}
