/**
 * Render cost of the chat list tab (`app/tabs/(tabs)/Chat.tsx`).
 * Run with `npm run perf:render` (Reassure). Not part of `npx jest`.
 *
 * The search box filters through an effect that copies results into state,
 * so each keystroke is worth tracking. Data comes from mocked APIs; nothing
 * talks to Supabase or SQLite.
 */
import { jest, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';

// Reassure repeats each scenario ~10 times, so the 5 s default is too short.
jest.setTimeout(120_000);

const mockUserId = 'user-self';
const mockProfiles: unknown[] = [];
const mockConversations: unknown[] = [];

jest.mock('@/utility/session/SessionProvider', () => ({
  useSession: () => ({
    user: { id: mockUserId },
    profile: { id: mockUserId, displayname: 'Me', public_key: '' },
    isDarkMode: 'light',
    setCurrentConversation: async () => undefined,
  }),
}));
jest.mock('@/utility/messages', () => ({
  profileAPI: { getAllProfiles: async () => ({ data: mockProfiles }) },
  conversationAPI: { getConversations: async () => ({ data: mockConversations }) },
  realtimeAPI: { subscribeToConversations: () => ({ unsubscribe: () => undefined }) },
}));
jest.mock('@/utility/localstorage/snapshot', () => ({
  createSnapshotTable: () => undefined,
  SnapShot: {
    getMessagesSnapshot: async () => [],
    saveMessageSnapshot: async () => undefined,
  },
}));
jest.mock('@/utility/handleStorage', () => ({ utilityFunction: { buildFileUrl: () => '' } }));
jest.mock('@/utility/connection', () => ({ supabase: {} }));
jest.mock('@/utility/securedMessage/ConversationKeyResolver', () => ({
  resolveConversationKeyInteractive: async () => ({ status: 'absent' }),
  backfillMissingWrappedKeys: async () => undefined,
}));
jest.mock('@/utility/securedMessage/ConversationKeyManagement', () => ({ ConversationKeyManager: {} }));
jest.mock('@/utility/securedMessage/PeerKeyPins', () => ({ PeerKeyPins: {} }));
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: () => ({ remove: () => undefined }),
  addNotificationResponseReceivedListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@/components/CreateGroupChat', () => () => null);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import Chat from '@/app/tabs/(tabs)/Chat';

/** `count` DMs with one peer each, plus the same peers in the user strip. */
function seed(count: number) {
  mockProfiles.length = 0;
  mockConversations.length = 0;
  for (let i = 0; i < count; i++) {
    const peer = { id: `peer-${i}`, username: `peer${i}`, displayname: `Peer ${i}`, avatar_url: '', files_profiles: [] };
    mockProfiles.push(peer);
    mockConversations.push({
      id: `convo-${i}`,
      conversation_id: `convo-${i}`,
      name: null,
      is_group: false,
      created_at: new Date(2026, 0, 1, 0, i).toISOString(),
      created_by: mockUserId,
      avatar_url: '',
      files_group: [],
      conversation_participants: [
        { profiles: { id: mockUserId, username: 'me', displayname: 'Me', avatar_url: '', files_profiles: [] } },
        { profiles: peer },
      ],
      messages: [{ id: `m-${i}`, sender_id: peer.id, content: 'ciphertext' }],
    });
  }
}

// The name shows in both the user strip and the conversation row.
const waitForList = async (count: number) => {
  await screen.findAllByText(`Peer ${count - 1}`, {}, { timeout: 10_000 });
};

test('Chat list: first render with 50 conversations', async () => {
  seed(50);
  await measureRenders(<Chat />, { scenario: () => waitForList(50) });
});

test('Chat list: typing a 6-character search with 50 conversations', async () => {
  seed(50);
  const scenario = async () => {
    await waitForList(50);
    const input = screen.getByTestId('search-input');
    let text = '';
    for (const ch of 'peer 4') {
      text += ch;
      await fireEvent.changeText(input, text);
    }
  };
  await measureRenders(<Chat />, { scenario });
});
