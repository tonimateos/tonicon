'use client';

import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Heart, MessageSquare, Trash2, ShieldCheck } from 'lucide-react';
import { ActionType } from '@/lib/types';

interface FriendActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  concertId: string;
  bandName: string;
  targetAction: ActionType;
  onSuccess: () => void;
}

export function FriendActionModal({
  isOpen,
  onClose,
  concertId,
  bandName,
  targetAction,
  onSuccess,
}: FriendActionModalProps) {
  const [userName, setUserName] = useState('');
  const [commentText, setCommentText] = useState('');

  // Bot challenge numbers
  const [num1, setNum1] = useState(3);
  const [num2, setNum2] = useState(4);
  const [mathAnswer, setMathAnswer] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      // Generate simple math problem
      const n1 = Math.floor(Math.random() * 8) + 2;
      const n2 = Math.floor(Math.random() * 8) + 1;
      setNum1(n1);
      setNum2(n2);
      setMathAnswer('');
      setErrorMsg('');

      // Load saved name from localStorage if available
      const savedName = localStorage.getItem('tonicon_friend_name');
      if (savedName) {
        setUserName(savedName);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) {
      setErrorMsg('Please enter your name or pseudonym so Toni knows who you are.');
      return;
    }

    if (parseInt(mathAnswer, 10) !== num1 + num2) {
      setErrorMsg(`Anti-bot check failed! What is ${num1} + ${num2}?`);
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concert_id: concertId,
          user_name: userName.trim(),
          action_type: targetAction,
          comment_text: targetAction === 'COMMENT' || commentText.trim() ? commentText.trim() : null,
          num1,
          num2,
          math_answer: mathAnswer,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit response.');
      }

      // Save name for convenience next time
      localStorage.setItem('tonicon_friend_name', userName.trim());

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getActionTitle = () => {
    switch (targetAction) {
      case 'GOING':
        return { text: "I'm Going!", icon: <CheckCircle className="w-5 h-5 text-emerald-400" /> };
      case 'INTERESTED':
        return { text: "I'm Interested!", icon: <Heart className="w-5 h-5 text-pink-400" /> };
      case 'COMMENT':
        return { text: 'Add a Comment', icon: <MessageSquare className="w-5 h-5 text-indigo-400" /> };
      case 'REMOVED':
        return { text: 'Remove My Status', icon: <Trash2 className="w-5 h-5 text-rose-400" /> };
    }
  };

  const actionInfo = getActionTitle();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 text-slate-100">

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            {actionInfo.icon}
            <div>
              <h3 className="font-semibold text-lg text-white">{actionInfo.text}</h3>
              <p className="text-xs text-slate-400">For {bandName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {errorMsg && (
            <div className="p-3 text-xs bg-rose-950/60 border border-rose-800/80 text-rose-300 rounded-xl">
              {errorMsg}
            </div>
          )}

          {/* Name Field */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Add your name or a pseudonym that Toni will understand <span className="text-pink-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Maria Arnal"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
            />
          </div>

          {/* Comment Field (Mandatory if action == COMMENT, optional otherwise) */}
          {(targetAction === 'COMMENT' || targetAction === 'GOING' || targetAction === 'INTERESTED') && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                {targetAction === 'COMMENT' ? 'Your Comment *' : 'Add a note (optional)'}
              </label>
              <textarea
                rows={3}
                required={targetAction === 'COMMENT'}
                placeholder="e.g. I'm not 100% sure, I'll confirm by whatsapp"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition resize-none"
              />
            </div>
          )}

          {/* Bot Proof Math Challenge */}
          <div className="p-3.5 bg-slate-950/80 border border-slate-800/80 rounded-xl">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300 mb-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Proof you are not a bot</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-indigo-300 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
                {num1} + {num2} = ?
              </span>
              <input
                type="number"
                required
                placeholder="Result"
                value={mathAnswer}
                onChange={(e) => setMathAnswer(e.target.value)}
                className="w-28 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition text-center"
              />
            </div>
          </div>

          {/* Submit Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
            >
              {loading ? 'Submitting...' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
