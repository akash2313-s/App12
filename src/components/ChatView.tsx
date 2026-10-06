import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  ArrowLeft,
  MoreVertical,
  Search,
  Smile,
  Paperclip,
  Camera,
  Mic,
  Send,
  Reply,
  Forward,
  Copy,
  Trash2,
  Pin,
  BellOff,
  Bell,
  Archive,
  Ban,
  Flag,
  Image as ImageIcon,
  FileText,
  Film,
  Link as LinkIcon,
  X,
  Check,
  Download,
  Square,
  FolderOpen,
  CheckSquare,
  ShieldCheck,
  Eraser,
  AlertTriangle,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ChatMessage,
  ChatThread,
  MessageType,
  UserPrivate,
  UserPublic,
} from '../types';
import { MessageStatusIcon, CHAT_STICKERS } from './BrandIcons';
import {
  compressImageFile,
  fileToSafeDataUrl,
  formatMessageTime,
  getVisiblePresenceStatus,
  getVisibleProfilePhoto,
  getAvatarDataUri,
  parseReactions,
  toggleReactionSummary,
  extractLinksFromText,
  generateSynthesizedVoiceNoteWav,
  getLocalMessages,
  saveLocalMessages,
} from '../utils/helpers';

interface ChatViewProps {
  chat: ChatThread;
  otherUser: UserPublic | null;
  currentUser: UserPublic;
  userPrivate: UserPrivate;
  allContactsMap: Record<string, UserPublic>;
  allChats: ChatThread[];
  onBack: () => void;
  onViewProfile: (user: UserPublic) => void;
  onTogglePin: (chatId: string) => Promise<void>;
  onToggleArchive: (chatId: string) => Promise<void>;
  onToggleMute: (chatId: string) => Promise<void>;
  onToggleBlockUser: (targetUserId: string) => Promise<void>;
  onChatDeleted: () => void;
  onChatUpdated?: (updatedChat: ChatThread) => void;
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '🎉', '🙏', '✨', '🙌', '😊', '🚀', '💯', '🤝'];
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '🎉', '🙏'];

export const ChatView: React.FC<ChatViewProps> = ({
  chat,
  otherUser,
  currentUser,
  userPrivate,
  allContactsMap,
  allChats,
  onBack,
  onViewProfile,
  onTogglePin,
  onToggleArchive,
  onToggleMute,
  onToggleBlockUser,
  onChatDeleted,
  onChatUpdated,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => getLocalMessages(chat.chatId));
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [textInput, setTextInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Interactive panels
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMediaDrawer, setShowMediaDrawer] = useState(false);
  const [mediaTab, setMediaTab] = useState<'photos' | 'videos' | 'documents' | 'links'>('photos');

  // Message actions state
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [activeMessageMenuId, setActiveMessageMenuId] = useState<string | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Selection & Chat Delete Sheet state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [deletingAction, setDeletingAction] = useState(false);

  // Report modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('Spam or unwanted messages');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitted, setReportSubmitted] = useState(false);

  // Voice recording state
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const isParticipant1 = chat.participant1 === currentUser.userId;
  const otherUserId = isParticipant1 ? chat.participant2 : chat.participant1;
  const isBlockedByMe = userPrivate.blockedUsers.includes(otherUserId);
  const isPinned = userPrivate.pinnedChats.includes(chat.chatId);
  const isArchived = userPrivate.archivedChats.includes(chat.chatId);
  const isMuted = userPrivate.mutedChats.includes(chat.chatId);
  const myClearedAt = isParticipant1 ? chat.clearedAt1 : chat.clearedAt2;

  const presence = getVisiblePresenceStatus(otherUser, true, currentUser.userId);
  const avatarUrl = getVisibleProfilePhoto(otherUser, true, currentUser.userId);

  // Real-time listener on messages in this chat + local storage sync
  useEffect(() => {
    const localInitial = getLocalMessages(chat.chatId);
    setMessages(localInitial);
    setLoadingMessages(localInitial.length === 0);
    setIsSelectMode(false);
    setSelectedMessageIds([]);

    const messagesRef = collection(db, 'chats', chat.chatId, 'messages');
    const q = query(messagesRef, where('participants', 'array-contains', currentUser.userId));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const cloudList: ChatMessage[] = [];
        snapshot.forEach((docSnap) => {
          cloudList.push(docSnap.data() as ChatMessage);
        });

        const mergedMap = new Map<string, ChatMessage>();
        for (const m of getLocalMessages(chat.chatId)) {
          mergedMap.set(m.messageId, m);
        }
        for (const m of cloudList) {
          mergedMap.set(m.messageId, m);
        }

        const list = Array.from(mergedMap.values());
        list.sort((a, b) => {
          const tA = a.createdAt?.toMillis
            ? a.createdAt.toMillis()
            : typeof a.createdAt === 'string'
            ? new Date(a.createdAt).getTime()
            : 0;
          const tB = b.createdAt?.toMillis
            ? b.createdAt.toMillis()
            : typeof b.createdAt === 'string'
            ? new Date(b.createdAt).getTime()
            : 0;
          return tA - tB;
        });

        setMessages(list);
        saveLocalMessages(chat.chatId, list);
        setLoadingMessages(false);

        // Automatically update incoming unread messages to 'read' or 'delivered'
        const unreadIncoming = list.filter(
          (m) => m.receiverId === currentUser.userId && m.status !== 'read'
        );
        if (unreadIncoming.length > 0) {
          const targetStatus =
            currentUser.readReceipts && (otherUser?.readReceipts ?? true)
              ? 'read'
              : 'delivered';
          unreadIncoming.forEach(async (msg) => {
            if (msg.status !== targetStatus) {
              try {
                await updateDoc(doc(db, 'chats', chat.chatId, 'messages', msg.messageId), {
                  status: targetStatus,
                  updatedAt: serverTimestamp(),
                });
              } catch {
                // Ignore transient status update error
              }
            }
          });
        }

        // Reset unread counter for current user on parent chat if > 0
        const myUnread = isParticipant1 ? chat.unreadCount1 : chat.unreadCount2;
        if (myUnread > 0) {
          updateDoc(doc(db, 'chats', chat.chatId), {
            ...(isParticipant1 ? { unreadCount1: 0 } : { unreadCount2: 0 }),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      },
      () => {
        setMessages(getLocalMessages(chat.chatId));
        setLoadingMessages(false);
      }
    );

    return () => unsubscribe();
  }, [
    chat.chatId,
    currentUser.userId,
    currentUser.readReceipts,
    otherUser?.readReceipts,
    isParticipant1,
    chat.unreadCount1,
    chat.unreadCount2,
  ]);

  // Auto-scroll to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Filter messages by clearedAt timestamp and search query
  const visibleMessages = useMemo(() => {
    const clearedMs = myClearedAt ? new Date(myClearedAt).getTime() : 0;
    return messages.filter((m) => {
      const msgMs = m.createdAt?.toMillis
        ? m.createdAt.toMillis()
        : typeof m.createdAt === 'string'
        ? new Date(m.createdAt).getTime()
        : Date.now();
      if (clearedMs && msgMs <= clearedMs) return false;
      if (searchQuery.trim()) {
        return (
          m.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.mediaName.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }
      return true;
    });
  }, [messages, myClearedAt, searchQuery]);

  // Shared media items derived from conversation messages
  const sharedPhotos = useMemo(
    () => visibleMessages.filter((m) => !m.isDeleted && m.messageType === 'image' && m.mediaUrl),
    [visibleMessages]
  );
  const sharedVideos = useMemo(
    () => visibleMessages.filter((m) => !m.isDeleted && m.messageType === 'video' && m.mediaUrl),
    [visibleMessages]
  );
  const sharedDocs = useMemo(
    () => visibleMessages.filter((m) => !m.isDeleted && m.messageType === 'document' && m.mediaUrl),
    [visibleMessages]
  );
  const sharedLinks = useMemo(() => {
    const items: { messageId: string; url: string; timestamp: string }[] = [];
    visibleMessages.forEach((m) => {
      if (!m.isDeleted && m.text) {
        const urls = extractLinksFromText(m.text);
        urls.forEach((url) => {
          items.push({
            messageId: m.messageId,
            url,
            timestamp: formatMessageTime(m.createdAt),
          });
        });
      }
    });
    return items;
  }, [visibleMessages]);

  // Send a message of any type
  const sendMessagePayload = async (
    type: MessageType,
    textVal: string,
    mediaUrlVal = '',
    mediaNameVal = '',
    targetChat: ChatThread = chat,
    isForwardedFlag = false
  ) => {
    if (isBlockedByMe && targetChat.chatId === chat.chatId) {
      setUploadError('You have blocked this user. Unblock them to send messages.');
      return;
    }

    const receiverUid =
      targetChat.participant1 === currentUser.userId
        ? targetChat.participant2
        : targetChat.participant1;

    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nowIso = new Date().toISOString();

    const previewLabel =
      type === 'image'
        ? '📷 Photo'
        : type === 'video'
        ? '🎬 Video'
        : type === 'document'
        ? `📄 ${mediaNameVal || 'Document'}`
        : type === 'voice'
        ? '🎤 Voice message'
        : type === 'sticker'
        ? `✨ Sticker: ${textVal}`
        : textVal.slice(0, 120);

    const localMsg: ChatMessage = {
      messageId: msgId,
      chatId: targetChat.chatId,
      senderId: currentUser.userId,
      receiverId: receiverUid,
      participants: [currentUser.userId, receiverUid],
      messageType: type,
      text: textVal.slice(0, 4000),
      mediaUrl: mediaUrlVal.slice(0, 700000),
      mediaName: mediaNameVal.slice(0, 255),
      status: otherUser?.isOnline ? 'delivered' : 'sent',
      replyToId: replyingTo ? replyingTo.messageId : '',
      replyToText: replyingTo ? replyingTo.text.slice(0, 300) : '',
      replyToSenderName: replyingTo
        ? replyingTo.senderId === currentUser.userId
          ? currentUser.name
          : otherUser?.name || 'User'
        : '',
      isForwarded: isForwardedFlag,
      isDeleted: false,
      reactionsSummary: '',
      createdAt: nowIso as unknown as ChatMessage['createdAt'],
      updatedAt: nowIso as unknown as ChatMessage['updatedAt'],
    };

    setSending(true);
    setUploadError(null);

    // 1. Optimistic local state + storage update
    const existingTargetMsgs = getLocalMessages(targetChat.chatId);
    const updatedTargetMsgs = [...existingTargetMsgs, localMsg];
    saveLocalMessages(targetChat.chatId, updatedTargetMsgs);

    if (targetChat.chatId === chat.chatId) {
      setMessages(updatedTargetMsgs);
      setTextInput('');
      setReplyingTo(null);
      setShowEmojiPicker(false);
      setShowAttachMenu(false);
    }

    const updatedChatObj: ChatThread = {
      ...targetChat,
      lastMessageText: previewLabel.slice(0, 500),
      lastMessageType: type,
      lastMessageSenderId: currentUser.userId,
      lastMessageTime: nowIso,
    };
    onChatUpdated?.(updatedChatObj);

    // 2. Sync to Firestore in background if signed in
    try {
      const msgRef = doc(db, 'chats', targetChat.chatId, 'messages', msgId);
      const chatRef = doc(db, 'chats', targetChat.chatId);
      await setDoc(msgRef, {
        ...localMsg,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const receiverIsP1 = targetChat.participant1 === receiverUid;
      const nextUnread = receiverIsP1
        ? (targetChat.unreadCount1 || 0) + 1
        : (targetChat.unreadCount2 || 0) + 1;

      await updateDoc(chatRef, {
        lastMessageText: previewLabel.slice(0, 500),
        lastMessageType: type,
        lastMessageSenderId: currentUser.userId,
        lastMessageTime: nowIso,
        ...(receiverIsP1 ? { unreadCount1: nextUnread } : { unreadCount2: nextUnread }),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Stored locally in hybrid mode
    } finally {
      setSending(false);
    }

    // 3. If messaging a directory contact (usr_*), mark as read & send an instant realistic response
    if (receiverUid.startsWith('usr_') && targetChat.chatId === chat.chatId) {
      window.setTimeout(() => {
        const currentList = getLocalMessages(targetChat.chatId).map((m) =>
          m.messageId === msgId ? { ...m, status: 'read' as const } : m
        );

        const contactName = otherUser?.name?.split(' ')[0] || 'there';
        const lowerText = textVal.toLowerCase();
        let replyText = `Hey ${currentUser.name.split(' ')[0]}! 👋 Great connecting with you on ChatConnect.`;
        if (lowerText.includes('hi') || lowerText.includes('hello') || lowerText.includes('hey') || lowerText.includes('kya')) {
          replyText = `Hello ${currentUser.name.split(' ')[0]}! 😊 I'm online right now—how are you doing?`;
        } else if (lowerText.includes('?')) {
          replyText = `Got your message! Let me check on that for you right away 👍`;
        } else if (type !== 'text') {
          replyText = `Awesome ${type} shared! Thanks for sending that over 🙌`;
        } else {
          replyText = `Received your message ("${textVal.slice(0, 40)}")! Happy to chat anytime — ${contactName} ✨`;
        }

        const replyIso = new Date().toISOString();
        const replyMsg: ChatMessage = {
          messageId: `msg_${Date.now()}_reply`,
          chatId: targetChat.chatId,
          senderId: receiverUid,
          receiverId: currentUser.userId,
          participants: [currentUser.userId, receiverUid],
          messageType: 'text',
          text: replyText,
          mediaUrl: '',
          mediaName: '',
          status: 'read',
          replyToId: '',
          replyToText: '',
          replyToSenderName: '',
          isForwarded: false,
          isDeleted: false,
          reactionsSummary: '',
          createdAt: replyIso as unknown as ChatMessage['createdAt'],
          updatedAt: replyIso as unknown as ChatMessage['updatedAt'],
        };

        const withReply = [...currentList, replyMsg];
        saveLocalMessages(targetChat.chatId, withReply);
        setMessages(withReply);
        onChatUpdated?.({
          ...updatedChatObj,
          lastMessageText: replyText,
          lastMessageType: 'text',
          lastMessageSenderId: receiverUid,
          lastMessageTime: replyIso,
        });
      }, 950);
    }
  };

  const handleSendText = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = textInput.trim();
    if (!trimmed || sending) return;
    await sendMessagePayload('text', trimmed);
  };

  const handleImageAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowAttachMenu(false);
    setUploadError(null);
    try {
      setSending(true);
      const compressedDataUrl = await compressImageFile(file, 640, 0.72);
      await sendMessagePayload('image', textInput.trim() || 'Photo', compressedDataUrl, file.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Image upload failed.');
      setSending(false);
    } finally {
      e.target.value = '';
    }
  };

  const handleVideoAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowAttachMenu(false);
    setUploadError(null);
    try {
      setSending(true);
      const dataUrl = await fileToSafeDataUrl(file, 480 * 1024);
      await sendMessagePayload('video', textInput.trim() || file.name, dataUrl, file.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Video clip exceeds size limit.');
      setSending(false);
    } finally {
      e.target.value = '';
    }
  };

  const handleDocumentAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowAttachMenu(false);
    setUploadError(null);
    try {
      setSending(true);
      const dataUrl = await fileToSafeDataUrl(file, 480 * 1024);
      await sendMessagePayload('document', textInput.trim() || file.name, dataUrl, file.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Document upload failed.');
      setSending(false);
    } finally {
      e.target.value = '';
    }
  };

  // Voice recording handlers
  const startVoiceRecording = async () => {
    setUploadError(null);
    setRecordingSeconds(0);
    setIsRecordingVoice(true);

    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
    } catch {
      mediaRecorderRef.current = null;
    }
  };

  const stopAndSendVoiceRecording = async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const dur = Math.max(recordingSeconds, 1);
    setIsRecordingVoice(false);
    setRecordingSeconds(0);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      const recorder = mediaRecorderRef.current;
      recorder.onstop = async () => {
        recorder.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = String(reader.result);
          if (base64Audio.length <= 680000) {
            await sendMessagePayload('voice', `Voice message (${dur}s)`, base64Audio, `voice-${dur}s.webm`);
          } else {
            const fallbackWav = generateSynthesizedVoiceNoteWav(dur);
            await sendMessagePayload('voice', `Voice message (${dur}s)`, fallbackWav, `voice-${dur}s.wav`);
          }
        };
        reader.readAsDataURL(blob);
      };
      recorder.stop();
    } else {
      const wavDataUrl = generateSynthesizedVoiceNoteWav(dur);
      await sendMessagePayload('voice', `Voice message (${dur}s)`, wavDataUrl, `voice-${dur}s.wav`);
    }
  };

  const handleToggleReaction = async (msg: ChatMessage, emoji: string) => {
    setActiveMessageMenuId(null);
    const nextSummary = toggleReactionSummary(msg.reactionsSummary, emoji, currentUser.userId);
    const updated = messages.map((m) =>
      m.messageId === msg.messageId ? { ...m, reactionsSummary: nextSummary } : m
    );
    setMessages(updated);
    saveLocalMessages(chat.chatId, updated);
    try {
      await updateDoc(doc(db, 'chats', chat.chatId, 'messages', msg.messageId), {
        reactionsSummary: nextSummary,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Stored locally
    }
  };

  const handleDeleteMessage = async (msg: ChatMessage) => {
    setActiveMessageMenuId(null);
    const updated = messages.map((m) =>
      m.messageId === msg.messageId
        ? { ...m, text: 'This message was deleted', mediaUrl: '', isDeleted: true }
        : m
    );
    setMessages(updated);
    saveLocalMessages(chat.chatId, updated);
    try {
      await updateDoc(doc(db, 'chats', chat.chatId, 'messages', msg.messageId), {
        text: 'This message was deleted',
        mediaUrl: '',
        isDeleted: true,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Stored locally
    }
  };

  const handleHardDeleteMessage = async (msgId: string) => {
    setActiveMessageMenuId(null);
    const updated = messages.filter((m) => m.messageId !== msgId);
    setMessages(updated);
    saveLocalMessages(chat.chatId, updated);
    try {
      await deleteDoc(doc(db, 'chats', chat.chatId, 'messages', msgId));
    } catch {
      // Stored locally
    }
  };

  const toggleSelectMessageId = (msgId: string) => {
    setSelectedMessageIds((prev) =>
      prev.includes(msgId) ? prev.filter((id) => id !== msgId) : [...prev, msgId]
    );
  };

  const handleBatchDeleteSelected = async (mode: 'soft' | 'permanent') => {
    if (selectedMessageIds.length === 0) return;
    setDeletingAction(true);
    const selSet = new Set(selectedMessageIds);
    const updated =
      mode === 'permanent'
        ? messages.filter((m) => !selSet.has(m.messageId))
        : messages.map((m) =>
            selSet.has(m.messageId)
              ? { ...m, text: 'This message was deleted', mediaUrl: '', isDeleted: true }
              : m
          );
    setMessages(updated);
    saveLocalMessages(chat.chatId, updated);

    try {
      for (const msgId of selectedMessageIds) {
        if (mode === 'permanent') {
          await deleteDoc(doc(db, 'chats', chat.chatId, 'messages', msgId));
        } else {
          await updateDoc(doc(db, 'chats', chat.chatId, 'messages', msgId), {
            text: 'This message was deleted',
            mediaUrl: '',
            isDeleted: true,
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch {
      // Stored locally
    } finally {
      setSelectedMessageIds([]);
      setIsSelectMode(false);
      setDeletingAction(false);
    }
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    setActiveMessageMenuId(null);
    try {
      await navigator.clipboard.writeText(msg.text || '');
      setCopiedId(msg.messageId);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore
    }
  };

  const handleClearChat = async () => {
    setShowMoreMenu(false);
    setShowDeleteSheet(false);
    setDeletingAction(true);
    setMessages([]);
    saveLocalMessages(chat.chatId, []);
    const clearedIso = new Date().toISOString();
    onChatUpdated?.({
      ...chat,
      lastMessageText: '',
      ...(isParticipant1
        ? { clearedAt1: clearedIso, unreadCount1: 0 }
        : { clearedAt2: clearedIso, unreadCount2: 0 }),
    });

    try {
      for (const m of visibleMessages) {
        try {
          await deleteDoc(doc(db, 'chats', chat.chatId, 'messages', m.messageId));
        } catch {
          // Continue clearing
        }
      }
      await updateDoc(doc(db, 'chats', chat.chatId), {
        lastMessageText: '',
        ...(isParticipant1
          ? { clearedAt1: clearedIso, unreadCount1: 0 }
          : { clearedAt2: clearedIso, unreadCount2: 0 }),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Handled locally
    } finally {
      setDeletingAction(false);
    }
  };

  const handleDeleteEntireConversation = async () => {
    setShowMoreMenu(false);
    setShowDeleteSheet(false);
    setDeletingAction(true);
    saveLocalMessages(chat.chatId, []);
    setMessages([]);
    try {
      for (const m of messages) {
        try {
          await deleteDoc(doc(db, 'chats', chat.chatId, 'messages', m.messageId));
        } catch {
          // Continue
        }
      }
      await deleteDoc(doc(db, 'chats', chat.chatId));
    } catch {
      // Handled locally
    } finally {
      setDeletingAction(false);
      onChatDeleted();
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    const repId = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      await setDoc(doc(db, 'reports', repId), {
        reportId: repId,
        reporterId: currentUser.userId,
        targetUserId: otherUserId,
        reason: reportReason.slice(0, 100),
        details: (reportDetails || 'Reported from 1-to-1 conversation').slice(0, 1000),
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setReportSubmitted(true);
      setTimeout(() => {
        setShowReportModal(false);
        setReportSubmitted(false);
        setReportDetails('');
      }, 1500);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `reports/${repId}`);
      } catch {
        // Handled
      }
    }
  };

  // Wallpaper classes
  const wallpaperStyles: Record<string, string> = {
    default: 'bg-slate-100/75 dark:bg-slate-950',
    indigo:
      'bg-gradient-to-br from-indigo-50/90 via-slate-50 to-cyan-50/70 dark:from-indigo-950/40 dark:via-slate-950 dark:to-cyan-950/30',
    nordic: 'bg-gradient-to-b from-slate-100 to-slate-50 dark:from-slate-900 dark:to-slate-950',
    obsidian: 'bg-slate-900 text-slate-100',
    sunset:
      'bg-gradient-to-br from-rose-50/60 via-amber-50/40 to-indigo-50/60 dark:from-rose-950/30 dark:via-slate-950 dark:to-indigo-950/40',
  };
  const activeWallpaperClass = wallpaperStyles[userPrivate.wallpaper] || wallpaperStyles.default;

  return (
    <div className="flex flex-col h-full w-full relative overflow-hidden bg-white dark:bg-slate-950">
      {/* Hidden File Inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageAttachment}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleImageAttachment}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        onChange={handleVideoAttachment}
        className="hidden"
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,.zip,.csv,.json"
        onChange={handleDocumentAttachment}
        className="hidden"
      />

      {/* Chat Top Header */}
      <header className="h-16 px-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between shrink-0 z-20 shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="md:hidden w-10 h-10 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            title="Back to chats"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => otherUser && onViewProfile(otherUser)}
            className="flex items-center gap-3 min-w-0 text-left group cursor-pointer"
          >
            <div className="relative shrink-0">
              <img
                src={avatarUrl}
                alt={otherUser?.name || 'User'}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.src = getAvatarDataUri(otherUser?.name || 'User');
                }}
                className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 shadow-2xs"
              />
              {presence.isOnlineVisible && (
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {otherUser?.name || 'ChatConnect User'}
                </h2>
                {isPinned && <Pin className="w-3 h-3 text-indigo-500 shrink-0" />}
                {isMuted && <BellOff className="w-3 h-3 text-slate-400 shrink-0" />}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {presence.isOnlineVisible && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    ● Online
                  </span>
                )}
                {!presence.isOnlineVisible && <span>{presence.statusText}</span>}
                {otherUser && (
                  <span className="font-mono text-slate-400 dark:text-slate-500">
                    · @{otherUser.username}
                  </span>
                )}
              </div>
            </div>
          </button>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowSearchBar((s) => !s)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              showSearchBar
                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Search in conversation"
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              setIsSelectMode((prev) => !prev);
              setSelectedMessageIds([]);
            }}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              isSelectMode
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Select messages to delete"
          >
            <CheckSquare className="w-4 h-4" />
          </button>

          {/* Prominent Delete Chat / Clear Chat Header Button */}
          <button
            type="button"
            onClick={() => setShowDeleteSheet(true)}
            className="h-9 px-2.5 rounded-xl flex items-center gap-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer text-xs font-semibold"
            title="Delete or Clear Chat"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Delete Chat</span>
          </button>

          <button
            type="button"
            onClick={() => setShowMediaDrawer((s) => !s)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              showMediaDrawer
                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Shared Media & Links"
          >
            <FolderOpen className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMoreMenu((s) => !s)}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              title="More chat options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-1.5 z-30 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setIsSelectMode(true);
                    setSelectedMessageIds([]);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-500" />
                  Select Messages to Delete
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    onTogglePin(chat.chatId);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <Pin className="w-3.5 h-3.5" />
                  {isPinned ? 'Unpin Chat' : 'Pin Chat'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    onToggleMute(chat.chatId);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  {isMuted ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                  {isMuted ? 'Unmute Notifications' : 'Mute Notifications'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    onToggleArchive(chat.chatId);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5" />
                  {isArchived ? 'Unarchive Chat' : 'Archive Chat'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowMediaDrawer(true);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Shared Media & Docs
                </button>
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowDeleteSheet(true);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2.5 text-rose-600 dark:text-rose-400 font-semibold cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear or Delete Chat...
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    onToggleBlockUser(otherUserId);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2.5 text-rose-600 dark:text-rose-400 cursor-pointer"
                >
                  <Ban className="w-3.5 h-3.5" />
                  {isBlockedByMe ? 'Unblock User' : 'Block User'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowReportModal(true);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2.5 text-rose-600 dark:text-rose-400 cursor-pointer"
                >
                  <Flag className="w-3.5 h-3.5" />
                  Report User
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Multi-Select Action Bar */}
      {isSelectMode && (
        <div className="px-4 py-2.5 bg-indigo-600 text-white flex items-center justify-between gap-3 shrink-0 z-20">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold">
              {selectedMessageIds.length} message{selectedMessageIds.length === 1 ? '' : 's'} selected
            </span>
            <button
              type="button"
              onClick={() => {
                if (selectedMessageIds.length === visibleMessages.length) {
                  setSelectedMessageIds([]);
                } else {
                  setSelectedMessageIds(visibleMessages.map((m) => m.messageId));
                }
              }}
              className="text-[11px] underline text-indigo-100 hover:text-white cursor-pointer"
            >
              {selectedMessageIds.length === visibleMessages.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={selectedMessageIds.length === 0 || deletingAction}
              onClick={() => handleBatchDeleteSelected('soft')}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Eraser className="w-3.5 h-3.5" />
              Delete for Everyone
            </button>
            <button
              type="button"
              disabled={selectedMessageIds.length === 0 || deletingAction}
              onClick={() => handleBatchDeleteSelected('permanent')}
              className="px-3 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Permanently
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSelectMode(false);
                setSelectedMessageIds([]);
              }}
              className="p-1.5 rounded-lg hover:bg-white/15 text-white cursor-pointer"
              title="Exit selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Search Messages Sub-bar */}
      {showSearchBar && (
        <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages in this conversation..."
            className="flex-1 bg-transparent text-xs focus:outline-none text-slate-900 dark:text-white"
            autoFocus
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowSearchBar(false);
              setSearchQuery('');
            }}
            className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Message Scroll Area */}
      <div
        onClick={() => {
          setActiveMessageMenuId(null);
          setShowMoreMenu(false);
        }}
        className={`flex-1 overflow-y-auto p-4 sm:p-6 space-y-2.5 ${activeWallpaperClass}`}
      >
        {/* Security Verification Notice Pill */}
        <div className="flex justify-center mb-4">
          <div className="px-3.5 py-1.5 rounded-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-xs border border-slate-200/70 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 shadow-2xs">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>Private 1-to-1 ChatConnect thread · Only participants can read or manage messages</span>
          </div>
        </div>

        {loadingMessages ? (
          <div className="space-y-3 py-6">
            <div className="h-12 w-48 bg-slate-200/70 dark:bg-slate-800/60 rounded-2xl animate-pulse" />
            <div className="h-14 w-64 bg-indigo-500/20 rounded-2xl animate-pulse ml-auto" />
            <div className="h-10 w-40 bg-slate-200/70 dark:bg-slate-800/60 rounded-2xl animate-pulse" />
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center text-center py-12 px-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3 shadow-2xs">
              <Smile className="w-7 h-7" />
            </div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
              {searchQuery ? 'No matching messages found' : `Say hello to ${otherUser?.name || 'your contact'}`}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
              Send a message, photo, voice note, or sticker below to start chatting in real time.
            </p>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            const isOwn = msg.senderId === currentUser.userId;
            const reactions = parseReactions(msg.reactionsSummary);
            const showMenu = activeMessageMenuId === msg.messageId;
            const isSelected = selectedMessageIds.includes(msg.messageId);

            return (
              <div
                key={msg.messageId}
                className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} group relative`}
              >
                <div className={`flex items-end gap-2 max-w-[86%] sm:max-w-[70%] ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Checkbox when in Multi-Select Mode */}
                  {isSelectMode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectMessageId(msg.messageId);
                      }}
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mb-2 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </button>
                  )}

                  {/* Message Bubble */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSelectMode) {
                        toggleSelectMessageId(msg.messageId);
                      } else {
                        setActiveMessageMenuId(showMenu ? null : msg.messageId);
                      }
                    }}
                    className={`rounded-2xl px-4 py-2.5 relative cursor-pointer transition-all ${
                      isSelected ? 'ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-slate-950' : ''
                    } ${
                      isOwn
                        ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-br-xs shadow-sm'
                        : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200/90 dark:border-slate-800 rounded-bl-xs shadow-2xs'
                    }`}
                  >
                    {/* Forwarded Label */}
                    {msg.isForwarded && !msg.isDeleted && (
                      <div
                        className={`flex items-center gap-1 text-[10px] italic mb-1 ${
                          isOwn ? 'text-indigo-200' : 'text-slate-400'
                        }`}
                      >
                        <Forward className="w-3 h-3" />
                        <span>Forwarded</span>
                      </div>
                    )}

                    {/* Quoted Reply Header */}
                    {msg.replyToId && !msg.isDeleted && (
                      <div
                        className={`mb-2 p-2 rounded-xl border-l-2 text-xs ${
                          isOwn
                            ? 'bg-indigo-800/60 border-cyan-300 text-indigo-100'
                            : 'bg-slate-100 dark:bg-slate-800 border-indigo-500 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <p className="font-semibold text-[11px] truncate">
                          {msg.replyToSenderName || 'Reply'}
                        </p>
                        <p className="truncate opacity-90 text-[11px]">{msg.replyToText}</p>
                      </div>
                    )}

                    {/* Message Body by Type */}
                    {msg.isDeleted ? (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs italic opacity-75">🚫 This message was deleted</p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleHardDeleteMessage(msg.messageId);
                          }}
                          className="text-[10px] underline opacity-80 hover:opacity-100 cursor-pointer"
                          title="Remove deleted placeholder"
                        >
                          Remove
                        </button>
                      </div>
                    ) : msg.messageType === 'image' && msg.mediaUrl ? (
                      <div className="space-y-1.5">
                        <img
                          src={msg.mediaUrl}
                          alt={msg.mediaName || 'Shared image'}
                          referrerPolicy="no-referrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightboxImage(msg.mediaUrl);
                          }}
                          className="rounded-xl max-h-64 w-auto object-cover cursor-zoom-in"
                        />
                        {msg.text && msg.text !== 'Photo' && (
                          <p className="text-sm leading-relaxed break-words">{msg.text}</p>
                        )}
                      </div>
                    ) : msg.messageType === 'video' && msg.mediaUrl ? (
                      <div className="space-y-1.5">
                        <video
                          src={msg.mediaUrl}
                          controls
                          className="rounded-xl max-h-60 w-full bg-black"
                        />
                        <p className="text-xs opacity-90">{msg.mediaName || msg.text}</p>
                      </div>
                    ) : msg.messageType === 'document' && msg.mediaUrl ? (
                      <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-black/10 dark:bg-white/5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText className="w-5 h-5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">
                              {msg.mediaName || 'Document'}
                            </p>
                            <p className="text-[10px] opacity-75">Tap to download</p>
                          </div>
                        </div>
                        <a
                          href={msg.mediaUrl}
                          download={msg.mediaName || 'document'}
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    ) : msg.messageType === 'voice' && msg.mediaUrl ? (
                      <div className="space-y-1 min-w-[210px]" onClick={(e) => e.stopPropagation()}>
                        <audio src={msg.mediaUrl} controls className="w-full h-8" />
                        <p className="text-[10px] opacity-80">{msg.text}</p>
                      </div>
                    ) : msg.messageType === 'sticker' ? (
                      <div className="py-1 px-2 text-center">
                        <span className="text-4xl block">{msg.mediaUrl || '✨'}</span>
                        <span className="text-[11px] font-medium opacity-90 mt-1 block">
                          {msg.text}
                        </span>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                        {msg.text}
                      </p>
                    )}

                    {/* Timestamp & Status Footer */}
                    <div
                      className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] tabular-nums ${
                        isOwn ? 'text-indigo-200' : 'text-slate-400'
                      }`}
                    >
                      {copiedId === msg.messageId && (
                        <span className="text-emerald-300 font-medium">Copied!</span>
                      )}
                      <span>{formatMessageTime(msg.createdAt)}</span>
                      {isOwn && <MessageStatusIcon status={msg.status} isOwn={isOwn} />}
                    </div>
                  </div>

                  {/* Quick Hover Actions (Reply & Delete) next to bubble */}
                  {!isSelectMode && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 mb-1">
                      {!msg.isDeleted && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReplyingTo(msg);
                          }}
                          className="w-7 h-7 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-600 flex items-center justify-center shadow-2xs cursor-pointer"
                          title="Reply"
                        >
                          <Reply className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleHardDeleteMessage(msg.messageId);
                        }}
                        className="w-7 h-7 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 flex items-center justify-center shadow-2xs cursor-pointer"
                        title="Delete this message"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Reactions Row */}
                {reactions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {reactions.map((r) => {
                      const iReacted = r.userIds.includes(currentUser.userId);
                      return (
                        <button
                          key={r.emoji}
                          type="button"
                          onClick={() => handleToggleReaction(msg, r.emoji)}
                          className={`px-2 py-0.5 rounded-full text-xs flex items-center gap-1 border transition-colors cursor-pointer ${
                            iReacted
                              ? 'bg-indigo-50 dark:bg-indigo-950/80 border-indigo-400 text-indigo-700 dark:text-indigo-300'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <span>{r.emoji}</span>
                          <span className="text-[10px] font-medium tabular-nums">
                            {r.userIds.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Context Action Popover for Message */}
                {showMenu && !msg.isDeleted && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`mt-1.5 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-2.5 flex flex-col gap-1.5 min-w-[230px] ${
                      isOwn ? 'right-0' : 'left-0'
                    }`}
                  >
                    {/* Quick Emoji Reactions */}
                    <div className="flex items-center justify-between gap-1 px-1 pb-1.5 border-b border-slate-100 dark:border-slate-800">
                      {REACTION_EMOJIS.map((em) => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => handleToggleReaction(msg, em)}
                          className="w-7 h-7 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-sm transition-transform hover:scale-110 cursor-pointer"
                        >
                          {em}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setReplyingTo(msg);
                          setActiveMessageMenuId(null);
                        }}
                        className="py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        <Reply className="w-3.5 h-3.5" />
                        Reply
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setForwardingMessage(msg);
                          setActiveMessageMenuId(null);
                        }}
                        className="py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        <Forward className="w-3.5 h-3.5" />
                        Forward
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(msg)}
                        className="py-1.5 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </button>
                    </div>

                    <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => handleDeleteMessage(msg)}
                        className="flex-1 py-1.5 px-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center gap-1 font-medium cursor-pointer"
                      >
                        <Eraser className="w-3.5 h-3.5" />
                        Unsend
                      </button>
                      <button
                        type="button"
                        onClick={() => handleHardDeleteMessage(msg.messageId)}
                        className="flex-1 py-1.5 px-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center gap-1 font-semibold cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Upload / Error Banner */}
      {uploadError && (
        <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/80 border-t border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between">
          <span>{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="text-rose-500 hover:text-rose-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Reply Banner above Composer */}
      {replyingTo && (
        <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="border-l-2 border-indigo-600 pl-2.5 text-xs min-w-0">
            <p className="font-semibold text-indigo-600 dark:text-indigo-400">
              Replying to{' '}
              {replyingTo.senderId === currentUser.userId
                ? 'yourself'
                : otherUser?.name || 'User'}
            </p>
            <p className="text-slate-600 dark:text-slate-300 truncate">{replyingTo.text}</p>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Emoji & Stickers Picker Popover */}
      {showEmojiPicker && (
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Quick Emojis</span>
            <button
              type="button"
              onClick={() => setShowEmojiPicker(false)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setTextInput((prev) => prev + em)}
                className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-lg flex items-center justify-center cursor-pointer"
              >
                {em}
              </button>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-500 block mb-2">
              Original ChatConnect Stickers
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {CHAT_STICKERS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => sendMessagePayload('sticker', st.text, st.emoji, st.label)}
                  className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-center transition-transform hover:scale-105 cursor-pointer"
                >
                  <span className="text-2xl block">{st.emoji}</span>
                  <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 mt-0.5 block truncate">
                    {st.text}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Attachment Picker Popover */}
      {showAttachMenu && (
        <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex flex-col items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <ImageIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <span>Photo</span>
          </button>
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex flex-col items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <Film className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            <span>Video Clip</span>
          </button>
          <button
            type="button"
            onClick={() => docInputRef.current?.click()}
            className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex flex-col items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <FileText className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            <span>Document</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAttachMenu(false);
              setShowDeleteSheet(true);
            }}
            className="p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/60 flex flex-col items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer"
          >
            <Trash2 className="w-5 h-5" />
            <span>Delete Chat</span>
          </button>
        </div>
      )}

      {/* Bottom Message Composer (with integrated Delete Option) */}
      <div className="p-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800/80 shrink-0">
        {isBlockedByMe ? (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300">
            <span>You blocked this user.</span>
            <button
              type="button"
              onClick={() => onToggleBlockUser(otherUserId)}
              className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
            >
              Unblock
            </button>
          </div>
        ) : isRecordingVoice ? (
          <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800">
            <div className="flex items-center gap-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping" />
              <span className="tabular-nums">
                Recording Voice Note... 0:{String(recordingSeconds).padStart(2, '0')}
              </span>
            </div>
            <button
              type="button"
              onClick={stopAndSendVoiceRecording}
              className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5" />
              Stop & Send
            </button>
          </div>
        ) : (
          <form onSubmit={handleSendText} className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                setShowEmojiPicker((s) => !s);
                setShowAttachMenu(false);
              }}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
              title="Emoji & Stickers"
            >
              <Smile className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => {
                setShowAttachMenu((s) => !s);
                setShowEmojiPicker(false);
              }}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
              title="Attach file, photo, or video"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="w-10 h-10 rounded-xl hidden sm:flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
              title="Camera Photo"
            >
              <Camera className="w-5 h-5" />
            </button>

            {/* Direct Delete Chat Option right inside the message composer bar */}
            <button
              type="button"
              onClick={() => setShowDeleteSheet(true)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0 cursor-pointer transition-colors"
              title="Delete messages or clear chat"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && userPrivate.enterToSend) {
                  e.preventDefault();
                  handleSendText();
                }
              }}
              placeholder="Write a message..."
              className="flex-1 px-4 py-2.5 text-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/90 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />

            {textInput.trim() ? (
              <button
                type="submit"
                disabled={sending}
                className="w-11 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white flex items-center justify-center shrink-0 transition-colors shadow-xs cursor-pointer"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={startVoiceRecording}
                className="w-11 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                title="Record voice message"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
          </form>
        )}
      </div>

      {/* Delete / Clear Chat Options Modal Sheet */}
      {showDeleteSheet && (
        <div
          onClick={() => setShowDeleteSheet(false)}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Delete Chat Options
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Manage messages with {otherUser?.name || 'this user'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteSheet(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteSheet(false);
                  setIsSelectMode(true);
                  setSelectedMessageIds([]);
                }}
                className="w-full p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/70 flex items-center gap-3 text-left transition-colors cursor-pointer"
              >
                <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-slate-900 dark:text-white">
                    Select Specific Messages to Delete
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Choose individual messages to unsend or delete
                  </p>
                </div>
              </button>

              <button
                type="button"
                disabled={deletingAction}
                onClick={handleClearChat}
                className="w-full p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 hover:bg-amber-50/60 dark:hover:bg-amber-950/30 flex items-center gap-3 text-left transition-colors cursor-pointer"
              >
                <Eraser className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-slate-900 dark:text-white">
                    Clear All Messages in Chat
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Wipes all message history while keeping the contact
                  </p>
                </div>
              </button>

              <button
                type="button"
                disabled={deletingAction}
                onClick={handleDeleteEntireConversation}
                className="w-full p-3.5 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 hover:bg-rose-100/80 dark:hover:bg-rose-950/60 flex items-center gap-3 text-left transition-colors cursor-pointer"
              >
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-rose-600 dark:text-rose-400">
                    Delete Entire Conversation
                  </p>
                  <p className="text-[11px] text-rose-500/90">
                    Permanently removes this chat thread and all messages
                  </p>
                </div>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowDeleteSheet(false)}
              className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Shared Media Slide-over Drawer (Section 17) */}
      {showMediaDrawer && (
        <div className="absolute inset-y-0 right-0 w-full sm:w-80 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 z-30 flex flex-col shadow-xl">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Shared Media & Files
            </h3>
            <button
              type="button"
              onClick={() => setShowMediaDrawer(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1 p-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px]">
            {(
              [
                { id: 'photos', label: `Photos (${sharedPhotos.length})` },
                { id: 'videos', label: `Videos (${sharedVideos.length})` },
                { id: 'documents', label: `Docs (${sharedDocs.length})` },
                { id: 'links', label: `Links (${sharedLinks.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMediaTab(tab.id)}
                className={`py-1.5 px-2 rounded-lg font-medium transition-colors cursor-pointer truncate ${
                  mediaTab === tab.id
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {mediaTab === 'photos' &&
              (sharedPhotos.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">No photos shared yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {sharedPhotos.map((m) => (
                    <img
                      key={m.messageId}
                      src={m.mediaUrl}
                      alt={m.mediaName}
                      onClick={() => setLightboxImage(m.mediaUrl)}
                      className="w-full h-28 object-cover rounded-xl border border-slate-200 dark:border-slate-800 cursor-zoom-in"
                    />
                  ))}
                </div>
              ))}

            {mediaTab === 'videos' &&
              (sharedVideos.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">No videos shared yet.</p>
              ) : (
                <div className="space-y-3">
                  {sharedVideos.map((m) => (
                    <div key={m.messageId} className="space-y-1">
                      <video src={m.mediaUrl} controls className="w-full rounded-xl bg-black" />
                      <p className="text-[11px] text-slate-500 truncate">{m.mediaName}</p>
                    </div>
                  ))}
                </div>
              ))}

            {mediaTab === 'documents' &&
              (sharedDocs.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">No documents shared yet.</p>
              ) : (
                <div className="space-y-2">
                  {sharedDocs.map((m) => (
                    <a
                      key={m.messageId}
                      href={m.mediaUrl}
                      download={m.mediaName || 'document'}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                        <span className="text-xs font-medium truncate">
                          {m.mediaName || 'Document'}
                        </span>
                      </div>
                      <Download className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </a>
                  ))}
                </div>
              ))}

            {mediaTab === 'links' &&
              (sharedLinks.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">No links shared yet.</p>
              ) : (
                <div className="space-y-2">
                  {sharedLinks.map((item, idx) => (
                    <a
                      key={`${item.messageId}_${idx}`}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs text-indigo-600 dark:text-indigo-400 break-all"
                    >
                      <LinkIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>{item.url}</span>
                    </a>
                  ))}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Forward Message Modal */}
      {forwardingMessage && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Forward Message To...
              </h3>
              <button
                type="button"
                onClick={() => setForwardingMessage(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {allChats.map((c) => {
                const targetUid =
                  c.participant1 === currentUser.userId ? c.participant2 : c.participant1;
                const contact = allContactsMap[targetUid];
                return (
                  <button
                    key={c.chatId}
                    type="button"
                    onClick={async () => {
                      await sendMessagePayload(
                        forwardingMessage.messageType,
                        forwardingMessage.text,
                        forwardingMessage.mediaUrl,
                        forwardingMessage.mediaName,
                        c,
                        true
                      );
                      setForwardingMessage(null);
                    }}
                    className="w-full p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={getVisibleProfilePhoto(contact, true, currentUser.userId)}
                        alt={contact?.name || 'User'}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {contact?.name || 'Conversation'}
                        </p>
                        <p className="text-[10px] font-mono text-slate-400">
                          @{contact?.username || 'user'}
                        </p>
                      </div>
                    </div>
                    <Send className="w-3.5 h-3.5 text-indigo-600" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Report User Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Report @{otherUser?.username || 'User'}
              </h3>
              <button
                type="button"
                onClick={() => setShowReportModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {reportSubmitted ? (
              <div className="py-6 text-center space-y-2">
                <Check className="w-8 h-8 text-emerald-500 mx-auto" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Report submitted to ChatConnect Moderation
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmitReport} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Reason
                  </label>
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="Spam or unwanted messages">Spam or unwanted messages</option>
                    <option value="Harassment or abusive behavior">Harassment or abusive behavior</option>
                    <option value="Impersonation or fake User ID">Impersonation or fake User ID</option>
                    <option value="Inappropriate profile content">Inappropriate profile content</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Additional Details
                  </label>
                  <textarea
                    rows={3}
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Provide context for our moderation team..."
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 resize-none"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReportModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
                  >
                    Submit Report
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Image Lightbox Modal */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img
            src={lightboxImage}
            alt="Full size preview"
            className="max-w-full max-h-[90vh] rounded-2xl object-contain"
          />
        </div>
      )}
    </div>
  );
};
