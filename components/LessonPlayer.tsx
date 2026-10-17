'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  ExternalLink,
  Sparkles,
  BookmarkCheck,
  Send,
  MessageSquarePlus,
  RotateCcw,
  Music2,
  Clock,
  Radio,
  ChevronRight,
  Headphones
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
  type: 'heading' | 'paragraph' | 'song_links';
  title?: string;
  text: string;
  rawText: string;
  isBreakpoint: boolean;
  breakpointLabel?: string;
  spotifyUrl?: string;
  youtubeUrl?: string;
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

      // Default to a good English or system voice
      const preferred = voices.find(
        (v) =>
          (v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel') || v.name.includes('Google')))
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

  // 2. Parse Markdown content into structured segments with TTS breakpoints
  const segments = useMemo(() => {
    const lines = content.split('\n');
    const result: Segment[] = [];
    let currentId = 0;

    let hasAddedFirstBreakpoint = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Skip top-level # title since it's already shown in hero
      if (line.startsWith('# ') && !line.startsWith('## ')) {
        continue;
      }

      if (line.startsWith('## ') || line.startsWith('### ')) {
        const headingText = line.replace(/^#{2,3}\s+/, '').replace(/\*\*/g, '');
        const isFirst = !hasAddedFirstBreakpoint;
        if (isFirst) hasAddedFirstBreakpoint = true;

        result.push({
          id: currentId++,
          type: 'heading',
          title: headingText,
          text: headingText,
          rawText: headingText,
          isBreakpoint: isFirst,
          breakpointLabel: isFirst ? 'Start Podcast Lesson' : undefined
        });
      } else {
        // Check if line contains Spotify or YouTube link
        const spotifyMatch = line.match(/\[.*?Spotify.*?\]\((https?:\/\/[^\s)]+)\)/i) ||
                             line.match(/(https:\/\/open\.spotify\.com\/[^\s)]+)/i);
        const youtubeMatch = line.match(/\[.*?YouTube.*?\]\((https?:\/\/[^\s)]+)\)/i) ||
                             line.match(/(https:\/\/(?:www\.)?youtube\.com\/[^\s)]+)/i);

        const isSongLine = Boolean(spotifyMatch || youtubeMatch);

        // Strip markdown formatting for TTS text
        const cleanForSpeech = line
          .replace(/\[(.*?)\]\(.*?\)/g, '$1') // [text](url) -> text
          .replace(/https?:\/\/\S+/g, '') // remove raw URLs
          .replace(/[*_~`#]/g, '') // remove markdown symbols
          .replace(/\s+/g, ' ')
          .trim();

        if (isSongLine) {
          result.push({
            id: currentId++,
            type: 'song_links',
            text: line,
            rawText: cleanForSpeech,
            isBreakpoint: true,
            breakpointLabel: 'Resume after song',
            spotifyUrl: spotifyMatch ? (spotifyMatch[1] || spotifyMatch[0]) : undefined,
            youtubeUrl: youtubeMatch ? (youtubeMatch[1] || youtubeMatch[0]) : undefined
          });
        } else {
          // Normal paragraph
          const isFirst = !hasAddedFirstBreakpoint;
          if (isFirst) hasAddedFirstBreakpoint = true;

          result.push({
            id: currentId++,
            type: 'paragraph',
            text: line,
            rawText: cleanForSpeech,
            isBreakpoint: isFirst,
            breakpointLabel: isFirst ? 'Start Podcast Lesson' : undefined
          });
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

    window.speechSynthesis.cancel();

    // Collect all text from startIndex to end
    const remainingSegments = segments.slice(startIndex);
    if (remainingSegments.length === 0) return;

    setActiveSegmentIndex(startIndex);
    setIsPlaying(true);
    setIsPaused(false);

    // Chain speech utterance segment by segment so highlighting updates accurately
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

      const textToSpeak = segment.rawText;
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

  const handlePause = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const handleResume = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  };

  const handleStop = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      setIsPaused(false);
      setActiveSegmentIndex(null);
    }
  };

  const handleRateChange = (newRate: number) => {
    setSpeechRate(newRate);
    if (isPlaying && activeSegmentIndex !== null) {
      // Restart current segment with new rate
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
              Podcast Music Lesson
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
                <span>Listen to Full Lesson</span>
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
              <h3 className="text-sm font-bold text-white">Refine Lesson with Gemini</h3>
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
            Tell Gemini what to modify, add, shorten, or expand in this podcast lesson:
          </p>

          <textarea
            rows={3}
            value={userSuggestion}
            onChange={(e) => setUserSuggestion(e.target.value)}
            placeholder="e.g. Add 2 more obscure funk bands from Nigeria in chapter 2, and explain the rhythm section in more detail..."
            className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500 transition resize-none"
            autoFocus
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap gap-1.5">
              {[
                'Add more historical context',
                'Focus more on instruments',
                'Add 2 more recommended tracks',
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
                  <span>Refining Lesson...</span>
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

      {/* Lesson Body: Chapters, Paragraphs, Song Citations & Breakpoint Listen Buttons */}
      <div className="space-y-4 text-slate-200">
        {segments.map((seg, idx) => {
          const isCurrentlySpeaking = activeSegmentIndex === idx;

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
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-pink-500" />
                    {seg.title}
                  </h2>

                  {seg.isBreakpoint && (
                    <button
                      onClick={() => startSpeechFromSegment(idx)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-pink-400 hover:text-pink-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition shrink-0 shadow-sm"
                      title="Start listening from here"
                    >
                      <Play className="w-3 h-3 fill-pink-400" />
                      <span>Listen</span>
                    </button>
                  )}
                </div>
              </div>
            );
          }

          if (seg.type === 'song_links') {
            return (
              <div
                key={seg.id}
                className={`my-3 p-4 rounded-2xl bg-gradient-to-r from-slate-900/90 to-slate-950 border border-slate-800/80 shadow-md flex flex-wrap items-center justify-between gap-3 transition-all duration-300 ${
                  isCurrentlySpeaking ? 'ring-2 ring-pink-500/80 bg-pink-950/20' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-pink-400 shrink-0">
                    <Music2 className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm font-semibold text-white">
                      {seg.text.replace(/\[.*?\]\(.*?\)/g, '').replace(/https?:\/\/\S+/g, '').replace(/^[-*]\s*/, '').trim() || 'Featured Track'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {seg.spotifyUrl && (
                        <a
                          href={seg.spotifyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-300 border border-emerald-700/60 text-[11px] font-semibold flex items-center gap-1 transition"
                        >
                          <span>Spotify</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {seg.youtubeUrl && (
                        <a
                          href={seg.youtubeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900/90 text-rose-300 border border-rose-700/60 text-[11px] font-semibold flex items-center gap-1 transition"
                        >
                          <span>YouTube</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Resume TTS button right after song link */}
                <button
                  onClick={() => startSpeechFromSegment(idx + 1)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-400 hover:text-indigo-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm shrink-0"
                  title="Resume podcast listening after this song"
                >
                  <Play className="w-3 h-3 fill-indigo-400" />
                  <span>Resume from here</span>
                </button>
              </div>
            );
          }

          // Regular paragraph
          return (
            <div
              key={seg.id}
              className={`p-3 rounded-2xl transition-all duration-300 leading-relaxed text-sm sm:text-base ${
                isCurrentlySpeaking
                  ? 'bg-indigo-950/40 border border-indigo-500/60 text-white shadow-md'
                  : 'text-slate-300'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1 whitespace-pre-wrap">{seg.text}</p>
                {seg.isBreakpoint && (
                  <button
                    onClick={() => startSpeechFromSegment(idx)}
                    className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-pink-400 border border-slate-700 text-xs transition shrink-0"
                    title="Listen from this paragraph"
                  >
                    <Play className="w-3 h-3 fill-pink-400" />
                  </button>
                )}
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
                {isPaused ? 'Paused' : 'Playing podcast narration...'}
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
                onClick={handleResume}
                className="p-2.5 rounded-2xl bg-pink-600 hover:bg-pink-500 text-white transition shadow-lg shadow-pink-600/30"
                title="Resume"
              >
                <Play className="w-4 h-4 fill-white" />
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="p-2.5 rounded-2xl bg-pink-600 hover:bg-pink-500 text-white transition shadow-lg shadow-pink-600/30"
                title="Pause"
              >
                <Pause className="w-4 h-4 fill-white" />
              </button>
            )}

            {/* Stop */}
            <button
              onClick={handleStop}
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
