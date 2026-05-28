import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { flags } from '../config/flags';
import { prisma } from '../lib/prisma';
import { runPipeline } from '../lib/pipeline';
import { getAnalysisType } from '../lib/validation';
import { broadcastFeedEvent } from './feed';
import { requirePatientAccess } from '../middleware/sessionAuth';

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

// Upload a document and kick off the AI pipeline.
// The pipeline gate runs BEFORE multer so no file is written when the flag is off.
// requirePatientAccess cannot run before multer (body is unparsed for multipart),
// so the ownership check is done inline after multer parses the form fields.
documentsRouter.post(
  '/upload',
  (req, res, next) => {
    if (!flags.PIPELINE_ENABLED) {
      return res.status(503).json({ error: 'Document pipeline is currently disabled.' });
    }
    next();
  },
  upload.single('file'),
  async (req, res) => {
    const cleanup = () => { if (req.file?.path) fs.unlink(req.file.path, () => {}); };
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const { patientId, analysisType } = req.body;
      if (!patientId) {
        cleanup();
        return res.status(400).json({ error: 'patientId is required' });
      }

      // Ownership check — must happen after multer so req.body is populated
      if (patientId !== req.user!.patientId) {
        cleanup();
        return res.status(403).json({ error: 'Access denied' });
      }

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
      cleanup();
      console.error(err);
      res.status(500).json({ error: 'Upload failed' });
    }
  },
);

// List documents for a patient — must be before /:id to avoid route conflict
documentsRouter.get('/list/:patientId', requirePatientAccess, async (req, res) => {
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
    const document = await prisma.document.findUnique({
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
    if (!document) return res.status(404).json({ error: 'Document not found' });
    if (document.patientId !== req.user!.patientId) return res.status(403).json({ error: 'Access denied' });
    res.json(document);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// SSE stream for pipeline status — delegates to feed SSE
documentsRouter.get('/events/:patientId', requirePatientAccess, (req, res) => {
  res.redirect(`/api/feed/events/${req.params.patientId}`);
});
