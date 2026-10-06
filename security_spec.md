# ChatConnect Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **PII Split Isolation**: `/users/{userId}` never stores `email` or `phone`. All PII and private preferences reside in `/users/{userId}/private/{docId}`, accessible strictly by `request.auth.uid == userId` or `isAdmin()`.
2. **No Blanket User Enumeration**: Normal users cannot `list` `/users` or `/usernames`. User discovery occurs strictly via exact `get` on `/usernames/{username}` and `/users/{userId}`, while `allow list` on `/users` is restricted to `isAdmin()`.
3. **Master Gate & Relational Sync on Messages**: `/chats/{chatId}/messages/{messageId}` requires the parent `/chats/{chatId}` document to exist and the caller to be a verified participant (`participant1` or `participant2`).
4. **Strict Schema & Update Action Gates**: Every `create` and `update` invokes `isValid[Entity](incoming())`, enforces `.hasAll()` and `.hasOnly()`, checks string `.size()` bounds, verifies `request.time` on timestamps, and locks immutable fields (`userId`, `chatId`, `senderId`, `createdAt`).
5. **Terminal State Locking**: Once a `/reports/{reportId}` reaches `status == 'resolved'` or `status == 'dismissed'`, non-admin users cannot mutate it. New users cannot self-assign `accountStatus: 'banned'` or admin status.

## 2. The "Dirty Dozen" Payloads

1. **Identity Spoofing on Profile Create**: Authenticated user `user_A` attempts to create `/users/user_B` with `userId: "user_B"`.
2. **Unverified Email Spoofing Admin**: Attacker with `email: "akash1719singh@gmail.com"` and `email_verified: false` attempts to list `/users` or write to `/announcements`.
3. **Shadow Field Injection on User Update**: Owner attempts to update `/users/user_A` with `{ isAdmin: true }` or `{ role: "admin" }`.
4. **PII Leak via Cross-User Read**: User `user_B` attempts `get` on `/users/user_A/private/info`.
5. **Blanket User List Scraping**: Non-admin user `user_A` attempts `list` query on `/users` to dump all registered users.
6. **Unauthorized Chat Read**: User `user_C` attempts `get` or `list` on `/chats/chat_AB` where participants are `["user_A", "user_B"]`.
7. **Orphaned Message Write (Master Gate Bypass)**: User `user_A` attempts to create `/chats/nonexistent_chat/messages/msg_1` without a valid parent chat document.
8. **Message Sender Spoofing**: Participant `user_A` attempts to create a message in `/chats/chat_AB/messages/msg_1` with `senderId: "user_B"`.
9. **Denial-of-Wallet Oversized String**: User `user_A` sends a 10,000-character `bio` to `/users/user_A` or a 2,000-character document ID.
10. **Immortal Field Mutation**: Participant `user_A` attempts to update `createdAt` or `senderId` on an existing message `/chats/chat_AB/messages/msg_1`.
11. **Client Timestamp Forgery**: User `user_A` attempts to create a chat or message with a backdated `createdAt` instead of `request.time`.
12. **Terminal State Re-opening on Report**: Reporter `user_A` attempts to update a resolved report `/reports/rep_1` after `status == 'resolved'`.
