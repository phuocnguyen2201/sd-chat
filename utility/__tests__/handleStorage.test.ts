/**
 * Attachment upload encryption (security #5): the plaintext filename and raw
 * file bytes must never reach Supabase - only an opaque object name, a
 * generic mime type, and a descriptor encrypted under the conversation key.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));
jest.mock('expo-secure-store', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
}));

const mockUpload = jest.fn(async () => ({ data: { path: 'messages/convo-1/uuid' }, error: null }));
const mockCreateSignedUrl = jest.fn(async () => ({
  data: { signedUrl: 'https://example.test/signed?token=abc123' },
  error: null,
}));
const mockMessagesInsert = jest.fn(() => ({
  select: jest.fn(() => ({ single: jest.fn(async () => ({ data: { id: 'message-1' }, error: null })) })),
}));
const mockFilesInsert = jest.fn(async () => ({ data: null, error: null }));

jest.mock('../messages', () => ({
  profileAPI: { getImagesbyProfile: jest.fn() },
}));
// handleStorage.ts imports these only for their types (namespace imports
// aren't elided by the babel TS transform), but requiring the real modules
// drags in native bindings that don't work under jest-expo.
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('uuid', () => ({ v4: () => '11111111-2222-4333-8444-555555555555' }));

jest.mock('../connection', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
      })),
    },
    from: jest.fn((table: string) => {
      if (table === 'messages') return { insert: mockMessagesInsert };
      if (table === 'files') return { insert: mockFilesInsert };
      throw new Error(`unexpected table: ${table}`);
    }),
  },
}));

import { storageAPIs } from '../handleStorage';
import { MessageEncryption } from '../securedMessage/secured';

const CONVO = 'convo-1';
const USER = 'user-1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const originalFetch = global.fetch;

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = originalFetch;
});

describe('storageAPIs.uploadImageToSupabase', () => {
  it('stores the ciphertext under an opaque uuid name and seals the descriptor under the conversation key', async () => {
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
    global.fetch = jest.fn(async () => ({ arrayBuffer: async () => plaintext.buffer })) as unknown as typeof fetch;

    const conversationKey = new Uint8Array(32).fill(4);
    const image = {
      uri: 'file://photo.jpg',
      fileName: 'super-secret-plans.jpg',
      mimeType: 'image/jpeg',
    } as unknown as Parameters<typeof storageAPIs.uploadImageToSupabase>[0];

    const result = await storageAPIs.uploadImageToSupabase(image, CONVO, USER, conversationKey);
    expect(result.success).toBe(true);

    // Opaque storage path/object name: no trace of the original filename, and
    // the uploaded bytes are ciphertext, not the raw plaintext.
    const [uploadPath, uploadedBytes, uploadOptions] = mockUpload.mock.calls[0];
    expect(uploadPath).not.toContain('super-secret-plans');
    expect(String(uploadPath).split('/').pop()).toMatch(UUID_RE);
    expect(uploadOptions).toMatchObject({ contentType: 'application/octet-stream' });
    expect(uploadedBytes).not.toEqual(plaintext);

    // The message row's content must not leak the filename in the clear.
    const [insertedRows] = mockMessagesInsert.mock.calls[0];
    const messageRow = insertedRows[0];
    expect(messageRow.content).not.toContain('super-secret-plans');

    // ...but it does decrypt back to the real name under the conversation key,
    // proving the descriptor really was sealed with it before the insert.
    const decrypted = JSON.parse(
      MessageEncryption.decryptMessage(
        {
          ciphertext: messageRow.content,
          nonce: messageRow.nonce,
          wrappedKey: messageRow.wrapped_key,
          keyNonce: messageRow.key_nonce,
        },
        conversationKey
      )
    );
    expect(decrypted.name).toBe('super-secret-plans.jpg');

    // The files-table row blanks the original name and mime type.
    const [fileRow] = mockFilesInsert.mock.calls[0];
    expect(fileRow.mime_type).toBe('application/octet-stream');
    expect(fileRow.original_name).toBe('');
    expect(fileRow.filename).toMatch(UUID_RE);
  });
});
