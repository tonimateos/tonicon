'use client';

import React from 'react';
import { Calendar, MapPin, ExternalLink, Heart, CheckCircle, MessageSquare, Info, Edit3 } from 'lucide-react';
import { Concert, ActionType, Activity } from '@/lib/types';
import { YouTubeEmbed } from './YouTubeEmbed';

interface ConcertCardProps {
  concert: Concert;
  isPast?: boolean;
  isAdmin?: boolean;
  onEditConcert?: (concert: Concert) => void;
  onOpenActionModal: (concertId: string, bandName: string, action: ActionType) => void;
}

export function ConcertCard({ concert, isPast = false, isAdmin = false, onEditConcert, onOpenActionModal }: ConcertCardProps) {
  // Format date nicely (omit year for upcoming concerts)
  const concertDateObj = new Date(concert.date);
  const formattedDate = concertDateObj.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(isPast ? { year: 'numeric' } : {})
  });
  const formattedTime = concertDateObj.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const activities = concert.activities || [];

  return (
    <div className="relative bg-slate-900/95 border border-slate-700/90 hover:border-indigo-500/50 rounded-2xl p-6 shadow-2xl shadow-slate-950/90 ring-1 ring-white/10 transition-all duration-200 overflow-hidden flex flex-col justify-between group">
      {/* Top Accent Line for visual separation */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${isPast ? 'bg-slate-700/60' : 'bg-gradient-to-r from-indigo-500 via-pink-500 to-emerald-500 opacity-70 group-hover:opacity-100'} transition-opacity`} />

      {/* Top Banner & Info */}
      <div>
        {/* Row 1: Band Name & Edit Button */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display bg-gradient-to-r from-amber-200 via-yellow-300 to-orange-400 bg-clip-text text-transparent drop-shadow-sm">
              {concert.band_name}
            </h2>
            {isAdmin && onEditConcert && (
              <button
                onClick={() => onEditConcert(concert)}
                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-semibold rounded-lg flex items-center gap-1 transition shrink-0"
                title="Edit Concert details"
              >
                <Edit3 className="w-3 h-3 text-indigo-400" />
                <span>Edit</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Date, Venue, and Event Info link in the same row */}
        <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-3 mb-3 text-xs">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            {/* Date & Time Badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-semibold shrink-0">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <span>{formattedDate}</span>
              {formattedTime !== '00:00' && <span className="opacity-75">• {formattedTime}</span>}
            </div>

            {/* Venue Link */}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(concert.venue_name + ', Barcelona')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-slate-300 hover:text-pink-400 group transition truncate"
              title={`Search ${concert.venue_name}, Barcelona on Google Maps`}
            >
              <MapPin className="w-3.5 h-3.5 text-pink-400 shrink-0 group-hover:scale-110 transition-transform" />
              <span className="font-medium group-hover:underline group-hover:text-pink-300 truncate">{concert.venue_name}</span>
              <ExternalLink className="w-3 h-3 text-slate-500 opacity-60 group-hover:opacity-100 transition shrink-0" />
            </a>
          </div>

          {/* Event Info Link */}
          {concert.url && (
            <a
              href={concert.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-indigo-400 flex items-center gap-1 transition shrink-0 font-medium"
              title="View Event Link"
            >
              <span>Info</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Toni's Comment Callout */}
        {concert.toni_comment && (
          <div className="mt-4 p-3 bg-indigo-950/40 border border-indigo-500/20 rounded-xl text-xs text-indigo-200 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <p className="text-slate-300 leading-relaxed">
              <span className="font-semibold text-indigo-300 mr-1.5">Toni:</span>
              {concert.toni_comment}
            </p>
          </div>
        )}

        {/* YouTube Embed / Links */}
        {concert.youtube_urls && concert.youtube_urls.length > 0 && (
          <YouTubeEmbed urls={concert.youtube_urls} />
        )}
      </div>

      {/* Activity Timeline & RSVP Section */}
      <div className="mt-5 pt-4 border-t border-slate-700/60">

        {/* Render Friends Activity section only if activities exist */}
        {activities.length > 0 && (
          <div className="mb-4 space-y-2">
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {activities.map((act) => {
                const actDate = new Date(act.created_at).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short'
                });

                let actionText = 'is going';
                let actionColor = 'text-emerald-400';
                if (act.action_type === 'INTERESTED') {
                  actionText = 'is interested';
                  actionColor = 'text-pink-400';
                } else if (act.action_type === 'COMMENT') {
                  actionText = 'commented';
                  actionColor = 'text-indigo-400';
                } else if (act.action_type === 'REMOVED') {
                  actionText = 'updated status';
                  actionColor = 'text-slate-400';
                }

                return (
                  <div key={act.id} className="py-2 px-3 bg-slate-950/70 border border-slate-700/60 rounded-xl text-xs flex items-start justify-between gap-2">
                    <div className="text-slate-300 whitespace-normal break-words leading-relaxed flex-1">
                      <span className="font-semibold text-white">{act.user_name}</span>{' '}
                      <span className={actionColor}>{actionText}</span>
                      {act.comment_text && (
                        <span className="text-slate-200 italic font-normal">{` "${act.comment_text}"`}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 font-medium shrink-0 pt-0.5">on {actDate}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {!isPast ? (
          <div className="grid grid-cols-3 gap-2 pt-2">
            <button
              onClick={() => onOpenActionModal(concert.id, concert.band_name, 'GOING')}
              className="px-2.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>I'm going</span>
            </button>

            <button
              onClick={() => onOpenActionModal(concert.id, concert.band_name, 'INTERESTED')}
              className="px-2.5 py-2 bg-pink-600/20 hover:bg-pink-600/30 text-pink-300 border border-pink-500/30 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <Heart className="w-3.5 h-3.5 text-pink-400" />
              <span>Interested</span>
            </button>

            <button
              onClick={() => onOpenActionModal(concert.id, concert.band_name, 'COMMENT')}
              className="px-2.5 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>Comment</span>
            </button>
          </div>
        ) : (
          <div className="py-2 text-center text-xs text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800/40">
            Concert has passed — non-editable archive
          </div>
        )}
      </div>
    </div>
  );
}
