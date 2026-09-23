import { authAPI } from '@/utility/messages';
import { storageAPIs } from '@/utility/handleStorage';
import { SnapShot } from '@/utility/localstorage/snapshot';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { ConversationKeyManager } from '@/utility/securedMessage/ConversationKeyManagement';
import { deleteVaultBackup } from '@/utility/securedMessage/VaultBackup';

/**
 * Delete an account and everything this device kept for it.
 *
 * Shared by Settings and by the key-recovery screen, where it is the way out
 * for someone signed in on a device that has no usable key: without it they
 * cannot reach Settings at all, since the recovery screen sits outside the tabs.
 *
 * Returns false rather than throwing, so callers can report the failure and
 * leave the user where they are with the account still intact.
 */
export async function deleteAccountAndLocalData(
  userId: string,
  hasAvatar: boolean
): Promise<boolean> {
  if (!userId) {
    // Without an id the local cleanup cannot address this account's storage,
    // and deleting server-side first would leave that storage stranded.
    console.error('Cannot delete account: no user id');
    return false;
  }

  try {
    // Must run while the session is still valid: deleteAccount() signs out partway through.
    if (hasAvatar) {
      await storageAPIs.deleteAvatarFromSupabase(userId);
    }

    /*
      The same applies to the key vault, which authenticates every request with
      this session. Its `key_backups` row would cascade away with the profile,
      but the ciphertext blob it points at lives outside Supabase and nothing
      else would ever come to collect it.

      An unreachable vault must not block the deletion: the account is the
      user's to delete, and what would be left behind is an opaque blob that no
      longer has a passphrase attached to anyone.
    */
    try {
      await deleteVaultBackup(userId);
    } catch (error) {
      console.error('Could not remove the key backup from the vault:', error);
    }

    const success = await authAPI.deleteAccount();
    if (!success) {
      return false;
    }
  } catch (error) {
    console.error('Error deleting account:', error);
    return false;
  }

  /*
    Discard the device's copy only once the account is really gone. Doing it
    first would leave a device that cannot read anything while the user still
    has an account.

    Secure Store cannot enumerate its own keys, so the conversation ids come
    from the local snapshots - this device's own record of what it has held.

    Past this point the account no longer exists, so a failure here is reported
    but never returned as failure: telling the caller the deletion failed would
    strand the user on a screen belonging to an account that is already gone.
  */
  try {
    const snapshots = await SnapShot.getMessagesSnapshot();
    const localConversationIds: string[] = snapshots.map((snapshot) => snapshot.conversation_id);

    await Promise.all([
      MessageEncryption.deletePrivateKey(userId),
      ConversationKeyManager.deleteAllKeys(userId, localConversationIds),
      ...localConversationIds.map((id) => SnapShot.deleteSnapshotByConversationId(id)),
    ]);
  } catch (error) {
    console.error('Account deleted, but clearing local data failed:', error);
  }

  return true;
}
