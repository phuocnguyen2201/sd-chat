import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConversationKeyManager } from '@/utility/securedMessage/ConversationKeyManagement';
import { MessageEncryption } from '@/utility/securedMessage/secured';

/*
  Shows new-message notifications with the decrypted text (Android only).

  Messages are end-to-end encrypted, so the `push` edge function can't put the
  text in the notification. For tokens marked preview_capable it sends a
  data-only push carrying the ciphertext instead. Android hands that to this
  task - in the foreground, in the background, or with the app killed - and the
  task decrypts it with the conversation key already on this device and posts a
  local notification.

  Nothing here goes to the network and no key is ever created: if this device
  doesn't hold the key, or anything fails, the notification says "New message".

  This module must be imported early (app/_layout.tsx) so the task is defined
  when Android starts the JS bundle headless for a push.
*/

export const BACKGROUND_MESSAGE_TASK = 'sdchat-background-message';

const FALLBACK_BODY = 'New message';
const MAX_BODY_LENGTH = 200;

type MessagePushData = {
  kind?: string;
  message_id?: string;
  conversation_id?: string;
  sender_id?: string;
  displayname?: string;
  public_key?: string;
  message_type?: string;
  content?: string;
  nonce?: string;
  wrapped_key?: string;
  key_nonce?: string;
};

function readPushData(payload: Notifications.NotificationTaskPayload | undefined): MessagePushData | null {
  if (!payload || 'actionIdentifier' in payload) {
    // A notification tap, handled by the listeners in Bootstrap.tsx / Chat.tsx.
    return null;
  }
  const raw = payload.data ?? {};
  if (typeof raw.dataString === 'string') {
    try {
      return JSON.parse(raw.dataString);
    } catch {
      return null;
    }
  }
  return raw as MessagePushData;
}

async function decryptBody(data: MessagePushData): Promise<string> {
  const { conversation_id, content, nonce, wrapped_key, key_nonce } = data;
  if (!conversation_id || !content || !nonce || !wrapped_key || !key_nonce) {
    return FALLBACK_BODY;
  }

  const user = await AsyncStorage.getItem('user').then((d) => (d ? JSON.parse(d) : null));
  if (!user?.id) return FALLBACK_BODY;

  const key = await ConversationKeyManager.getKey(user.id, conversation_id);
  if (!key) return FALLBACK_BODY;

  try {
    const text = MessageEncryption.decryptMessage(
      { ciphertext: content, nonce, wrappedKey: wrapped_key, keyNonce: key_nonce },
      key
    );
    return text.length > MAX_BODY_LENGTH ? `${text.slice(0, MAX_BODY_LENGTH)}…` : text;
  } catch {
    return FALLBACK_BODY;
  }
}

export async function showMessageNotification(data: MessagePushData): Promise<void> {
  if (data.kind !== 'message' || !data.conversation_id) return;

  const body = await decryptBody(data);

  await Notifications.scheduleNotificationAsync({
    // Same id twice replaces instead of stacking a duplicate.
    identifier: data.message_id,
    content: {
      title: data.displayname || 'New Message',
      body,
      sound: 'default',
      // The shape the tap handlers in Bootstrap.tsx / Chat.tsx read.
      data: {
        conversation_id: data.conversation_id,
        displayname: data.displayname,
        public_key: data.public_key,
      },
    },
    trigger: null,
  });
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(BACKGROUND_MESSAGE_TASK, async ({ data }) => {
  try {
    const push = readPushData(data);
    if (!push) return Notifications.BackgroundNotificationTaskResult.NoData;
    await showMessageNotification(push);
    return Notifications.BackgroundNotificationTaskResult.NewData;
  } catch (error) {
    console.error('Message notification task failed:', error);
    return Notifications.BackgroundNotificationTaskResult.Failed;
  }
});

if (Platform.OS === 'android') {
  Notifications.registerTaskAsync(BACKGROUND_MESSAGE_TASK).catch((error) =>
    console.error('Could not register message notification task:', error)
  );
}

/** True for the data-only pushes this task handles; they have nothing to display themselves. */
export function isDataOnlyMessagePush(notification: Notifications.Notification): boolean {
  const content = notification.request.content;
  return !content.title && !content.body && (content.data as MessagePushData | undefined)?.kind === 'message';
}
