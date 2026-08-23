'use client';

import React from 'react';
import { Play, ExternalLink } from 'lucide-react';

interface YouTubeEmbedProps {
  urls: string[];
}

function getYouTubeId(url: string): string | null {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

export function YouTubeEmbed({ urls }: YouTubeEmbedProps) {
  if (!urls || urls.length === 0) return null;

  const validUrls = urls.filter((u) => typeof u === 'string' && u.trim().length > 0);
  if (validUrls.length === 0) return null;

  return (
    <div className="mt-4 pt-3 border-t border-slate-700/60">
      <div className="flex flex-wrap gap-3">
        {validUrls.map((url, idx) => {
          const videoId = getYouTubeId(url);
          const thumbnailUrl = videoId
            ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
            : null;

          if (thumbnailUrl) {
            return (
              <a
                key={idx}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative w-32 sm:w-36 aspect-video rounded-xl overflow-hidden border border-slate-700/80 hover:border-red-500/60 bg-slate-950 shadow-md transition-all duration-200 block shrink-0"
                title="Watch on YouTube (opens in new tab)"
              >
                <img
                  src={thumbnailUrl}
                  alt={`YouTube cover ${idx + 1}`}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-90 group-hover:opacity-100"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20 group-hover:from-black/40 transition-opacity" />

                {/* Play Button Overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-7 h-7 rounded-full bg-red-600/90 text-white flex items-center justify-center shadow-lg shadow-red-950/50 group-hover:scale-110 group-hover:bg-red-500 transition-transform duration-200 border border-red-400/30">
                    <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                  </div>
                </div>

                {/* External link indicator */}
                <div className="absolute top-1 right-1 px-1 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[9px] font-medium text-white/90 flex items-center gap-0.5">
                  <ExternalLink className="w-2.5 h-2.5" />
                </div>
              </a>
            );
          }

          // Fallback if URL isn't standard YouTube pattern
          return (
            <a
              key={idx}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800/90 hover:bg-red-950/40 text-slate-200 hover:text-red-300 rounded-xl border border-slate-700 hover:border-red-500/50 transition-all duration-200"
              title="Watch video on YouTube"
            >
              <Play className="w-3 h-3 text-red-400 fill-red-400" />
              <span>Video {idx + 1}</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          );
        })}
      </div>
    </div>
  );
}
