import React, { useState, useEffect, useRef, useMemo } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  MessageSquarePlus,
  Search,
  Settings,
  User as UserIcon,
  MessageSquare,
  Home,
  Pin,
  BellOff,
  QrCode,
  WifiOff,
  Megaphone,
  X,
  Ban,
  Trash2,
  ShieldCheck,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  Unlock,
  LogOut,
  Check,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  auth,
  db,
  ADMIN_EMAIL,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  ChatThread,
  NavTab,
  SystemAnnouncement,
  ThemeMode,
  UserPrivate,
  UserPublic,
} from './types';
import { ChatConnectLogo } from './components/BrandIcons';
import { AuthOnboarding } from './components/AuthOnboarding';
import { ChatView } from './components/ChatView';
import { SearchAndQRView } from './components/SearchAndQRModal';
import { SettingsAndProfileView } from './components/SettingsAndProfileView';
import { AdminPanelView } from './components/AdminPanelView';
import {
  formatMessageTime,
  getAvatarDataUri,
  getDeterministicChatId,
  getVisiblePresenceStatus,
  getVisibleProfilePhoto,
  playNotificationChime,
  getAppLockPassword,
  setAppLockPassword,
  clearAppLockPassword,
  getAppAutoLockEnabled,
  getQuickLocalSession,
  saveQuickLocalSession,
  clearQuickLocalSession,
  getDirectoryUsers,
  upsertDirectoryUser,
  searchDirectoryUsers,
  createInstantUserFromHandle,
  sanitizeUsername,
  getLocalChats,
  saveLocalChats,
  saveLocalMessages,
} from './utils/helpers';

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserPublic | null>(() => {
    const quick = getQuickLocalSession();
    return quick ? quick.publicProfile : null;
  });
  const [userPrivate, setUserPrivate] = useState<UserPrivate | null>(() => {
    const quick = getQuickLocalSession();
    return quick ? quick.privatePrefs : null;
  });
  const [profileLoading, setProfileLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [isAdminDoc, setIsAdminDoc] = useState(false);

  // App Lock Screen state
  const [isAppLocked, setIsAppLocked] = useState<boolean>(() => {
    const quick = getQuickLocalSession();
    const uid = quick?.publicProfile?.userId || 'default';
    const pwd = getAppLockPassword(uid);
    const autoLock = getAppAutoLockEnabled(uid);
    return Boolean(pwd && autoLock);
  });
  const [unlockInput, setUnlockInput] = useState('');
  const [showUnlockPwd, setShowUnlockPwd] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Quick Setup App Password Modal state
  const [showSetupPwdModal, setShowSetupPwdModal] = useState(false);
  const [setupPwdInput, setSetupPwdInput] = useState('');
  const [showSetupPwdEye, setShowSetupPwdEye] = useState(false);
  const [setupPwdSavedToast, setSetupPwdSavedToast] = useState<string | null>(null);

  // Navigation & UI state
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatFilter, setChatFilter] = useState<'all' | 'unread' | 'pinned' | 'archived'>('all');
  const [chatListSearch, setChatListSearch] = useState('');
  const [searchInitialMode, setSearchInitialMode] = useState<'search' | 'my-qr' | 'scan-qr'>('search');
  const [inspectedUser, setInspectedUser] = useState<UserPublic | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [chatToDelete, setChatToDelete] = useState<ChatThread | null>(null);
  const [deletingSidebarChat, setDeletingSidebarChat] = useState(false);

  // Real-time data state
  const [chats, setChats] = useState<ChatThread[]>(() => {
    const quick = getQuickLocalSession();
    return quick?.publicProfile?.userId ? getLocalChats(quick.publicProfile.userId) : [];
  });
  const [contactsMap, setContactsMap] = useState<Record<string, UserPublic>>(() => {
    const map: Record<string, UserPublic> = {};
    for (const u of getDirectoryUsers()) {
      map[u.userId] = u;
    }
    return map;
  });
  const [announcements, setAnnouncements] = useState<SystemAnnouncement[]>([]);
  const [dismissedAnnIds, setDismissedAnnIds] = useState<string[]>([]);

  // Push Notification Toast
  const [pushBanner, setPushBanner] = useState<{
    chatId: string;
    senderName: string;
    previewText: string;
  } | null>(null);
  const prevChatTimestampsRef = useRef<Record<string, string>>({});

  // Monitor browser online/offline state
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Theme application (Light / Dark / System)
  const applyTheme = (mode: ThemeMode) => {
    const root = document.documentElement;
    if (mode === 'dark') {
      root.classList.add('dark');
    } else if (mode === 'light') {
      root.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
  };

  useEffect(() => {
    applyTheme(userPrivate?.theme || 'system');
  }, [userPrivate?.theme]);

  // 1. Firebase Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        const quick = getQuickLocalSession();
        if (quick) {
          setCurrentUserProfile(quick.publicProfile);
          setUserPrivate(quick.privatePrefs);
          setNeedsOnboarding(false);
        } else {
          setCurrentUserProfile(null);
          setUserPrivate(null);
          setNeedsOnboarding(false);
          setChats([]);
          setSelectedChatId(null);
        }
        setProfileLoading(false);
      } else {
        const pwd = getAppLockPassword(user.uid);
        if (pwd && getAppAutoLockEnabled(user.uid)) {
          setIsAppLocked(true);
        }
      }
    });
    return () => unsub();
  }, []);

  // 2. Load Current User Profile & Private Preferences
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    setProfileLoading(true);

    const publicRef = doc(db, 'users', firebaseUser.uid);
    const privateRef = doc(db, 'users', firebaseUser.uid, 'private', 'info');
    const adminRef = doc(db, 'admins', firebaseUser.uid);

    getDoc(adminRef)
      .then((snap) => setIsAdminDoc(snap.exists()))
      .catch(() => setIsAdminDoc(false));

    const unsubPublic = onSnapshot(
      publicRef,
      (snap) => {
        if (snap.exists()) {
          const pubData = snap.data() as UserPublic;
          setCurrentUserProfile(pubData);
          setNeedsOnboarding(false);
        } else {
          const quick = getQuickLocalSession();
          if (quick) {
            setCurrentUserProfile(quick.publicProfile);
            setUserPrivate(quick.privatePrefs);
            setNeedsOnboarding(false);
          } else {
            setCurrentUserProfile(null);
            setNeedsOnboarding(true);
          }
        }
        setProfileLoading(false);
      },
      () => {
        setProfileLoading(false);
      }
    );

    const unsubPrivate = onSnapshot(
      privateRef,
      (snap) => {
        if (snap.exists()) {
          const privData = snap.data() as UserPrivate;
          setUserPrivate(privData);
        }
      },
      () => {}
    );

    return () => {
      unsubPublic();
      unsubPrivate();
    };
  }, [authReady, firebaseUser]);

  // 3. Automatic Online / Last Seen Presence Sync
  useEffect(() => {
    if (!firebaseUser || !currentUserProfile || currentUserProfile.accountStatus !== 'active') {
      return;
    }

    const userRef = doc(db, 'users', firebaseUser.uid);

    const setPresence = (online: boolean) => {
      updateDoc(userRef, {
        isOnline: online,
        lastSeen: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    };

    setPresence(true);

    const handleVisibility = () => {
      setPresence(document.visibilityState === 'visible');
    };
    const handleBeforeUnload = () => {
      setPresence(false);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [firebaseUser?.uid, currentUserProfile?.userId, currentUserProfile?.accountStatus]);

  // 4. Subscribe to Active System Announcements
  useEffect(() => {
    if (!firebaseUser || !currentUserProfile) return;
    const q = query(collection(db, 'announcements'), where('isActive', '==', true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: SystemAnnouncement[] = [];
        snap.forEach((d) => list.push(d.data() as SystemAnnouncement));
        setAnnouncements(list);
      },
      () => {}
    );
    return () => unsub();
  }, [firebaseUser?.uid, currentUserProfile?.userId]);

  // 5. Subscribe to User's 1-to-1 Chats & Trigger Real-Time Push Notifications
  useEffect(() => {
    if (!currentUserProfile) return;

    // Load local chats first
    const localInitial = getLocalChats(currentUserProfile.userId);
    if (localInitial.length > 0 && chats.length === 0) {
      setChats(localInitial);
    }

    // Refresh directory users into contactsMap
    const dirMap: Record<string, UserPublic> = {};
    for (const u of getDirectoryUsers()) {
      dirMap[u.userId] = u;
    }
    setContactsMap((prev) => ({ ...dirMap, ...prev }));

    if (!firebaseUser) return;

    const q = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', firebaseUser.uid)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const cloudList: ChatThread[] = [];
        snap.forEach((d) => cloudList.push(d.data() as ChatThread));

        const mergedMap = new Map<string, ChatThread>();
        for (const c of getLocalChats(currentUserProfile.userId)) {
          mergedMap.set(c.chatId, c);
        }
        for (const c of cloudList) {
          mergedMap.set(c.chatId, c);
        }

        const list = Array.from(mergedMap.values());

        // Sort by most recent activity
        list.sort((a, b) => {
          const tA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
          const tB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
          return tB - tA;
        });

        setChats(list);
        saveLocalChats(currentUserProfile.userId, list);

        // Check for newly arrived messages from other participants
        list.forEach((chatItem) => {
          const prevTime = prevChatTimestampsRef.current[chatItem.chatId];
          const currTime = chatItem.lastMessageTime;
          if (
            prevTime &&
            currTime &&
            currTime !== prevTime &&
            chatItem.lastMessageSenderId &&
            chatItem.lastMessageSenderId !== firebaseUser.uid
          ) {
            const isMuted = userPrivate?.mutedChats.includes(chatItem.chatId);
            const isCurrentlyOpen =
              selectedChatId === chatItem.chatId &&
              (activeTab === 'home' || activeTab === 'chats');

            if (!isMuted && !isCurrentlyOpen && (userPrivate?.notificationsEnabled ?? true)) {
              const otherId =
                chatItem.participant1 === firebaseUser.uid
                  ? chatItem.participant2
                  : chatItem.participant1;
              const senderProfile = contactsMap[otherId];
              const senderName = senderProfile?.name || 'New Message';
              const previewText =
                userPrivate?.notificationPreview ?? true
                  ? chatItem.lastMessageText || 'Sent a message'
                  : 'New private message received';

              playNotificationChime(
                userPrivate?.notificationSound ?? true,
                userPrivate?.notificationVibration ?? true
              );

              setPushBanner({
                chatId: chatItem.chatId,
                senderName,
                previewText,
              });

              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                try {
                  const n = new Notification(senderName, { body: previewText });
                  n.onclick = () => {
                    setSelectedChatId(chatItem.chatId);
                    setActiveTab('chats');
                  };
                } catch {
                  // Ignore notification constructor error in restricted contexts
                }
              }
            }
          }
          if (currTime) {
            prevChatTimestampsRef.current[chatItem.chatId] = currTime;
          }
        });
      },
      () => {
        // Fallback to local chats
      }
    );

    return () => unsub();
  }, [
    firebaseUser?.uid,
    currentUserProfile?.userId,
    selectedChatId,
    activeTab,
    userPrivate?.mutedChats,
    userPrivate?.notificationsEnabled,
    userPrivate?.notificationSound,
    userPrivate?.notificationVibration,
    userPrivate?.notificationPreview,
  ]);

  // 6. Subscribe to Contact Public Profiles for all chat participants
  useEffect(() => {
    if (!currentUserProfile || chats.length === 0) return;

    const otherUids = Array.from(
      new Set(
        chats.map((c) =>
          c.participant1 === currentUserProfile.userId ? c.participant2 : c.participant1
        )
      )
    );

    const unsubs = otherUids.map((uid) =>
      onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserPublic;
            upsertDirectoryUser(data);
            setContactsMap((prev) => ({ ...prev, [uid]: data }));
          }
        },
        () => {}
      )
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [currentUserProfile?.userId, chats.length]);

  const isAdmin = Boolean(
    firebaseUser?.emailVerified &&
      (firebaseUser?.email === ADMIN_EMAIL || isAdminDoc)
  );

  // Start or open a 1-to-1 private chat with a target user
  const handleStartChatWithUser = async (targetUser: UserPublic) => {
    if (!currentUserProfile) return;
    upsertDirectoryUser(targetUser);
    setContactsMap((prev) => ({ ...prev, [targetUser.userId]: targetUser }));

    const deterministicId = getDeterministicChatId(
      currentUserProfile.userId,
      targetUser.userId
    );

    const existingChat = chats.find(
      (c) =>
        c.chatId === deterministicId ||
        (c.participants.includes(currentUserProfile.userId) &&
          c.participants.includes(targetUser.userId))
    );

    if (existingChat) {
      setSelectedChatId(existingChat.chatId);
      setInspectedUser(null);
      setChatListSearch('');
      setActiveTab('chats');
      return;
    }

    const sorted = [currentUserProfile.userId, targetUser.userId].sort();
    const newChatObj: ChatThread = {
      chatId: deterministicId,
      participant1: sorted[0],
      participant2: sorted[1],
      participants: [sorted[0], sorted[1]],
      lastMessageText: '',
      lastMessageType: 'text',
      lastMessageSenderId: currentUserProfile.userId,
      lastMessageTime: new Date().toISOString(),
      unreadCount1: 0,
      unreadCount2: 0,
      clearedAt1: '',
      clearedAt2: '',
      createdAt: {} as ChatThread['createdAt'],
      updatedAt: {} as ChatThread['updatedAt'],
    };

    const updatedChats = [
      newChatObj,
      ...chats.filter((c) => c.chatId !== deterministicId),
    ];
    setChats(updatedChats);
    saveLocalChats(currentUserProfile.userId, updatedChats);
    setSelectedChatId(deterministicId);
    setInspectedUser(null);
    setChatListSearch('');
    setActiveTab('chats');

    if (!firebaseUser) {
      return;
    }

    const newChatRef = doc(db, 'chats', deterministicId);
    try {
      await setDoc(newChatRef, {
        ...newChatObj,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Stored locally in hybrid mode
    }
  };

  // Toggle Pin, Archive, Mute, Block helpers
  const togglePrivateListItem = async (
    field: 'pinnedChats' | 'archivedChats' | 'mutedChats' | 'blockedUsers',
    itemId: string,
    maxAllowed: number
  ) => {
    if (!currentUserProfile || !userPrivate) return;
    const currentList = userPrivate[field] || [];
    const exists = currentList.includes(itemId);
    const nextList = exists
      ? currentList.filter((id) => id !== itemId)
      : [...currentList, itemId].slice(0, maxAllowed);

    const updatedPrivate = { ...userPrivate, [field]: nextList };
    setUserPrivate(updatedPrivate);
    saveQuickLocalSession(currentUserProfile, updatedPrivate);

    if (!firebaseUser) return;
    try {
      await updateDoc(doc(db, 'users', currentUserProfile.userId, 'private', 'info'), {
        [field]: nextList,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Handled
    }
  };

  // Delete a chat conversation from the sidebar
  const handleConfirmDeleteSidebarChat = async () => {
    if (!chatToDelete || !currentUserProfile) return;
    setDeletingSidebarChat(true);
    try {
      saveLocalMessages(chatToDelete.chatId, []);
      const remaining = chats.filter((c) => c.chatId !== chatToDelete.chatId);
      setChats(remaining);
      saveLocalChats(currentUserProfile.userId, remaining);
      if (selectedChatId === chatToDelete.chatId) {
        setSelectedChatId(null);
      }

      if (firebaseUser) {
        const msgQuery = query(
          collection(db, 'chats', chatToDelete.chatId, 'messages'),
          where('participants', 'array-contains', currentUserProfile.userId)
        );
        const snap = await getDocs(msgQuery);
        for (const d of snap.docs) {
          try {
            await deleteDoc(doc(db, 'chats', chatToDelete.chatId, 'messages', d.id));
          } catch {
            // Continue
          }
        }
        await deleteDoc(doc(db, 'chats', chatToDelete.chatId));
      }
      setChatToDelete(null);
    } catch {
      setChatToDelete(null);
    } finally {
      setDeletingSidebarChat(false);
    }
  };

  // App Lock Unlock Handler
  const handleUnlockApp = (e: React.FormEvent) => {
    e.preventDefault();
    const expectedPwd = getAppLockPassword(currentUserProfile?.userId || 'default');
    if (!expectedPwd || unlockInput.trim() === expectedPwd) {
      setIsAppLocked(false);
      setUnlockInput('');
      setUnlockError(null);
    } else {
      setUnlockError('Incorrect App Lock Password / PIN. Please try again.');
    }
  };

  // Quick Setup App Password Modal Handler
  const handleQuickSetupPasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUserProfile) return;
    const trimmed = setupPwdInput.trim();
    if (!trimmed) {
      clearAppLockPassword(currentUserProfile.userId);
      setSetupPwdSavedToast('App Lock password removed.');
    } else {
      setAppLockPassword(trimmed, currentUserProfile.userId);
      setSetupPwdSavedToast('App Lock password saved!');
    }
    setTimeout(() => {
      setSetupPwdSavedToast(null);
      setShowSetupPwdModal(false);
    }, 1000);
  };

  const totalUnreadMessages = useMemo(() => {
    if (!currentUserProfile) return 0;
    return chats.reduce((sum, c) => {
      const count =
        c.participant1 === currentUserProfile.userId ? c.unreadCount1 : c.unreadCount2;
      return sum + (count || 0);
    }, 0);
  }, [chats, currentUserProfile]);

  const filteredChats = useMemo(() => {
    if (!currentUserProfile || !userPrivate) return [];
    const pinnedSet = new Set(userPrivate.pinnedChats);
    const archivedSet = new Set(userPrivate.archivedChats);

    const list = chats.filter((c) => {
      const otherUid =
        c.participant1 === currentUserProfile.userId ? c.participant2 : c.participant1;
      const otherProfile = contactsMap[otherUid];

      if (chatListSearch.trim()) {
        const q = chatListSearch.toLowerCase();
        const matchName = otherProfile?.name?.toLowerCase().includes(q);
        const matchHandle = otherProfile?.username?.toLowerCase().includes(q);
        const matchLastMsg = c.lastMessageText?.toLowerCase().includes(q);
        if (!matchName && !matchHandle && !matchLastMsg) return false;
      }

      if (chatFilter === 'archived') {
        return archivedSet.has(c.chatId);
      }
      if (archivedSet.has(c.chatId)) return false;

      if (chatFilter === 'pinned') {
        return pinnedSet.has(c.chatId);
      }
      if (chatFilter === 'unread') {
        const myUnread =
          c.participant1 === currentUserProfile.userId ? c.unreadCount1 : c.unreadCount2;
        return myUnread > 0;
      }
      return true;
    });

    return list.sort((a, b) => {
      const aPinned = pinnedSet.has(a.chatId) ? 1 : 0;
      const bPinned = pinnedSet.has(b.chatId) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      const tA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const tB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return tB - tA;
    });
  }, [chats, currentUserProfile, userPrivate, contactsMap, chatFilter, chatListSearch]);

  const sidebarMatchedUsers = useMemo(() => {
    if (!currentUserProfile) return [];
    const results = searchDirectoryUsers(chatListSearch);
    return results.filter((u) => u.userId !== currentUserProfile.userId);
  }, [chatListSearch, currentUserProfile, contactsMap]);

  const cleanSidebarHandle = sanitizeUsername(chatListSearch.trim());

  // Loading Skeleton
  if (!authReady || (firebaseUser && profileLoading && !currentUserProfile)) {
    return (
      <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6 space-y-4">
        <ChatConnectLogo size={56} className="animate-pulse" />
        <p
          className="text-base font-bold text-slate-800 dark:text-slate-200"
          style={{ fontFamily: 'Syne, sans-serif' }}
        >
          Loading ChatConnect...
        </p>
      </div>
    );
  }

  // Not signed in or needs first-time profile setup
  if ((!firebaseUser && !currentUserProfile) || needsOnboarding || !currentUserProfile || !userPrivate) {
    return (
      <AuthOnboarding
        firebaseUser={firebaseUser}
        needsOnboarding={needsOnboarding}
        onProfileCreated={(quickSession) => {
          if (quickSession) {
            setCurrentUserProfile(quickSession.publicProfile);
            setUserPrivate(quickSession.privatePrefs);
          }
          setNeedsOnboarding(false);
        }}
      />
    );
  }

  // Full-Screen App Lock Password Screen
  const configuredAppPwd = getAppLockPassword(currentUserProfile.userId);
  if (isAppLocked && configuredAppPwd) {
    return (
      <div className="min-h-screen w-full bg-slate-950 text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-indigo-600/20 blur-3xl" />
          <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-cyan-500/20 blur-3xl" />
        </div>

        <div className="relative z-10 max-w-sm w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-7 space-y-6 shadow-2xl text-center">
          <div className="flex flex-col items-center space-y-3">
            <div className="relative">
              <img
                src={currentUserProfile.profilePhoto || getAvatarDataUri(currentUserProfile.name)}
                alt={currentUserProfile.name}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.src = getAvatarDataUri(currentUserProfile.name);
                }}
                className="w-20 h-20 rounded-full object-cover border-2 border-indigo-500"
              />
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-md">
                <Lock className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <h1
                className="text-xl font-bold text-white"
                style={{ fontFamily: 'Syne, sans-serif' }}
              >
                ChatConnect Locked
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {currentUserProfile.name} ·{' '}
                <span className="font-mono text-indigo-400">@{currentUserProfile.username}</span>
              </p>
            </div>
          </div>

          <form onSubmit={handleUnlockApp} className="space-y-4 text-left">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                Enter App Lock Password / PIN
              </label>
              <div className="relative">
                <input
                  type={showUnlockPwd ? 'text' : 'password'}
                  required
                  autoFocus
                  value={unlockInput}
                  onChange={(e) => {
                    setUnlockInput(e.target.value);
                    setUnlockError(null);
                  }}
                  placeholder="Enter your password or PIN..."
                  className="w-full pl-3.5 pr-10 py-3 text-sm rounded-xl border border-slate-700 bg-slate-800/80 text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowUnlockPwd((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                >
                  {showUnlockPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {unlockError && <p className="text-xs text-rose-400 pt-1">{unlockError}</p>}
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              Unlock ChatConnect
            </button>
          </form>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
            <button
              type="button"
              onClick={() => {
                clearAppLockPassword(currentUserProfile.userId);
                clearQuickLocalSession();
                auth.signOut().catch(() => {});
                setCurrentUserProfile(null);
                setUserPrivate(null);
                setIsAppLocked(false);
              }}
              className="hover:text-rose-400 flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Reset & Switch Account
            </button>
            <span>End-to-End Protected</span>
          </div>
        </div>
      </div>
    );
  }

  // Suspended or Banned Account Screen
  if (currentUserProfile.accountStatus !== 'active') {
    return (
      <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 rounded-3xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950 text-rose-600 flex items-center justify-center mx-auto">
            <Ban className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Account {currentUserProfile.accountStatus === 'banned' ? 'Banned' : 'Suspended'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Your ChatConnect account (@{currentUserProfile.username}) has been{' '}
            {currentUserProfile.accountStatus} by a moderator.
          </p>
          <button
            type="button"
            onClick={() => {
              clearQuickLocalSession();
              auth.signOut().catch(() => {});
              setCurrentUserProfile(null);
              setUserPrivate(null);
            }}
            className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const activeChat = chats.find((c) => c.chatId === selectedChatId) || null;
  const activeChatOtherUid = activeChat
    ? activeChat.participant1 === currentUserProfile.userId
      ? activeChat.participant2
      : activeChat.participant1
    : null;
  const activeChatOtherUser = activeChatOtherUid ? contactsMap[activeChatOtherUid] || null : null;

  const visibleAnnouncements = announcements.filter(
    (a) => !dismissedAnnIds.includes(a.announcementId)
  );

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Top Bar Contract (3-Zone Header) */}
      <header className="h-14 px-4 sm:px-6 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between shrink-0 z-30">
        {/* Zone 1: Single text wordmark */}
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-white cursor-pointer"
          style={{ fontFamily: 'Syne, sans-serif' }}
        >
          ChatConnect
        </button>

        {/* Zone 2: Clean text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'home'
                ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('chats')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'chats'
                ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            Chats {totalUnreadMessages > 0 ? `(${totalUnreadMessages})` : ''}
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchInitialMode('search');
              setActiveTab('search');
            }}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'search'
                ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            Search ID
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'settings' || activeTab === 'profile'
                ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            Settings
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className={`hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'admin'
                  ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              Admin
            </button>
          )}
        </nav>

        {/* Zone 3: Primary Actions (App Lock / Setup Password + New Chat + Profile) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const pwd = getAppLockPassword(currentUserProfile.userId);
              if (pwd) {
                setIsAppLocked(true);
              } else {
                setSetupPwdInput('');
                setShowSetupPwdModal(true);
              }
            }}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            title={
              configuredAppPwd
                ? 'Lock ChatConnect App Now'
                : 'Setup App Lock Password / PIN'
            }
          >
            <Lock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden sm:inline">
              {configuredAppPwd ? 'Lock App' : 'Set Password'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSearchInitialMode('search');
              setActiveTab('search');
            }}
            className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer whitespace-nowrap"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            New Chat
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className="flex items-center gap-2 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title={`@${currentUserProfile.username} Profile & Settings`}
          >
            <img
              src={currentUserProfile.profilePhoto || getAvatarDataUri(currentUserProfile.name)}
              alt={currentUserProfile.name}
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.src = getAvatarDataUri(currentUserProfile.name);
              }}
              className="w-8 h-8 rounded-full object-cover border border-indigo-500/40"
            />
          </button>
        </div>
      </header>

      {/* Offline Connection Warning Banner */}
      {isOffline && (
        <div className="px-4 py-2 bg-amber-500 text-white text-xs font-medium flex items-center justify-center gap-2 shrink-0">
          <WifiOff className="w-4 h-4" />
          <span>Internet disconnected. Messages will sync automatically when back online.</span>
        </div>
      )}

      {/* In-App Push Notification Toast */}
      {pushBanner && (
        <div className="fixed top-16 right-4 z-50 max-w-sm w-full bg-slate-900 dark:bg-slate-800 text-white rounded-2xl p-4 shadow-xl border border-indigo-500/40 flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setSelectedChatId(pushBanner.chatId);
              setActiveTab('chats');
              setPushBanner(null);
            }}
            className="flex-1 text-left cursor-pointer"
          >
            <p className="text-xs font-bold text-cyan-300">{pushBanner.senderName}</p>
            <p className="text-xs text-slate-200 truncate mt-0.5">{pushBanner.previewText}</p>
            <span className="text-[10px] text-indigo-300 mt-1 inline-block">
              Tap to open conversation →
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPushBanner(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Active Admin Announcement Banner */}
      {visibleAnnouncements.length > 0 && (
        <div className="px-4 py-2 bg-indigo-600 text-white text-xs flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 truncate">
            <Megaphone className="w-3.5 h-3.5 shrink-0" />
            <span className="font-semibold">{visibleAnnouncements[0].title}:</span>
            <span className="truncate opacity-95">{visibleAnnouncements[0].body}</span>
          </div>
          <button
            type="button"
            onClick={() =>
              setDismissedAnnIds((prev) => [...prev, visibleAnnouncements[0].announcementId])
            }
            className="text-indigo-200 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Workspace */}
      <main className="flex-1 overflow-hidden pb-16 md:pb-0">
        {(activeTab === 'home' || activeTab === 'chats') && (
          <div className="h-full w-full flex overflow-hidden">
            {/* Left Sidebar: Recent Conversations List */}
            <aside
              className={`${
                selectedChatId && activeTab === 'chats' ? 'hidden md:flex' : 'flex'
              } w-full md:w-88 lg:w-96 flex-col border-r border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shrink-0`}
            >
              {/* User Identity & Quick Actions Bar */}
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ChatConnectLogo size={30} />
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {currentUserProfile.name}
                      </h2>
                      <p className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 truncate">
                        @{currentUserProfile.username} · Active
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSetupPwdInput(getAppLockPassword(currentUserProfile.userId));
                        setShowSetupPwdModal(true);
                      }}
                      className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer"
                      title="Set or Change App Lock Password"
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchInitialMode('my-qr');
                        setActiveTab('search');
                      }}
                      className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer"
                      title="My QR Profile"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchInitialMode('search');
                        setActiveTab('search');
                      }}
                      className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer"
                      title="Search User by @ID"
                    >
                      <Search className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('settings')}
                      className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer"
                      title="Settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Search Conversations or Find User by @ID Input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={chatListSearch}
                    onChange={(e) => setChatListSearch(e.target.value)}
                    placeholder="Search user @ID, name, or chats..."
                    className="w-full pl-8 pr-8 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 focus:outline-none focus:border-indigo-500"
                  />
                  {chatListSearch && (
                    <button
                      type="button"
                      onClick={() => setChatListSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Interactive Filter Tabs */}
                <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-[11px]">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'unread', label: 'Unread' },
                      { id: 'pinned', label: 'Pinned' },
                      { id: 'archived', label: 'Archived' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setChatFilter(f.id)}
                      className={`py-1.5 px-2 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        chatFilter === f.id
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conversation Rows & Instant User Search Results */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
                {filteredChats.length > 0 &&
                  filteredChats.map((c) => {
                    const otherUid =
                      c.participant1 === currentUserProfile.userId
                        ? c.participant2
                        : c.participant1;
                    const contact = contactsMap[otherUid];
                    const presence = getVisiblePresenceStatus(
                      contact,
                      true,
                      currentUserProfile.userId
                    );
                    const photo = getVisibleProfilePhoto(
                      contact,
                      true,
                      currentUserProfile.userId
                    );
                    const myUnread =
                      c.participant1 === currentUserProfile.userId
                        ? c.unreadCount1
                        : c.unreadCount2;
                    const isPinned = userPrivate.pinnedChats.includes(c.chatId);
                    const isMuted = userPrivate.mutedChats.includes(c.chatId);
                    const isSelected = selectedChatId === c.chatId;

                    return (
                      <div
                        key={c.chatId}
                        onClick={() => {
                          setSelectedChatId(c.chatId);
                          setActiveTab('chats');
                        }}
                        className={`group w-full px-4 py-3.5 flex items-center gap-3.5 text-left transition-colors cursor-pointer relative ${
                          isSelected
                            ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-l-3 border-l-indigo-600'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="relative shrink-0">
                          <img
                            src={photo}
                            alt={contact?.name || 'User'}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.src = getAvatarDataUri(contact?.name || 'User');
                            }}
                            className="w-12 h-12 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                          />
                          {presence.isOnlineVisible && (
                            <span
                              className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900"
                              title="Online"
                            />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                              {contact?.name || 'ChatConnect User'}
                            </span>
                            <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                              {formatMessageTime(c.lastMessageTime)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {c.lastMessageText ||
                                (contact ? `@${contact.username}` : 'Tap to message')}
                            </p>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {isPinned && <Pin className="w-3 h-3 text-indigo-500" />}
                              {isMuted && <BellOff className="w-3 h-3 text-slate-400" />}
                              {myUnread > 0 && (
                                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                                  {myUnread}
                                </span>
                              )}

                              {/* Quick Delete Chat Button on Conversation Row */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setChatToDelete(c);
                                }}
                                className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-all cursor-pointer"
                                title="Delete conversation"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                {/* Matching Users Directory Section (when searching or when no active chats) */}
                {(chatListSearch.trim() !== '' || filteredChats.length === 0) && (
                  <div className="p-3 space-y-2.5 bg-slate-50/40 dark:bg-slate-900/40">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {chatListSearch.trim()
                          ? `Users matching "${chatListSearch.trim()}"`
                          : 'Discover Users on ChatConnect'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchInitialMode('search');
                          setActiveTab('search');
                        }}
                        className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                      >
                        Full Search →
                      </button>
                    </div>

                    {sidebarMatchedUsers.length > 0 ? (
                      <div className="space-y-1.5">
                        {sidebarMatchedUsers.map((u) => (
                          <div
                            key={u.userId}
                            className="p-2.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-2.5"
                          >
                            <div
                              onClick={() => setInspectedUser(u)}
                              className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
                            >
                              <div className="relative shrink-0">
                                <img
                                  src={u.profilePhoto || getAvatarDataUri(u.name)}
                                  alt={u.name}
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    e.currentTarget.src = getAvatarDataUri(u.name);
                                  }}
                                  className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                                />
                                {u.isOnline && (
                                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-800" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                  {u.name}
                                </p>
                                <p className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 truncate">
                                  @{u.username}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleStartChatWithUser(u)}
                              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
                            >
                              Message
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      cleanSidebarHandle.length >= 2 && (
                        <div className="p-4 rounded-2xl bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-center space-y-2.5">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            Connect with <span className="font-mono text-indigo-600 dark:text-indigo-400">@{cleanSidebarHandle}</span>
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              const newU = createInstantUserFromHandle(chatListSearch);
                              handleStartChatWithUser(newU);
                            }}
                            className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
                          >
                            Connect & Message @{cleanSidebarHandle}
                          </button>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            </aside>

            {/* Right Pane: Active 1-to-1 Chat or Welcome Hub */}
            <section
              className={`${
                selectedChatId && activeTab === 'chats' ? 'flex' : 'hidden md:flex'
              } flex-1 h-full flex-col bg-slate-50 dark:bg-slate-950`}
            >
              {activeChat ? (
                <ChatView
                  chat={activeChat}
                  otherUser={activeChatOtherUser}
                  currentUser={currentUserProfile}
                  userPrivate={userPrivate}
                  allContactsMap={contactsMap}
                  allChats={chats}
                  onBack={() => {
                    setSelectedChatId(null);
                    setActiveTab('home');
                  }}
                  onViewProfile={(u) => setInspectedUser(u)}
                  onTogglePin={(cid) => togglePrivateListItem('pinnedChats', cid, 20)}
                  onToggleArchive={(cid) => togglePrivateListItem('archivedChats', cid, 50)}
                  onToggleMute={(cid) => togglePrivateListItem('mutedChats', cid, 50)}
                  onToggleBlockUser={(uid) => togglePrivateListItem('blockedUsers', uid, 50)}
                  onChatDeleted={() => {
                    const remaining = chats.filter((c) => c.chatId !== activeChat.chatId);
                    setChats(remaining);
                    saveLocalChats(currentUserProfile.userId, remaining);
                    setSelectedChatId(null);
                  }}
                  onChatUpdated={(updatedChat) => {
                    const nextChats = [
                      updatedChat,
                      ...chats.filter((c) => c.chatId !== updatedChat.chatId),
                    ];
                    setChats(nextChats);
                    saveLocalChats(currentUserProfile.userId, nextChats);
                  }}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-lg mx-auto space-y-6">
                  <ChatConnectLogo size={68} />
                  <div className="space-y-2">
                    <h2
                      className="text-2xl font-bold text-slate-900 dark:text-white"
                      style={{ fontFamily: 'Syne, sans-serif' }}
                    >
                      Welcome, {currentUserProfile.name}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      Your unique User ID is{' '}
                      <strong className="font-mono text-indigo-600 dark:text-indigo-400">
                        @{currentUserProfile.username}
                      </strong>
                      . Select a conversation on the left or search another person’s @UserID to start a real-time 1-to-1 chat.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSearchInitialMode('search');
                        setActiveTab('search');
                      }}
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 shadow-xs cursor-pointer"
                    >
                      <Search className="w-4 h-4" />
                      Search User by @ID
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSetupPwdInput(getAppLockPassword(currentUserProfile.userId));
                        setShowSetupPwdModal(true);
                      }}
                      className="px-5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer"
                    >
                      <KeyRound className="w-4 h-4 text-indigo-500" />
                      {configuredAppPwd ? 'Manage App Password' : 'Setup App Password'}
                    </button>
                  </div>

                  <div className="pt-4 flex items-center gap-2 text-[11px] text-slate-400">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    <span>Protected by participant-isolated real-time security rules</span>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'search' && (
          <SearchAndQRView
            currentUserProfile={currentUserProfile}
            contactUserIds={Object.keys(contactsMap)}
            blockedUserIds={userPrivate.blockedUsers}
            onStartChatWithUser={handleStartChatWithUser}
            onViewUserProfile={(u) => setInspectedUser(u)}
            initialMode={searchInitialMode}
          />
        )}

        {(activeTab === 'settings' || activeTab === 'profile') && (
          <SettingsAndProfileView
            currentUser={currentUserProfile}
            userPrivate={userPrivate}
            allContactsMap={contactsMap}
            initialSection="profile"
            onOpenMyQR={() => {
              setSearchInitialMode('my-qr');
              setActiveTab('search');
            }}
            onOpenArchivedChats={() => {
              setChatFilter('archived');
              setActiveTab('home');
            }}
            onThemeChanged={applyTheme}
            onLockAppNow={() => setIsAppLocked(true)}
            onProfileUpdatedLocally={(pub, priv) => {
              setCurrentUserProfile(pub);
              setUserPrivate(priv);
            }}
            onLoggedOut={() => {
              setCurrentUserProfile(null);
              setUserPrivate(null);
              setSelectedChatId(null);
            }}
          />
        )}

        {activeTab === 'admin' && (
          <AdminPanelView currentUser={currentUserProfile} isAdmin={isAdmin} />
        )}
      </main>

      {/* Mobile Bottom Tab Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 items-center z-30">
        <button
          type="button"
          onClick={() => {
            setSelectedChatId(null);
            setActiveTab('home');
          }}
          className={`flex flex-col items-center justify-center h-full cursor-pointer ${
            activeTab === 'home' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-1">Home</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('chats')}
          className={`relative flex flex-col items-center justify-center h-full cursor-pointer ${
            activeTab === 'chats' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
          }`}
        >
          <MessageSquare className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-1">Chats</span>
          {totalUnreadMessages > 0 && (
            <span className="absolute top-2 right-6 w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px] font-bold flex items-center justify-center">
              {totalUnreadMessages}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setSearchInitialMode('search');
            setActiveTab('search');
          }}
          className={`flex flex-col items-center justify-center h-full cursor-pointer ${
            activeTab === 'search' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
          }`}
        >
          <Search className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-1">Search ID</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center justify-center h-full cursor-pointer ${
            activeTab === 'settings' || activeTab === 'profile'
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500'
          }`}
        >
          <UserIcon className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-1">Profile</span>
        </button>
      </nav>

      {/* Quick Setup App Lock Password Modal */}
      {showSetupPwdModal && (
        <div
          onClick={() => setShowSetupPwdModal(false)}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Setup App Lock Password
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Protect ChatConnect with a custom password or PIN
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSetupPwdModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {setupPwdSavedToast ? (
              <div className="py-4 text-center space-y-2">
                <Check className="w-7 h-7 text-emerald-500 mx-auto" />
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  {setupPwdSavedToast}
                </p>
              </div>
            ) : (
              <form onSubmit={handleQuickSetupPasswordSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    App Password / PIN
                  </label>
                  <div className="relative">
                    <input
                      type={showSetupPwdEye ? 'text' : 'password'}
                      maxLength={32}
                      autoFocus
                      value={setupPwdInput}
                      onChange={(e) => setSetupPwdInput(e.target.value)}
                      placeholder="Enter password or 4-digit PIN..."
                      className="w-full pl-3.5 pr-10 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSetupPwdEye((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showSetupPwdEye ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  {configuredAppPwd && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowSetupPwdModal(false);
                        setIsAppLocked(true);
                      }}
                      className="px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
                    >
                      Lock Now
                    </button>
                  )}
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
                  >
                    Save Password
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Sidebar Delete Chat Confirmation Modal */}
      {chatToDelete && (
        <div
          onClick={() => setChatToDelete(null)}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 dark:bg-rose-950 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Delete Conversation?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  This will permanently remove this chat thread and all its messages.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setChatToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingSidebarChat}
                onClick={handleConfirmDeleteSidebarChat}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white cursor-pointer"
              >
                {deletingSidebarChat ? 'Deleting...' : 'Delete Chat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Profile Inspector Modal */}
      {inspectedUser && (
        <div
          onClick={() => setInspectedUser(null)}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <img
                  src={getVisibleProfilePhoto(
                    inspectedUser,
                    Boolean(contactsMap[inspectedUser.userId]),
                    currentUserProfile.userId
                  )}
                  alt={inspectedUser.name}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.src = getAvatarDataUri(inspectedUser.name);
                  }}
                  className="w-16 h-16 rounded-full object-cover border-2 border-indigo-500/30"
                />
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    {inspectedUser.name}
                  </h3>
                  <p className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                    @{inspectedUser.username}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {
                      getVisiblePresenceStatus(
                        inspectedUser,
                        Boolean(contactsMap[inspectedUser.userId]),
                        currentUserProfile.userId
                      ).statusText
                    }
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectedUser(null)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 space-y-1">
              <span className="text-[11px] font-medium text-slate-400">Bio</span>
              <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                {inspectedUser.bio || 'Available on ChatConnect'}
              </p>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  QR Profile Card
                </p>
                <p className="text-[11px] font-mono text-slate-500">
                  chatconnect://user/{inspectedUser.username}
                </p>
              </div>
              <div className="p-2 bg-white rounded-xl border border-slate-200">
                <QRCodeSVG
                  value={`chatconnect://user/${inspectedUser.username}`}
                  size={56}
                />
              </div>
            </div>

            {inspectedUser.userId !== currentUserProfile.userId && (
              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => handleStartChatWithUser(inspectedUser)}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  Send Message
                </button>
                <button
                  type="button"
                  onClick={() =>
                    togglePrivateListItem('blockedUsers', inspectedUser.userId, 50)
                  }
                  className="px-4 py-2.5 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Ban className="w-3.5 h-3.5" />
                  {userPrivate.blockedUsers.includes(inspectedUser.userId)
                    ? 'Unblock'
                    : 'Block'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
