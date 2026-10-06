import React, { useState, useRef, useEffect, useMemo } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import {
  Search,
  QrCode,
  Copy,
  Check,
  MessageSquare,
  User as UserIcon,
  Camera,
  Share2,
  X,
  Sparkles,
  Download,
  UserPlus,
  Users,
  AtSign,
} from 'lucide-react';
import { db } from '../firebase';
import { UserPublic } from '../types';
import {
  sanitizeUsername,
  getVisiblePresenceStatus,
  getVisibleProfilePhoto,
  getAvatarDataUri,
  getDirectoryUsers,
  upsertDirectoryUser,
  searchDirectoryUsers,
  createInstantUserFromHandle,
} from '../utils/helpers';

interface SearchAndQRViewProps {
  currentUserProfile: UserPublic;
  contactUserIds: string[];
  blockedUserIds: string[];
  onStartChatWithUser: (targetUser: UserPublic) => void;
  onViewUserProfile: (targetUser: UserPublic) => void;
  initialMode?: 'search' | 'my-qr' | 'scan-qr';
}

export const SearchAndQRView: React.FC<SearchAndQRViewProps> = ({
  currentUserProfile,
  contactUserIds,
  blockedUserIds,
  onStartChatWithUser,
  onViewUserProfile,
  initialMode = 'search',
}) => {
  const [activeTab, setActiveTab] = useState<'search' | 'my-qr' | 'scan-qr'>(initialMode);
  const [searchInput, setSearchInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<UserPublic | null>(null);
  const [matchedUsers, setMatchedUsers] = useState<UserPublic[]>([]);
  const [directoryPool, setDirectoryPool] = useState<UserPublic[]>(() => getDirectoryUsers());
  const [hasSearched, setHasSearched] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Camera QR Scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [qrUriInput, setQrUriInput] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const profileUri = `chatconnect://user/${currentUserProfile.username}`;

  useEffect(() => {
    setActiveTab(initialMode);
  }, [initialMode]);

  // Sync active users from Firestore into local directory on mount
  useEffect(() => {
    upsertDirectoryUser(currentUserProfile);
    const loadCloudUsers = async () => {
      try {
        const q = query(collection(db, 'users'), where('accountStatus', '==', 'active'));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const u = d.data() as UserPublic;
          if (u && u.username) {
            upsertDirectoryUser(u);
          }
        });
        setDirectoryPool(getDirectoryUsers());
      } catch {
        setDirectoryPool(getDirectoryUsers());
      }
    };
    loadCloudUsers();
  }, [currentUserProfile]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Live instant search as the user types
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (!trimmed) {
      setMatchedUsers([]);
      setFoundUser(null);
      setHasSearched(false);
      return;
    }
    const localMatches = searchDirectoryUsers(trimmed);
    setMatchedUsers(localMatches);
    if (localMatches.length > 0) {
      setFoundUser(localMatches[0]);
    } else {
      setFoundUser(null);
    }
  }, [searchInput, directoryPool]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setCameraError(
        'Camera access is unavailable in this browser frame. Paste a chatconnect://user/... link or @UserID below to open the profile immediately.'
      );
    }
  };

  const executeUserLookup = async (rawHandleOrName: string) => {
    const rawTrimmed = rawHandleOrName.replace(/^chatconnect:\/\/user\//i, '').trim();
    const cleaned = sanitizeUsername(rawTrimmed);

    if (!rawTrimmed) {
      setFoundUser(null);
      setMatchedUsers([]);
      setHasSearched(false);
      return;
    }

    setSearching(true);
    setHasSearched(true);

    try {
      // 1. Check exact username in Firestore /usernames/{cleaned}
      if (cleaned && cleaned.length >= 3) {
        try {
          const unameSnap = await getDoc(doc(db, 'usernames', cleaned));
          if (unameSnap.exists()) {
            const targetUid = unameSnap.data()?.userId as string | undefined;
            if (targetUid) {
              const userSnap = await getDoc(doc(db, 'users', targetUid));
              if (userSnap.exists()) {
                const cloudUser = userSnap.data() as UserPublic;
                if (cloudUser.accountStatus !== 'banned') {
                  upsertDirectoryUser(cloudUser);
                  setDirectoryPool(getDirectoryUsers());
                  setFoundUser(cloudUser);
                  setMatchedUsers([
                    cloudUser,
                    ...searchDirectoryUsers(rawTrimmed).filter(
                      (u) => u.userId !== cloudUser.userId
                    ),
                  ]);
                  setSearching(false);
                  return;
                }
              }
            }
          }
        } catch {
          // Proceed to Firestore /users query and directory lookup
        }
      }

      // 2. Refresh active users from Firestore /users
      try {
        const q = query(collection(db, 'users'), where('accountStatus', '==', 'active'));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const u = d.data() as UserPublic;
          if (u && u.username) {
            upsertDirectoryUser(u);
          }
        });
      } catch {
        // Proceed with local directory
      }

      // 3. Search combined directory by @UserID or Name
      const combinedMatches = searchDirectoryUsers(rawTrimmed);
      setDirectoryPool(getDirectoryUsers());
      setMatchedUsers(combinedMatches);
      if (combinedMatches.length > 0) {
        setFoundUser(combinedMatches[0]);
      } else {
        setFoundUser(null);
      }
    } finally {
      setSearching(false);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeUserLookup(searchInput);
  };

  const handleScanDecodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    stopCamera();
    setActiveTab('search');
    setSearchInput(qrUriInput);
    await executeUserLookup(qrUriInput);
  };

  const handleConnectNewHandle = () => {
    const created = createInstantUserFromHandle(searchInput);
    setDirectoryPool(getDirectoryUsers());
    setFoundUser(created);
    setMatchedUsers([created]);
    onStartChatWithUser(created);
  };

  const handleCopyProfileLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUri);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleShareQR = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${currentUserProfile.name} on ChatConnect`,
          text: `Connect with me on ChatConnect using my User ID @${currentUserProfile.username}`,
          url: profileUri,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    await handleCopyProfileLink();
  };

  const handleDownloadQR = () => {
    const svgEl = document.getElementById('chatconnect-user-qr-svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chatconnect-${currentUserProfile.username}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const discoverableDirectory = useMemo(() => {
    return directoryPool.filter(
      (u) => u.userId !== currentUserProfile.userId && u.accountStatus !== 'banned'
    );
  }, [directoryPool, currentUserProfile.userId]);

  const cleanTypedHandle = sanitizeUsername(
    searchInput.replace(/^chatconnect:\/\/user\//i, '').trim()
  );

  const renderUserCard = (userItem: UserPublic, isHighlighted = false) => {
    const isContact = contactUserIds.includes(userItem.userId);
    const isBlocked = blockedUserIds.includes(userItem.userId);
    const presence = getVisiblePresenceStatus(
      userItem,
      isContact,
      currentUserProfile.userId
    );
    const avatarUrl = getVisibleProfilePhoto(
      userItem,
      isContact,
      currentUserProfile.userId
    );

    return (
      <div
        key={userItem.userId}
        className={`p-5 rounded-3xl bg-white dark:bg-slate-900 border transition-all space-y-4 ${
          isHighlighted
            ? 'border-indigo-500/60 shadow-md ring-1 ring-indigo-500/20'
            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="relative shrink-0">
              <img
                src={avatarUrl}
                alt={userItem.name}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.src = getAvatarDataUri(userItem.name);
                }}
                className="w-14 h-14 rounded-full object-cover border border-slate-200 dark:border-slate-700"
              />
              {presence.isOnlineVisible && (
                <span
                  className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900"
                  title="Online"
                />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
                  {userItem.name}
                </h2>
                {userItem.userId === currentUserProfile.userId && (
                  <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                    · You
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                @{userItem.username}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {presence.isOnlineVisible ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    ● Online
                  </span>
                ) : (
                  presence.statusText
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onViewUserProfile(userItem)}
              className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <UserIcon className="w-3.5 h-3.5" />
              Profile
            </button>
            {userItem.userId !== currentUserProfile.userId && (
              <button
                type="button"
                disabled={isBlocked}
                onClick={() => onStartChatWithUser(userItem)}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer whitespace-nowrap"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                {isBlocked ? 'Blocked' : 'Message'}
              </button>
            )}
          </div>
        </div>

        {userItem.bio && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {userItem.bio}
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      {/* Header & Segmented Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1
            className="text-xl font-bold text-slate-900 dark:text-white"
            style={{ fontFamily: 'Syne, sans-serif' }}
          >
            Find User & QR Discovery
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Search any person by their @UserID or Name to start a 1-to-1 private chat
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl self-start">
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setActiveTab('search');
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'search'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            Search User
          </button>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setActiveTab('my-qr');
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'my-qr'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            My QR
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scan-qr')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'scan-qr'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            Scan QR
          </button>
        </div>
      </div>

      {/* TAB 1: SEARCH BY USER ID OR NAME */}
      {activeTab === 'search' && (
        <div className="space-y-6">
          <form
            onSubmit={handleSearchSubmit}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 space-y-4 shadow-2xs"
          >
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Search by Unique @UserID or Full Name
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-indigo-500 font-mono font-semibold text-sm">
                  @
                </span>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search @rahul123, @priya_sharma, or any Name/ID..."
                  className="w-full pl-8 pr-9 py-2.5 text-sm font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 focus:outline-none focus:border-indigo-500"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput('');
                      setFoundUser(null);
                      setMatchedUsers([]);
                      setHasSearched(false);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={searching}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors shadow-2xs cursor-pointer whitespace-nowrap"
              >
                <Search className="w-4 h-4" />
                {searching ? 'Finding...' : 'Find User'}
              </button>
            </div>

            {/* Quick Search Chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-slate-400 mr-1">Try searching:</span>
              {['@rahul123', '@priya_sharma', '@arjun_dev', '@kabir_singh'].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => {
                    setSearchInput(sample);
                    executeUserLookup(sample);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-[11px] font-mono text-indigo-600 dark:text-indigo-400 transition-colors cursor-pointer"
                >
                  {sample}
                </button>
              ))}
            </div>
          </form>

          {/* Search Results Section */}
          {searchInput.trim() && (
            <div className="space-y-4">
              {matchedUsers.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Found {matchedUsers.length} matching user{matchedUsers.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {matchedUsers.map((u, idx) => renderUserCard(u, idx === 0))}
                </div>
              ) : (
                <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
                    <AtSign className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      No existing profile matched &ldquo;{searchInput.trim()}&rdquo;
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                      Want to connect directly with{' '}
                      <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                        @{cleanTypedHandle || 'user'}
                      </span>
                      ? You can add this @UserID and start a private 1-to-1 chat immediately:
                    </p>
                  </div>
                  {cleanTypedHandle.length >= 2 && (
                    <button
                      type="button"
                      onClick={handleConnectNewHandle}
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-2 shadow-xs cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                      Connect & Message @{cleanTypedHandle}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Active & Discoverable Users Directory */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-500" />
                Active Users on ChatConnect ({discoverableDirectory.length})
              </h3>
              <span className="text-[11px] text-slate-400">Tap Message to start chatting</span>
            </div>

            <div className="space-y-3">
              {discoverableDirectory.map((u) => renderUserCard(u, false))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MY QR PROFILE */}
      {activeTab === 'my-qr' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 text-center space-y-6">
          <div className="flex flex-col items-center space-y-2">
            <img
              src={currentUserProfile.profilePhoto || getAvatarDataUri(currentUserProfile.name)}
              alt={currentUserProfile.name}
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.src = getAvatarDataUri(currentUserProfile.name);
              }}
              className="w-16 h-16 rounded-full object-cover border-2 border-indigo-500/30"
            />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {currentUserProfile.name}
            </h2>
            <p className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
              @{currentUserProfile.username}
            </p>
          </div>

          <div className="inline-flex p-5 rounded-3xl bg-white border border-slate-200 shadow-xs mx-auto">
            <QRCodeSVG
              id="chatconnect-user-qr-svg"
              value={profileUri}
              size={200}
              level="M"
              includeMargin={false}
              fgColor="#1e1b4b"
              bgColor="#ffffff"
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-mono text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 py-2 px-3 rounded-xl inline-block">
              {profileUri}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 block">
              Anyone who scans this QR code on ChatConnect can open your profile and start chatting.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleCopyProfileLink}
              className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedLink ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              {copiedLink ? 'Copied Profile Link!' : 'Copy Profile Link'}
            </button>
            <button
              type="button"
              onClick={handleShareQR}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              Share Profile QR
            </button>
            <button
              type="button"
              onClick={handleDownloadQR}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download SVG
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: SCAN ANOTHER USER'S QR */}
      {activeTab === 'scan-qr' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Scan ChatConnect QR Code
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Use your camera or paste a shared <span className="font-mono">chatconnect://user/...</span> link
              </p>
            </div>
            {!cameraActive ? (
              <button
                type="button"
                onClick={startCamera}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Camera className="w-3.5 h-3.5" />
                Start Camera
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5" />
                Stop Camera
              </button>
            )}
          </div>

          {cameraActive && (
            <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center border border-indigo-500/40">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-44 h-44 border-2 border-cyan-400 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              </div>
            </div>
          )}

          {cameraError && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-300">
              {cameraError}
            </div>
          )}

          <form onSubmit={handleScanDecodeSubmit} className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Open via QR Link or @UserID
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={qrUriInput}
                onChange={(e) => setQrUriInput(e.target.value)}
                placeholder="chatconnect://user/rahul123 or @rahul123"
                className="flex-1 px-3.5 py-2.5 text-sm font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Open User Profile
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
