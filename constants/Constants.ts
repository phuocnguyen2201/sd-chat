export const Constants = {
    TABLE:{ MESSAGES: 'messages', PROFILES: 'profiles', CONVERSATIONS: 'conversations' },
    COLUMNS: {
        MESSAGES: {
            ID: 'id',
            CONVERSATION_ID: 'conversation_id',
            SENDER_ID: 'sender_id',
            CONTENT: 'content',
            CREATED_AT: 'created_at',
        },
        PROFILES: {
            ID: 'id',
            DISPLAYNAME: 'displayname',
            AVATAR_URL: 'avatar_url',
            FCM_TOKEN: 'fcm_token',
        },
        CONVERSATIONS: {
            ID: 'id',
            TYPE: 'type',
            CREATED_AT: 'created_at',
        },
    },
};
