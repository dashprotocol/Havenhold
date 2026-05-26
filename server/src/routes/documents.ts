import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { runPipeline } from '../lib/pipeline';
import { getAnalysisType } from '../lib/validation';
import { broadcastFeedEvent } from './feed';

export const documentsRouter = Router();

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_MIMETYPES = new Set(['application/pdf', 'text/plain']);
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    // Sanitize filename — strip path traversal characters
    const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMETYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and plain text files are accepted'));
    }
  },
});

// Upload a document and kick off the AI pipeline
documentsRouter.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { patientId, analysisType } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const safeAnalysisType = getAnalysisType(analysisType);

    // Extract text — use async fs.promises to avoid blocking the event loop
    let rawText = '';
    if (req.file.mimetype === 'application/pdf') {
      const pdfParse = await import('pdf-parse');
      const buffer = await fs.promises.readFile(req.file.path);
      const parsed = await pdfParse.default(buffer);
      rawText = parsed.text;
    } else {
      rawText = await fs.promises.readFile(req.file.path, 'utf-8');
    }

    // Store rawText only for pipeline use — never returned in API responses
    const document = await prisma.document.create({
      data: {
        patientId,
        filename: req.file.originalname,
        fileUrl: `/uploads/${req.file.filename}`,
        processingStatus: 'PENDING',
        analysisType: safeAnalysisType,
        rawText,
      },
    });

    broadcastFeedEvent(patientId, { type: 'feed_refresh', patientId });

    // Fire-and-forget — respond immediately, pipeline runs async
    runPipeline(document.id, rawText, patientId, safeAnalysisType).catch(console.error);

    res.status(201).json({ documentId: document.id, status: 'PENDING' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// List documents for a patient — must be before /:id to avoid route conflict
documentsRouter.get('/list/:patientId', async (req, res) => {
  try {
    const documents = await prisma.document.findMany({
      where: { patientId: req.params.patientId as string },
      select: {
        id: true,
        filename: true,
        processingStatus: true,
        uploadedAt: true,
      },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json(documents);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Get a single document — rawText excluded
documentsRouter.get('/:id', async (req, res) => {
  try {
    const document = await prisma.document.findUniqueOrThrow({
      where: { id: req.params.id },
      select: {
        id: true,
        patientId: true,
        filename: true,
        fileUrl: true,
        processingStatus: true,
        aiSummary: true,
        aiQuestions: true,
        uploadedAt: true,
        comments: { include: { author: true }, orderBy: { createdAt: 'asc' } },
        appointments: true,
        medications: true,
      },
    });
    res.json(document);
  } catch (err) {
    res.status(404).json({ error: 'Document not found' });
  }
});

// SSE stream for pipeline status — delegates to feed SSE
documentsRouter.get('/events/:patientId', (req, res) => {
  res.redirect(`/api/feed/events/${req.params.patientId}`);
});
