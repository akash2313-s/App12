/**
 * Firestore Rules Red-Team Test Suite for ChatConnect
 * Verifies that all Dirty Dozen payloads return PERMISSION_DENIED.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const dirtyDozenTests: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Profile Create',
    collection: '/users/user_B',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { userId: 'user_B', username: 'userb', name: 'User B' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Spoofing Admin',
    collection: '/announcements/ann_1',
    operation: 'create',
    auth: { uid: 'spoof_uid', email: 'akash1719singh@gmail.com', email_verified: false },
    payload: { announcementId: 'ann_1', title: 'Pwned', body: 'Test', authorId: 'spoof_uid', isActive: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on User Update',
    collection: '/users/user_A',
    operation: 'update',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { name: 'Valid Name', isAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'PII Leak via Cross-User Read',
    collection: '/users/user_A/private/info',
    operation: 'get',
    auth: { uid: 'user_B', email: 'b@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Blanket User List Scraping',
    collection: '/users',
    operation: 'list',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Unauthorized Chat Read',
    collection: '/chats/chat_AB',
    operation: 'get',
    auth: { uid: 'user_C', email: 'c@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Orphaned Message Write (Master Gate Bypass)',
    collection: '/chats/nonexistent_chat/messages/msg_1',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { messageId: 'msg_1', chatId: 'nonexistent_chat', senderId: 'user_A', receiverId: 'user_B' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Message Sender Spoofing',
    collection: '/chats/chat_AB/messages/msg_1',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { messageId: 'msg_1', chatId: 'chat_AB', senderId: 'user_B', receiverId: 'user_A' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Denial-of-Wallet Oversized Bio String',
    collection: '/users/user_A',
    operation: 'update',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { bio: 'x'.repeat(10000) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immortal Field Mutation on Message',
    collection: '/chats/chat_AB/messages/msg_1',
    operation: 'update',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { senderId: 'user_B' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Client Timestamp Forgery',
    collection: '/reports/rep_1',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { reportId: 'rep_1', reporterId: 'user_A', createdAt: '1999-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Terminal State Re-opening on Report',
    collection: '/reports/rep_1',
    operation: 'update',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { status: 'open' },
    expectedResult: 'PERMISSION_DENIED',
  },
];
