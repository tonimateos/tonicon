'use client';

import React from 'react';
import { Play, ExternalLink } from 'lucide-react';

interface YouTubeEmbedProps {
  urls: string[];
}

export function YouTubeEmbed({ urls }: YouTubeEmbedProps) {
  if (!urls || urls.length === 0) return null;

  const validUrls = urls.filter((u) => typeof u === 'string' && u.trim().length > 0);
  if (validUrls.length === 0) return null;

  return (
    <div className="mt-3 pt-2.5 border-t border-slate-700/40 flex flex-wrap gap-2">
      {validUrls.map((url, idx) => (
        <a
          key={idx}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800/80 hover:bg-pink-950/40 hover:text-pink-300 text-slate-300 rounded-lg border border-slate-700/80 hover:border-pink-500/50 transition-all duration-200"
          title="Watch video on YouTube (opens in new tab)"
        >
          <Play className="w-3 h-3 text-pink-400 fill-pink-400" />
          <span>Video #{idx + 1}</span>
          <ExternalLink className="w-3 h-3 text-slate-400" />
        </a>
      ))}
    </div>
  );
}
