import { useState } from 'react';
import { Alert, FlatList, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { EllipsisVertical } from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Heading } from '@/components/ui/heading';
import { Avatar, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Spinner } from '@/components/ui/spinner';
import { automationLocatorsDataState } from '@/constants/automationLocatorsDataState';
import { paginate, type AccountCard } from '@/utility/auth/RememberedAccounts';

/*
  The "Logined accounts" section of the login screen: up to 4 account cards
  per page (2x2), swipe left/right between pages. Tapping a card signs in;
  the ⋯ button removes the card from this device.
*/

const PAGE_SIZE = 4;
const GAP = 12;
const locators = automationLocatorsDataState.loginScreen;

type Props = {
  accounts: AccountCard[];
  busyUserId: string | null;
  onSelect: (account: AccountCard) => void;
  onRemove: (account: AccountCard) => void;
  onSignIn: () => void;
  onSignUp: () => void;
};

export function RememberedAccountsPanel({ accounts, busyUserId, onSelect, onRemove, onSignIn, onSignUp }: Props) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const pages = paginate(accounts, PAGE_SIZE);
  const cardWidth = width > 0 ? (width - GAP) / 2 : 0;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const confirmRemove = (account: AccountCard) => {
    const name = account.displayName || account.email;
    Alert.alert(
      name,
      'Remove this account from this device? You will need the email and password to sign in again. The account itself is not deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove from this device', style: 'destructive', onPress: () => onRemove(account) },
      ]
    );
  };

  return (
    <Box className="w-full rounded-lg border border-outline-200 p-4 mb-6">
      <Heading className="text-typography-100 mb-3" size="lg">
        Logined accounts
      </Heading>

      <View onLayout={onLayout}>
        {width > 0 && (
          <FlatList
            testID={locators.rememberedAccountsList}
            data={pages}
            keyExtractor={(_, index) => `page-${index}`}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <View style={{ width, flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                {item.map((account) => (
                  <Pressable
                    key={account.userId}
                    testID={`${locators.rememberedAccountCard}-${account.email}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Sign in as ${account.displayName || account.email}`}
                    onPress={() => onSelect(account)}
                    disabled={busyUserId !== null}
                    style={{ width: cardWidth }}
                    className="items-center rounded-lg border border-outline-200 px-2 pb-3 pt-4"
                  >
                    <Pressable
                      testID={`${locators.rememberedAccountMenu}-${account.email}`}
                      accessibilityRole="button"
                      accessibilityLabel={`More options for ${account.displayName || account.email}`}
                      onPress={() => confirmRemove(account)}
                      hitSlop={10}
                      style={{ position: 'absolute', top: 6, right: 4, padding: 4 }}
                    >
                      <EllipsisVertical size={18} color="#9ca3af" />
                    </Pressable>

                    <Avatar size="lg">
                      <AvatarFallbackText>{account.displayName || account.email}</AvatarFallbackText>
                      {account.avatarUri ? <AvatarImage source={{ uri: account.avatarUri }} /> : null}
                    </Avatar>
                    <Text className="text-typography-100 mt-2 text-center font-semibold" numberOfLines={1}>
                      {account.displayName || account.email}
                    </Text>
                    <Text className="text-xs text-typography-400 text-center" numberOfLines={1}>
                      {account.hasSession ? account.email : 'Password needed'}
                    </Text>
                    {busyUserId === account.userId && (
                      <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} className="items-center justify-center">
                        <Spinner size="small" />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          />
        )}
      </View>

      {pages.length > 1 && (
        <View className="mt-3 flex-row justify-center" style={{ gap: 6 }}>
          {pages.map((_, index) => (
            <View
              key={index}
              style={{ width: 8, height: 8, borderRadius: 4 }}
              className={index === page ? 'bg-typography-100' : 'bg-typography-500'}
            />
          ))}
        </View>
      )}

      <View className="mt-4 items-center" style={{ gap: 8 }}>
        <Pressable testID={locators.showSignInFormLink} onPress={onSignIn} hitSlop={8}>
          <Text className="text-typography-100 font-semibold">Sign in to another account</Text>
        </Pressable>
        <Pressable testID={locators.showSignUpFormLink} onPress={onSignUp} hitSlop={8}>
          <Text className="text-typography-100 font-semibold">Create account</Text>
        </Pressable>
      </View>
    </Box>
  );
}
