import { Router } from 'express';
import { usersRouter } from '@/api/v1/users/routes';
import { filesRouter } from '@/api/v1/files/routes';
import { walletsRouter } from '@/api/v1/wallets/routes';
import { accountsRouter } from '@/api/v1/accounts/routes';
import { onrampsRouter } from '@/api/v1/onramps/routes';
import { offrampsRouter } from '@/api/v1/offramps/routes';
import { limitsRouter } from '@/api/v1/limits/routes';
import { networksRouter } from '@/api/v1/networks/routes';
import { coinsRouter } from '@/api/v1/coins/routes';
import { banksRouter } from '@/api/v1/banks/routes';
import { payoutCorridorsRouter } from '@/api/v1/payout-corridors/routes';
import { miscRouter } from '@/api/v1/misc/routes';
import { beneficiariesRouter } from '@/api/v1/beneficiaries/routes';

const router = Router();

router.use(filesRouter);
router.use(usersRouter);
router.use(walletsRouter);
router.use(accountsRouter);
router.use('/onramps', onrampsRouter);
router.use('/offramps', offrampsRouter);
router.use('/beneficiaries', beneficiariesRouter);
router.use(coinsRouter);
router.use(banksRouter);
router.use(payoutCorridorsRouter);
router.use(networksRouter);
router.use(limitsRouter);
router.use(miscRouter);

export const v1Router = router;
