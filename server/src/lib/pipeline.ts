import { Anthropic as PostHogAnthropic } from '@posthog/ai';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnalysisType, ProcessingStatus } from '@prisma/client';
import { prisma } from './prisma';
import { posthog, captureEvent } from './posthog';
import { captureError } from './errors';
import { deidentify } from './deidentify';
import {
  sanitizeQuestions,
  toMedicationInteractionCandidate,
  type MedicationInteractionCandidate,
} from './validation';
import { broadcastFeedEvent } from '../routes/feed';

const anthropic = new PostHogAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  posthog,
});

// PostHogAnthropic's overloads return Stream|Message when posthogDistinctId is present,
// because there's no non-streaming+MonitoringParams overload. All our calls are non-streaming;
// this wrapper preserves that contract at the type level without touching every call site.
async function createMessage(
  params: Anthropic.Messages.MessageCreateParamsNonStreaming & { posthogDistinctId?: string },
): Promise<Anthropic.Messages.Message> {
  return anthropic.messages.create(params) as Promise<Anthropic.Messages.Message>;
}

// Use Haiku for cost efficiency during development.
// Switch to claude-sonnet-4-6 for higher quality output.
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';

interface ExtractedData {
  appointments: Array<{
    title: string;
    doctor?: string;
    specialty?: string;
    datetime?: string;
    location?: string;
    notes?: string;
  }>;
  medications: Array<{
    name: string;
    dosage?: string;
    frequency?: string;
    prescribingDoctor?: string;
  }>;
  diagnosis?: string;
  instructions?: string;
}

function parseDate(value?: string): Date {
  if (!value) return new Date();
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date() : d;
}

async function setStatus(documentId: string, status: ProcessingStatus) {
  await prisma.document.update({
    where: { id: documentId },
    data: { processingStatus: status },
  });
}

// Prompt lens for each analysis type — same data, different perspective.
// Intentionally separate from the extraction step so the lens only affects
// how findings are communicated, not what is extracted.
const ANALYSIS_LENS: Record<AnalysisType, string> = {
  BALANCED:    'Use plain, warm language a non-medical family member can easily understand. Avoid jargon — if you must use a medical term, explain it simply in parentheses.',
  SCIENTIFIC:  'Use accurate medical terminology and clinical language. Reference evidence-based guidelines where relevant. This summary is for a family member with a medical background who prefers precision over simplification.',
  HOLISTIC:    'Connect findings to the whole person — physical, emotional, and lifestyle dimensions. Explain how this affects sleep, stress, diet, daily routines, and overall wellbeing alongside the clinical details.',
  INTEGRATIVE: 'Alongside conventional treatment, mention complementary approaches (nutrition, supplements, mind-body practices) where credible evidence supports them. Balance conventional and integrative perspectives.',
};

export async function runPipeline(
  documentId: string,
  rawText: string,
  patientId: string,
  analysisType: AnalysisType = 'BALANCED',
  userId: string,
) {
  try {
    const cleanText = deidentify(rawText);

    // ─── Step 1: Extract structured data ───────────────────────────────────
    await setStatus(documentId, 'EXTRACTING');
    broadcastFeedEvent(patientId, { type: 'pipeline', documentId, step: 'EXTRACTING' });

    const extractionResponse = await createMessage({
      model: MODEL,
      max_tokens: 1024,
      posthogDistinctId: documentId,
      messages: [
        {
          role: 'user',
          content: `Extract structured data from this doctor's note. Return ONLY valid JSON matching this schema exactly:
{
  "appointments": [{ "title": string, "doctor": string?, "specialty": string?, "datetime": string? (ISO 8601 format e.g. "2026-04-15T10:30:00"), "location": string?, "notes": string? }],
  "medications": [{ "name": string, "dosage": string?, "frequency": string?, "prescribingDoctor": string? }],
  "diagnosis": string?,
  "instructions": string?
}

Doctor's note:
${cleanText}`,
        },
      ],
    });

    const extractedText = extractionResponse.content[0].type === 'text'
      ? extractionResponse.content[0].text
      : '';

    let extracted: ExtractedData = { appointments: [], medications: [] };
    try {
      const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
      extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : extracted;
    } catch {
      // Continue with empty extracted data if parsing fails
    }

    // Persist extracted appointments and medications
    const [createdAppointments, createdMedications] = await Promise.all([
      Promise.all(
        extracted.appointments.map((a) =>
          prisma.appointment.create({
            data: {
              patientId,
              title: a.title,
              doctor: a.doctor,
              specialty: a.specialty,
              datetime: parseDate(a.datetime),
              location: a.location,
              notes: a.notes,
              source: 'AI_EXTRACTED',
              // Requires human review before appearing in feed/lists
              reviewStatus: 'PENDING',
              sourceDocumentId: documentId,
            },
          })
        )
      ),
      Promise.all(
        extracted.medications.map(async (m) => {
          // Check for existing medication by name (case-insensitive) to avoid duplicates
          const existing = await prisma.medication.findFirst({
            where: {
              patientId,
              name: { equals: m.name, mode: 'insensitive' },
            },
          });

          if (existing) {
            // Update dosage/frequency if the note specifies a change,
            // but require human review — AI shouldn't silently change an active medication
            return prisma.medication.update({
              where: { id: existing.id },
              data: {
                dosage: m.dosage ?? existing.dosage,
                frequency: m.frequency ?? existing.frequency,
                prescribingDoctor: m.prescribingDoctor ?? existing.prescribingDoctor,
                sourceDocumentId: documentId,
                reviewStatus: 'PENDING',
              },
            });
          }

          // New medication — create it, pending human review
          return prisma.medication.create({
            data: {
              patientId,
              name: m.name,
              dosage: m.dosage,
              frequency: m.frequency,
              prescribingDoctor: m.prescribingDoctor,
              source: 'AI_EXTRACTED',
              // Requires human review before appearing in feed/lists
              reviewStatus: 'PENDING',
              sourceDocumentId: documentId,
            },
          });
        })
      ),
    ]);

    // ─── Step 2: Simplify language ─────────────────────────────────────────
    await setStatus(documentId, 'SIMPLIFYING');
    broadcastFeedEvent(patientId, { type: 'pipeline', documentId, step: 'SIMPLIFYING' });

    // Step 2 uses the analysis lens — same data, different communication style.
    // Haiku is sufficient here; the lens guides tone, not factual reasoning.
    const lens = ANALYSIS_LENS[analysisType] ?? ANALYSIS_LENS.BALANCED;
    const simplifyResponse = await createMessage({
      model: MODEL,
      max_tokens: 1024,
      posthogDistinctId: documentId,
      messages: [
        {
          role: 'user',
          content: `Rewrite this doctor's note as a clear, helpful summary for the patient's family.

Tone and style: ${lens}

Keep it concise and well-structured with markdown headings.

Doctor's note:
${cleanText}

Diagnosis: ${extracted.diagnosis ?? 'not specified'}
Instructions: ${extracted.instructions ?? 'none'}`,
        },
      ],
    });

    const aiSummary = simplifyResponse.content[0].type === 'text'
      ? simplifyResponse.content[0].text
      : '';

    await prisma.document.update({ where: { id: documentId }, data: { aiSummary } });

    // ─── Step 3: Check medication interactions ─────────────────────────────
    await setStatus(documentId, 'CHECKING_INTERACTIONS');
    broadcastFeedEvent(patientId, { type: 'pipeline', documentId, step: 'CHECKING_INTERACTIONS' });

    if (createdMedications.length > 0) {
      // Get all existing medications for this patient (not just newly added ones)
      const allMedications = await prisma.medication.findMany({
        where: { patientId, active: true },
      });

      if (allMedications.length > 1) {
        const medList = allMedications.map((m) => `- ${m.name} ${m.dosage ?? ''}`).join('\n');
        const newMedNames = createdMedications.map((m) => m.name).join(', ');

        // Use Sonnet for interaction checks — this is safety-critical data where
        // accuracy matters more than cost. Haiku is too conservative and misses
        // real interactions.
        // All other pipeline steps use the cheaper Haiku model.
        const interactionResponse = await createMessage({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          posthogDistinctId: documentId,
          messages: [
            {
              role: 'user',
              content: `A patient is taking the following medications:
${medList}

New medications just added: ${newMedNames}

Check for interactions between the NEW medications and the OTHER existing ones.
Never flag a medication as interacting with itself.
Return ONLY valid JSON:
[{ "medicationA": string, "medicationB": string, "severity": "MILD"|"MODERATE"|"SEVERE", "description": string }]

If no interactions, return an empty array [].`,
            },
          ],
        });

        const interactionText = interactionResponse.content[0].type === 'text'
          ? interactionResponse.content[0].text
          : '[]';

        try {
          const jsonMatch = interactionText.match(/\[[\s\S]*\]/);
          const parsedInteractions: unknown = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
          const interactions = Array.isArray(parsedInteractions)
            ? parsedInteractions
                .map(toMedicationInteractionCandidate)
                .filter((interaction): interaction is MedicationInteractionCandidate => interaction !== null)
            : [];

          await Promise.all(
            interactions.map(async (interaction) => {
              const medA = allMedications.find((m) =>
                m.name.toLowerCase().includes(interaction.medicationA.toLowerCase())
              );
              const medB = allMedications.find((m) =>
                m.name.toLowerCase().includes(interaction.medicationB.toLowerCase())
              );

              // Skip self-interactions — can occur when an existing med is upserted
              // and the AI sees it in both the new and existing lists
              if (medA && medB && medA.id !== medB.id) {
                await prisma.medicationInteraction.upsert({
                  where: {
                    medicationAId_medicationBId: {
                      medicationAId: medA.id,
                      medicationBId: medB.id,
                    },
                  },
                  update: {
                    severity: interaction.severity,
                    description: interaction.description,
                    checkedAt: new Date(),
                  },
                  create: {
                    patientId,
                    medicationAId: medA.id,
                    medicationBId: medB.id,
                    severity: interaction.severity,
                    description: interaction.description,
                  },
                });
              }
            })
          );
        } catch {
          // Non-fatal — continue pipeline
        }
      }

      // Enrich new medications with plain-language descriptions
      await Promise.all(
        createdMedications.map(async (med) => {
          const descResponse = await createMessage({
            model: MODEL,
            max_tokens: 512,
            posthogDistinctId: documentId,
            messages: [
              {
                role: 'user',
                content: `In 2-3 plain sentences each, explain to a non-medical family member:
1. What ${med.name} (${med.dosage ?? ''}) is used for
2. Common side effects to watch for

Be warm and clear, not clinical.`,
              },
            ],
          });

          const description = descResponse.content[0].type === 'text'
            ? descResponse.content[0].text
            : '';

          await prisma.medication.update({
            where: { id: med.id },
            data: { aiDescription: description },
          });
        })
      );
    }

    // ─── Step 4: Generate doctor questions ────────────────────────────────
    await setStatus(documentId, 'GENERATING_QUESTIONS');
    broadcastFeedEvent(patientId, { type: 'pipeline', documentId, step: 'GENERATING_QUESTIONS' });

    const questionsResponse = await createMessage({
      model: MODEL,
      max_tokens: 512,
      posthogDistinctId: documentId,
      messages: [
        {
          role: 'user',
          content: `Based on this doctor's note, generate 3-5 clear, practical questions a family member should ask at the next appointment.
Focus on things that matter for day-to-day care.

Doctor's note summary: ${aiSummary}
New medications: ${extracted.medications.map((m) => m.name).join(', ') || 'none'}
Instructions: ${extracted.instructions ?? 'none'}

Return ONLY a JSON array of strings: ["question 1", "question 2", ...]`,
        },
      ],
    });

    const questionsText = questionsResponse.content[0].type === 'text'
      ? questionsResponse.content[0].text
      : '[]';

    let aiQuestions: string[] = [];
    try {
      const jsonMatch = questionsText.match(/\[[\s\S]*\]/);
      const parsedQuestions: unknown = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      aiQuestions = sanitizeQuestions(parsedQuestions);
    } catch {
      aiQuestions = [];
    }

    // ─── Complete ──────────────────────────────────────────────────────────
    await prisma.document.update({
      where: { id: documentId },
      data: { processingStatus: 'COMPLETE', aiQuestions },
    });

    broadcastFeedEvent(patientId, {
      type: 'pipeline',
      documentId,
      step: 'COMPLETE',
      appointmentsAdded: createdAppointments.length,
      medicationsAdded: createdMedications.length,
    });

    broadcastFeedEvent(patientId, { type: 'feed_refresh', patientId });

    captureEvent(userId, 'document_processed', { patientId, documentId, success: true });

  } catch (err: unknown) {
    captureError(err);
    await prisma.document.update({
      where: { id: documentId },
      data: { processingStatus: 'FAILED' },
    });
    broadcastFeedEvent(patientId, { type: 'pipeline', documentId, step: 'FAILED' });
    captureEvent(userId, 'document_processed', { patientId, documentId, success: false });
  }
}
