import React, { useContext } from "react";
import { View, Pressable, StyleSheet, Text as RNText } from "react-native";
import { Text } from "@/components/ui/text";
import { Icon } from "@/components/ui/icon";
import { ForwardIcon, Trash2Icon, EditIcon } from "lucide-react-native";
import { HStack } from "./ui/hstack";
import { useSession } from '@/utility/session/SessionProvider';
type MessageActionProps = {
  messageId: string;
  msg_type: string;
  id_darkMode: boolean;
  onReaction?: (messageId: string, emoji: string) => void;
  onEdit?: () => void;
  onForward?: () => void;
  onDelete?: () => void;
};

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡"];

const ACTIONS = [
  { id: "edit", icon: EditIcon, label: "Edit", color: "#4b5563", dark_color: '#fff' },
  { id: "forward", icon: ForwardIcon, label: "Forward", color: "#4b5563", dark_color: '#fff' },
  { id: "delete", icon: Trash2Icon, label: "Delete", color: "#ef4444", dark_color: '#fff' },
];



export function MessageAction({
  messageId,
  msg_type,
  id_darkMode,
  onReaction,
  onEdit,
  onForward,
  onDelete,
}: MessageActionProps) {
  const handleAction = (actionId: string) => {
    switch (actionId) {
      case "edit":
        onEdit?.();
        break;
      case "forward":
        onForward?.();
        break;
      case "delete":
        onDelete?.();
        break;
    }
  };
  return (
    <View style = { id_darkMode ? styles.dark_contain: styles.container } >
      
      <HStack space="md" className="flex-wrap">
        {REACTIONS.map((emoji) => (
          <Pressable
            key = {emoji}
            onPress = {() => onReaction?.(messageId, emoji)}
            style = { styles.reaction }
          >
            <RNText style = {  id_darkMode? styles.dark_emoji:styles.emoji }>{ emoji }</RNText>
          </Pressable>
        ))}

        <View style = { styles.divider } />

        {ACTIONS.map((action) => {
          // Skip edit action if msg_type is not 'text'
          if (action.id === "edit" && msg_type !== "text") {
            return null;
          }

          return (
            <Pressable
              key = { action.id }
              onPress = {() => handleAction(action.id)}
              style = { id_darkMode ? styles.dark_contain : styles.action}
              disabled = {
                (action.id === "edit" && !onEdit) ||
                (action.id === "forward" && !onForward) ||
                (action.id === "delete" && !onDelete)
              }
            >
              <Icon
                as = { action.icon }
                size = "md"
                style = {{ color: id_darkMode? action.dark_color: action.color }}
              />
              <Text
                style = {{
                  fontSize: 10,
                  color: id_darkMode? action.dark_color: action.color,
                  marginTop: 4,
                  textAlign: "center",
                }}
              >
                { action.label }
              </Text>
            </Pressable>
          );
        })}
      </HStack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    padding: 8,
    borderRadius: 24,
    elevation: 5,
    borderColor: "#030f3e",
    alignItems: "center",
    justifyContent: "center",
  },
  dark_contain:{
    backgroundColor: "#303030",
    padding: 8,
    borderRadius: 24,
    elevation: 5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  reaction: {
    padding: 6,
  },
  emoji: {
    fontSize: 24,
  },
  dark_emoji:{
    fontSize: 24,
    textShadowColor: 'white',
    textShadowRadius: 10,
  },
  divider: {
    width: 1,
    height: 32,
    backgroundColor: "#e5e7eb",
    marginHorizontal: 8,
  },
  action: {
    padding: 8,
    alignItems: "center",
    marginHorizontal: 4,
  },
});
