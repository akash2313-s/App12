import React from 'react';
import { MessageStatus } from '../types';

/**
 * Original ChatConnect geometric emblem: Interlocking Indigo-Cyan Pulse Nodes.
 * Distinct from any existing messaging application logo.
 */
export const ChatConnectLogo: React.FC<{ className?: string; size?: number }> = ({
  className = '',
  size = 36,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-label="ChatConnect Logo"
  >
    <defs>
      <linearGradient id="cc_grad_primary" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#4F46E5" />
        <stop offset="55%" stopColor="#6366F1" />
        <stop offset="100%" stopColor="#06B6D4" />
      </linearGradient>
      <linearGradient id="cc_grad_accent" x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#E0E7FF" stopOpacity="0.85" />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="42" height="42" rx="14" fill="url(#cc_grad_primary)" />
    {/* Interlocking signal rings */}
    <path
      d="M19 16C14.5817 16 11 19.5817 11 24C11 28.4183 14.5817 32 19 32H23L27 35.5V32H29C33.4183 32 37 28.4183 37 24C37 19.5817 33.4183 16 29 16H19Z"
      stroke="url(#cc_grad_accent)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="19.5" cy="24" r="2.5" fill="#FFFFFF" />
    <circle cx="28.5" cy="24" r="2.5" fill="#67E8F9" />
    <path d="M22 24H26" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/**
 * Original geometric message delivery state indicator:
 * - sending: animated orbital ring
 * - sent: single crisp diamond node
 * - delivered: dual linked nodes (muted)
 * - read: dual linked glowing cyan-indigo nodes
 */
export const MessageStatusIcon: React.FC<{
  status: MessageStatus;
  isOwn?: boolean;
}> = ({ status, isOwn = true }) => {
  if (status === 'sending') {
    return (
      <span className="inline-flex items-center gap-1" title="Sending...">
        <svg className="w-3.5 h-3.5 animate-spin text-indigo-200" viewBox="0 0 16 16" fill="none">
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeDasharray="18 12"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  if (status === 'sent') {
    return (
      <span className="inline-flex items-center" title="Sent">
        <svg
          className={`w-3.5 h-3.5 ${isOwn ? 'text-indigo-200' : 'text-slate-400'}`}
          viewBox="0 0 16 16"
          fill="none"
        >
          <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
        </svg>
      </span>
    );
  }

  if (status === 'delivered') {
    return (
      <span className="inline-flex items-center" title="Delivered">
        <svg
          className={`w-4 h-3.5 ${isOwn ? 'text-indigo-100' : 'text-slate-400'}`}
          viewBox="0 0 20 14"
          fill="none"
        >
          <circle cx="6.5" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="13.5" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="6.5" cy="7" r="1.2" fill="currentColor" />
          <circle cx="13.5" cy="7" r="1.2" fill="currentColor" />
        </svg>
      </span>
    );
  }

  // status === 'read'
  return (
    <span className="inline-flex items-center" title="Read">
      <svg className="w-4 h-3.5 text-cyan-300" viewBox="0 0 20 14" fill="none">
        <circle cx="6.5" cy="7" r="4" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="13.5" cy="7" r="4" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="6.5" cy="7" r="1.6" fill="#67E8F9" />
        <circle cx="13.5" cy="7" r="1.6" fill="#67E8F9" />
      </svg>
    </span>
  );
};

/**
 * Curated original vector stickers for quick expressive messaging.
 */
export const CHAT_STICKERS = [
  { id: 'wave', label: 'Hello Wave', emoji: '👋', bg: 'from-indigo-500 to-cyan-500', text: 'Hey there!' },
  { id: 'rocket', label: 'Launch', emoji: '🚀', bg: 'from-violet-600 to-indigo-500', text: 'Let’s go!' },
  { id: 'spark', label: 'Awesome', emoji: '⚡', bg: 'from-amber-500 to-orange-500', text: 'High Energy' },
  { id: 'chill', label: 'Cool', emoji: '🧊', bg: 'from-cyan-500 to-teal-500', text: 'Stay Cool' },
  { id: 'heart', label: 'Appreciate', emoji: '💜', bg: 'from-fuchsia-500 to-indigo-600', text: 'Much Love' },
  { id: 'check', label: 'Done', emoji: '🎯', bg: 'from-emerald-500 to-teal-600', text: 'On Target' },
];
