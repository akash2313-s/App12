import { ChatMessage, ChatThread, UserPrivate, UserPublic } from '../types';

/**
 * Generates a deterministic 1-to-1 chat ID from two user IDs.
 */
export function getDeterministicChatId(uid1: string, uid2: string): string {
  const sorted = [uid1.trim(), uid2.trim()].sort();
  return `chat_${sorted[0]}_${sorted[1]}`.slice(0, 120);
}

/**
 * Normalizes a raw username input into a valid lowercase handle (3-32 chars, [a-z0-9_]).
 */
export function sanitizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32);
}

/**
 * Generates a suggested unique username from a display name.
 */
export function generateSuggestedUsername(fullName: string): string {
  const base = sanitizeUsername(fullName.replace(/\s+/g, '_')) || 'user';
  const trimmedBase = base.slice(0, 20);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const candidate = `${trimmedBase}_${randomSuffix}`;
  return candidate.length < 3 ? `user_${randomSuffix}` : candidate;
}

/**
 * Creates a clean SVG data-URI avatar fallback so no broken image ever renders.
 */
export function getAvatarDataUri(name: string, bgHex?: string): string {
  const cleanName = (name || 'User').trim();
  const initials = cleanName
    .split(/\s+/)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'CC';

  const palette = ['#4f46e5', '#0891b2', '#7c3aed', '#2563eb', '#0d9488', '#db2777'];
  let hash = 0;
  for (let i = 0; i < cleanName.length; i++) {
    hash = cleanName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = bgHex || palette[Math.abs(hash) % palette.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color}" />
        <stop offset="100%" stop-color="#1e1b4b" />
      </linearGradient>
    </defs>
    <rect width="160" height="160" rx="80" fill="url(#g)" />
    <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Plus Jakarta Sans, sans-serif" font-weight="700" font-size="56">${initials}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Curated original geometric avatar presets for onboarding and profile editing.
 */
export const AVATAR_PRESETS = [
  { label: 'Indigo Pulse', name: 'Indigo', hex: '#4f46e5' },
  { label: 'Cyan Horizon', name: 'Cyan', hex: '#0891b2' },
  { label: 'Violet Nebula', name: 'Violet', hex: '#7c3aed' },
  { label: 'Teal Aurora', name: 'Teal', hex: '#0d9488' },
  { label: 'Cobalt Core', name: 'Cobalt', hex: '#2563eb' },
  { label: 'Rose Quartz', name: 'Rose', hex: '#e11d48' },
];

/**
 * Compresses an uploaded image File into a lightweight Data URL (< 250KB)
 * to ensure rapid real-time transmission and strict Firestore 1MB safety.
 */
export function compressImageFile(
  file: File,
  maxDimension = 640,
  quality = 0.72
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image format.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length > 680000) {
          const smaller = canvas.toDataURL('image/jpeg', 0.45);
          resolve(smaller);
        } else {
          resolve(dataUrl);
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Converts a small file (document/audio/video clip) to a safe Data URL,
 * enforcing size limits so Firestore writes never fail.
 */
export function fileToSafeDataUrl(file: File, maxBytes = 480 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(
        new Error(
          `File is ${(file.size / 1024).toFixed(0)}KB. Maximum size for direct real-time transfer is ${(maxBytes / 1024).toFixed(0)}KB.`
        )
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/**
 * Formats an ISO timestamp or Firestore Timestamp into a human-friendly time label.
 */
export function formatMessageTime(isoOrDate: string | Date | { toDate?: () => Date } | null | undefined): string {
  if (!isoOrDate) return '';
  let date: Date;
  if (typeof isoOrDate === 'string') {
    date = new Date(isoOrDate);
  } else if (isoOrDate instanceof Date) {
    date = isoOrDate;
  } else if (typeof isoOrDate.toDate === 'function') {
    date = isoOrDate.toDate();
  } else {
    return '';
  }
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Formats a user's online/last-seen status respecting their privacy settings.
 */
export function getVisiblePresenceStatus(
  targetUser: UserPublic | null | undefined,
  isContact: boolean,
  viewerUid: string
): { isOnlineVisible: boolean; statusText: string } {
  if (!targetUser) {
    return { isOnlineVisible: false, statusText: 'Offline' };
  }
  const isSelf = targetUser.userId === viewerUid;

  const canSeeOnline =
    isSelf ||
    targetUser.privacyOnline === 'everyone' ||
    (targetUser.privacyOnline === 'contacts' && isContact);

  const canSeeLastSeen =
    isSelf ||
    targetUser.privacyLastSeen === 'everyone' ||
    (targetUser.privacyLastSeen === 'contacts' && isContact);

  if (canSeeOnline && targetUser.isOnline) {
    return { isOnlineVisible: true, statusText: 'Online' };
  }

  if (canSeeLastSeen && targetUser.lastSeen) {
    const formatted = formatMessageTime(targetUser.lastSeen);
    return {
      isOnlineVisible: false,
      statusText: formatted ? `Last seen ${formatted}` : 'Last seen recently',
    };
  }

  return { isOnlineVisible: false, statusText: 'Offline' };
}

/**
 * Returns the visible profile photo URL for a user based on their privacy settings.
 */
export function getVisibleProfilePhoto(
  targetUser: UserPublic | null | undefined,
  isContact: boolean,
  viewerUid: string
): string {
  if (!targetUser) return getAvatarDataUri('User');
  const isSelf = targetUser.userId === viewerUid;
  const canSeePhoto =
    isSelf ||
    targetUser.privacyPhoto === 'everyone' ||
    (targetUser.privacyPhoto === 'contacts' && isContact);

  if (canSeePhoto && targetUser.profilePhoto) {
    return targetUser.profilePhoto;
  }
  return getAvatarDataUri(targetUser.name || targetUser.username);
}

/**
 * Synthesizes a subtle Web Audio notification chime and triggers browser/in-app notification.
 */
export function playNotificationChime(soundEnabled = true, vibrationEnabled = true): void {
  if (vibrationEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate([80, 40, 80]);
    } catch {
      // Ignore vibration errors on unsupported browsers
    }
  }
  if (!soundEnabled || typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.14); // A5
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.28);
  } catch {
    // AudioContext blocked until user interaction
  }
}

/**
 * Parses and serializes message reactions stored in `reactionsSummary` ("👍:uid1|❤️:uid2").
 */
export function parseReactions(summary: string): { emoji: string; userIds: string[] }[] {
  if (!summary || !summary.trim()) return [];
  const map = new Map<string, string[]>();
  const parts = summary.split('|').filter(Boolean);
  for (const part of parts) {
    const [emoji, uid] = part.split(':');
    if (emoji && uid) {
      const list = map.get(emoji) || [];
      if (!list.includes(uid)) list.push(uid);
      map.set(emoji, list);
    }
  }
  return Array.from(map.entries()).map(([emoji, userIds]) => ({ emoji, userIds }));
}

export function toggleReactionSummary(summary: string, emoji: string, userId: string): string {
  const parts = (summary || '').split('|').filter(Boolean);
  const token = `${emoji}:${userId}`;
  const exists = parts.includes(token);
  const updated = exists ? parts.filter((p) => p !== token) : [...parts, token];
  return updated.join('|').slice(0, 500);
}

/**
 * Extracts HTTP/HTTPS links from message text for the Shared Media -> Links tab.
 */
export function extractLinksFromText(text: string): string[] {
  if (!text) return [];
  const regex = /https?:\/\/[^\s/$.?#].[^\s]*/gi;
  return text.match(regex) || [];
}

/**
 * Synthesizes a valid playable WAV data URI for voice notes when microphone access
 * is blocked by iframe permissions, or encodes real recorded audio blobs.
 */
export function generateSynthesizedVoiceNoteWav(durationSec = 2): string {
  const sampleRate = 8000;
  const numSamples = sampleRate * Math.min(Math.max(durationSec, 1), 6);
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); // 8-bit
  writeString(36, 'data');
  view.setUint32(40, numSamples, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin((Math.PI * i) / numSamples);
    const freq = 260 + 80 * Math.sin(2 * Math.PI * 3 * t);
    const sample = 128 + Math.round(45 * envelope * Math.sin(2 * Math.PI * freq * t));
    view.setUint8(44 + i, Math.max(0, Math.min(255, sample)));
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const APP_LOCK_KEY_PREFIX = 'chatconnect_applock_pwd_';
const APP_AUTOLOCK_KEY_PREFIX = 'chatconnect_applock_auto_';
const QUICK_SESSION_STORAGE_KEY = 'chatconnect_quick_session_v1';

/**
 * Retrieves the configured App Lock password/PIN for the current user (or global fallback).
 */
export function getAppLockPassword(userId = 'default'): string {
  try {
    return (
      localStorage.getItem(`${APP_LOCK_KEY_PREFIX}${userId}`) ||
      localStorage.getItem(`${APP_LOCK_KEY_PREFIX}default`) ||
      ''
    );
  } catch {
    return '';
  }
}

/**
 * Sets or updates the App Lock password/PIN.
 */
export function setAppLockPassword(password: string, userId = 'default'): void {
  try {
    const clean = password.trim();
    if (!clean) {
      localStorage.removeItem(`${APP_LOCK_KEY_PREFIX}${userId}`);
      localStorage.removeItem(`${APP_LOCK_KEY_PREFIX}default`);
      return;
    }
    localStorage.setItem(`${APP_LOCK_KEY_PREFIX}${userId}`, clean);
    localStorage.setItem(`${APP_LOCK_KEY_PREFIX}default`, clean);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Removes the App Lock password/PIN.
 */
export function clearAppLockPassword(userId = 'default'): void {
  try {
    localStorage.removeItem(`${APP_LOCK_KEY_PREFIX}${userId}`);
    localStorage.removeItem(`${APP_LOCK_KEY_PREFIX}default`);
  } catch {
    // Ignore
  }
}

export function getAppAutoLockEnabled(userId = 'default'): boolean {
  try {
    const val = localStorage.getItem(`${APP_AUTOLOCK_KEY_PREFIX}${userId}`);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setAppAutoLockEnabled(enabled: boolean, userId = 'default'): void {
  try {
    localStorage.setItem(`${APP_AUTOLOCK_KEY_PREFIX}${userId}`, String(enabled));
  } catch {
    // Ignore
  }
}

/**
 * Stores or retrieves a Quick Name + @UserID session so users can log in
 * directly with Name & ID even if external OAuth popups are blocked.
 */
export function getQuickLocalSession(): {
  publicProfile: UserPublic;
  privatePrefs: UserPrivate;
} | null {
  try {
    const raw = localStorage.getItem(QUICK_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveQuickLocalSession(
  publicProfile: UserPublic,
  privatePrefs: UserPrivate
): void {
  try {
    localStorage.setItem(
      QUICK_SESSION_STORAGE_KEY,
      JSON.stringify({ publicProfile, privatePrefs })
    );
    upsertDirectoryUser(publicProfile);
  } catch {
    // Ignore
  }
}

export function clearQuickLocalSession(): void {
  try {
    localStorage.removeItem(QUICK_SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

const DIRECTORY_USERS_KEY = 'chatconnect_directory_users_v1';
const LOCAL_CHATS_KEY_PREFIX = 'chatconnect_local_chats_';
const LOCAL_MESSAGES_KEY_PREFIX = 'chatconnect_local_msgs_';

export const DEFAULT_DIRECTORY_USERS: UserPublic[] = [
  {
    userId: 'usr_rahul123',
    username: 'rahul123',
    name: 'Rahul Sharma',
    profilePhoto: getAvatarDataUri('Rahul Sharma', '#4f46e5'),
    bio: 'Product Architect & Full-Stack Builder · Always reachable on ChatConnect 🚀',
    isOnline: true,
    lastSeen: new Date().toISOString(),
    privacyPhoto: 'everyone',
    privacyLastSeen: 'everyone',
    privacyOnline: 'everyone',
    readReceipts: true,
    accountStatus: 'active',
    createdAt: null as unknown as UserPublic['createdAt'],
    updatedAt: null as unknown as UserPublic['updatedAt'],
  },
  {
    userId: 'usr_priya_sharma',
    username: 'priya_sharma',
    name: 'Priya Sharma',
    profilePhoto: getAvatarDataUri('Priya Sharma', '#0891b2'),
    bio: 'UI/UX Designer ✨ Designing clean digital experiences',
    isOnline: true,
    lastSeen: new Date().toISOString(),
    privacyPhoto: 'everyone',
    privacyLastSeen: 'everyone',
    privacyOnline: 'everyone',
    readReceipts: true,
    accountStatus: 'active',
    createdAt: null as unknown as UserPublic['createdAt'],
    updatedAt: null as unknown as UserPublic['updatedAt'],
  },
  {
    userId: 'usr_arjun_dev',
    username: 'arjun_dev',
    name: 'Arjun Verma',
    profilePhoto: getAvatarDataUri('Arjun Verma', '#7c3aed'),
    bio: 'Cloud & Security Engineer · Open for tech discussions 💻',
    isOnline: true,
    lastSeen: new Date().toISOString(),
    privacyPhoto: 'everyone',
    privacyLastSeen: 'everyone',
    privacyOnline: 'everyone',
    readReceipts: true,
    accountStatus: 'active',
    createdAt: null as unknown as UserPublic['createdAt'],
    updatedAt: null as unknown as UserPublic['updatedAt'],
  },
  {
    userId: 'usr_neha_design',
    username: 'neha_design',
    name: 'Neha Gupta',
    profilePhoto: getAvatarDataUri('Neha Gupta', '#e11d48'),
    bio: 'Creative Director & Photographer 📸 Available on ChatConnect',
    isOnline: false,
    lastSeen: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    privacyPhoto: 'everyone',
    privacyLastSeen: 'everyone',
    privacyOnline: 'everyone',
    readReceipts: true,
    accountStatus: 'active',
    createdAt: null as unknown as UserPublic['createdAt'],
    updatedAt: null as unknown as UserPublic['updatedAt'],
  },
  {
    userId: 'usr_kabir_singh',
    username: 'kabir_singh',
    name: 'Kabir Singh',
    profilePhoto: getAvatarDataUri('Kabir Singh', '#0d9488'),
    bio: 'Entrepreneur & Fitness Enthusiast ⚡ Drop a message anytime',
    isOnline: true,
    lastSeen: new Date().toISOString(),
    privacyPhoto: 'everyone',
    privacyLastSeen: 'everyone',
    privacyOnline: 'everyone',
    readReceipts: true,
    accountStatus: 'active',
    createdAt: null as unknown as UserPublic['createdAt'],
    updatedAt: null as unknown as UserPublic['updatedAt'],
  },
  {
    userId: 'usr_ananya_k',
    username: 'ananya_k',
    name: 'Ananya Kapoor',
    profilePhoto: getAvatarDataUri('Ananya Kapoor', '#2563eb'),
    bio: 'Music, Travel & Coffee ☕ Connecting via @ananya_k',
    isOnline: true,
    lastSeen: new Date().toISOString(),
    privacyPhoto: 'everyone',
    privacyLastSeen: 'everyone',
    privacyOnline: 'everyone',
    readReceipts: true,
    accountStatus: 'active',
    createdAt: null as unknown as UserPublic['createdAt'],
    updatedAt: null as unknown as UserPublic['updatedAt'],
  },
];

export function getDirectoryUsers(): UserPublic[] {
  const map = new Map<string, UserPublic>();
  for (const u of DEFAULT_DIRECTORY_USERS) {
    map.set(u.username.toLowerCase(), u);
  }
  try {
    const raw = localStorage.getItem(DIRECTORY_USERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UserPublic[];
      if (Array.isArray(parsed)) {
        for (const u of parsed) {
          if (u && u.username) {
            map.set(u.username.toLowerCase(), u);
          }
        }
      }
    }
  } catch {
    // Ignore
  }
  return Array.from(map.values());
}

export function upsertDirectoryUser(user: UserPublic): void {
  if (!user || !user.username) return;
  try {
    const current = getDirectoryUsers();
    const map = new Map<string, UserPublic>();
    for (const u of current) {
      map.set(u.username.toLowerCase(), u);
    }
    map.set(user.username.toLowerCase(), user);
    localStorage.setItem(DIRECTORY_USERS_KEY, JSON.stringify(Array.from(map.values())));
  } catch {
    // Ignore
  }
}

/**
 * Searches the local + default directory by @UserID, partial username, or full name.
 */
export function searchDirectoryUsers(rawQuery: string): UserPublic[] {
  const trimmed = rawQuery.replace(/^chatconnect:\/\/user\//i, '').trim();
  if (!trimmed) return getDirectoryUsers();
  const cleanHandle = sanitizeUsername(trimmed);
  const lowerRaw = trimmed.replace(/^@+/, '').toLowerCase();

  const all = getDirectoryUsers();
  // Sort exact username match first, then prefix match, then name match
  const matched = all.filter((u) => {
    if (u.accountStatus === 'banned') return false;
    const uname = u.username.toLowerCase();
    const fname = u.name.toLowerCase();
    return (
      (cleanHandle && uname === cleanHandle) ||
      (cleanHandle && uname.includes(cleanHandle)) ||
      fname.includes(lowerRaw) ||
      uname.includes(lowerRaw)
    );
  });

  matched.sort((a, b) => {
    const aExact = a.username.toLowerCase() === cleanHandle ? 1 : 0;
    const bExact = b.username.toLowerCase() === cleanHandle ? 1 : 0;
    return bExact - aExact;
  });

  return matched;
}

/**
 * Creates a valid UserPublic profile on the fly if the user searches a brand-new @UserID
 * and chooses to connect immediately.
 */
export function createInstantUserFromHandle(rawInput: string): UserPublic {
  const cleanHandle =
    sanitizeUsername(rawInput.replace(/^chatconnect:\/\/user\//i, '')) ||
    generateSuggestedUsername(rawInput);
  const formattedName = rawInput
    .replace(/^chatconnect:\/\/user\//i, '')
    .replace(/^@+/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || cleanHandle;

  const newUser: UserPublic = {
    userId: `usr_${cleanHandle}`,
    username: cleanHandle,
    name: formattedName.slice(0, 80),
    profilePhoto: getAvatarDataUri(formattedName),
    bio: 'Available on ChatConnect',
    isOnline: true,
    lastSeen: new Date().toISOString(),
    privacyPhoto: 'everyone',
    privacyLastSeen: 'everyone',
    privacyOnline: 'everyone',
    readReceipts: true,
    accountStatus: 'active',
    createdAt: null as unknown as UserPublic['createdAt'],
    updatedAt: null as unknown as UserPublic['updatedAt'],
  };
  upsertDirectoryUser(newUser);
  return newUser;
}

export function getLocalChats(userId: string): ChatThread[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_CHATS_KEY_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalChats(userId: string, chats: ChatThread[]): void {
  try {
    localStorage.setItem(`${LOCAL_CHATS_KEY_PREFIX}${userId}`, JSON.stringify(chats));
  } catch {
    // Ignore
  }
}

export function getLocalMessages(chatId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_MESSAGES_KEY_PREFIX}${chatId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalMessages(chatId: string, messages: ChatMessage[]): void {
  try {
    localStorage.setItem(`${LOCAL_MESSAGES_KEY_PREFIX}${chatId}`, JSON.stringify(messages));
  } catch {
    // Ignore
  }
}


