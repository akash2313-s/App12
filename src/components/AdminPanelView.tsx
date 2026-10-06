import React, { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  ShieldAlert,
  Users,
  Flag,
  Megaphone,
  Search,
  Ban,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Plus,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AccountStatus,
  ModerationReport,
  SystemAnnouncement,
  UserPublic,
} from '../types';
import { getAvatarDataUri, formatMessageTime } from '../utils/helpers';

interface AdminPanelViewProps {
  currentUser: UserPublic;
  isAdmin: boolean;
}

export const AdminPanelView: React.FC<AdminPanelViewProps> = ({
  currentUser,
  isAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<'users' | 'reports' | 'announcements'>('users');
  const [usersList, setUsersList] = useState<UserPublic[]>([]);
  const [reportsList, setReportsList] = useState<ModerationReport[]>([]);
  const [announcements, setAnnouncements] = useState<SystemAnnouncement[]>([]);
  const [userSearch, setUserSearch] = useState('');

  // New announcement state
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [creatingAnn, setCreatingAnn] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const list: UserPublic[] = [];
        snap.forEach((d) => list.push(d.data() as UserPublic));
        setUsersList(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'users');
        } catch {
          // Handled
        }
      }
    );

    const unsubReports = onSnapshot(
      collection(db, 'reports'),
      (snap) => {
        const list: ModerationReport[] = [];
        snap.forEach((d) => list.push(d.data() as ModerationReport));
        list.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return tB - tA;
        });
        setReportsList(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'reports');
        } catch {
          // Handled
        }
      }
    );

    const unsubAnn = onSnapshot(
      collection(db, 'announcements'),
      (snap) => {
        const list: SystemAnnouncement[] = [];
        snap.forEach((d) => list.push(d.data() as SystemAnnouncement));
        setAnnouncements(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'announcements');
        } catch {
          // Handled
        }
      }
    );

    return () => {
      unsubUsers();
      unsubReports();
      unsubAnn();
    };
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm font-semibold text-rose-600">
          Access Denied · Administrator privileges required.
        </p>
      </div>
    );
  }

  const handleSetAccountStatus = async (targetUser: UserPublic, status: AccountStatus) => {
    try {
      await updateDoc(doc(db, 'users', targetUser.userId), {
        accountStatus: status,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.userId}`);
      } catch {
        // Handled
      }
    }
  };

  const handleCleanProfileContent = async (targetUser: UserPublic) => {
    try {
      await updateDoc(doc(db, 'users', targetUser.userId), {
        bio: 'Profile content reset by ChatConnect Moderation',
        profilePhoto: getAvatarDataUri(targetUser.name),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.userId}`);
      } catch {
        // Handled
      }
    }
  };

  const handleUpdateReportStatus = async (
    rep: ModerationReport,
    status: 'resolved' | 'dismissed'
  ) => {
    try {
      await updateDoc(doc(db, 'reports', rep.reportId), {
        status,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `reports/${rep.reportId}`);
      } catch {
        // Handled
      }
    }
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annBody.trim()) return;
    setCreatingAnn(true);
    const annId = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'announcements', annId), {
        announcementId: annId,
        title: annTitle.trim().slice(0, 120),
        body: annBody.trim().slice(0, 1000),
        authorId: currentUser.userId,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setAnnTitle('');
      setAnnBody('');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `announcements/${annId}`);
      } catch {
        // Handled
      }
    } finally {
      setCreatingAnn(false);
    }
  };

  const handleToggleAnnouncement = async (ann: SystemAnnouncement) => {
    try {
      await updateDoc(doc(db, 'announcements', ann.announcementId), {
        isActive: !ann.isActive,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `announcements/${ann.announcementId}`);
      } catch {
        // Handled
      }
    }
  };

  const handleDeleteAnnouncement = async (annId: string) => {
    try {
      await deleteDoc(doc(db, 'announcements', annId));
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `announcements/${annId}`);
      } catch {
        // Handled
      }
    }
  };

  const filteredUsers = usersList.filter((u) => {
    if (!userSearch.trim()) return true;
    const q = userSearch.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q) ||
      u.userId.toLowerCase().includes(q)
    );
  });

  const onlineUsersCount = usersList.filter((u) => u.isOnline).length;
  const openReportsCount = reportsList.filter((r) => r.status === 'open').length;
  const activeAnnCount = announcements.filter((a) => a.isActive).length;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h1
              className="text-xl font-bold text-slate-900 dark:text-white"
              style={{ fontFamily: 'Syne, sans-serif' }}
            >
              Admin & Moderation Center
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Monitor system health, review user reports, and enforce community safety
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl self-start">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'users'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-500'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Users ({usersList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('reports')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'reports'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-500'
            }`}
          >
            <Flag className="w-3.5 h-3.5" />
            Reports ({openReportsCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('announcements')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'announcements'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-500'
            }`}
          >
            <Megaphone className="w-3.5 h-3.5" />
            Announcements ({activeAnnCount})
          </button>
        </div>
      </div>

      {/* System Statistics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <p className="text-xs text-slate-500">Registered Users</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
            {usersList.length}
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <p className="text-xs text-slate-500">Online Now</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
            {onlineUsersCount}
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <p className="text-xs text-slate-500">Open Moderation Reports</p>
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1 tabular-nums">
            {openReportsCount}
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <p className="text-xs text-slate-500">Active Announcements</p>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1 tabular-nums">
            {activeAnnCount}
          </p>
        </div>
      </div>

      {/* TAB 1: REGISTERED USERS MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Registered User Directory
            </h2>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search by @username or name..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredUsers.map((u) => (
              <div
                key={u.userId}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={u.profilePhoto || getAvatarDataUri(u.name)}
                    alt={u.name}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = getAvatarDataUri(u.name);
                    }}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-bold text-slate-900 dark:text-white truncate">
                        {u.name}
                      </span>
                      <span className="font-mono text-indigo-600 dark:text-indigo-400">
                        @{u.username}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span
                        className={
                          u.accountStatus === 'active'
                            ? 'text-emerald-600 font-medium'
                            : 'text-rose-600 font-semibold'
                        }
                      >
                        {u.accountStatus}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">{u.bio}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {u.accountStatus !== 'active' && (
                    <button
                      type="button"
                      onClick={() => handleSetAccountStatus(u, 'active')}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Restore
                    </button>
                  )}
                  {u.accountStatus !== 'suspended' && u.userId !== currentUser.userId && (
                    <button
                      type="button"
                      onClick={() => handleSetAccountStatus(u, 'suspended')}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-medium cursor-pointer"
                    >
                      Suspend
                    </button>
                  )}
                  {u.accountStatus !== 'banned' && u.userId !== currentUser.userId && (
                    <button
                      type="button"
                      onClick={() => handleSetAccountStatus(u, 'banned')}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-medium flex items-center gap-1 cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      Ban
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCleanProfileContent(u)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
                    title="Reset inappropriate profile photo & bio"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reset Profile
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: MODERATION REPORTS */}
      {activeTab === 'reports' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            User Moderation Reports
          </h2>
          {reportsList.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              No moderation reports submitted yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {reportsList.map((rep) => {
                const target = usersList.find((u) => u.userId === rep.targetUserId);
                return (
                  <div
                    key={rep.reportId}
                    className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {rep.reason}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-indigo-600 dark:text-indigo-400">
                          Target: @{target?.username || rep.targetUserId.slice(0, 8)}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500">
                          {formatMessageTime(rep.createdAt)}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span
                          className={
                            rep.status === 'open'
                              ? 'text-rose-600 font-semibold'
                              : 'text-emerald-600 font-medium'
                          }
                        >
                          {rep.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        {rep.details}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 text-xs shrink-0">
                      {rep.status === 'open' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleUpdateReportStatus(rep, 'resolved')}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-semibold cursor-pointer"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateReportStatus(rep, 'dismissed')}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                      {target && target.userId !== currentUser.userId && (
                        <button
                          type="button"
                          onClick={() => handleSetAccountStatus(target, 'suspended')}
                          className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold cursor-pointer"
                        >
                          Suspend User
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SYSTEM ANNOUNCEMENTS */}
      {activeTab === 'announcements' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleCreateAnnouncement}
            className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 space-y-4 self-start"
          >
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-indigo-600" />
              Publish App Announcement
            </h3>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Headline
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                placeholder="e.g. Welcome to ChatConnect 2.0"
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Message Body
              </label>
              <textarea
                rows={3}
                required
                maxLength={1000}
                value={annBody}
                onChange={(e) => setAnnBody(e.target.value)}
                placeholder="Write announcement details for all users..."
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={creatingAnn}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
            >
              {creatingAnn ? 'Publishing...' : 'Publish Announcement'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Broadcast History
            </h3>
            {announcements.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">
                No announcements published yet.
              </p>
            ) : (
              <div className="space-y-3">
                {announcements.map((ann) => (
                  <div
                    key={ann.announcementId}
                    className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {ann.title}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span
                          className={
                            ann.isActive
                              ? 'text-emerald-600 font-semibold'
                              : 'text-slate-400'
                          }
                        >
                          {ann.isActive ? 'Active' : 'Hidden'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">{ann.body}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleAnnouncement(ann)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
                      >
                        {ann.isActive ? 'Hide' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAnnouncement(ann.announcementId)}
                        className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
