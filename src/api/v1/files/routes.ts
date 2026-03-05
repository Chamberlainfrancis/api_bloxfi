/**
 * File upload routes. Spec §1.4.
 * POST /files — multipart/form-data, max 10MB, PDF/JPEG/PNG.
 */

import { Router } from 'express';
import multer from 'multer';
import { uploadFileHandler } from './controllers';
import { MAX_FILE_SIZE_BYTES } from '../../../services/storage';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

const router = Router();

router.post('/files', upload.single('file'), uploadFileHandler);

export const filesRouter = router;
