import { Router } from 'express';
import { sendSuccess } from '@/utils';
import { usersRouter } from '@/api/v1/users/routes';
import { filesRouter } from '@/api/v1/files/routes';
import { walletsRouter } from '@/api/v1/wallets/routes';
import { accountsRouter } from '@/api/v1/accounts/routes';
import { onrampsRouter } from '@/api/v1/onramps/routes';
import { offrampsRouter } from '@/api/v1/offramps/routes';
import { limitsRouter } from '@/api/v1/limits/routes';

const router = Router();

router.get('/health', (_req, res) => {
  sendSuccess(res, { status: 'ok', timestamp: new Date().toISOString() });
});

router.use(filesRouter);
router.use(usersRouter);
router.use(walletsRouter);
router.use(accountsRouter);
router.use('/onramps', onrampsRouter);
router.use('/offramps', offrampsRouter);
router.use(limitsRouter);

export const v1Router = router;
