'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  Square,
  BookmarkCheck,
  Send,
  MessageSquarePlus,
  Radio,
  Headphones,
  Music,
  ExternalLink,
  Sparkles,
  X
} from 'lucide-react';

interface LessonPlayerProps {
  title: string;
  content: string;
  topicPrompt?: string;
  onSave?: () => void;
  isSaving?: boolean;
  isSaved?: boolean;
  onSuggestChanges?: (suggestion: string) => Promise<void> | void;
  isRefining?: boolean;
  isAdmin?: boolean;
  readOnly?: boolean;
}

interface Segment {
  id: number;
  type: 'heading' | 'paragraph' | 'inline_song';
  title?: string;
  text: string;
  rawSpeechText: string;
  songTitle?: string;
  youtubeUrl?: string;
  embedUrl?: string;
}

function sanitizeTextForSpeech(raw: string): string {
  return raw
    // Remove sound cues like (Intro music fades in...) or [Music fades]
    .replace(/\([^)]*(?:music|fade|applause|drum|intro|outro|beat|sound|riff|silence|tempo|groove)[^)]*\)/gi, '')
    .replace(/\[[^\]]*(?:music|fade|applause|drum|intro|outro|beat|sound|riff|silence)[^\]]*\]/gi, '')
    .replace(/\((?:[^)]*?(?:fades?|playing|plays?|guitar|horns?|sax|percussion|cues?)[^)]*?)\)/gi, '')
    // Remove speaker labels like **Host:**, Host:, Narrator:
    .replace(/(?:^|\n)\s*(?:\*\*|\*|\[)?(?:Host|Narrator|Speaker|Announcer|Presenter)(?:\*\*|\*|\])?:\s*/gi, '')
    // Format markdown song links into spoken track names
    .replace(/\[(?:Play\s+)?(.*?)(?:\s+on\s+YouTube)?\]\(.*?\)/gi, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanVisualText(raw: string): string {
  return raw
    // Remove sound cues like (Intro music fades in...)
    .replace(/\([^)]*(?:music|fade|applause|drum|intro|outro|beat|sound|riff|silence|tempo|groove)[^)]*\)/gi, '')
    .replace(/\[[^\]]*(?:music|fade|applause|drum|intro|outro|beat|sound|riff|silence)[^\]]*\]/gi, '')
    // Remove speaker labels like **Host:** or Host:
    .replace(/(?:^|\n)\s*(?:\*\*|\*|\[)?(?:Host|Narrator|Speaker|Announcer|Presenter)(?:\*\*|\*|\])?:\s*/gi, '')
    .trim();
}

function getEmbedUrl(youtubeUrl: string): string {
  const queryMatch = youtubeUrl.match(/[?&]search_query=([^&#]+)/);
  if (queryMatch && queryMatch[1]) {
    return `https://www.youtube-nocookie.com/embed?listType=search&list=${queryMatch[1]}&autoplay=1`;
  }

  const idMatch = youtubeUrl.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]{11})/);
  if (idMatch && idMatch[1]) {
    return `https://www.youtube-nocookie.com/embed/${idMatch[1]}?autoplay=1`;
  }

  return youtubeUrl;
}

export function LessonPlayer({
  title,
  content,
  topicPrompt,
  onSave,
  isSaving,
  isSaved,
  onSuggestChanges,
  isRefining,
  isAdmin = false,
  readOnly = false
}: LessonPlayerProps) {
  // TTS State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [speechRate, setSpeechRate] = useState<number>(1);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState<string>('');

  // Active in-page playing YouTube embed (track ID or segment ID)
  const [activeEmbedSegmentId, setActiveEmbedSegmentId] = useState<number | null>(null);
  const [resolvedEmbeds, setResolvedEmbeds] = useState<Record<number, string>>({});
  const [resolvingSegmentId, setResolvingSegmentId] = useState<number | null>(null);

  // Suggest Changes State
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [userSuggestion, setUserSuggestion] = useState('');

  // Ref to hold current speech utterance
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const segmentsRef = useRef<Segment[]>([]);

  // 1. Initialize voices
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const updateVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);

      const preferred = voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          (v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Google'))
      ) || voices.find((v) => v.lang.startsWith('en')) || voices[0];

      if (preferred && !selectedVoiceUri) {
        setSelectedVoiceUri(preferred.voiceURI);
      }
    };

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // 2. Parse Markdown content into structured segments
  const segments = useMemo(() => {
    const lines = content.split('\n');
    const result: Segment[] = [];
    let currentId = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Skip top-level # title since it's already shown in hero
      if (line.startsWith('# ') && !line.startsWith('## ')) {
        continue;
      }

      if (line.startsWith('## ') || line.startsWith('### ')) {
        const headingText = line.replace(/^#{2,3}\s+/, '').replace(/\*\*/g, '');
        result.push({
          id: currentId++,
          type: 'heading',
          title: headingText,
          text: headingText,
          rawSpeechText: sanitizeTextForSpeech(headingText)
        });
      } else {
        // Check for YouTube link in line
        const ytMatch = line.match(/\[(.*?)(?:on\s+YouTube)?\]\((https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+)\)/i) ||
                        line.match(/(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+)/i);

        if (ytMatch) {
          const ytUrl = ytMatch[2] || ytMatch[1];
          const rawLinkText = ytMatch[1] || '';
          const songLabel = rawLinkText.replace(/^Play\s+/i, '').replace(/\s+on\s+YouTube$/i, '').replace(/[*"']/g, '').trim() || 'Featured Track';

          // Add inline song segment
          result.push({
            id: currentId++,
            type: 'inline_song',
            text: line,
            songTitle: songLabel,
            youtubeUrl: ytUrl,
            rawSpeechText: '' // Songs themselves aren't read by TTS; speech pauses
          });
        } else {
          // Normal narrative paragraph
          const cleanedVisual = cleanVisualText(line);
          const speechText = sanitizeTextForSpeech(line);

          // Only add if there is actual spoken content
          if (cleanedVisual.length > 0 && speechText.length > 0) {
            result.push({
              id: currentId++,
              type: 'paragraph',
              text: cleanedVisual,
              rawSpeechText: speechText
            });
          }
        }
      }
    }

    segmentsRef.current = result;
    return result;
  }, [content]);

  // Clean text and speak from a given segment index
  const startSpeechFromSegment = (startIndex: number) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      alert('Speech synthesis is not supported on this device/browser.');
      return;
    }

    // Stop any active YouTube playing embed
    setActiveEmbedSegmentId(null);

    window.speechSynthesis.cancel();

    const remainingSegments = segments.slice(startIndex);
    if (remainingSegments.length === 0) return;

    setActiveSegmentIndex(startIndex);
    setIsPlaying(true);
    setIsPaused(false);

    let currentIdx = startIndex;

    const playNext = () => {
      if (currentIdx >= segments.length) {
        setIsPlaying(false);
        setIsPaused(false);
        setActiveSegmentIndex(null);
        return;
      }

      const segment = segments[currentIdx];
      setActiveSegmentIndex(currentIdx);

      // If next item is a song, pause speech so the user can play the song
      if (segment.type === 'inline_song') {
        currentIdx++;
        playNext();
        return;
      }

      const textToSpeak = segment.rawSpeechText;
      if (!textToSpeak || textToSpeak.length < 2) {
        currentIdx++;
        playNext();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utteranceRef.current = utterance;
      utterance.rate = speechRate;

      if (selectedVoiceUri) {
        const voice = availableVoices.find((v) => v.voiceURI === selectedVoiceUri);
        if (voice) utterance.voice = voice;
      }

      utterance.onend = () => {
        currentIdx++;
        playNext();
      };

      utterance.onerror = (e) => {
        console.warn('SpeechSynthesis error:', e);
        setIsPlaying(false);
        setIsPaused(false);
        setActiveSegmentIndex(null);
      };

      window.speechSynthesis.speak(utterance);
    };

    playNext();
  };

  const handlePauseTTS = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const handleResumeTTS = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  };

  const handleStopTTS = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      setIsPaused(false);
      setActiveSegmentIndex(null);
    }
  };

  const handlePlayInlineSong = async (seg: Segment) => {
    // Automatically pause TTS speech so the user can enjoy the music track
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && isPlaying) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }

    // If already resolved, just activate it
    if (resolvedEmbeds[seg.id]) {
      setActiveEmbedSegmentId(seg.id);
      return;
    }

    // Check if the URL already has a direct 11-char video ID
    const directIdMatch = seg.youtubeUrl?.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]{11})/);
    if (directIdMatch && directIdMatch[1]) {
      const embed = `https://www.youtube-nocookie.com/embed/${directIdMatch[1]}?autoplay=1`;
      setResolvedEmbeds((prev) => ({ ...prev, [seg.id]: embed }));
      setActiveEmbedSegmentId(seg.id);
      return;
    }

    // Otherwise, resolve search query via server to get the top matching video ID
    const queryMatch = seg.youtubeUrl?.match(/[?&]search_query=([^&#]+)/);
    const searchQuery = queryMatch && queryMatch[1] ? decodeURIComponent(queryMatch[1].replace(/\+/g, ' ')) : (seg.songTitle || '');

    setResolvingSegmentId(seg.id);
    setActiveEmbedSegmentId(seg.id);

    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (res.ok && data.videoId) {
        const embed = `https://www.youtube-nocookie.com/embed/${data.videoId}?autoplay=1`;
        setResolvedEmbeds((prev) => ({ ...prev, [seg.id]: embed }));
      } else {
        console.warn('Could not resolve exact video ID, falling back to direct search URL');
      }
    } catch (err) {
      console.error('Failed to resolve video ID:', err);
    } finally {
      setResolvingSegmentId(null);
    }
  };

  const handleCloseInlineSong = () => {
    setActiveEmbedSegmentId(null);
  };

  const handleRateChange = (newRate: number) => {
    setSpeechRate(newRate);
    if (isPlaying && activeSegmentIndex !== null) {
      startSpeechFromSegment(activeSegmentIndex);
    }
  };

  const handleSubmitSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userSuggestion.trim() || !onSuggestChanges) return;
    await onSuggestChanges(userSuggestion.trim());
    setUserSuggestion('');
    setIsSuggestOpen(false);
  };

  return (
    <div className="relative space-y-6 pb-28">
      {/* Hero Title & Podcast Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950/70 via-slate-900 to-slate-950 border border-indigo-500/30 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-48 h-48 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-3 py-1 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30 font-semibold flex items-center gap-1.5 shadow-sm">
              <Radio className="w-3.5 h-3.5 animate-pulse text-pink-400" />
              Music Podcast Episode
            </span>
            {topicPrompt && (
              <span className="px-3 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700/80 truncate max-w-xs">
                Topic: {topicPrompt}
              </span>
            )}
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
            {title}
          </h1>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800/80">
            <div className="flex items-center gap-3">
              <button
                onClick={() => startSpeechFromSegment(0)}
                className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-600 hover:from-pink-400 hover:to-indigo-500 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-pink-500/20 transition transform active:scale-95"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Listen to Full Podcast</span>
              </button>
            </div>

            {/* Top Action Buttons (Save & Suggest Changes) */}
            {!readOnly && isAdmin && (
              <div className="flex items-center gap-2">
                {onSave && (
                  <button
                    onClick={onSave}
                    disabled={isSaving || isSaved}
                    className={`px-4 py-2.5 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition shadow-md ${
                      isSaved
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
                    }`}
                  >
                    <BookmarkCheck className="w-4 h-4" />
                    <span>{isSaved ? 'Lesson Saved' : isSaving ? 'Saving...' : 'Save Lesson'}</span>
                  </button>
                )}

                {onSuggestChanges && (
                  <button
                    onClick={() => setIsSuggestOpen(!isSuggestOpen)}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition"
                  >
                    <MessageSquarePlus className="w-4 h-4 text-pink-400" />
                    <span>Suggest Changes</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Suggest Changes Interactive Drawer */}
      {isSuggestOpen && !readOnly && isAdmin && (
        <form
          onSubmit={handleSubmitSuggestion}
          className="p-5 rounded-2xl bg-slate-900/90 border border-pink-500/40 shadow-xl space-y-3 backdrop-blur-md animate-fade-in"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-pink-400" />
              <h3 className="text-sm font-bold text-white">Refine Podcast with Gemini</h3>
            </div>
            <button
              type="button"
              onClick={() => setIsSuggestOpen(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>

          <p className="text-xs text-slate-400">
            Tell Gemini what to modify, add, shorten, or expand in this podcast:
          </p>

          <textarea
            rows={3}
            value={userSuggestion}
            onChange={(e) => setUserSuggestion(e.target.value)}
            placeholder="e.g. Expand on the cultural impact of this movement in the 70s, add another representative track, and explain its rhythm in more depth..."
            className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500 transition resize-none"
            autoFocus
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap gap-1.5">
              {[
                'Add more historical context',
                'Focus more on instruments',
                'Add another track example',
                'Make it more storytelling-like'
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setUserSuggestion(chip)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-[11px] text-slate-300 border border-slate-700/60 transition"
                >
                  {chip}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={isRefining || !userSuggestion.trim()}
              className="px-5 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-pink-600/30 transition disabled:opacity-50"
            >
              {isRefining ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  <span>Refining Podcast...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Suggestion</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Lesson Body: Chapters, In-Page Playable YouTube Tracks & Paragraph-Only Resume Buttons */}
      <div className="space-y-4 text-slate-200">
        {segments.map((seg, idx) => {
          const isCurrentlySpeaking = activeSegmentIndex === idx;

          // 1. Chapter Headings (NO resume buttons here)
          if (seg.type === 'heading') {
            return (
              <div
                key={seg.id}
                className={`pt-6 pb-2 transition-all duration-300 ${
                  isCurrentlySpeaking
                    ? 'p-3 rounded-2xl bg-indigo-950/40 border border-indigo-500/50 shadow-lg'
                    : ''
                }`}
              >
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-pink-500 shrink-0" />
                  <span>{seg.title}</span>
                </h2>
              </div>
            );
          }

          // 2. In-Page Playable YouTube Tracks (NO resume buttons here; playable inside the page)
          if (seg.type === 'inline_song') {
            const isEmbedActive = activeEmbedSegmentId === seg.id;

            return (
              <div
                key={seg.id}
                className="my-3 p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-red-500/30 shadow-lg space-y-3 transition"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-600/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                      <Music className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
                        Featured Song
                      </span>
                      <h4 className="text-sm sm:text-base font-bold text-white mt-0.5">
                        {seg.songTitle}
                      </h4>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Play inside page button */}
                    <button
                      onClick={() => handlePlayInlineSong(seg)}
                      disabled={resolvingSegmentId === seg.id}
                      className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-red-600/30 transition transform active:scale-95 disabled:opacity-70"
                    >
                      {resolvingSegmentId === seg.id ? (
                        <>
                          <Sparkles className="w-3.5 h-3.5 animate-spin" />
                          <span>Finding Track...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-white" />
                          <span>{isEmbedActive ? 'Playing in Page' : 'Play Song in Page'}</span>
                        </>
                      )}
                    </button>

                    {/* Direct external link fallback */}
                    {seg.youtubeUrl && (
                      <a
                        href={seg.youtubeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
                        title="Open on YouTube website"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Inline Embedded YouTube Iframe Player */}
                {isEmbedActive && resolvedEmbeds[seg.id] && (
                  <div className="relative pt-2 animate-fade-in">
                    <div className="relative aspect-video w-full rounded-2xl overflow-hidden border border-red-500/40 bg-black shadow-2xl">
                      <iframe
                        src={resolvedEmbeds[seg.id]}
                        title={`Play ${seg.songTitle}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full border-0"
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400 pt-2 px-1">
                      <span className="text-emerald-400 font-medium">✓ Playing directly inside page. Podcast narration is paused.</span>
                      <button
                        onClick={handleCloseInlineSong}
                        className="flex items-center gap-1 text-red-400 hover:text-red-300 font-semibold"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Close Player</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          }

          // 3. Regular Narrative Paragraphs: "Resume from here" button is ONLY placed here at the start
          return (
            <div
              key={seg.id}
              className={`group relative p-3 sm:p-4 rounded-2xl transition-all duration-300 text-sm sm:text-base leading-relaxed ${
                isCurrentlySpeaking
                  ? 'bg-indigo-950/40 border border-indigo-500/60 text-white shadow-md'
                  : 'text-slate-300 hover:bg-slate-900/40'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Resume from here button at start of paragraph */}
                <button
                  onClick={() => startSpeechFromSegment(idx)}
                  className={`mt-0.5 px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shrink-0 shadow-sm ${
                    isCurrentlySpeaking
                      ? 'bg-pink-600 text-white shadow-pink-600/30'
                      : 'bg-slate-800 hover:bg-slate-700 text-pink-400 hover:text-pink-300 border border-slate-700'
                  }`}
                  title="Resume podcast listening from this paragraph"
                >
                  <Play className={`w-3 h-3 ${isCurrentlySpeaking ? 'fill-white' : 'fill-pink-400'}`} />
                  <span className="hidden sm:inline">Resume from here</span>
                </button>

                <p className="flex-1 whitespace-pre-wrap">{seg.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Sticky TTS Player Control Bar */}
      {isPlaying && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-2xl bg-slate-900/95 border border-pink-500/40 rounded-3xl p-3 sm:p-4 shadow-2xl backdrop-blur-xl flex items-center justify-between gap-4 animate-slide-up">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-2xl bg-pink-500/20 border border-pink-500/40 flex items-center justify-center text-pink-400 shrink-0">
              <Headphones className="w-5 h-5 animate-bounce" />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-white truncate">
                {title}
              </p>
              <p className="text-[11px] text-pink-300 truncate">
                {isPaused ? 'Paused (Ready to resume)' : 'Playing podcast narration...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Speed Control */}
            <div className="hidden sm:flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 text-xs text-slate-300">
              {[0.9, 1, 1.25].map((rate) => (
                <button
                  key={rate}
                  onClick={() => handleRateChange(rate)}
                  className={`px-1.5 py-0.5 rounded ${
                    speechRate === rate ? 'bg-pink-600 text-white font-bold' : 'hover:text-white'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* Play/Pause */}
            {isPaused ? (
              <button
                onClick={handleResumeTTS}
                className="p-2.5 rounded-2xl bg-pink-600 hover:bg-pink-500 text-white transition shadow-lg shadow-pink-600/30"
                title="Resume"
              >
                <Play className="w-4 h-4 fill-white" />
              </button>
            ) : (
              <button
                onClick={handlePauseTTS}
                className="p-2.5 rounded-2xl bg-pink-600 hover:bg-pink-500 text-white transition shadow-lg shadow-pink-600/30"
                title="Pause"
              >
                <Pause className="w-4 h-4 fill-white" />
              </button>
            )}

            {/* Stop */}
            <button
              onClick={handleStopTTS}
              className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
              title="Stop"
            >
              <Square className="w-4 h-4 fill-slate-300" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
