import { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable } from 'react-native';
import { Link } from 'expo-router';
import { File, Paths } from 'expo-file-system';
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
  const [displayName, setDisplayName] = useState<string>(file?.filename ?? '');
  const [failed, setFailed] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const isEncrypted = !!message.nonce;
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
          const tempFile = new File(Paths.cache, `att-${message.id}`);
          tempFile.write(plaintext);
          cleanupRef.current = () => {
            try {
              tempFile.delete();
            } catch {
              // best-effort cleanup
            }
          };
          setLocalUri(tempFile.uri);
        }

        setDisplayName(descriptor.name);
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

  const openLocalFile = async () => {
    if (!uri) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sharing = require('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      }
    } catch (error) {
      console.error('Unable to open attachment:', error);
    }
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
