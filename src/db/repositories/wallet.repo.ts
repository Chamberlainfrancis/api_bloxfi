/**
 * External wallet repository. Only layer that touches Prisma for ExternalWallet.
 * Per CURSOR_RULES: all DB access for external wallets goes through this file.
 */

import { prisma } from '../prisma/client';
import type { BlockchainNetwork } from '../../types/wallet';
import type { BlockchainNetwork as PrismaBlockchainNetwork } from '../../../generated/prisma';

const CHAIN_MAP: Record<BlockchainNetwork, PrismaBlockchainNetwork> = {
  POLYGON: 'POLYGON',
  ETHEREUM: 'ETHEREUM',
  BASE: 'BASE',
  SOLANA: 'SOLANA',
  ARBITRUM: 'ARBITRUM',
  OPTIMISM: 'OPTIMISM',
  AVALANCHE: 'AVALANCHE',
  BNB_CHAIN: 'BNB_CHAIN',
};

export interface CreateExternalWalletData {
  userId: string;
  address: string;
  chain: BlockchainNetwork;
  name: string;
  referenceId: string;
  active?: boolean;
}

export async function createExternalWallet(data: CreateExternalWalletData): Promise<{
  id: string;
  userId: string;
  address: string;
  chain: string;
  name: string;
  referenceId: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date | null;
}> {
  const wallet = await prisma.externalWallet.create({
    data: {
      userId: data.userId,
      address: data.address.trim(),
      chain: CHAIN_MAP[data.chain],
      name: data.name.trim(),
      referenceId: data.referenceId.trim(),
      active: data.active ?? true,
    },
  });
  return {
    ...wallet,
    chain: wallet.chain,
    updatedAt: wallet.updatedAt,
  };
}

export async function findExternalWalletByIdAndUser(
  walletId: string,
  userId: string
): Promise<{
  id: string;
  userId: string;
  address: string;
  chain: string;
  name: string;
  referenceId: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date | null;
} | null> {
  const wallet = await prisma.externalWallet.findFirst({
    where: { id: walletId, userId },
  });
  return wallet;
}

export interface ListExternalWalletsParams {
  userId: string;
  limit: number;
  createdBefore?: Date;
  chain?: BlockchainNetwork;
  active?: boolean;
}

export async function listExternalWallets(params: ListExternalWalletsParams): Promise<{
  wallets: Array<{
    id: string;
    userId: string;
    address: string;
    chain: string;
    name: string;
    referenceId: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date | null;
  }>;
  nextCursor: Date | null;
}> {
  const { userId, limit, createdBefore, chain, active } = params;
  const take = Math.min(Math.max(1, limit), 100);
  const where: {
    userId: string;
    createdAt?: { lt: Date };
    chain?: PrismaBlockchainNetwork;
    active?: boolean;
  } = { userId };
  if (createdBefore) {
    where.createdAt = { lt: createdBefore };
  }
  if (chain !== undefined) {
    where.chain = CHAIN_MAP[chain];
  }
  if (active !== undefined) {
    where.active = active;
  }
  const wallets = await prisma.externalWallet.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
  });
  const hasMore = wallets.length > take;
  const page = hasMore ? wallets.slice(0, take) : wallets;
  const nextCursor = hasMore && page.length > 0
    ? page[page.length - 1].createdAt
    : null;
  return {
    wallets: page.map((w) => ({
      ...w,
      updatedAt: w.updatedAt,
    })),
    nextCursor,
  };
}

export async function updateExternalWallet(
  walletId: string,
  userId: string,
  data: { name?: string; active?: boolean }
): Promise<{
  id: string;
  userId: string;
  address: string;
  chain: string;
  name: string;
  referenceId: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date | null;
} | null> {
  const updated = await prisma.externalWallet.updateMany({
    where: { id: walletId, userId },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.active !== undefined && { active: data.active }),
      updatedAt: new Date(),
    },
  });
  if (updated.count === 0) return null;
  return findExternalWalletByIdAndUser(walletId, userId);
}

export async function deleteExternalWallet(
  walletId: string,
  userId: string
): Promise<{ id: string; deletedAt: Date } | null> {
  const wallet = await findExternalWalletByIdAndUser(walletId, userId);
  if (!wallet) return null;
  await prisma.externalWallet.delete({
    where: { id: walletId },
  });
  return { id: walletId, deletedAt: new Date() };
}

/**
 * Whether the wallet has pending transactions (onramp/offramp).
 * When Feature 5/6 exist, query those tables. Until then, no pending.
 */
export async function hasPendingTransactions(_walletId: string): Promise<boolean> {
  return false;
}
