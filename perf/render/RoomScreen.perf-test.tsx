/**
 * Render cost of the chat room screen (`app/tabs/msg/[room_id].tsx`).
 * Run with `npm run perf:render` (Reassure). Not part of `npx jest`.
 *
 * The room decrypts every message during render, and the composer's text lives
 * in screen state, so these scenarios track two things: the first paint of a
 * full page of messages, and what each keystroke in the composer costs.
 *
 * Supabase, the session and the router are mocked. Messages are real
 * ciphertext, so the decryption work being measured is the real work.
 */
import { jest, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';

// Reassure repeats each scenario ~10 times, so the 5 s default is too short.
jest.setTimeout(120_000);

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

const mockConversationKey = new Uint8Array(32).fill(9);
const mockUserId = 'user-self';
const mockConversationId = 'convo-perf';
const mockMessages: unknown[] = [];

jest.mock('@/utility/connection', () => {
  const channel: any = {
    on: () => channel,
    subscribe: () => channel,
    unsubscribe: () => undefined,
  };
  return {
    supabase: {
      rpc: () => ({ limit: async () => ({ data: mockMessages, error: null }) }),
      channel: () => channel,
      removeChannel: () => undefined,
      from: () => ({ insert: async () => ({ error: null }) }),
    },
  };
});

jest.mock('@/utility/session/SessionProvider', () => ({
  useSession: () => ({
    user: { id: mockUserId },
    profile: { id: mockUserId, display_name: 'Me' },
    isDarkMode: 'light',
    conversationKey: mockConversationKey,
    currentConversationId: mockConversationId,
    getConversationKey: async () => mockConversationKey,
    setCurrentConversation: async () => undefined,
  }),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ conversation_id: mockConversationId, displayName: 'Perf room' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('@/utility/securedMessage/ConversationKeyResolver', () => ({
  resolveConversationKeyInteractive: async () => ({ status: 'found', key: mockConversationKey }),
}));
jest.mock('@/utility/messages', () => ({
  conversationAPI: {},
  messageAPI: { refreshMessage: async () => ({ data: null }) },
  reactionAPI: {},
}));
jest.mock('@/utility/handleStorage', () => ({
  storageAPIs: {},
  filesAPI: {},
  utilityFunction: { buildFileUrl: () => '' },
}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('emoji-mart-native', () => ({ Picker: () => null }));
jest.mock('@/components/EncryptedAttachment', () => () => null);
jest.mock('@/components/ZoomImage', () => () => null);
jest.mock('@/components/ForwardMessage', () => () => null);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { MessageEncryption } from '@/utility/securedMessage/secured';
import ChatScreen from '@/app/tabs/msg/[room_id]';

/** A page of text messages, alternating senders in runs, with a few reactions. */
function seedMessages(count: number) {
  mockMessages.length = 0;
  for (let i = 0; i < count; i++) {
    const fromSelf = Math.floor(i / 3) % 2 === 0;
    const envelope = MessageEncryption.encryptMessage(`Message number ${i}, long enough to wrap once on a phone`, mockConversationKey);
    mockMessages.push({
      id: `msg-${i}`,
      conversation_id: mockConversationId,
      sender_id: fromSelf ? mockUserId : 'user-peer',
      displayname: fromSelf ? 'Me' : 'Peer',
      message_type: 'text',
      content: envelope.ciphertext,
      nonce: envelope.nonce,
      wrapped_key: envelope.wrappedKey,
      key_nonce: envelope.keyNonce,
      reactions:
        i % 10 === 0
          ? [{ id: `r-${i}`, sender_id: 'user-peer', sender_username: 'Peer', emoji: '👍', message_id: `msg-${i}` }]
          : [],
      created_at: new Date(2026, 0, 1, 0, i).toISOString(),
    });
  }
}

const waitForMessages = async (count: number) => {
  await screen.findByText(`Message number ${count - 1}, long enough to wrap once on a phone`, {}, { timeout: 10_000 });
};

// The screen loads 30 messages per page (`get_messages_with_reactions` .limit(30)).
test('Room: first render of a 30-message page', async () => {
  seedMessages(30);
  await measureRenders(<ChatScreen />, { scenario: () => waitForMessages(30) });
});

test('Room: first render of 200 messages (long session, after realtime inserts)', async () => {
  seedMessages(200);
  await measureRenders(<ChatScreen />, { scenario: () => waitForMessages(200) });
});

test('Room: typing 10 characters with 30 messages on screen', async () => {
  seedMessages(30);
  const scenario = async () => {
    await waitForMessages(30);
    const input = screen.getByTestId('message-input');
    let text = '';
    for (const ch of 'hello room') {
      text += ch;
      await fireEvent.changeText(input, text);
    }
  };
  await measureRenders(<ChatScreen />, { scenario });
});
