import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, Pressable } from 'react-native';
import { Link } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { Text } from '@/components/ui/text';
import { LinkText } from '@/components/ui/link';
import { Icon } from '@/components/ui/icon';
import { ArrowBigDown } from 'lucide-react-native';
import { AttachmentDescriptor, MessageEncryption } from '@/utility/securedMessage/secured';
import { utilityFunction } from '@/utility/handleStorage';
import { Files, Message } from '@/utility/types/supabse';

interface EncryptedAttachmentProps {
  message: Message;
  file: Files | null;
  conversationKey: Uint8Array | null;
  kind: 'image' | 'file';
  isCurrentUser?: boolean;
  onPressImage?: (uri: string) => void;
  onLongPress?: () => void;
}

/*
  The descriptor name comes from the sender, so keep only its last path
  segment and drop characters file systems reject. It becomes the temp file's
  name, which is what the share sheet saves the file as.
*/
function safeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  return base && base !== '.' && base !== '..' ? base : 'attachment';
}

/**
 * Renders an image/file message. Messages with a `nonce` carry an encrypted
 * descriptor (name, mime type, per-file key) - the ciphertext blob in storage
 * is downloaded and decrypted to a private temp file before display.
 * Attachments sent before this shipped have no `nonce`, so they fall back to
 * the old direct-signed-URL behavior and keep working.
 */
export default function EncryptedAttachment({
  message,
  file,
  conversationKey,
  kind,
  isCurrentUser,
  onPressImage,
  onLongPress,
}: EncryptedAttachmentProps) {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const isEncrypted = !!message.nonce;
  // An encrypted file's `filename` is its opaque storage id, not something to show.
  const [displayName, setDisplayName] = useState<string>(isEncrypted ? '' : file?.filename ?? '');
  const [mimeType, setMimeType] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const legacyUrl = utilityFunction.buildFileUrl(file);

  useEffect(() => {
    if (!isEncrypted) {
      return;
    }

    if (!conversationKey || !file) {
      setFailed(true);
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        const descriptorJson = MessageEncryption.decryptMessage(
          {
            ciphertext: message.content ?? '',
            nonce: message.nonce ?? '',
            wrappedKey: message.wrapped_key ?? '',
            keyNonce: message.key_nonce ?? '',
          },
          conversationKey as Uint8Array
        );
        const descriptor: AttachmentDescriptor = JSON.parse(descriptorJson);

        const response = await fetch(legacyUrl);
        const ciphertext = new Uint8Array(await response.arrayBuffer());
        const plaintext = MessageEncryption.decryptAttachment(ciphertext, descriptor.key, descriptor.nonce);

        if (cancelled) return;

        if (Platform.OS === 'web') {
          const arrayBuffer = plaintext.buffer.slice(
            plaintext.byteOffset,
            plaintext.byteOffset + plaintext.byteLength
          ) as ArrayBuffer;
          const blobUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: descriptor.mime }));
          cleanupRef.current = () => URL.revokeObjectURL(blobUrl);
          setLocalUri(blobUrl);
        } else {
          // One folder per message, so the file keeps its real name without
          // two attachments called the same thing overwriting each other.
          const tempDir = new Directory(Paths.cache, `att-${message.id}`);
          tempDir.create({ intermediates: true, idempotent: true });
          const tempFile = new File(tempDir, safeFileName(descriptor.name));
          tempFile.write(plaintext);
          cleanupRef.current = () => {
            try {
              tempDir.delete();
            } catch {
              // best-effort cleanup
            }
          };
          setLocalUri(tempFile.uri);
        }

        setDisplayName(descriptor.name);
        setMimeType(descriptor.mime);
      } catch (error) {
        console.error('Unable to decrypt attachment:', error);
        if (!cancelled) setFailed(true);
      }
    }

    run();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEncrypted, conversationKey, file, message.id, message.content, message.nonce, message.wrapped_key, message.key_nonce, legacyUrl]);

  const uri = isEncrypted ? localUri : legacyUrl;

  const shareLocalFile = async () => {
    if (!uri) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sharing = require('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType, dialogTitle: displayName });
      }
    } catch (error) {
      console.error('Unable to open attachment:', error);
    }
  };

  /*
    Android's share sheet only lists apps to send the file to - unlike iOS's
    "Save to Files" there is no way to keep it on the device. So save it through
    the system folder picker instead, which needs no storage permission.
  */
  const saveToDevice = async () => {
    if (!uri) return;
    try {
      const target = await Directory.pickDirectoryAsync();
      const saved = target.createFile(safeFileName(displayName), mimeType ?? 'application/octet-stream');
      saved.write(new File(uri).bytesSync());
      Alert.alert('Saved', `${saved.name} was saved to the folder you picked.`);
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) return;
      console.error('Unable to save attachment:', error);
      Alert.alert('Error', 'Could not save the file. Try another folder.');
    }
  };

  const openLocalFile = () => {
    if (Platform.OS !== 'android') {
      shareLocalFile();
      return;
    }
    Alert.alert(displayName, undefined, [
      { text: 'Save to device', onPress: saveToDevice },
      { text: 'Share', onPress: shareLocalFile },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (kind === 'image') {
    if (failed) {
      return <Text>File/ image not available</Text>;
    }
    if (!uri) {
      return <Text>Loading…</Text>;
    }
    return (
      <Pressable onPress={() => onPressImage?.(uri)} onLongPress={onLongPress}>
        <Image
          source={{ uri }}
          className="w-48 h-48 rounded-lg"
          alt="image"
          onError={(e) => console.log('Image error:', e.nativeEvent.error)}
        />
      </Pressable>
    );
  }

  // File message
  if (failed) {
    return <Text>File/ image not available</Text>;
  }

  if (isEncrypted) {
    return (
      <Pressable onPress={openLocalFile}>
        <LinkText className={`${isCurrentUser ? 'text-white' : 'text-black'} text-xl`}>
          {displayName || 'Loading…'}
        </LinkText>
        <Icon
          as={ArrowBigDown}
          size="lg"
          className={`mt-0.5 text-info-600 ${isCurrentUser ? 'text-white' : 'text-black'}`}
        />
      </Pressable>
    );
  }

  return (
    <Link href={legacyUrl as '/'} target="_blank" rel="noopener noreferrer">
      <LinkText className={`${isCurrentUser ? 'text-white' : 'text-black'} text-xl`}>
        {file?.filename || ''}
      </LinkText>
      <Icon
        as={ArrowBigDown}
        size="lg"
        className={`mt-0.5 text-info-600 ${isCurrentUser ? 'text-white' : 'text-black'}`}
      />
    </Link>
  );
}
