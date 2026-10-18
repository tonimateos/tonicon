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
  X,
  Volume2,
  VolumeX,
  Clock,
  FileText,
  List,
  SkipForward,
  SkipBack,
  ChevronDown,
  ChevronUp,
  Mic,
  RotateCcw,
  Loader2,
  CheckCircle2
} from 'lucide-react';
import { AudioSegment, AudioStreamEvent, extractQuotaWaitTime } from '@/lib/types';

interface LessonPlayerProps {
  id?: string;
  lessonId?: string;
  title: string;
  content: string;
  topicPrompt?: string;
  language?: 'en' | 'es';
  onSave?: () => void;
  isSaving?: boolean;
  isSaved?: boolean;
  onSuggestChanges?: (suggestion: string) => Promise<void> | void;
  isRefining?: boolean;
  isAdmin?: boolean;
  readOnly?: boolean;
  adminPassword?: string;
  initialAudioSegments?: AudioSegment[];
  initialAudioStatus?: 'none' | 'in_progress' | 'paused' | 'ready';
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
    .replace(/\([^)]*(?:music|fade|applause|drum|intro|outro|beat|sound|riff|silence|tempo|groove|música|aplausos|batería|guitarra|silencio)[^)]*\)/gi, '')
    .replace(/\[[^\]]*(?:music|fade|applause|drum|intro|outro|beat|sound|riff|silence|música|aplausos|batería)[^\]]*\]/gi, '')
    .replace(/\((?:[^)]*?(?:fades?|playing|plays?|guitar|horns?|sax|percussion|cues?)[^)]*?)\)/gi, '')
    // Remove speaker labels like **Host:**, Host:, Narrator:, Locutor:
    .replace(/(?:^|\n)\s*(?:\*\*|\*|\[)?(?:Host|Narrator|Speaker|Announcer|Presenter|Locutor|Narrador|Presentador)(?:\*\*|\*|\])?:\s*/gi, '')
    // Format markdown song links into spoken track names
    .replace(/\[(?:Play|Escuchar|Reproducir)?\s*(.*?)(?:\s+(?:on|en)\s+YouTube)?\]\(.*?\)/gi, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanVisualText(raw: string): string {
  return raw
    // Remove sound cues like (Intro music fades in...)
    .replace(/\([^)]*(?:music|fade|applause|drum|intro|outro|beat|sound|riff|silence|tempo|groove|música|aplausos|batería|guitarra|silencio)[^)]*\)/gi, '')
    .replace(/\[[^\]]*(?:music|fade|applause|drum|intro|outro|beat|sound|riff|silence|música|aplausos|batería)[^\]]*\]/gi, '')
    // Remove speaker labels like **Host:** or Host:
    .replace(/(?:^|\n)\s*(?:\*\*|\*|\[)?(?:Host|Narrator|Speaker|Announcer|Presenter|Locutor|Narrador|Presentador)(?:\*\*|\*|\])?:\s*/gi, '')
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
  id,
  lessonId,
  title,
  content,
  topicPrompt,
  language,
  onSave,
  isSaving,
  isSaved,
  onSuggestChanges,
  isRefining,
  isAdmin = false,
  readOnly = false,
  adminPassword,
  initialAudioSegments,
  initialAudioStatus
}: LessonPlayerProps) {
  const effectiveLessonId = lessonId || id;
  const isSpanish = language === 'es' || /\b(el|la|los|las|de|en|un|una|por|para|con|este|esta|canción|música)\b/i.test(title + ' ' + content.slice(0, 400));

  // Studio Audio State (Lesson v3)
  const [audioSegments, setAudioSegments] = useState<AudioSegment[]>(initialAudioSegments || []);
  const [audioStatus, setAudioStatus] = useState<'none' | 'in_progress' | 'paused' | 'ready'>(initialAudioStatus || 'none');
  const [audioMode, setAudioMode] = useState<'studio' | 'browser'>('browser');
  const [isConvertingAudio, setIsConvertingAudio] = useState(false);
  const [audioStatusMessage, setAudioStatusMessage] = useState<string | null>(null);
  const [conversionProgress, setConversionProgress] = useState<{ completed: number; total: number }>({ completed: 0, total: 0 });
  const [quotaNotice, setQuotaNotice] = useState<{ message: string; retryAfter?: string } | null>(null);

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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
  const [isBrave, setIsBrave] = useState<boolean>(false);

  // Suggest Changes State
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [userSuggestion, setUserSuggestion] = useState('');

  // Table of Contents State
  const [isTocOpen, setIsTocOpen] = useState(false);

  // Ref to hold current speech utterance
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechSessionIdRef = useRef<number>(0);
  const segmentsRef = useRef<Segment[]>([]);

  // Fetch existing audio segments if lesson is saved
  useEffect(() => {
    if (!effectiveLessonId) return;

    fetch(`/api/lessons/audio?lessonId=${effectiveLessonId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          if (Array.isArray(data.audio_segments) && data.audio_segments.length > 0) {
            setAudioSegments(data.audio_segments);
            setAudioMode('studio');
          }
          if (data.audio_status) {
            setAudioStatus(data.audio_status);
          }
        }
      })
      .catch((err) => console.warn('Could not load audio segments:', err));
  }, [effectiveLessonId]);

  // 1. Initialize voices
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const updateVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);

      const targetLang = isSpanish ? 'es' : 'en';

      const preferred =
        targetLang === 'es'
          ? voices.find(
            (v) =>
              v.lang.startsWith('es') &&
              (v.name.includes('Natural') ||
                v.name.includes('Google') ||
                v.name.includes('Jorge') ||
                v.name.includes('Mónica') ||
                v.name.includes('Monica') ||
                v.name.includes('Paulina'))
          ) ||
          voices.find((v) => v.lang.startsWith('es')) ||
          voices[0]
          : voices.find(
            (v) =>
              v.lang.startsWith('en') &&
              (v.name.includes('Natural') ||
                v.name.includes('Samantha') ||
                v.name.includes('Daniel') ||
                v.name.includes('Google'))
          ) ||
          voices.find((v) => v.lang.startsWith('en')) ||
          voices[0];

      if (preferred && !selectedVoiceUri) {
        setSelectedVoiceUri(preferred.voiceURI);
      }
    };

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    // Detect Brave browser to adapt autoplay/sound strategy
    if (typeof window !== 'undefined' && (navigator as any).brave?.isBrave) {
      (navigator as any).brave.isBrave().then((res: boolean) => {
        if (res) setIsBrave(true);
      }).catch(() => { });
    }

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
        const ytMatch =
          line.match(/\[(.*?)(?:(?:on|en)\s+YouTube)?\]\((https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+)\)/i) ||
          line.match(/(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+)/i);

        if (ytMatch) {
          const ytUrl = ytMatch[2] || ytMatch[1];
          const rawLinkText = ytMatch[1] || '';
          const songLabel =
            rawLinkText
              .replace(/^(?:Play|Escuchar|Reproducir)\s+/i, '')
              .replace(/\s+(?:on|en)\s+YouTube$/i, '')
              .replace(/[*"'`]/g, '')
              .trim() || 'Featured Track';

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

  // Episode metadata statistics
  const stats = useMemo(() => {
    const totalWords = content.split(/\s+/).filter(Boolean).length;
    const estMinutes = Math.max(1, Math.ceil(totalWords / 150));
    const chapterCount = segments.filter((s) => s.type === 'heading').length;
    const songCount = segments.filter((s) => s.type === 'inline_song').length;
    return { totalWords, estMinutes, chapterCount, songCount };
  }, [content, segments]);

  // Auto-scroll to currently spoken paragraph during TTS
  useEffect(() => {
    if (isPlaying && activeSegmentIndex !== null) {
      const el = document.getElementById(`segment-${activeSegmentIndex}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [isPlaying, activeSegmentIndex]);

  const handleSkipChapter = (direction: 'prev' | 'next') => {
    const headingIndices = segments
      .map((s, idx) => (s.type === 'heading' ? idx : null))
      .filter((idx): idx is number => idx !== null);

    if (headingIndices.length === 0) return;

    if (activeSegmentIndex === null) {
      startSpeechFromSegment(headingIndices[0]);
      return;
    }

    if (direction === 'next') {
      const nextIdx = headingIndices.find((idx) => idx > activeSegmentIndex);
      if (nextIdx !== undefined) {
        startSpeechFromSegment(nextIdx);
      }
    } else {
      const prevIndices = headingIndices.filter((idx) => idx < activeSegmentIndex);
      if (prevIndices.length > 0) {
        startSpeechFromSegment(prevIndices[prevIndices.length - 1]);
      } else {
        startSpeechFromSegment(headingIndices[0]);
      }
    }
  };

  // Spoken segments count (excluding songs)
  const spokenSegmentsCount = useMemo(() => {
    return segments.filter((s) => s.type === 'paragraph' || s.type === 'heading').length;
  }, [segments]);

  // Audio Conversion Controls (Lesson v3)
  const handleStartAudioConversion = async (isResume = false) => {
    if (!effectiveLessonId) return;
    setIsConvertingAudio(true);
    setQuotaNotice(null);
    setAudioStatusMessage(isResume ? 'Resuming studio voice conversion...' : 'Starting studio voice conversion...');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const res = await fetch('/api/lessons/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: effectiveLessonId,
          action: isResume ? 'resume' : 'render',
          password: adminPassword || (typeof window !== 'undefined' ? localStorage.getItem('tonicon_admin_password') : null) || 'godzilla'
        }),
        signal: abortController.signal
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Audio conversion failed.');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No audio event stream received.');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const event: AudioStreamEvent = JSON.parse(trimmed.slice(6));
              if (event.type === 'status') {
                setAudioStatusMessage(event.message);
                setConversionProgress({ completed: event.completedCount, total: event.totalCount });
              } else if (event.type === 'segment_ready') {
                setAudioSegments((prev) => {
                  const filtered = prev.filter((s) => s.segment_id !== event.segment.segment_id);
                  return [...filtered, event.segment].sort((a, b) => a.segment_id - b.segment_id);
                });
                setConversionProgress({ completed: event.completedCount, total: event.totalCount });
              } else if (event.type === 'complete') {
                setAudioStatus('ready');
                setAudioSegments(event.audioSegments);
                setAudioMode('studio');
                setAudioStatusMessage(null);
                setQuotaNotice(null);
              } else if (event.type === 'error') {
                const isQuota = Boolean(event.isQuota || /quota|rate limit|resource_exhausted/i.test(event.error));
                const waitTime = event.retryAfter || extractQuotaWaitTime(event.error);
                if (isQuota || waitTime) {
                  setQuotaNotice({
                    message: event.error,
                    retryAfter: waitTime || undefined
                  });
                }
                const err = new Error(event.error);
                (err as any).isQuota = isQuota;
                (err as any).retryAfter = waitTime;
                throw err;
              }
            } catch (pErr) {
              console.warn('Failed to parse audio event:', pErr);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setAudioStatus('paused');
      } else {
        console.error('Audio conversion error:', err);
        setAudioStatus('paused');

        const isQuota = Boolean(err.isQuota || /quota|rate limit|resource_exhausted/i.test(err.message));
        const waitTime = err.retryAfter || extractQuotaWaitTime(err.message);

        if (isQuota || waitTime) {
          setQuotaNotice({
            message: err.message,
            retryAfter: waitTime || undefined
          });
        } else {
          alert(`Voice conversion paused: ${err.message}`);
        }
      }
    } finally {
      setIsConvertingAudio(false);
      abortControllerRef.current = null;
    }
  };

  const handlePauseAudioConversion = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsConvertingAudio(false);
    setAudioStatus('paused');
    if (effectiveLessonId) {
      await fetch('/api/lessons/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: effectiveLessonId,
          action: 'pause',
          password: adminPassword || (typeof window !== 'undefined' ? localStorage.getItem('tonicon_admin_password') : null) || 'godzilla'
        })
      }).catch(() => { });
    }
  };

  // Clean text and speak from a given segment index (Dual Buffer: Studio Audio + Browser Fallback)
  const startSpeechFromSegment = (startIndex: number) => {
    // Generate new session ID to invalidate any callbacks from previous session
    const sessionId = ++speechSessionIdRef.current;

    // Stop any active YouTube playing embed
    setActiveEmbedSegmentId(null);

    // Detach and cancel browser TTS safely
    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    // Stop HTML5 audio element
    if (currentAudioRef.current) {
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    const remainingSegments = segments.slice(startIndex);
    if (remainingSegments.length === 0) return;

    setActiveSegmentIndex(startIndex);
    setIsPlaying(true);
    setIsPaused(false);

    let currentIdx = startIndex;

    const playNext = () => {
      if (sessionId !== speechSessionIdRef.current) return;

      if (currentIdx >= segments.length) {
        setIsPlaying(false);
        setIsPaused(false);
        setActiveSegmentIndex(null);
        return;
      }

      const segment = segments[currentIdx];
      setActiveSegmentIndex(currentIdx);

      // If next item is a song, pause speech so user can play the song
      if (segment.type === 'inline_song') {
        currentIdx++;
        playNext();
        return;
      }

      // Check if studio audio is available and active
      const studioClip = audioSegments.find((a) => a.segment_id === segment.id);

      if (audioMode === 'studio' && studioClip?.audio_url) {
        const audio = new Audio(studioClip.audio_url);
        currentAudioRef.current = audio;
        audio.playbackRate = speechRate;

        // Preload next audio clip
        const nextSegment = segments[currentIdx + 1];
        if (nextSegment) {
          const nextClip = audioSegments.find((a) => a.segment_id === nextSegment.id);
          if (nextClip?.audio_url) {
            const preloader = new Audio(nextClip.audio_url);
            preloader.preload = 'auto';
            nextAudioRef.current = preloader;
          }
        }

        audio.onended = () => {
          if (sessionId !== speechSessionIdRef.current) return;
          setTimeout(() => {
            if (sessionId !== speechSessionIdRef.current) return;
            currentIdx++;
            playNext();
          }, 350);
        };

        audio.onerror = (e) => {
          if (sessionId !== speechSessionIdRef.current) return;
          console.warn('Studio audio playback error, falling back to browser speech:', e);
          fallbackToBrowserSpeech(segment, () => {
            if (sessionId !== speechSessionIdRef.current) return;
            currentIdx++;
            playNext();
          });
        };

        audio.play().catch((playErr) => {
          if (sessionId !== speechSessionIdRef.current) return;
          console.warn('Audio play prevented:', playErr);
          setIsPlaying(false);
          setIsPaused(false);
        });
      } else {
        fallbackToBrowserSpeech(segment, () => {
          if (sessionId !== speechSessionIdRef.current) return;
          currentIdx++;
          playNext();
        });
      }
    };

    const fallbackToBrowserSpeech = (segment: Segment, onComplete: () => void) => {
      if (sessionId !== speechSessionIdRef.current) return;

      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        onComplete();
        return;
      }

      const textToSpeak = segment.rawSpeechText;
      if (!textToSpeak || textToSpeak.length < 2) {
        onComplete();
        return;
      }

      // Detach listeners from any active utterance
      if (utteranceRef.current) {
        utteranceRef.current.onend = null;
        utteranceRef.current.onerror = null;
        utteranceRef.current = null;
      }

      // If speechSynthesis was paused in browser, resume it to prevent queue lockup
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utteranceRef.current = utterance;
      utterance.rate = speechRate;

      if (selectedVoiceUri) {
        const voice = availableVoices.find((v) => v.voiceURI === selectedVoiceUri);
        if (voice) utterance.voice = voice;
      }

      utterance.onend = () => {
        if (sessionId !== speechSessionIdRef.current) return;
        onComplete();
      };

      utterance.onerror = (e) => {
        if (sessionId !== speechSessionIdRef.current) return;
        // In Chrome and Safari, canceling an utterance fires onerror with 'interrupted' or 'canceled'.
        // These are normal lifecycle events from user navigation or double clicks, NOT unrecoverable playback failures.
        if (e.error === 'interrupted' || e.error === 'canceled') {
          return;
        }
        console.warn('SpeechSynthesis error:', e);
        setIsPlaying(false);
        setIsPaused(false);
        setActiveSegmentIndex(null);
      };

      // In Chromium / Safari, speechSynthesis.cancel() is asynchronous.
      // A 50ms buffer prevents the browser's speech synthesis engine from dropping the new utterance.
      setTimeout(() => {
        if (sessionId !== speechSessionIdRef.current) return;
        window.speechSynthesis.speak(utterance);
      }, 50);
    };

    playNext();
  };

  const handlePauseTTS = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
    }
    setIsPaused(true);
  };

  const handleResumeTTS = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.play();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
    }
    setIsPaused(false);
  };

  const handleStopTTS = () => {
    speechSessionIdRef.current++;
    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setIsPaused(false);
    setActiveSegmentIndex(null);
  };

  const handlePlayInlineSong = async (seg: Segment, forceClickMode?: boolean) => {
    // Release speech synthesis and studio audio immediately
    handleStopTTS();

    // In Brave, cross-origin iframes with autoplay=1 are strictly muted unless clicked directly.
    // Defaulting to click-to-play in Brave lets the user click the video directly, granting full unmuted audio.
    const useClickMode = forceClickMode !== undefined ? forceClickMode : isBrave;
    const autoplayParam = useClickMode ? '0' : '1';
    const originParam = typeof window !== 'undefined' && window.location.origin ? `&origin=${encodeURIComponent(window.location.origin)}` : '';
    const embedBase = 'https://www.youtube-nocookie.com/embed';

    // If already resolved, update the autoplay parameter and show immediately
    if (resolvedEmbeds[seg.id]) {
      const existing = resolvedEmbeds[seg.id];
      const updated = existing.replace(/autoplay=[01]/, `autoplay=${autoplayParam}`);
      setResolvedEmbeds((prev) => ({ ...prev, [seg.id]: updated }));
      setActiveEmbedSegmentId(seg.id);
      return;
    }

    // Check if the URL already has a direct 11-char video ID
    const directIdMatch = seg.youtubeUrl?.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]{11})/);
    if (directIdMatch && directIdMatch[1]) {
      const embed = `${embedBase}/${directIdMatch[1]}?autoplay=${autoplayParam}&enablejsapi=1&playsinline=1${originParam}`;
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
        const embed = `${embedBase}/${data.videoId}?autoplay=${autoplayParam}&enablejsapi=1&playsinline=1${originParam}`;
        setResolvedEmbeds((prev) => ({ ...prev, [seg.id]: embed }));
      } else {
        console.warn('Could not resolve exact video ID, falling back to direct query search');
      }
    } catch (err) {
      console.error('Failed to resolve video ID:', err);
    } finally {
      setResolvingSegmentId(null);
    }
  };

  const handleUnmuteIframe = (segId: number) => {
    const iframe = document.getElementById(`youtube-iframe-${segId}`) as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      try {
        const messages = [
          JSON.stringify({ event: 'command', func: 'unMute', args: '' }),
          JSON.stringify({ event: 'command', func: 'unMute', args: [] }),
          JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }),
          JSON.stringify({ event: 'command', func: 'playVideo', args: '' })
        ];
        messages.forEach((msg) => {
          iframe.contentWindow?.postMessage(msg, '*');
          iframe.contentWindow?.postMessage(msg, 'https://www.youtube.com');
        });
      } catch (err) {
        console.warn('Could not postMessage to iframe:', err);
      }
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


          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
            {title}
          </h1>

          {/* Episode Statistics Badges */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-indigo-950/70 border border-indigo-700/50 text-indigo-200 flex items-center gap-1.5 font-medium">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>⏱ ~{stats.estMinutes} min listen</span>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/60 text-slate-300 flex items-center gap-1.5 font-medium">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span>📖 {stats.totalWords.toLocaleString()} words</span>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/60 text-slate-300 flex items-center gap-1.5 font-medium">
              <Music className="w-3.5 h-3.5 text-pink-400" />
              <span>🎵 {stats.songCount} Tracks</span>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/60 text-slate-300 flex items-center gap-1.5 font-medium">
              <Radio className="w-3.5 h-3.5 text-purple-400" />
              <span>🎙 {stats.chapterCount} Chapters</span>
            </span>

            {stats.chapterCount > 0 && (
              <button
                type="button"
                onClick={() => setIsTocOpen(!isTocOpen)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-pink-300 border border-pink-500/30 flex items-center gap-1 font-semibold transition ml-auto"
              >
                <List className="w-3.5 h-3.5 text-pink-400" />
                <span>Chapters ({stats.chapterCount})</span>
                {isTocOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>

          {/* Collapsible Table of Contents */}
          {isTocOpen && stats.chapterCount > 0 && (
            <div className="p-4 rounded-2xl bg-slate-950/90 border border-pink-500/30 space-y-2 animate-fade-in backdrop-blur-md">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <List className="w-3.5 h-3.5 text-pink-400" />
                <span>Episode Chapter Outline:</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {segments
                  .map((s, idx) => (s.type === 'heading' ? { title: s.title, idx } : null))
                  .filter(Boolean)
                  .map((ch, num) => (
                    <button
                      key={ch!.idx}
                      onClick={() => {
                        startSpeechFromSegment(ch!.idx);
                        setIsTocOpen(false);
                      }}
                      className="text-left px-3 py-2 rounded-xl bg-slate-900 hover:bg-pink-950/40 text-slate-300 hover:text-white border border-slate-800 hover:border-pink-500/40 text-xs font-medium flex items-center gap-2 transition group"
                    >
                      <span className="w-5 h-5 rounded-full bg-pink-500/20 text-pink-300 flex items-center justify-center text-[10px] font-bold shrink-0 group-hover:bg-pink-500 group-hover:text-white transition">
                        {num + 1}
                      </span>
                      <span className="truncate flex-1">{ch!.title}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}

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
                    className={`px-4 py-2.5 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition shadow-md ${isSaved
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

      {/* Studio Voice Conversion Banner (Enabled ONLY on Saved Lessons for Admin) */}
      {(isSaved || readOnly) && effectiveLessonId && isAdmin && (
        <div className="space-y-3">
          {isConvertingAudio ? (
            /* State: In Progress */
            <div className="p-4 sm:p-5 rounded-3xl bg-indigo-950/80 border border-pink-500/50 shadow-xl space-y-3 animate-fade-in backdrop-blur-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-pink-400 animate-spin" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Generating Studio Voice with Gemini...
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handlePauseAudioConversion}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700 transition"
                >
                  Pause
                </button>
              </div>

              <div className="w-full bg-slate-950 rounded-full h-2 border border-slate-800 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-pink-500 to-indigo-500 h-full transition-all duration-300"
                  style={{
                    width: `${Math.round(
                      (audioSegments.length / Math.max(1, spokenSegmentsCount)) * 100
                    )}%`
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="truncate">{audioStatusMessage || 'Converting paragraphs to broadcast audio...'}</span>
                <span className="font-semibold text-pink-300 shrink-0">
                  {audioSegments.length} of {spokenSegmentsCount} paragraphs ({Math.round(
                    (audioSegments.length / Math.max(1, spokenSegmentsCount)) * 100
                  )}%)
                </span>
              </div>
            </div>
          ) : audioSegments.length >= spokenSegmentsCount && spokenSegmentsCount > 0 ? (
            /* State: Completed / Ready */
            <div className="p-4 rounded-3xl bg-gradient-to-r from-emerald-950/60 via-slate-900 to-indigo-950/60 border border-emerald-500/40 shadow-lg flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center border border-emerald-500/30">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">Broadcast Studio Voice Ready</span>
                    <span className="text-[10px] text-emerald-300 font-semibold bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-800/60">
                      {audioSegments.length}/{spokenSegmentsCount} Cached
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">High-fidelity narration cached in Supabase ($0 streaming)</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-2xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setAudioMode('studio')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${audioMode === 'studio'
                    ? 'bg-gradient-to-r from-pink-600 to-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                    }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>Studio Voice</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAudioMode('browser')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${audioMode === 'browser'
                    ? 'bg-slate-800 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                    }`}
                >
                  Browser Voice
                </button>
              </div>
            </div>
          ) : audioSegments.length > 0 || quotaNotice ? (
            /* State: Paused / Partial / Quota Notice */
            <div className="p-4 sm:p-5 rounded-3xl bg-amber-950/40 border border-amber-500/40 shadow-lg space-y-3 animate-fade-in backdrop-blur-md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-300 flex items-center justify-center border border-amber-500/30 shrink-0">
                    {quotaNotice ? (
                      <Clock className="w-5 h-5 text-amber-400" />
                    ) : (
                      <RotateCcw className="w-5 h-5 text-amber-400" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-amber-200 uppercase tracking-wide">
                        {quotaNotice ? 'Gemini Quota Exceeded — Conversion Paused' : 'Voice Conversion Paused'}
                      </span>
                      <span className="text-[10px] text-amber-300 font-semibold bg-amber-950 px-2 py-0.5 rounded-full border border-amber-800/60">
                        {audioSegments.length} of {spokenSegmentsCount} Ready
                      </span>
                    </div>
                    {quotaNotice?.retryAfter ? (
                      <p className="text-xs text-amber-200 mt-1 font-medium">
                        Google suggests waiting <span className="font-bold text-amber-100 bg-amber-900/80 px-2 py-0.5 rounded border border-amber-600/60">{quotaNotice.retryAfter}</span> before resuming.
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Saved permanently. Resume anytime without re-converting.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStartAudioConversion(audioSegments.length > 0)}
                    className="px-4 py-2 rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-md shadow-amber-600/30"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Resume Conversion</span>
                  </button>
                </div>
              </div>

              {quotaNotice && audioSegments.length > 0 && (
                <div className="text-[11px] text-amber-300/80 bg-black/40 rounded-xl p-2.5 border border-amber-500/20">
                  <span>
                    {audioSegments.length} segments converted and saved so far.
                  </span>
                </div>
              )}
            </div>
          ) : (
            /* State: Never Converted */
            <div className="p-4 rounded-3xl bg-slate-900/90 border border-indigo-500/30 shadow-lg flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-pink-500/20 text-pink-300 flex items-center justify-center border border-pink-500/30">
                  <Mic className="w-4 h-4 text-pink-400" />
                </div>
                <div>
                  <span className="text-xs font-bold text-white">Broadcast Studio Voice Available</span>
                  <p className="text-[11px] text-slate-400">
                    Convert paragraphs into human-like speech. Cached permanently in Supabase.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleStartAudioConversion(false)}
                className="px-4 py-2 rounded-2xl bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-2 transition shadow-lg shadow-pink-600/25"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Convert to Studio Voice</span>
              </button>
            </div>
          )}
        </div>
      )
      }

      {/* Suggest Changes Interactive Drawer */}
      {
        isSuggestOpen && !readOnly && isAdmin && (
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
        )
      }

      {/* Lesson Body: Chapters, In-Page Playable YouTube Tracks & Paragraph-Only Resume Buttons */}
      <div className="space-y-4 text-slate-200">
        {segments.map((seg, idx) => {
          const isCurrentlySpeaking = activeSegmentIndex === idx;

          // 1. Chapter Headings (NO resume buttons here)
          if (seg.type === 'heading') {
            return (
              <div
                id={`segment-${seg.id}`}
                key={seg.id}
                className={`pt-6 pb-2 transition-all duration-300 ${isCurrentlySpeaking
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
                id={`segment-${seg.id}`}
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
                  <div className="relative pt-2 animate-fade-in space-y-2">
                    {/* Audio Status & Unmute Bar */}
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200">
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>
                          {isBrave ? (
                            <>
                              <strong>Brave Browser detected:</strong> Brave blocks audio in autoplaying embeds. Click the play button (or 🔇 speaker) directly inside the video for sound.
                            </>
                          ) : (
                            <>
                              <strong>Can&apos;t hear audio?</strong> Browsers mute autoplayed embeds. Click the speaker icon (🔇) in the video or click:
                            </>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isBrave && (
                          <button
                            onClick={() => handleUnmuteIframe(seg.id)}
                            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1 transition shadow-sm active:scale-95"
                            title="Send unmute signal to video"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                            <span>Unmute Audio</span>
                          </button>
                        )}
                        <button
                          onClick={() => handlePlayInlineSong(seg, true)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
                          title="Reload in click-to-play mode (plays with full sound on user click)"
                        >
                          Click-to-Play Mode
                        </button>
                      </div>
                    </div>

                    <div className="relative aspect-video w-full rounded-2xl overflow-hidden border border-red-500/40 bg-black shadow-2xl">
                      <iframe
                        id={`youtube-iframe-${seg.id}`}
                        src={resolvedEmbeds[seg.id]}
                        title={`Play ${seg.songTitle}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        className="w-full h-full border-0"
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400 pt-1 px-1">
                      <span className="text-emerald-400 font-medium">✓ Playing directly in page. Podcast narration stopped.</span>
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
              id={`segment-${seg.id}`}
              key={seg.id}
              className={`group relative p-3 sm:p-4 rounded-2xl transition-all duration-300 text-sm sm:text-base leading-relaxed ${isCurrentlySpeaking
                ? 'bg-indigo-950/40 border border-indigo-500/60 text-white shadow-md'
                : 'text-slate-300 hover:bg-slate-900/40'
                }`}
            >
              <div className="flex items-start gap-3">
                {/* Resume from here button at start of paragraph */}
                <button
                  onClick={() => startSpeechFromSegment(idx)}
                  className={`mt-0.5 px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shrink-0 shadow-sm ${isCurrentlySpeaking
                    ? 'bg-pink-600 text-white shadow-pink-600/30'
                    : 'bg-slate-800 hover:bg-slate-700 text-pink-400 hover:text-pink-300 border border-slate-700'
                    }`}
                  title="Resume podcast listening from this paragraph"
                >
                  <Play className={`w-3 h-3 ${isCurrentlySpeaking ? 'fill-white' : 'fill-pink-400'}`} />
                  <span className="hidden sm:inline">Resume from here</span>
                </button>

                <div className="flex-1 space-y-1">
                  {audioSegments.some((a) => a.segment_id === seg.id) && audioMode === 'studio' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-pink-300 bg-pink-950/60 border border-pink-800/50 px-2 py-0.5 rounded-full mb-1">
                      <Mic className="w-2.5 h-2.5 text-pink-400" />
                      <span>Studio Audio</span>
                    </span>
                  )}
                  <p className="whitespace-pre-wrap">{seg.text}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Sticky TTS Player Control Bar */}
      {
        isPlaying && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-2xl bg-slate-900/95 border border-pink-500/40 rounded-3xl p-3 sm:p-4 shadow-2xl backdrop-blur-xl flex items-center justify-between gap-4 animate-slide-up">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-2xl bg-pink-500/20 border border-pink-500/40 flex items-center justify-center text-pink-400 shrink-0">
                {audioMode === 'studio' ? (
                  <Mic className="w-5 h-5 text-pink-400 animate-pulse" />
                ) : (
                  <Headphones className="w-5 h-5 animate-bounce" />
                )}
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-white truncate">
                  {title}
                </p>
                <p className="text-[11px] text-pink-300 truncate flex items-center gap-1.5">
                  <span>{isPaused ? 'Paused (Ready to resume)' : 'Playing podcast narration...'}</span>
                  {audioMode === 'studio' && (
                    <span className="text-[9px] uppercase font-extrabold px-1.5 py-0.2 rounded bg-pink-500/20 text-pink-300 border border-pink-500/30">
                      Studio Voice
                    </span>
                  )}
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
                    className={`px-1.5 py-0.5 rounded ${speechRate === rate ? 'bg-pink-600 text-white font-bold' : 'hover:text-white'
                      }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              {/* Chapter Skip & Play/Pause */}
              <button
                onClick={() => handleSkipChapter('prev')}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                title="Previous chapter"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>

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

              <button
                onClick={() => handleSkipChapter('next')}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                title="Next chapter"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>

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
        )
      }
    </div >
  );
}
