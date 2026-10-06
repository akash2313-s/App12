import React, { useState, useEffect } from 'react';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  sendPasswordResetEmail,
  User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  ShieldCheck,
  AtSign,
  Camera,
  Sparkles,
  Mail,
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  KeyRound,
  UserCheck,
  Eye,
  EyeOff,
  User as UserIcon,
  QrCode,
} from 'lucide-react';
import { auth, db, googleProvider } from '../firebase';
import { UserPrivate, UserPublic } from '../types';
import { ChatConnectLogo } from './BrandIcons';
import {
  sanitizeUsername,
  generateSuggestedUsername,
  getAvatarDataUri,
  AVATAR_PRESETS,
  compressImageFile,
  setAppLockPassword,
  saveQuickLocalSession,
} from '../utils/helpers';

interface AuthOnboardingProps {
  firebaseUser: User | null;
  needsOnboarding: boolean;
  onProfileCreated: (quickSession?: {
    publicProfile: UserPublic;
    privatePrefs: UserPrivate;
  }) => void;
}

export const AuthOnboarding: React.FC<AuthOnboardingProps> = ({
  firebaseUser,
  needsOnboarding,
  onProfileCreated,
}) => {
  const [authTab, setAuthTab] = useState<'quick' | 'google' | 'email'>('quick');
  const [emailMode, setEmailMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Quick Login & Profile Setup state
  const [fullName, setFullName] = useState(firebaseUser?.displayName || '');
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [bio, setBio] = useState('Available on ChatConnect');
  const [profilePhoto, setProfilePhoto] = useState(
    firebaseUser?.photoURL || getAvatarDataUri(firebaseUser?.displayName || 'ChatConnect')
  );
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [lastAttemptTime, setLastAttemptTime] = useState(0);

  useEffect(() => {
    if (firebaseUser) {
      if (!fullName && firebaseUser.displayName) {
        setFullName(firebaseUser.displayName);
      }
      if (!username) {
        const suggested = generateSuggestedUsername(
          firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'user'
        );
        setUsername(suggested);
      }
      if (firebaseUser.photoURL && profilePhoto.startsWith('data:image/svg+xml')) {
        setProfilePhoto(firebaseUser.photoURL);
      }
    }
  }, [firebaseUser]);

  // Real-time username format & availability check
  useEffect(() => {
    const clean = sanitizeUsername(username);
    if (!clean || clean.length < 3 || clean.length > 32) {
      setUsernameStatus(clean.length > 0 ? 'invalid' : 'idle');
      return;
    }

    setUsernameStatus('checking');
    const timer = setTimeout(async () => {
      try {
        if (auth.currentUser) {
          const ref = doc(db, 'usernames', clean);
          const snap = await getDoc(ref);
          if (snap.exists() && snap.data()?.userId !== auth.currentUser.uid) {
            setUsernameStatus('taken');
            return;
          }
        }
        setUsernameStatus('available');
      } catch {
        setUsernameStatus('available');
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [username]);

  const checkAntiSpam = (): boolean => {
    const now = Date.now();
    if (now - lastAttemptTime < 1000) {
      setErrorMsg('Please wait a moment before trying again.');
      return false;
    }
    setLastAttemptTime(now);
    return true;
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const compressed = await compressImageFile(file, 400, 0.78);
      setProfilePhoto(compressed);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to process photo.');
    }
  };

  // Write profile to Firestore for an authenticated Firebase user
  const writeFirestoreProfile = async (
    activeUser: User,
    trimmedName: string,
    finalUsername: string,
    finalPhoto: string
  ) => {
    const usernameDocRef = doc(db, 'usernames', finalUsername);
    const existingSnap = await getDoc(usernameDocRef);
    let resolvedUsername = finalUsername;
    if (existingSnap.exists() && existingSnap.data()?.userId !== activeUser.uid) {
      resolvedUsername = generateSuggestedUsername(finalUsername);
    }

    const userPublicRef = doc(db, 'users', activeUser.uid);
    const userPrivateRef = doc(db, 'users', activeUser.uid, 'private', 'info');

    const batch = writeBatch(db);

    batch.set(doc(db, 'usernames', resolvedUsername), {
      username: resolvedUsername,
      userId: activeUser.uid,
      createdAt: serverTimestamp(),
    });

    batch.set(userPublicRef, {
      userId: activeUser.uid,
      username: resolvedUsername,
      name: trimmedName,
      profilePhoto: finalPhoto,
      bio: (bio || 'Available on ChatConnect').trim().slice(0, 200),
      isOnline: true,
      lastSeen: new Date().toISOString(),
      privacyPhoto: 'everyone',
      privacyLastSeen: 'everyone',
      privacyOnline: 'everyone',
      readReceipts: true,
      accountStatus: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(userPrivateRef, {
      userId: activeUser.uid,
      email: (activeUser.email || `${resolvedUsername}@chatconnect.app`).slice(0, 254),
      phone: (activeUser.phoneNumber || '').slice(0, 32),
      blockedUsers: [],
      pinnedChats: [],
      archivedChats: [],
      mutedChats: [],
      wallpaper: 'default',
      enterToSend: true,
      mediaAutoDownload: true,
      notificationsEnabled: true,
      notificationSound: true,
      notificationVibration: true,
      notificationPreview: true,
      theme: 'system',
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  };

  /**
   * Direct Login with Name + Unique User ID + Optional App Lock Password.
   * Works immediately in 1 step!
   */
  const handleQuickNameAndIdLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkAntiSpam()) return;
    setErrorMsg(null);
    setInfoMsg(null);

    const trimmedName = fullName.trim().slice(0, 80);
    if (!trimmedName) {
      setErrorMsg('Please enter your Full Name to log in.');
      return;
    }

    let finalUsername = sanitizeUsername(username);
    if (!finalUsername) {
      finalUsername = generateSuggestedUsername(trimmedName);
      setUsername(finalUsername);
    }

    if (finalUsername.length < 3 || finalUsername.length > 32) {
      setErrorMsg('User ID must be at least 3 characters (letters, numbers, or underscore).');
      return;
    }

    setLoading(true);

    const finalPhoto =
      profilePhoto && !profilePhoto.includes('ChatConnect') && profilePhoto.length <= 500000
        ? profilePhoto
        : getAvatarDataUri(trimmedName);

    try {
      let activeFirebaseUser: User | null = auth.currentUser;

      // 1. If not signed in yet, try deterministic Email/Password or Anonymous Auth
      if (!activeFirebaseUser) {
        const syntheticEmail = `${finalUsername}@chatconnect.app`;
        const effectivePassword =
          appPassword.trim().length >= 6
            ? appPassword.trim()
            : `cc_${finalUsername}_2026!`;

        try {
          const signInRes = await signInWithEmailAndPassword(
            auth,
            syntheticEmail,
            effectivePassword
          );
          activeFirebaseUser = signInRes.user;
        } catch (signInErr: unknown) {
          const code = (signInErr as { code?: string })?.code || '';
          if (
            code === 'auth/user-not-found' ||
            code === 'auth/invalid-credential' ||
            code === 'auth/invalid-login-credentials'
          ) {
            try {
              const createRes = await createUserWithEmailAndPassword(
                auth,
                syntheticEmail,
                effectivePassword
              );
              activeFirebaseUser = createRes.user;
            } catch {
              // Fallback to anonymous or quick session
            }
          }
        }

        if (!activeFirebaseUser) {
          try {
            const anonRes = await signInAnonymously(auth);
            activeFirebaseUser = anonRes.user;
          } catch {
            // Will use Quick Local Session fallback if Anonymous Auth is disabled in Console
          }
        }
      }

      const resolvedUid = activeFirebaseUser?.uid || `usr_${finalUsername}`;

      // Save App Lock Password if the user entered one
      if (appPassword.trim()) {
        setAppLockPassword(appPassword.trim(), resolvedUid);
      }

      const nowTs = Timestamp.now();
      const publicProfileObj: UserPublic = {
        userId: resolvedUid,
        username: finalUsername,
        name: trimmedName,
        profilePhoto: finalPhoto,
        bio: (bio || 'Available on ChatConnect').trim().slice(0, 200),
        isOnline: true,
        lastSeen: new Date().toISOString(),
        privacyPhoto: 'everyone',
        privacyLastSeen: 'everyone',
        privacyOnline: 'everyone',
        readReceipts: true,
        accountStatus: 'active',
        createdAt: nowTs,
        updatedAt: nowTs,
      };

      const privatePrefsObj: UserPrivate = {
        userId: resolvedUid,
        email: activeFirebaseUser?.email || `${finalUsername}@chatconnect.app`,
        phone: activeFirebaseUser?.phoneNumber || '',
        blockedUsers: [],
        pinnedChats: [],
        archivedChats: [],
        mutedChats: [],
        wallpaper: 'default',
        enterToSend: true,
        mediaAutoDownload: true,
        notificationsEnabled: true,
        notificationSound: true,
        notificationVibration: true,
        notificationPreview: true,
        theme: 'system',
        updatedAt: nowTs,
      };

      // Always persist Quick Session locally so login is instantaneous and reliable
      saveQuickLocalSession(publicProfileObj, privatePrefsObj);

      // If Firebase Auth user is active, also persist to Firestore
      if (activeFirebaseUser) {
        try {
          const existingDoc = await getDoc(doc(db, 'users', activeFirebaseUser.uid));
          if (!existingDoc.exists()) {
            await writeFirestoreProfile(
              activeFirebaseUser,
              trimmedName,
              finalUsername,
              finalPhoto
            );
          }
        } catch {
          // Local session is already saved so user proceeds smoothly
        }
      }

      onProfileCreated({
        publicProfile: publicProfileObj,
        privatePrefs: privatePrefsObj,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!checkAntiSpam()) return;
    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await signInWithPopup(auth, googleProvider);
      if (appPassword.trim()) {
        setAppLockPassword(appPassword.trim(), res.user.uid);
      }

      // Check if user already has a profile; if not and they typed Name/ID, auto-create it!
      const snap = await getDoc(doc(db, 'users', res.user.uid));
      if (!snap.exists()) {
        const autoName = (fullName.trim() || res.user.displayName || 'ChatConnect User').slice(
          0,
          80
        );
        const autoUsername =
          sanitizeUsername(username) && sanitizeUsername(username).length >= 3
            ? sanitizeUsername(username)
            : generateSuggestedUsername(autoName);
        const autoPhoto = res.user.photoURL || getAvatarDataUri(autoName);
        await writeFirestoreProfile(res.user, autoName, autoUsername, autoPhoto);
        onProfileCreated();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      if (msg.includes('popup-closed-by-user')) {
        setErrorMsg('Sign-in popup was closed. You can also use Quick Name & ID Login.');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkAntiSpam()) return;
    setErrorMsg(null);
    setInfoMsg(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      if (emailMode === 'reset') {
        await sendPasswordResetEmail(auth, trimmedEmail);
        setInfoMsg('Password recovery link sent! Check your email inbox.');
        setLoading(false);
        return;
      }

      if (password.length < 6) {
        setErrorMsg('Password must be at least 6 characters.');
        setLoading(false);
        return;
      }

      if (emailMode === 'login') {
        const cred = await signInWithEmailAndPassword(auth, trimmedEmail, password);
        if (appPassword.trim()) {
          setAppLockPassword(appPassword.trim(), cred.user.uid);
        }
      } else {
        const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        if (appPassword.trim()) {
          setAppLockPassword(appPassword.trim(), cred.user.uid);
        }
        const autoName = (fullName.trim() || trimmedEmail.split('@')[0] || 'User').slice(0, 80);
        const autoUsername =
          sanitizeUsername(username) && sanitizeUsername(username).length >= 3
            ? sanitizeUsername(username)
            : generateSuggestedUsername(autoName);
        await writeFirestoreProfile(
          cred.user,
          autoName,
          autoUsername,
          getAvatarDataUri(autoName)
        );
        onProfileCreated();
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setErrorMsg(
          'Email/Password provider is not enabled in Firebase Console yet. Switch to the "Name & ID Login" tab above for instant login!'
        );
      } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setErrorMsg('Invalid email or password.');
      } else if (code === 'auth/email-already-in-use') {
        setErrorMsg('An account with this email already exists. Try signing in instead.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[480px] h-[480px] rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[480px] h-[480px] rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      {/* Top Header Bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <ChatConnectLogo size={34} />
          <div>
            <span
              className="text-lg font-bold tracking-tight text-slate-900 dark:text-white block leading-none"
              style={{ fontFamily: 'Syne, sans-serif' }}
            >
              ChatConnect
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              Secure Real-Time Messaging
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {firebaseUser && (
            <button
              type="button"
              onClick={() => auth.signOut()}
              className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          )}
        </div>
      </header>

      {/* Main Content Split Layout */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-10">
        <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Column: Brand Value Proposition & Live Preview */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-800/60 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Instant @UserID Login · App Password Protection</span>
            </div>

            <h1
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12]"
              style={{ fontFamily: 'Syne, sans-serif', textWrap: 'balance' }}
            >
              Enter your Name & unique @ID to start chatting instantly.
            </h1>

            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
              ChatConnect lets you connect privately using your unique{' '}
              <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                @UserID
              </span>{' '}
              or QR Profile card—without ever exposing your phone number. Set an optional{' '}
              <strong>App Lock Password</strong> to keep your chats protected.
            </p>

            {/* Feature Highlights */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3.5 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 space-y-1">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <AtSign className="w-4 h-4" />
                </div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">Simple @ID Login</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Log in directly with your Name and unique User ID.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 space-y-1">
                <div className="w-8 h-8 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                  <Lock className="w-4 h-4" />
                </div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">App Lock Password</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Protect your app with a custom password or PIN anytime.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 space-y-1">
                <div className="w-8 h-8 rounded-xl bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                  <QrCode className="w-4 h-4" />
                </div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">QR Discovery</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Share & scan QR cards to open 1-to-1 private chats.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Unified Professional Login & Account Setup Card */}
          <div className="lg:col-span-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    {firebaseUser && needsOnboarding ? 'Complete Your Profile' : 'Login / Create Account'}
                  </span>
                  <h2
                    className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-0.5"
                    style={{ fontFamily: 'Syne, sans-serif' }}
                  >
                    Welcome to ChatConnect
                  </h2>
                </div>
                <ChatConnectLogo size={42} />
              </div>

              {/* Login Method Tabs */}
              {!needsOnboarding && (
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('quick');
                      setErrorMsg(null);
                    }}
                    className={`py-2 px-2.5 text-xs font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                      authTab === 'quick'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    Name & @ID Login
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('google');
                      setErrorMsg(null);
                    }}
                    className={`py-2 px-2.5 text-xs font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                      authTab === 'google'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    Google Login
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('email');
                      setErrorMsg(null);
                    }}
                    className={`py-2 px-2.5 text-xs font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                      authTab === 'email'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    Email Login
                  </button>
                </div>
              )}

              {errorMsg && (
                <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {infoMsg && (
                <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-start gap-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{infoMsg}</span>
                </div>
              )}

              {/* TAB 1: SIMPLE NAME & @ID LOGIN (WITH OPTIONAL APP SETUP PASSWORD) */}
              {(authTab === 'quick' || needsOnboarding) && (
                <form onSubmit={handleQuickNameAndIdLogin} className="space-y-4">
                  {/* Compact Avatar Picker */}
                  <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800">
                    <div className="relative shrink-0">
                      <img
                        src={profilePhoto || getAvatarDataUri(fullName || 'User')}
                        alt="Profile preview"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.src = getAvatarDataUri(fullName || 'User');
                        }}
                        className="w-14 h-14 rounded-full object-cover border-2 border-indigo-500/40"
                      />
                      <label
                        htmlFor="quick-dp-upload"
                        className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center cursor-pointer shadow-xs hover:bg-indigo-500"
                        title="Upload Profile Photo"
                      >
                        <Camera className="w-3 h-3" />
                        <input
                          id="quick-dp-upload"
                          type="file"
                          accept="image/*"
                          onChange={handlePhotoUpload}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                        Profile Avatar (DP)
                      </p>
                      <div className="flex items-center gap-1.5">
                        {AVATAR_PRESETS.map((preset) => (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() =>
                              setProfilePhoto(getAvatarDataUri(fullName || 'User', preset.hex))
                            }
                            className="w-5 h-5 rounded-full border border-white/40 transition-transform hover:scale-110 cursor-pointer"
                            style={{ backgroundColor: preset.hex }}
                            title={preset.label}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Full Name Input */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <UserIcon className="w-3.5 h-3.5 text-indigo-500" />
                      Your Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Enter your name (e.g. Rahul Sharma)"
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Unique User ID (@username) Input */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                        <AtSign className="w-3.5 h-3.5 text-indigo-500" />
                        Unique User ID <span className="text-rose-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setUsername(generateSuggestedUsername(fullName || 'user'))
                        }
                        className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" />
                        Auto-Generate ID
                      </button>
                    </div>

                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm">
                        @
                      </span>
                      <input
                        type="text"
                        maxLength={32}
                        value={username}
                        onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
                        placeholder="rahul123"
                        className="w-full pl-8 pr-28 py-2.5 text-sm font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 focus:outline-none focus:border-indigo-500"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs">
                        {usernameStatus === 'checking' && (
                          <span className="text-slate-400 flex items-center gap-1">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Checking
                          </span>
                        )}
                        {usernameStatus === 'available' && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Ready
                          </span>
                        )}
                        {usernameStatus === 'taken' && (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">
                            In Use
                          </span>
                        )}
                        {usernameStatus === 'invalid' && (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">
                            Min 3 chars
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* App Setup Password / Lock PIN Input */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                        Set App Lock Password / PIN{' '}
                        <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        maxLength={32}
                        value={appPassword}
                        onChange={(e) => setAppPassword(e.target.value)}
                        placeholder="Set a password or 4-digit PIN to lock your app..."
                        className="w-full pl-3.5 pr-10 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        title={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Protects your ChatConnect app with a password lock screen. You can also change or enable this anytime in Settings.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <UserCheck className="w-4 h-4" />
                    {loading ? 'Logging in to ChatConnect...' : 'Login with Name & @ID'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              )}

              {/* TAB 2: GOOGLE VERIFIED LOGIN */}
              {authTab === 'google' && !needsOnboarding && (
                <div className="space-y-4 py-2">
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-3">
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      Sign in with your Google account for instant cloud-verified synchronization across devices.
                    </p>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                        Optional App Lock Password
                      </label>
                      <input
                        type="password"
                        value={appPassword}
                        onChange={(e) => setAppPassword(e.target.value)}
                        placeholder="Set an App Lock password (optional)"
                        className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                    className="w-full py-3.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {loading ? 'Connecting to Google...' : 'Continue with Google'}
                  </button>
                </div>
              )}

              {/* TAB 3: EMAIL & PASSWORD LOGIN */}
              {authTab === 'email' && !needsOnboarding && (
                <form onSubmit={handleEmailAuth} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5" />
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {emailMode !== 'reset' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        Account Password
                      </label>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-xs transition-colors cursor-pointer"
                  >
                    {loading
                      ? 'Processing...'
                      : emailMode === 'login'
                      ? 'Sign In with Email'
                      : emailMode === 'signup'
                      ? 'Create Account with Email'
                      : 'Send Recovery Email'}
                  </button>

                  <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                    {emailMode === 'login' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setEmailMode('signup')}
                          className="hover:text-indigo-600 cursor-pointer"
                        >
                          Create new account
                        </button>
                        <button
                          type="button"
                          onClick={() => setEmailMode('reset')}
                          className="hover:text-indigo-600 cursor-pointer"
                        >
                          Forgot password?
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEmailMode('login')}
                        className="hover:text-indigo-600 cursor-pointer"
                      >
                        Back to Email Sign In
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-4 text-center text-xs text-slate-400 dark:text-slate-500">
        ChatConnect · Privacy-First Real-Time Messaging
      </footer>
    </div>
  );
};
