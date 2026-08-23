'use client';

import React, { useState } from 'react';
import { Play, ExternalLink } from 'lucide-react';

interface YouTubeEmbedProps {
  urls: string[];
}

export function YouTubeEmbed({ urls }: YouTubeEmbedProps) {
  const [activeEmbed, setActiveEmbed] = useState<string | null>(null);

  if (!urls || urls.length === 0) return null;

  const getVideoId = (url: string) => {
    try {
      if (url.includes('youtu.be/')) {
        return url.split('youtu.be/')[1]?.split('?')[0];
      }
      if (url.includes('youtube.com/watch')) {
        const urlParams = new URLSearchParams(new URL(url).search);
        return urlParams.get('v');
      }
      if (url.includes('youtube.com/embed/')) {
        return url.split('youtube.com/embed/')[1]?.split('?')[0];
      }
    } catch (e) {
      return null;
    }
    return null;
  };

  return (
    <div className="mt-4 pt-3 border-t border-slate-700/50">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-[#ec4899] items-center gap-1.5">
        <Play className="w-3.5 h-3.5 text-pink-400" />
        Featured YouTube Videos
      </p>

      {/* Video Embed Player Modal / Inline */}
      {activeEmbed && (
        <div className="mb-3 relative rounded-xl overflow-hidden aspect-video bg-black shadow-xl border border-slate-700">
          <button
            onClick={() => setActiveEmbed(null)}
            className="absolute top-2 right-2 z-10 bg-slate-900/80 hover:bg-slate-800 text-white text-xs px-2.5 py-1 rounded-md border border-slate-600 transition"
          >
            Close Video
          </button>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${activeEmbed}?autoplay=1`}
            title="YouTube video player"
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {/* Video links / thumbnails */}
      <div className="flex flex-wrap gap-2">
        {urls.map((url, idx) => {
          const videoId = getVideoId(url);
          return (
            <div key={idx} className="flex items-center gap-1">
              {videoId ? (
                <button
                  onClick={() => setActiveEmbed(videoId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800/80 hover:bg-pink-950/40 hover:text-pink-300 text-slate-300 rounded-lg border border-slate-700/80 hover:border-pink-500/50 transition-all duration-200"
                >
                  <Play className="w-3 h-3 text-pink-400 fill-pink-400" />
                  <span>Video #{idx + 1}</span>
                </button>
              ) : (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
                >
                  <span>Video #{idx + 1}</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
