import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  env: {
    S3_ENDPOINT: 'https://s3.example.com',
    S3_REGION: 'auto',
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
  },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: vi.fn().mockImplementation((input) => input),
}));

import { copyRemoteDocumentToS3, RemoteDocumentError } from '@/core/files/copyRemoteDocument';

describe('copyRemoteDocumentToS3', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects non-https URLs', async () => {
    await expect(copyRemoteDocumentToS3('http://cdn.example.com/sof.pdf')).rejects.toBeInstanceOf(
      RemoteDocumentError
    );
  });

  it('rejects private hosts', async () => {
    await expect(copyRemoteDocumentToS3('https://127.0.0.1/sof.pdf')).rejects.toMatchObject({
      code: 'INVALID_URL',
    });
  });

  it('copies an https PDF into S3', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 test');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/pdf' : null),
        },
        arrayBuffer: async () =>
          pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
      })
    );

    const result = await copyRemoteDocumentToS3('https://cdn.example.com/path/sof.pdf');
    expect(result.storagePath).toMatch(/^uploads\/DOC-/);
    expect(result.sanitizedFilename).toMatch(/^DOC-/);
  });
});
