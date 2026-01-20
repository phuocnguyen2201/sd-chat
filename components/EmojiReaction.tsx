import React from "react";
import { View, Pressable, StyleSheet, Text } from "react-native";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡"];

type ReactionPopupProps = {
  messageId: string;
  onSelect: (messageId: string, emoji: string) => void;
};

export function EmojiReaction({
  messageId,
  onSelect,
}: ReactionPopupProps) {
  return (
    <View style={styles.container}>
      {REACTIONS.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => onSelect(messageId, emoji)}
          style={styles.reaction}
        >
          <Text style={styles.emoji}>{emoji}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#fff",
    padding: 6,
    borderRadius: 24,
    elevation: 5,
    borderColor: "#030f3e"
  },
  reaction: {
    padding: 6,
  },
  emoji: {
    fontSize: 24,
  },
});
