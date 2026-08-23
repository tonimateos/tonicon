'use client';

import React, { useState } from 'react';
import { X, Lock, Plus, Calendar, MapPin, Music, Link as LinkIcon, AlertCircle } from 'lucide-react';

interface AddConcertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddConcertModal({ isOpen, onClose, onSuccess }: AddConcertModalProps) {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');

  // Form state
  const [bandName, setBandName] = useState('');
  const [venueName, setVenueName] = useState('');
  const [date, setDate] = useState('');
  const [url, setUrl] = useState('');
  const [youtubeUrls, setYoutubeUrls] = useState<string[]>(['', '', '']);
  const [toniComment, setToniComment] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  if (!isOpen) return null;

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setAuthError('Please enter your secret admin password.');
      return;
    }
    setAuthError('');
    setIsAuthenticated(true);
  };

  const handleAddConcert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bandName.trim() || !venueName.trim() || !date) {
      setSubmitError('Band name, venue name, and concert date are required.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    try {
      const cleanYt = youtubeUrls.filter((u) => u.trim().length > 0);

      const res = await fetch('/api/concerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          band_name: bandName.trim(),
          venue_name: venueName.trim(),
          date: new Date(date).toISOString(),
          url: url.trim() || null,
          youtube_urls: cleanYt,
          toni_comment: toniComment.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setIsAuthenticated(false);
          setAuthError('Incorrect password!');
          return;
        }
        throw new Error(data.error || 'Failed to add concert.');
      }

      // Reset form
      setBandName('');
      setVenueName('');
      setDate('');
      setUrl('');
      setYoutubeUrls(['', '', '']);
      setToniComment('');

      onSuccess();
      onClose();
    } catch (err: any) {
      setSubmitError(err.message || 'Something went wrong while adding the concert.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateYoutubeUrl = (index: number, val: string) => {
    const next = [...youtubeUrls];
    next[index] = val;
    setYoutubeUrls(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 text-slate-100 max-h-[90vh] overflow-y-auto">

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-white">Add a New Concert</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1: Password Gate */}
        {!isAuthenticated ? (
          <form onSubmit={handlePasswordSubmit} className="mt-6 space-y-4">
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl text-center">
              <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
                <Lock className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-semibold text-white">ONLY TONI CAN ADD NEW CONCERTS</h4>
            </div>

            {authError && (
              <div className="p-3 text-xs bg-rose-950/60 border border-rose-800/80 text-rose-300 rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <div>
              <input
                type="password"
                required
                placeholder="Toni password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg shadow-indigo-600/30 transition"
              >
                Continue
              </button>
            </div>
          </form>
        ) : (
          /* Step 2: Main Concert Form */
          <form onSubmit={handleAddConcert} className="mt-5 space-y-4">
            {submitError && (
              <div className="p-3 text-xs bg-rose-950/60 border border-rose-800/80 text-rose-300 rounded-xl">
                {submitError}
              </div>
            )}

            {/* Band Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Band / Artist Name <span className="text-pink-400">*</span>
              </label>
              <div className="relative">
                <Music className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Arctic Monkeys"
                  value={bandName}
                  onChange={(e) => setBandName(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            </div>

            {/* Venue Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Venue Name <span className="text-pink-400">*</span>
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  placeholder="e.g. O2 Academy Brixton, London"
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            </div>

            {/* Concert Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Concert Date & Time <span className="text-pink-400">*</span>
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="datetime-local"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            </div>

            {/* Event URL Link */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Event Page Link (optional)
              </label>
              <div className="relative">
                <LinkIcon className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="url"
                  placeholder="https://dice.fm/event/... or https://ticketmaster.com/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            </div>

            {/* YouTube Videos (up to 3) */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Band YouTube Videos (up to 3, optional)
              </label>
              <div className="space-y-2">
                {[0, 1, 2].map((idx) => (
                  <input
                    key={idx}
                    type="url"
                    placeholder={`YouTube URL #${idx + 1}`}
                    value={youtubeUrls[idx] || ''}
                    onChange={(e) => updateYoutubeUrl(idx, e.target.value)}
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                ))}
              </div>
            </div>

            {/* Toni's Comment */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Toni's Note / Comment (optional)
              </label>
              <textarea
                rows={2}
                placeholder="e.g. Standing tickets, meeting outside at 7 PM..."
                value={toniComment}
                onChange={(e) => setToniComment(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition resize-none"
              />
            </div>

            {/* Submit Action */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
              >
                {submitting ? 'Adding Concert...' : 'Add Concert'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
