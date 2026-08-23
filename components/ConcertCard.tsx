'use client';

import React from 'react';
import { Calendar, MapPin, ExternalLink, Heart, CheckCircle, MessageSquare, UserCheck, MessageCircle, Info } from 'lucide-react';
import { Concert, ActionType, Activity } from '@/lib/types';
import { YouTubeEmbed } from './YouTubeEmbed';

interface ConcertCardProps {
  concert: Concert;
  isPast?: boolean;
  onOpenActionModal: (concertId: string, bandName: string, action: ActionType) => void;
}

export function ConcertCard({ concert, isPast = false, onOpenActionModal }: ConcertCardProps) {
  // Format date nicely
  const concertDateObj = new Date(concert.date);
  const formattedDate = concertDateObj.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  const formattedTime = concertDateObj.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const activities = concert.activities || [];
  const goingCount = activities.filter((a) => a.action_type === 'GOING').length;
  const interestedCount = activities.filter((a) => a.action_type === 'INTERESTED').length;

  const formatActivityText = (act: Activity) => {
    const actDate = new Date(act.created_at).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short'
    });

    switch (act.action_type) {
      case 'GOING':
        return { text: `${act.user_name} is going`, date: actDate, badgeColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40' };
      case 'INTERESTED':
        return { text: `${act.user_name} is interested`, date: actDate, badgeColor: 'text-pink-400 bg-pink-950/40 border-pink-800/40' };
      case 'COMMENT':
        return { text: `${act.user_name} commented`, date: actDate, badgeColor: 'text-indigo-400 bg-indigo-950/40 border-indigo-800/40' };
      case 'REMOVED':
        return { text: `${act.user_name} updated status`, date: actDate, badgeColor: 'text-slate-400 bg-slate-800 border-slate-700' };
    }
  };

  return (
    <div className="relative bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 shadow-xl transition-all duration-200 overflow-hidden flex flex-col justify-between">
      
      {/* Top Banner & Info */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
            <Calendar className="w-3.5 h-3.5 text-indigo-400" />
            <span>{formattedDate}</span>
            {formattedTime !== '00:00' && <span className="opacity-75">• {formattedTime}</span>}
          </div>

          {concert.url && (
            <a
              href={concert.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-slate-400 hover:text-indigo-400 flex items-center gap-1 transition"
              title="View Event Link"
            >
              <span>Event Info</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Band & Venue */}
        <h2 className="text-xl font-bold text-white tracking-tight font-display">{concert.band_name}</h2>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
          <MapPin className="w-3.5 h-3.5 text-pink-400 shrink-0" />
          <span className="font-medium text-slate-300">{concert.venue_name}</span>
        </div>

        {/* Toni's Comment Callout */}
        {concert.toni_comment && (
          <div className="mt-4 p-3 bg-indigo-950/40 border border-indigo-500/20 rounded-xl text-xs text-indigo-200 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-indigo-300 block mb-0.5">Toni's Note:</span>
              <p className="text-slate-300 leading-relaxed">{concert.toni_comment}</p>
            </div>
          </div>
        )}

        {/* YouTube Embed / Links */}
        {concert.youtube_urls && concert.youtube_urls.length > 0 && (
          <YouTubeEmbed urls={concert.youtube_urls} />
        )}
      </div>

      {/* Activity Timeline & RSVP Section */}
      <div className="mt-5 pt-4 border-t border-slate-800/80">
        
        {/* RSVP Badges Summary */}
        <div className="flex items-center justify-between text-xs mb-3">
          <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">Friends Activity</span>
          <div className="flex items-center gap-2">
            {goingCount > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-medium">
                {goingCount} Going
              </span>
            )}
            {interestedCount > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-pink-500/10 text-pink-300 border border-pink-500/20 font-medium">
                {interestedCount} Interested
              </span>
            )}
          </div>
        </div>

        {/* Activity Feed Items */}
        {activities.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1 mb-4">
            {activities.map((act) => {
              const meta = formatActivityText(act);
              return (
                <div key={act.id} className="p-2.5 bg-slate-950/60 border border-slate-800/60 rounded-xl text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${meta.badgeColor}`}>
                      {meta.text}
                    </span>
                    <span className="text-[10px] text-slate-500">{meta.date}</span>
                  </div>
                  {act.comment_text && (
                    <p className="text-slate-300 pl-1 pt-0.5 italic">"{act.comment_text}"</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic mb-4">No responses yet. Be the first friend to RSVP!</p>
        )}

        {/* Action Buttons */}
        {!isPast ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
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

            <button
              onClick={() => onOpenActionModal(concert.id, concert.band_name, 'REMOVED')}
              className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition"
              title="Remove or update your response"
            >
              <span>Remove</span>
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
