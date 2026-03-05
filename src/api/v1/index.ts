import { Router } from 'express';
import { sendSuccess } from '../../utils';
import { usersRouter } from './users/routes';
import { filesRouter } from './files/routes';
import { walletsRouter } from './wallets/routes';
import { accountsRouter } from './accounts/routes';
import { onrampsRouter } from './onramps/routes';
import { offrampsRouter } from './offramps/routes';
import { limitsRouter } from './limits/routes';

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
