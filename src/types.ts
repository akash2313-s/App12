import { Timestamp } from 'firebase/firestore';

export type PrivacyLevel = 'everyone' | 'contacts' | 'nobody';
export type AccountStatus = 'active' | 'suspended' | 'banned';
export type ThemeMode = 'light' | 'dark' | 'system';
export type MessageType = 'text' | 'image' | 'video' | 'document' | 'voice' | 'sticker';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';
export type NavTab = 'home' | 'chats' | 'search' | 'profile' | 'settings' | 'admin';

export interface UserPublic {
  userId: string;
  username: string;
  name: string;
  profilePhoto: string;
  bio: string;
  isOnline: boolean;
  lastSeen: string;
  privacyPhoto: PrivacyLevel;
  privacyLastSeen: PrivacyLevel;
  privacyOnline: PrivacyLevel;
  readReceipts: boolean;
  accountStatus: AccountStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserPrivate {
  userId: string;
  email: string;
  phone: string;
  blockedUsers: string[];
  pinnedChats: string[];
  archivedChats: string[];
  mutedChats: string[];
  wallpaper: string;
  enterToSend: boolean;
  mediaAutoDownload: boolean;
  notificationsEnabled: boolean;
  notificationSound: boolean;
  notificationVibration: boolean;
  notificationPreview: boolean;
  theme: ThemeMode;
  updatedAt: Timestamp;
}

export interface UsernameRegistry {
  username: string;
  userId: string;
  createdAt: Timestamp;
}

export interface ChatThread {
  chatId: string;
  participant1: string;
  participant2: string;
  participants: [string, string];
  lastMessageText: string;
  lastMessageType: MessageType;
  lastMessageSenderId: string;
  lastMessageTime: string;
  unreadCount1: number;
  unreadCount2: number;
  clearedAt1: string;
  clearedAt2: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ChatMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  receiverId: string;
  participants: [string, string];
  messageType: MessageType;
  text: string;
  mediaUrl: string;
  mediaName: string;
  status: MessageStatus;
  replyToId: string;
  replyToText: string;
  replyToSenderName: string;
  isForwarded: boolean;
  isDeleted: boolean;
  reactionsSummary: string; // JSON string or compact key:uid pairs e.g. "👍:uid1|❤️:uid2"
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ModerationReport {
  reportId: string;
  reporterId: string;
  targetUserId: string;
  reason: string;
  details: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SystemAnnouncement {
  announcementId: string;
  title: string;
  body: string;
  authorId: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
