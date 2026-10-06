import React, { useState } from 'react';
import {
  doc,
  getDoc,
  updateDoc,
  writeBatch,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { deleteUser } from 'firebase/auth';
import {
  User as UserIcon,
  Shield,
  MessageSquare,
  Bell,
  Sun,
  Moon,
  Monitor,
  HelpCircle,
  LogOut,
  Trash2,
  Camera,
  AtSign,
  CheckCircle2,
  AlertCircle,
  QrCode,
  Lock,
  Ban,
  Volume2,
  Archive,
  Send,
  KeyRound,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  auth,
  db,
  EXTERNAL_FIREBASE_CONFIG,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import { PrivacyLevel, ThemeMode, UserPrivate, UserPublic } from '../types';
import {
  AVATAR_PRESETS,
  compressImageFile,
  getAvatarDataUri,
  playNotificationChime,
  sanitizeUsername,
  getAppLockPassword,
  setAppLockPassword,
  clearAppLockPassword,
  getAppAutoLockEnabled,
  setAppAutoLockEnabled,
  clearQuickLocalSession,
  saveQuickLocalSession,
} from '../utils/helpers';
import { ChatConnectLogo } from './BrandIcons';

interface SettingsAndProfileViewProps {
  currentUser: UserPublic;
  userPrivate: UserPrivate;
  allContactsMap: Record<string, UserPublic>;
  initialSection?:
    | 'profile'
    | 'privacy'
    | 'chats'
    | 'notifications'
    | 'appearance'
    | 'security'
    | 'help';
  onOpenMyQR: () => void;
  onOpenArchivedChats: () => void;
  onThemeChanged: (theme: ThemeMode) => void;
  onLockAppNow?: () => void;
  onProfileUpdatedLocally?: (updatedPublic: UserPublic, updatedPrivate: UserPrivate) => void;
  onLoggedOut?: () => void;
}

export const SettingsAndProfileView: React.FC<SettingsAndProfileViewProps> = ({
  currentUser,
  userPrivate,
  allContactsMap,
  initialSection = 'profile',
  onOpenMyQR,
  onOpenArchivedChats,
  onThemeChanged,
  onLockAppNow,
  onProfileUpdatedLocally,
  onLoggedOut,
}) => {
  const [activeSection, setActiveSection] = useState<
    'profile' | 'privacy' | 'chats' | 'notifications' | 'appearance' | 'security' | 'help'
  >(initialSection);

  // Edit Profile state
  const [name, setName] = useState(currentUser.name);
  const [bio, setBio] = useState(currentUser.bio);
  const [profilePhoto, setProfilePhoto] = useState(currentUser.profilePhoto);
  const [newUsername, setNewUsername] = useState(currentUser.username);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // App Lock Password state
  const [currentAppPwd, setCurrentAppPwd] = useState(() =>
    getAppLockPassword(currentUser.userId)
  );
  const [newAppPwdInput, setNewAppPwdInput] = useState(() =>
    getAppLockPassword(currentUser.userId)
  );
  const [showAppPwd, setShowAppPwd] = useState(false);
  const [autoLockOnLaunch, setAutoLockOnLaunch] = useState(() =>
    getAppAutoLockEnabled(currentUser.userId)
  );

  // Delete Account confirmation
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Help problem report
  const [problemText, setProblemText] = useState('');
  const [problemSubmitted, setProblemSubmitted] = useState(false);

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 3200);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 400, 0.78);
      setProfilePhoto(compressed);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to compress photo.');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim().slice(0, 80);
    const cleanedUsername = sanitizeUsername(newUsername);

    if (!trimmedName) {
      showToast('error', 'Name cannot be empty.');
      return;
    }
    if (cleanedUsername.length < 3 || cleanedUsername.length > 32) {
      showToast('error', 'User ID must be 3–32 lowercase characters.');
      return;
    }

    setSaving(true);
    try {
      const updatedPublic: UserPublic = {
        ...currentUser,
        username: cleanedUsername,
        name: trimmedName,
        bio: bio.trim().slice(0, 200),
        profilePhoto: profilePhoto.slice(0, 500000),
      };
      saveQuickLocalSession(updatedPublic, userPrivate);
      onProfileUpdatedLocally?.(updatedPublic, userPrivate);

      if (auth.currentUser) {
        const usernameChanged = cleanedUsername !== currentUser.username;
        if (usernameChanged) {
          const targetUsernameRef = doc(db, 'usernames', cleanedUsername);
          const snap = await getDoc(targetUsernameRef);
          if (snap.exists() && snap.data()?.userId !== currentUser.userId) {
            showToast('error', `@${cleanedUsername} is already taken by another user.`);
            setSaving(false);
            return;
          }

          const batch = writeBatch(db);
          batch.set(targetUsernameRef, {
            username: cleanedUsername,
            userId: currentUser.userId,
            createdAt: serverTimestamp(),
          });
          batch.update(doc(db, 'users', currentUser.userId), {
            username: cleanedUsername,
            name: trimmedName,
            bio: bio.trim().slice(0, 200),
            profilePhoto: profilePhoto.slice(0, 500000),
            updatedAt: serverTimestamp(),
          });
          batch.delete(doc(db, 'usernames', currentUser.username));
          await batch.commit();
        } else {
          await updateDoc(doc(db, 'users', currentUser.userId), {
            name: trimmedName,
            bio: bio.trim().slice(0, 200),
            profilePhoto: profilePhoto.slice(0, 500000),
            updatedAt: serverTimestamp(),
          });
        }
      }
      showToast('success', 'Profile and @UserID updated!');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.userId}`);
      } catch {
        showToast('success', 'Profile saved locally!');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAppLockPassword = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newAppPwdInput.trim();
    if (!trimmed) {
      clearAppLockPassword(currentUser.userId);
      setCurrentAppPwd('');
      showToast('success', 'App Lock password removed.');
      return;
    }
    if (trimmed.length < 3) {
      showToast('error', 'App Lock password/PIN must be at least 3 characters.');
      return;
    }
    setAppLockPassword(trimmed, currentUser.userId);
    setCurrentAppPwd(trimmed);
    showToast('success', 'App Lock password saved! You can lock the app anytime.');
  };

  const handleRemoveAppLockPassword = () => {
    clearAppLockPassword(currentUser.userId);
    setCurrentAppPwd('');
    setNewAppPwdInput('');
    showToast('success', 'App Lock password disabled.');
  };

  const handleToggleAutoLock = (checked: boolean) => {
    setAutoLockOnLaunch(checked);
    setAppAutoLockEnabled(checked, currentUser.userId);
    showToast('success', checked ? 'Auto-Lock on launch enabled.' : 'Auto-Lock on launch disabled.');
  };

  const handleUpdatePrivacy = async (
    field: 'privacyPhoto' | 'privacyLastSeen' | 'privacyOnline' | 'readReceipts',
    value: PrivacyLevel | boolean
  ) => {
    const updatedPublic = { ...currentUser, [field]: value };
    saveQuickLocalSession(updatedPublic, userPrivate);
    onProfileUpdatedLocally?.(updatedPublic, userPrivate);

    if (!auth.currentUser) {
      showToast('success', 'Privacy setting saved.');
      return;
    }
    try {
      await updateDoc(doc(db, 'users', currentUser.userId), {
        [field]: value,
        updatedAt: serverTimestamp(),
      });
      showToast('success', 'Privacy setting saved.');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.userId}`);
      } catch {
        showToast('error', 'Could not update privacy setting.');
      }
    }
  };

  const handleUpdatePrivatePref = async (
    updates: Partial<
      Pick<
        UserPrivate,
        | 'wallpaper'
        | 'enterToSend'
        | 'mediaAutoDownload'
        | 'notificationsEnabled'
        | 'notificationSound'
        | 'notificationVibration'
        | 'notificationPreview'
        | 'theme'
        | 'blockedUsers'
      >
    >
  ) => {
    const updatedPrivate = { ...userPrivate, ...updates };
    saveQuickLocalSession(currentUser, updatedPrivate);
    onProfileUpdatedLocally?.(currentUser, updatedPrivate);
    if (updates.theme) {
      onThemeChanged(updates.theme);
    }

    if (!auth.currentUser) {
      showToast('success', 'Preferences saved.');
      return;
    }
    try {
      await updateDoc(doc(db, 'users', currentUser.userId, 'private', 'info'), {
        ...updates,
        updatedAt: serverTimestamp(),
      });
      showToast('success', 'Preferences saved.');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.userId}/private/info`);
      } catch {
        showToast('error', 'Failed to save preference.');
      }
    }
  };

  const handleUnblockUser = async (uidToUnblock: string) => {
    const nextBlocked = userPrivate.blockedUsers.filter((id) => id !== uidToUnblock);
    await handleUpdatePrivatePref({ blockedUsers: nextBlocked });
  };

  const handleRequestBrowserPushPermission = async () => {
    if (typeof Notification === 'undefined') {
      showToast('error', 'Browser notifications are not supported in this frame.');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        showToast('success', 'Push notifications enabled!');
      } else {
        showToast('error', `Notification permission state: ${result}`);
      }
    } catch {
      showToast('error', 'Unable to request notification permission in iframe.');
    }
  };

  const handleSignOutClick = async () => {
    clearQuickLocalSession();
    try {
      await auth.signOut();
    } catch {
      // Ignore
    }
    onLoggedOut?.();
  };

  const handleDeleteAccountPermanently = async () => {
    setSaving(true);
    clearQuickLocalSession();
    clearAppLockPassword(currentUser.userId);
    try {
      if (auth.currentUser) {
        await deleteDoc(doc(db, 'usernames', currentUser.username));
        await deleteDoc(doc(db, 'users', currentUser.userId, 'private', 'info'));
        await deleteDoc(doc(db, 'users', currentUser.userId));
        try {
          await deleteUser(auth.currentUser);
        } catch {
          await auth.signOut();
        }
      }
      onLoggedOut?.();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `users/${currentUser.userId}`);
      } catch {
        onLoggedOut?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReportProblemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problemText.trim()) return;
    const repId = `prob_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      if (auth.currentUser) {
        await setDoc(doc(db, 'reports', repId), {
          reportId: repId,
          reporterId: currentUser.userId,
          targetUserId: currentUser.userId,
          reason: 'Help Center Problem Report',
          details: problemText.trim().slice(0, 1000),
          status: 'open',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setProblemSubmitted(true);
      setProblemText('');
      setTimeout(() => setProblemSubmitted(false), 3000);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `reports/${repId}`);
      } catch {
        showToast('error', 'Could not submit problem report.');
      }
    }
  };

  const navItems = [
    { id: 'profile', label: 'Edit Profile & @ID', icon: UserIcon },
    { id: 'security', label: 'App Lock & Password', icon: Lock },
    { id: 'privacy', label: 'Privacy & Blocked', icon: Shield },
    { id: 'chats', label: 'Chat Settings', icon: MessageSquare },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'appearance', label: 'Appearance & Theme', icon: Sun },
    { id: 'help', label: 'Help & About', icon: HelpCircle },
  ] as const;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left Settings Sidebar */}
        <div className="md:col-span-4 space-y-4">
          <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={currentUser.profilePhoto || getAvatarDataUri(currentUser.name)}
                alt={currentUser.name}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.src = getAvatarDataUri(currentUser.name);
                }}
                className="w-12 h-12 rounded-full object-cover border border-indigo-500/30 shrink-0"
              />
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {currentUser.name}
                </h2>
                <p className="text-xs font-mono text-indigo-600 dark:text-indigo-400 truncate">
                  @{currentUser.username}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenMyQR}
              className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 cursor-pointer"
              title="Open My QR Code"
            >
              <QrCode className="w-4 h-4" />
            </button>
          </div>

          <nav className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-2 space-y-1 shadow-2xs">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full px-3.5 py-2.5 rounded-2xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </div>
                  {item.id === 'security' && currentAppPwd && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        active
                          ? 'bg-white/20 text-white'
                          : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      Locked
                    </span>
                  )}
                </button>
              );
            })}

            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

            <button
              type="button"
              onClick={handleSignOutClick}
              className="w-full px-3.5 py-2.5 rounded-2xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-3 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Log Out</span>
            </button>
          </nav>
        </div>

        {/* Right Detail Panel */}
        <div className="md:col-span-8 space-y-5">
          {feedback && (
            <div
              className={`p-3.5 rounded-2xl border flex items-center gap-2.5 text-xs ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* SECTION 1: EDIT PROFILE & @USERID */}
          {activeSection === 'profile' && (
            <form
              onSubmit={handleSaveProfile}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-5 shadow-2xs"
            >
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Public Profile & Unique User ID
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Manage how others discover and recognize you on ChatConnect
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                <div className="relative">
                  <img
                    src={profilePhoto || getAvatarDataUri(name)}
                    alt={name}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = getAvatarDataUri(name);
                    }}
                    className="w-20 h-20 rounded-full object-cover border-2 border-indigo-500/40"
                  />
                  <label
                    htmlFor="settings-dp-upload"
                    className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center cursor-pointer hover:bg-indigo-500"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <input
                      id="settings-dp-upload"
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="space-y-2 text-center sm:text-left">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    Change Profile Photo
                  </p>
                  <div className="flex items-center justify-center sm:justify-start gap-2">
                    {AVATAR_PRESETS.map((p) => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => setProfilePhoto(getAvatarDataUri(name || 'User', p.hex))}
                        className="w-6 h-6 rounded-full border border-white/40 cursor-pointer"
                        style={{ backgroundColor: p.hex }}
                        title={p.label}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Display Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <AtSign className="w-3.5 h-3.5 text-indigo-500" />
                    Unique User ID
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={32}
                    value={newUsername}
                    onChange={(e) => setNewUsername(sanitizeUsername(e.target.value))}
                    className="w-full px-3.5 py-2.5 text-sm font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Bio</label>
                  <span className="text-slate-400 tabular-nums">{bio.length}/200</span>
                </div>
                <textarea
                  rows={3}
                  maxLength={200}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 resize-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                >
                  {saving ? 'Saving Changes...' : 'Save Profile'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('security')}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                  {currentAppPwd ? 'Manage App Lock Password' : 'Setup App Lock Password'}
                </button>
              </div>
            </form>
          )}

          {/* SECTION 2: PRIVACY & BLOCKED USERS */}
          {activeSection === 'privacy' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-6 shadow-2xs">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Privacy Controls
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Control who can see your presence, photo, and read receipts
                </p>
              </div>

              <div className="space-y-4">
                {(
                  [
                    {
                      field: 'privacyPhoto',
                      label: 'Who can see my Profile Photo',
                      value: currentUser.privacyPhoto,
                    },
                    {
                      field: 'privacyLastSeen',
                      label: 'Who can see my Last Seen timestamp',
                      value: currentUser.privacyLastSeen,
                    },
                    {
                      field: 'privacyOnline',
                      label: 'Who can see my Online status',
                      value: currentUser.privacyOnline,
                    },
                  ] as const
                ).map((item) => (
                  <div
                    key={item.field}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800"
                  >
                    <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      {item.label}
                    </span>
                    <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                      {(['everyone', 'contacts', 'nobody'] as PrivacyLevel[]).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => handleUpdatePrivacy(item.field, lvl)}
                          className={`px-3 py-1 text-xs font-medium rounded-lg capitalize cursor-pointer ${
                            item.value === lvl
                              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                              : 'text-slate-500'
                          }`}
                        >
                          {lvl}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between pt-1">
                  <div>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Read Receipts
                    </p>
                    <p className="text-[11px] text-slate-500">
                      If turned off, you won't send or see read receipts in 1-to-1 chats.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={currentUser.readReceipts}
                    onChange={(e) => handleUpdatePrivacy('readReceipts', e.target.checked)}
                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* Blocked Users List */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Ban className="w-3.5 h-3.5 text-rose-500" />
                  Blocked Users ({userPrivate.blockedUsers.length})
                </h4>
                {userPrivate.blockedUsers.length === 0 ? (
                  <p className="text-xs text-slate-400">You haven't blocked any users.</p>
                ) : (
                  <div className="space-y-2">
                    {userPrivate.blockedUsers.map((bUid) => {
                      const u = allContactsMap[bUid];
                      return (
                        <div
                          key={bUid}
                          className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between"
                        >
                          <div className="text-xs">
                            <p className="font-semibold text-slate-900 dark:text-white">
                              {u?.name || 'Blocked User'}
                            </p>
                            <p className="font-mono text-slate-400">
                              @{u?.username || bUid.slice(0, 8)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleUnblockUser(bUid)}
                            className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-indigo-600 hover:underline cursor-pointer"
                          >
                            Unblock
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 3: CHATS SETTINGS */}
          {activeSection === 'chats' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-6 shadow-2xs">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Chats & Media Preferences
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Customize chat wallpaper, Enter key behavior, and media auto-download
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Chat Wallpaper
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { id: 'default', label: 'Clean Slate' },
                    { id: 'indigo', label: 'Indigo Aura' },
                    { id: 'nordic', label: 'Nordic Mist' },
                    { id: 'obsidian', label: 'Obsidian' },
                    { id: 'sunset', label: 'Warm Horizon' },
                  ].map((wp) => (
                    <button
                      key={wp.id}
                      type="button"
                      onClick={() => handleUpdatePrivatePref({ wallpaper: wp.id })}
                      className={`p-3 rounded-2xl border text-xs font-medium cursor-pointer transition-all ${
                        userPrivate.wallpaper === wp.id
                          ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {wp.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Enter Key Sends Message
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Pressing Enter sends your message immediately
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={userPrivate.enterToSend}
                    onChange={(e) => handleUpdatePrivatePref({ enterToSend: e.target.checked })}
                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Auto-Download Shared Media
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Automatically load incoming photos and voice notes
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={userPrivate.mediaAutoDownload}
                    onChange={(e) =>
                      handleUpdatePrivatePref({ mediaAutoDownload: e.target.checked })
                    }
                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Archived Conversations ({userPrivate.archivedChats.length})
                    </p>
                    <p className="text-[11px] text-slate-500">
                      View or unarchive hidden conversations
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenArchivedChats}
                    className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Open Archived
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4: NOTIFICATIONS */}
          {activeSection === 'notifications' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-5 shadow-2xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Push & In-App Notifications
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Configure real-time alerts, chime sounds, and message previews
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    playNotificationChime(
                      userPrivate.notificationSound,
                      userPrivate.notificationVibration
                    )
                  }
                  className="px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Test Sound
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Enable Message Notifications
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Alert when new real-time messages arrive
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={userPrivate.notificationsEnabled}
                    onChange={(e) =>
                      handleUpdatePrivatePref({ notificationsEnabled: e.target.checked })
                    }
                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Notification Sound Chime
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Play harmonic chime on incoming messages
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={userPrivate.notificationSound}
                    onChange={(e) =>
                      handleUpdatePrivatePref({ notificationSound: e.target.checked })
                    }
                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Vibration Feedback
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Vibrate supported mobile devices on new message
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={userPrivate.notificationVibration}
                    onChange={(e) =>
                      handleUpdatePrivatePref({ notificationVibration: e.target.checked })
                    }
                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      Show Message Text Preview
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Hide preview text in notification banners when disabled
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={userPrivate.notificationPreview}
                    onChange={(e) =>
                      handleUpdatePrivatePref({ notificationPreview: e.target.checked })
                    }
                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={handleRequestBrowserPushPermission}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Grant Browser Push Notification Permission
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 5: APPEARANCE & DARK MODE */}
          {activeSection === 'appearance' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-5 shadow-2xs">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Appearance & Theme
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Switch smoothly between Light, Dark, and System Default themes
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(
                  [
                    { id: 'light', label: 'Light Mode', icon: Sun },
                    { id: 'dark', label: 'Dark Mode', icon: Moon },
                    { id: 'system', label: 'System Default', icon: Monitor },
                  ] as const
                ).map((t) => {
                  const Icon = t.icon;
                  const active = userPrivate.theme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleUpdatePrivatePref({ theme: t.id })}
                      className={`p-4 rounded-2xl border flex flex-col items-center gap-2 cursor-pointer transition-all ${
                        active
                          ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                          : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-xs font-semibold">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* SECTION 6: APP LOCK PASSWORD & ACCOUNT SECURITY */}
          {activeSection === 'security' && (
            <div className="space-y-5">
              {/* App Setup Password / Lock Screen Configuration Card */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-5 shadow-2xs">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        App Lock & Setup Password
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Set a password or PIN to lock ChatConnect and protect your private chats
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      currentAppPwd
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    {currentAppPwd ? 'Password Active' : 'Not Set'}
                  </span>
                </div>

                <form onSubmit={handleSaveAppLockPassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {currentAppPwd ? 'Change App Lock Password / PIN' : 'Set App Lock Password / PIN'}
                    </label>
                    <div className="relative">
                      <input
                        type={showAppPwd ? 'text' : 'password'}
                        maxLength={32}
                        value={newAppPwdInput}
                        onChange={(e) => setNewAppPwdInput(e.target.value)}
                        placeholder="Enter password or 4-6 digit PIN..."
                        className="w-full pl-3.5 pr-10 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAppPwd((s) => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showAppPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Require Password When Opening App
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Automatically show the App Lock screen when ChatConnect launches
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={autoLockOnLaunch}
                      onChange={(e) => handleToggleAutoLock(e.target.checked)}
                      className="w-4 h-4 accent-indigo-600 cursor-pointer"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      {currentAppPwd ? 'Update App Password' : 'Enable App Password'}
                    </button>

                    {currentAppPwd && onLockAppNow && (
                      <button
                        type="button"
                        onClick={onLockAppNow}
                        className="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        Lock App Now
                      </button>
                    )}

                    {currentAppPwd && (
                      <button
                        type="button"
                        onClick={handleRemoveAppLockPassword}
                        className="px-4 py-2.5 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-semibold cursor-pointer"
                      >
                        Remove Password
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Account Isolation & Danger Zone Card */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-6 shadow-2xs">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Account Data Isolation
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Your private contact info is stored in an isolated subcollection and never exposed via @UserID search
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Isolated Account Email:</span>
                    <span className="font-mono text-slate-900 dark:text-white">
                      {userPrivate.email || 'Hidden'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Unique User ID:</span>
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">
                      @{currentUser.username}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Configured External Project ID:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {EXTERNAL_FIREBASE_CONFIG.projectId}
                    </span>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <h4 className="text-xs font-bold text-rose-600 dark:text-rose-400">
                    Danger Zone · Permanent Account Deletion
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Deleting your account permanently removes your public profile, isolated private preferences, and releases your @{currentUser.username} User ID.
                  </p>

                  {!confirmDeleteOpen ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteOpen(true)}
                      className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete My Account
                    </button>
                  ) : (
                    <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 space-y-3">
                      <p className="text-xs font-semibold text-rose-800 dark:text-rose-200">
                        Are you sure you want to permanently delete @{currentUser.username}?
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={handleDeleteAccountPermanently}
                          className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
                        >
                          {saving ? 'Deleting...' : 'Yes, Permanently Delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteOpen(false)}
                          className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 7: HELP & ABOUT CHATCONNECT */}
          {activeSection === 'help' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-6 shadow-2xs">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                <ChatConnectLogo size={42} />
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    ChatConnect Help Center
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Modern Real-Time Messaging with @UserID Discovery
                  </p>
                </div>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 space-y-1">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    How do people find me on ChatConnect?
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">
                    Share your unique <span className="font-mono">@{currentUser.username}</span> handle or your QR Profile card. Your email and phone number are never shown in search results.
                  </p>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 space-y-1">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    How does App Lock Password work?
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">
                    Set a custom password or PIN in <strong>App Lock & Password</strong> or click the Lock icon in the top bar to lock your screen anytime.
                  </p>
                </div>
              </div>

              <form
                onSubmit={handleReportProblemSubmit}
                className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3"
              >
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Report a Problem or Feedback
                </label>
                <textarea
                  rows={3}
                  value={problemText}
                  onChange={(e) => setProblemText(e.target.value)}
                  placeholder="Describe any issue you encountered..."
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 resize-none"
                />
                {problemSubmitted && (
                  <p className="text-xs text-emerald-600 font-medium">
                    Thank you! Your report was sent to the admin team.
                  </p>
                )}
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  Submit Feedback
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
