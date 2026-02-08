import React from "react";
import { View, Pressable, StyleSheet, Text as RNText, TouchableWithoutFeedback } from "react-native";
import { Text } from "@/components/ui/text";
import { Icon } from "@/components/ui/icon";
import { ForwardIcon, Trash2Icon, EditIcon } from "lucide-react-native";
import { HStack } from "./ui/hstack";

type MessageActionProps = {
  messageId: string;
  msg_type: string;
  onReaction?: (messageId: string, emoji: string) => void;
  onEdit?: () => void;
  onForward?: () => void;
  onDelete?: () => void;
};

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡"];

const ACTIONS = [
  { id: "edit", icon: EditIcon, label: "Edit", color: "#4b5563" },
  { id: "forward", icon: ForwardIcon, label: "Forward", color: "#4b5563" },
  { id: "delete", icon: Trash2Icon, label: "Delete", color: "#ef4444" },
];

export function MessageAction({
  messageId,
  msg_type,
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
    <View style = { styles.container } >
      <HStack space="md" className="flex-wrap">
        {REACTIONS.map((emoji) => (
          <Pressable
            key = {emoji}
            onPress = {() => onReaction?.(messageId, emoji)}
            style = { styles.reaction }
          >
            <RNText style = { styles.emoji }>{ emoji }</RNText>
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
              style = {styles.action}
              disabled = {
                (action.id === "edit" && !onEdit) ||
                (action.id === "forward" && !onForward) ||
                (action.id === "delete" && !onDelete)
              }
            >
              <Icon
                as = { action.icon }
                size = "md"
                style = {{ color: action.color }}
              />
              <Text
                style = {{
                  fontSize: 10,
                  color: action.color,
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
  reaction: {
    padding: 6,
  },
  emoji: {
    fontSize: 24,
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
