/**
 * Admin dashboard routes (NO AUTH). Mounted at /dashboard/api in app.ts,
 * before the API-key auth middleware.
 */

import { Router } from 'express';
import * as controllers from '@/api/admin/controllers';
import { logger } from '@/lib/logger';

const router = Router();

// Lightweight request logging for the dashboard API (the app has no global
// request logger). Logs method/path/status/duration on response finish.
router.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(
      { method: req.method, path: req.originalUrl, status: res.statusCode, ms: Date.now() - start },
      'dashboard api request'
    );
  });
  next();
});

router.get('/transactions', controllers.listTransactions);
router.get('/transactions/:type/:id', controllers.getTransaction);
router.post('/transactions/:type/:id/mark', controllers.markTransaction);

export const adminRouter = router;
