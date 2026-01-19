declare module "emoji-mart-native" {
  import * as React from "react";

  export interface EmojiData {
    id: string;
    name: string;
    native: string;
    unified: string;
  }

  export interface PickerProps {
    onSelect: (emoji: EmojiData) => void;
    theme?: "light" | "dark";
    emojiSize?: number;
    perLine?: number;
    showPreview?: boolean;
    showSkinTones?: boolean;
  }

  export const Picker: React.ComponentType<PickerProps>;
}
