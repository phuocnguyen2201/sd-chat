# Chat Room Editing Screen

**Source:** [`app/tabs/msg/ChatRoomEditing.tsx`](../../../app/tabs/msg/ChatRoomEditing.tsx)

This stack screen displays conversation details and shared media. It supports editing group presentation details.

## Behavior

- Loads the conversation avatar and determines whether the conversation is a group.
- For group conversations, allows the group name to be edited and saved to the `conversations` table.
- Allows a group avatar to be selected from the gallery or captured with the camera.
- For one-to-one conversations, shows the other participant's avatar and display name without a group-name editor.
- Loads image and file records for the conversation through `filesAPI.getFilesAndImagesOnly()`.
- Displays images with the `ZoomImage` viewer and files as links.
- Shows `No images and files yet.` when no shared media is available.

## Navigation

The chat room opens this screen from its header action and passes `conversation_id` and `displayName`. Saving a group name returns to the previous screen.

## Storage

Avatar processing and upload are delegated to `storageAPIs`; profile/group file records are inserted or updated through `filesAPI`.
