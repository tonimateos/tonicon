'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Plus,
  Headphones,
  Lock,
  ShieldCheck,
  LogOut,
  Sparkles,
  ArrowLeft,
  Calendar,
  Radio,
  Music,
  Send,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RotateCcw,
  PlayCircle,
  Trash2,
  List,
  Clock,
  Layers,
  ChevronRight,
  MessageSquare
} from 'lucide-react';
import {
  Lesson,
  ActiveLessonBuild,
  LessonOutline,
  CompletedChapter,
  LessonStreamEvent,
  PodcastComment,
  PodcastPetition
} from '@/lib/types';
import { LessonPlayer } from '@/components/LessonPlayer';
import { AdminLoginModal } from '@/components/AdminLoginModal';

const PROMPT_SUGGESTIONS_EN = [
  'How music changed in the western world in the 1960s (folk, pop, rock, jazz, bossa)',
  'The evolution of Brazilian Tropicália and MPB in the late 60s',
  'How Jamaican Dub and Sound System culture gave birth to modern remixing',
  'The golden era of Japanese City Pop and its western yacht-rock roots',
  'West African Afrobeat: Fela Kuti, Tony Allen, and polyrhythmic resistance',
  'Desert Blues from Mali: How Tuareg guitar music conquered global stages'
];

const PROMPT_SUGGESTIONS_ES = [
  'Cómo cambió la música en el mundo occidental en los años 60 (folk, pop, rock, jazz, bossa)',
  'La evolución del flamenco fusión y el nuevo flamenco (Paco de Lucía, Camarón, Veneno, Pata Negra)',
  'La Movida Madrileña y la transición sonora de los años 80 en España',
  'La Bossa Nova de Río de Janeiro: armonías de Jobim, João Gilberto y el cool jazz',
  'La Fania All-Stars y el nacimiento de la salsa moderna en el Nueva York de los 70',
  'El rock andino y la psicodelia chicha en el Perú de los años 60 y 70'
];

export default function LessonsPage() {
  const [activeTab, setActiveTab] = useState<'saved' | 'add'>('saved');

  // Admin authentication state
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);

  // Saved lessons data
  const [savedLessons, setSavedLessons] = useState<Lesson[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [lessonToDelete, setLessonToDelete] = useState<Lesson | null>(null);
  const [isDeletingLesson, setIsDeletingLesson] = useState(false);

  // Add Lesson generation state & Language preference
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'es'>('en');
  const [userPrompt, setUserPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Active Draft / In-Progress Build State
  const [activeBuild, setActiveBuild] = useState<ActiveLessonBuild | null>(null);
  const [liveStatusMessage, setLiveStatusMessage] = useState<string | null>(null);
  const [liveOutline, setLiveOutline] = useState<LessonOutline | null>(null);
  const [liveChapters, setLiveChapters] = useState<CompletedChapter[]>([]);

  // Discard Confirmation Safeguard Modal State
  const [showDiscardModal, setShowDiscardModal] = useState<boolean>(false);
  const [pendingPromptToRun, setPendingPromptToRun] = useState<string | null>(null);

  // Active ready draft (for LessonPlayer)
  const [currentDraft, setCurrentDraft] = useState<{
    id?: string;
    title: string;
    content: string;
    topicPrompt: string;
    language?: 'en' | 'es';
    isSaved: boolean;
  } | null>(null);

  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isRefiningDraft, setIsRefiningDraft] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Podcast Comments State
  const [comments, setComments] = useState<PodcastComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commenterName, setCommenterName] = useState('');
  const [commentText, setCommentText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentSuccessMessage, setCommentSuccessMessage] = useState<string | null>(null);

  // Sync admin authentication from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedPass =
        localStorage.getItem('tonicon_admin_password') ||
        sessionStorage.getItem('tonicon_admin_password');
      if (savedPass) {
        setAdminPassword(savedPass);
        setIsAdmin(true);
      }
    }
  }, []);

  const handleAdminAuthSuccess = (pass: string) => {
    setAdminPassword(pass);
    setIsAdmin(true);
    localStorage.setItem('tonicon_admin_password', pass);
    sessionStorage.setItem('tonicon_admin_password', pass);
    showToast('Admin mode unlocked! You can now create lessons.');
  };

  const handleAdminLogout = () => {
    setIsAdmin(false);
    setAdminPassword('');
    localStorage.removeItem('tonicon_admin_password');
    sessionStorage.removeItem('tonicon_admin_password');
    showToast('Admin logged out.');
  };

  // Fetch saved lessons
  const fetchLessons = async () => {
    setLoadingSaved(true);
    try {
      const res = await fetch('/api/lessons');
      const data = await res.json();
      if (res.ok && data.lessons) {
        setSavedLessons(data.lessons);
      }
    } catch (err) {
      console.error('Failed to load saved lessons:', err);
    } finally {
      setLoadingSaved(false);
    }
  };

  // Fetch active in-progress draft from DB
  const fetchActiveDraft = async () => {
    try {
      const res = await fetch('/api/lessons/draft');
      const data = await res.json();
      if (res.ok && data.draft) {
        setActiveBuild(data.draft);
        if (data.draft.outline_json) {
          setLiveOutline(data.draft.outline_json);
        }
        if (Array.isArray(data.draft.chapters_json)) {
          setLiveChapters(data.draft.chapters_json);
        }
        // If already completed in DB, mount into player view
        if (data.draft.status === 'completed' && data.draft.content) {
          setCurrentDraft({
            title: data.draft.title || data.draft.topic_prompt,
            content: data.draft.content,
            topicPrompt: data.draft.topic_prompt,
            language: data.draft.language || 'en',
            isSaved: false
          });
        }
      } else {
        setActiveBuild(null);
      }
    } catch (err) {
      console.warn('Failed to load active draft:', err);
    }
  };

  useEffect(() => {
    fetchLessons();
    fetchActiveDraft();
    fetchComments();
  }, []);

  const fetchComments = async () => {
    setLoadingComments(true);
    try {
      const res = await fetch('/api/lessons/comments');
      const data = await res.json();
      if (res.ok && Array.isArray(data.comments)) {
        setComments(data.comments);
      }
    } catch (err) {
      console.error('Failed to load podcast comments:', err);
    } finally {
      setLoadingComments(false);
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commenterName.trim() || !commentText.trim()) return;

    setIsSubmittingComment(true);
    setCommentSuccessMessage(null);
    try {
      const res = await fetch('/api/lessons/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: commenterName.trim(),
          comment: commentText.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit comment');
      }

      if (data.comment) {
        setComments((prev) => [data.comment, ...prev.filter((c) => c.id !== data.comment.id)]);
      }

      setCommentText('');
      setCommentSuccessMessage('Thank you! Your comment has been saved :-)');
      showToast('Comment submitted! Toni will check it out :-)');
    } catch (err: any) {
      console.error('Error submitting comment:', err);
      showToast(err.message || 'Error submitting comment');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (id: string) => {
    if (!confirm('Are you sure you want to remove this comment?')) return;
    try {
      const res = await fetch('/api/lessons/comments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password: adminPassword })
      });
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== id));
        showToast('Comment removed.');
      }
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  const renderCommentsList = (isAdminView = false) => {
    return (
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400 flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Podcast Comments</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-pink-300 font-semibold border border-slate-700">
                  {comments.length}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                {isAdminView
                  ? 'Comments left by visitors — click "Use as Topic" to load into prompt'
                  : 'Comments, feedback, and topic suggestions left by friends for Toni'}
              </p>
            </div>
          </div>
        </div>

        {loadingComments ? (
          <div className="p-8 text-center rounded-2xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400">
            <Sparkles className="w-4 h-4 animate-spin text-pink-400 mx-auto mb-2" />
            Loading comments...
          </div>
        ) : comments.length === 0 ? (
          <div className="p-8 text-center rounded-2xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">No comments yet :-)</p>
            <p className="text-[11px]">Be the first to leave a comment above!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {comments.map((item) => {
              const formattedDate = new Date(item.created_at).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
              });

              return (
                <div
                  key={item.id}
                  className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/80 hover:border-slate-700 transition shadow-sm space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-pink-500/20 to-indigo-500/20 border border-pink-500/30 text-pink-300 font-bold text-xs flex items-center justify-center shrink-0">
                        {item.name ? item.name.charAt(0).toUpperCase() : '?'}
                      </div>
                      <span className="text-xs font-bold text-white truncate">
                        {item.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-slate-500">
                        {formattedDate}
                      </span>
                      {isAdminView && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setUserPrompt(item.comment);
                              showToast(`Topic copied to prompt: "${item.comment.slice(0, 30)}..."`);
                              window.scrollTo({ top: 300, behavior: 'smooth' });
                            }}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold flex items-center gap-1 transition"
                            title="Use as podcast topic prompt"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>Use as Topic</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(item.id)}
                            className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition"
                            title="Delete comment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed pl-9 border-l-2 border-pink-500/30 whitespace-pre-wrap">
                    {item.comment}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // SSE Stream Generation Pipeline
  const startStreamGeneration = async (promptText: string, isResume = false, langOverride?: 'en' | 'es') => {
    const langToUse = langOverride || (isResume && activeBuild?.language ? activeBuild.language : selectedLanguage);
    setIsGenerating(true);
    setGenerationError(null);
    setLiveStatusMessage(
      isResume
        ? (langToUse === 'es' ? 'Reanudando la generación del podcast...' : 'Resuming podcast generation...')
        : (langToUse === 'es' ? '🧠 Gemini está diseñando el guión del episodio (estructurando capítulos, artistas y canciones)...' : '🧠 Gemini is designing the episode syllabus (structuring chapters, artists & songs)...')
    );

    if (!isResume) {
      setLiveOutline(null);
      setLiveChapters([]);
      setCurrentDraft(null);
    } else if (activeBuild?.outline_json) {
      setLiveOutline(activeBuild.outline_json);
      setLiveChapters(activeBuild.chapters_json || []);
    }

    try {
      const res = await fetch('/api/lessons/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isResume ? 'resume' : 'generate',
          userPrompt: promptText,
          language: langToUse,
          password: adminPassword,
          stream: true
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Generation failed with status ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('No readable stream received from server');
      }

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
              const event: LessonStreamEvent = JSON.parse(trimmed.slice(6));

              if (event.type === 'status') {
                setLiveStatusMessage(event.message);
              } else if (event.type === 'outline') {
                setLiveOutline(event.data);
                setActiveBuild((prev) => ({
                  id: prev?.id || `draft-${Date.now()}`,
                  topic_prompt: promptText,
                  title: event.data.title,
                  language: event.data.language || langToUse,
                  outline_json: event.data,
                  chapters_json: prev?.chapters_json || [],
                  content: `# ${event.data.title}\n\n${event.data.intro}`,
                  status: 'in_progress',
                  updated_at: new Date().toISOString()
                }));
              } else if (event.type === 'chapter') {
                setLiveChapters((prev) => {
                  const filtered = prev.filter((c) => c.chapter_number !== event.chapter.chapter_number);
                  return [...filtered, event.chapter];
                });
                setActiveBuild((prev) => ({
                  id: prev?.id || `draft-${Date.now()}`,
                  topic_prompt: prev?.topic_prompt || promptText,
                  title: prev?.title || null,
                  language: prev?.language || langToUse,
                  outline_json: prev?.outline_json || null,
                  status: 'in_progress',
                  updated_at: new Date().toISOString(),
                  chapters_json: [
                    ...(prev?.chapters_json || []).filter((c) => c.chapter_number !== event.chapter.chapter_number),
                    event.chapter
                  ],
                  content: event.accumulatedContent
                }));
              } else if (event.type === 'complete') {
                setCurrentDraft({
                  title: event.lesson.title,
                  content: event.lesson.content,
                  topicPrompt: promptText,
                  language: event.lesson.language || langToUse,
                  isSaved: false
                });
                setActiveBuild((prev) => ({
                  id: prev?.id || `draft-${Date.now()}`,
                  topic_prompt: prev?.topic_prompt || promptText,
                  title: event.lesson.title,
                  language: event.lesson.language || langToUse,
                  outline_json: prev?.outline_json || null,
                  chapters_json: prev?.chapters_json || [],
                  content: event.lesson.content,
                  status: 'completed',
                  updated_at: new Date().toISOString()
                }));
                showToast(`Podcast episode complete! (${event.lesson.totalWords.toLocaleString()} words)`);
                setLiveStatusMessage(null);
              } else if (event.type === 'error') {
                throw new Error(event.error);
              }
            } catch (parseErr) {
              console.warn('Failed to parse SSE event:', parseErr, trimmed);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Generation error:', err);
      setGenerationError(err.message || 'An error occurred during podcast generation.');
    } finally {
      setIsGenerating(false);
      fetchActiveDraft();
    }
  };

  // Form submit handler with safeguard check
  const handleInitiateNewLesson = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userPrompt.trim()) return;

    if (!isAdmin || !adminPassword) {
      setIsAdminModalOpen(true);
      return;
    }

    // Safeguard: Check if an active build exists
    if (activeBuild && (activeBuild.outline_json || activeBuild.chapters_json?.length > 0)) {
      setPendingPromptToRun(userPrompt.trim());
      setShowDiscardModal(true);
      return;
    }

    startStreamGeneration(userPrompt.trim(), false);
  };

  // Confirm discard of active build & start fresh
  const handleConfirmDiscardAndStart = async () => {
    setShowDiscardModal(false);
    try {
      await fetch('/api/lessons/draft', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
    } catch (e) {
      console.warn('Could not delete draft on server:', e);
    }

    setActiveBuild(null);
    setCurrentDraft(null);
    setLiveOutline(null);
    setLiveChapters([]);

    if (pendingPromptToRun) {
      const promptToRun = pendingPromptToRun;
      setPendingPromptToRun(null);
      startStreamGeneration(promptToRun, false);
    }
  };

  // Resume active build
  const handleResumeActiveBuild = () => {
    if (!activeBuild) return;
    startStreamGeneration(activeBuild.topic_prompt, true, activeBuild.language);
  };

  // Refine lesson with Gemini
  const handleSuggestChanges = async (userSuggestion: string) => {
    if (!currentDraft) return;

    setIsRefiningDraft(true);
    try {
      const res = await fetch('/api/lessons/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refine',
          originalPrompt: currentDraft.topicPrompt,
          previousLesson: currentDraft.content,
          language: currentDraft.language || selectedLanguage,
          userSuggestion,
          password: adminPassword,
          stream: false
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to refine lesson.');
      }

      setCurrentDraft({
        ...currentDraft,
        title: data.title || currentDraft.title,
        content: data.content,
        isSaved: false
      });
      showToast('Lesson updated with your suggestions!');
    } catch (err: any) {
      console.error('Error refining lesson:', err);
      showToast(`Refinement failed: ${err.message}`);
    } finally {
      setIsRefiningDraft(false);
    }
  };

  // Save lesson to DB & clear active build draft
  const handleSaveLesson = async () => {
    if (!currentDraft) return;

    setIsSavingDraft(true);
    try {
      const res = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: currentDraft.title,
          topic_prompt: currentDraft.topicPrompt,
          content: currentDraft.content,
          language: currentDraft.language || selectedLanguage,
          password: adminPassword
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save lesson.');
      }

      // Clear active build draft since it is now permanently saved in the lessons table
      await fetch('/api/lessons/draft', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      }).catch(() => { });

      setActiveBuild(null);

      setCurrentDraft({
        ...currentDraft,
        id: data.lesson?.id || data.id,
        isSaved: true
      });

      showToast('Lesson saved successfully! It is now in Saved Lessons.');
      fetchLessons();
    } catch (err: any) {
      console.error('Error saving lesson:', err);
      showToast(`Save failed: ${err.message}`);
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Delete saved lesson from DB and clean up all audio files
  const handleDeleteLesson = async () => {
    if (!lessonToDelete) return;
    if (!isAdmin || !adminPassword) {
      setIsAdminModalOpen(true);
      return;
    }

    setIsDeletingLesson(true);
    try {
      const res = await fetch('/api/lessons', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: lessonToDelete.id,
          password: adminPassword
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete podcast.');
      }

      setSavedLessons((prev) => prev.filter((l) => l.id !== lessonToDelete.id));
      if (selectedLesson?.id === lessonToDelete.id) {
        setSelectedLesson(null);
      }
      showToast(`Podcast "${lessonToDelete.title}" and its audio files deleted.`);
      setLessonToDelete(null);
    } catch (err: any) {
      console.error('Delete error:', err);
      showToast(`Failed to delete podcast: ${err.message}`);
    } finally {
      setIsDeletingLesson(false);
    }
  };


  return (
    <main className="min-h-screen pb-20 bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-4 py-3.5">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          {/* Brand & Back Button */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition"
              title="Return to Concerts"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-pink-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-pink-500/20">
                <Radio className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
                  <span>Music Podcasts Studio</span>
                </h1>
                <p className="text-[10px] text-slate-400">Deep-dive music podcasts & history</p>
              </div>
            </div>
          </div>

          {/* Admin Status / Unlock */}
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <div className="flex items-center gap-2 bg-emerald-950/60 border border-emerald-800/80 px-3 py-1.5 rounded-xl text-xs text-emerald-300">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold hidden sm:inline">Admin Mode</span>
                <button
                  onClick={handleAdminLogout}
                  className="ml-1 text-slate-400 hover:text-white"
                  title="Lock Admin Mode"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsAdminModalOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Lock className="w-3.5 h-3.5 text-pink-400" />
                <span>Admin Unlock</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-4xl mx-auto px-4 pt-6 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex p-1 bg-slate-900/90 rounded-2xl border border-slate-800 max-w-md mx-auto shadow-inner">
          <button
            onClick={() => {
              setActiveTab('saved');
              setSelectedLesson(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition ${activeTab === 'saved'
              ? 'bg-gradient-to-r from-pink-600 to-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200'
              }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Saved Podcasts</span>
            <span className="px-1.5 py-0.2 rounded-full bg-black/40 text-[10px]">
              {savedLessons.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab('add');
              setSelectedLesson(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition ${activeTab === 'add'
              ? 'bg-gradient-to-r from-pink-600 to-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200'
              }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Create Podcast</span>
            {activeBuild && activeBuild.status !== 'completed' && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            )}
          </button>
        </div>

        {/* Tab 1: Saved Lessons */}
        {activeTab === 'saved' && (
          <div className="space-y-6">
            {selectedLesson ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setSelectedLesson(null)}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold flex items-center gap-1.5 border border-slate-800 transition"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Saved Lessons</span>
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setLessonToDelete(selectedLesson)}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-700/60 text-xs font-semibold flex items-center gap-1.5 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>Delete Podcast</span>
                    </button>
                  )}
                </div>

                <LessonPlayer
                  id={selectedLesson.id}
                  lessonId={selectedLesson.id}
                  title={selectedLesson.title}
                  content={selectedLesson.content}
                  topicPrompt={selectedLesson.topic_prompt}
                  language={selectedLesson.language}
                  readOnly
                  isAdmin={isAdmin}
                  adminPassword={adminPassword}
                  initialAudioSegments={selectedLesson.audio_segments}
                  initialAudioStatus={selectedLesson.audio_status}
                />
              </div>
            ) : (
              <div className="space-y-4">
                {loadingSaved ? (
                  <div className="py-16 text-center text-slate-500 text-xs animate-pulse">
                    Loading saved podcasts...
                  </div>
                ) : savedLessons.length === 0 ? (
                  <div className="py-16 text-center rounded-3xl bg-slate-900/40 border border-slate-800/80 p-8 space-y-3">
                    <Headphones className="w-10 h-10 text-slate-600 mx-auto" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-white">No Podcasts Saved Yet</p>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        No podcasts have been saved yet. Switch to "Create Podcast" to generate your first episode!
                      </p>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => setActiveTab('add')}
                        className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold text-xs inline-flex items-center gap-1.5 shadow-lg shadow-pink-600/30 transition"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Create First Podcast</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {savedLessons.map((lesson) => (
                      <div
                        key={lesson.id}
                        onClick={() => setSelectedLesson(lesson)}
                        className="group relative p-5 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-pink-500/40 transition-all duration-200 shadow-lg cursor-pointer space-y-3 flex flex-col justify-between"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-500" />
                              {new Date(lesson.created_at).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {lesson.language && (
                                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                                  {lesson.language === 'es' ? '🇪🇸 ES' : '🇬🇧 EN'}
                                </span>
                              )}
                            </div>
                          </div>

                          <h3 className="text-base font-bold text-white group-hover:text-pink-300 transition line-clamp-2">
                            {lesson.title}
                          </h3>

                          {lesson.topic_prompt && (
                            <div className="pt-0.5 space-y-1">
                              <span className="text-[11px] font-semibold text-slate-400 block">
                                Generated by asking this:
                              </span>
                              <p className="text-xs text-slate-300 italic leading-relaxed">
                                "{lesson.topic_prompt}"
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                          <span className="text-[11px] text-indigo-400 font-semibold flex items-center gap-1">
                            <Headphones className="w-3.5 h-3.5" />
                            Read & Listen
                          </span>

                          <div className="flex items-center gap-2">
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLessonToDelete(lesson);
                                }}
                                className="px-2.5 py-1 rounded-xl bg-slate-950/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-700/60 text-[11px] font-semibold flex items-center gap-1.5 transition z-10"
                                title="Delete podcast and speech audio files"
                              >
                                <Trash2 className="w-3 h-3 text-rose-400" />
                                <span>Delete</span>
                              </button>
                            )}
                            <span className="text-xs font-semibold text-slate-400 group-hover:translate-x-1 transition transform">
                              →
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Music Podcasts (Creation & In-Progress Draft) */}
        {activeTab === 'add' && (
          <div className="space-y-6">
            {!isAdmin ? (
              /* Non-admin Gate & Comment Form */
              <div className="space-y-6">
                <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/70 border border-slate-800/80 shadow-2xl space-y-6 backdrop-blur-xl">
                  {/* Notice & Text */}
                  <div className="text-center space-y-3 max-w-lg mx-auto">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500/20 to-indigo-500/20 border border-pink-500/30 text-pink-400 flex items-center justify-center mx-auto shadow-inner">
                      <Radio className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
                        Leave a comment about a podcast, or a petition for a new one!
                      </p>
                    </div>
                  </div>

                  {/* Comment Form */}
                  <form onSubmit={handleCommentSubmit} className="space-y-4 max-w-lg mx-auto">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Name
                      </label>
                      <input
                        type="text"
                        value={commenterName}
                        onChange={(e) => setCommenterName(e.target.value)}
                        placeholder="Your name"
                        required
                        disabled={isSubmittingComment}
                        className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500 transition shadow-inner"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-semibold text-slate-300">
                          Your Comment
                        </label>
                      </div>

                      <textarea
                        rows={3}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder='e.g. "Me encantaría un podcast sobre la historia de la música clásica, pero con cotilleos!" or "Me ha encantado el podcast del funk!"'
                        required
                        disabled={isSubmittingComment}
                        className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500 transition shadow-inner resize-none"
                      />

                      {/* Quick Ideas / Sugerencias */}
                      <div className="space-y-1.5 pt-2">
                        <span className="text-[11px] text-slate-400 font-medium block">
                          Quick ideas (click to use):
                        </span>
                        <div className="flex flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setCommentText(
                                'Me encantaría un podcast sobre la historia de la música clásica, pero con cotilleos!'
                              )
                            }
                            className="text-[11px] px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition text-left"
                          >
                            💡 "Me encantaría un podcast sobre la historia de la música clásica, pero con cotilleos!"
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setCommentText('Me ha encantado el podcast del funk!')
                            }
                            className="text-[11px] px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition text-left"
                          >
                            ❤️ "Me ha encantado el podcast del funk!"
                          </button>
                        </div>
                      </div>
                    </div>

                    {commentSuccessMessage && (
                      <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-xs flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>{commentSuccessMessage}</span>
                      </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={isSubmittingComment || !commenterName.trim() || !commentText.trim()}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-pink-600/30 transition transform active:scale-95 disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{isSubmittingComment ? 'Sending...' : 'Send Comment'}</span>
                      </button>
                    </div>
                  </form>
                </div>

                {/* Comments list at the bottom */}
                {renderCommentsList(false)}
              </div>
            ) : isGenerating ? (
              /* Live Real-Time Generation Dashboard */
              <div className="space-y-6">
                {/* 1. Live Animated Status Indicator */}
                <div className="p-5 rounded-3xl bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-950 border border-pink-500/50 shadow-2xl space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-pink-500/20 border border-pink-500/40 text-pink-400 flex items-center justify-center shrink-0">
                      <Sparkles className="w-5 h-5 animate-spin" />
                    </div>
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <span className="text-[10px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded bg-pink-500/20 text-pink-300">
                        Live Podcast Generation
                      </span>
                      <p className="text-xs sm:text-sm font-semibold text-white truncate">
                        {liveStatusMessage || 'Gemini is writing your deep-dive lesson...'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Episode Syllabus Card (as soon as Phase 1 lands) */}
                {liveOutline && (
                  <div className="p-6 rounded-3xl bg-slate-900/80 border border-indigo-500/40 shadow-xl space-y-4 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <span className="px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-bold flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                        Episode Roadmap Planned
                      </span>
                      <span className="text-xs text-slate-400 font-medium">
                        {liveOutline.chapters.length} Chapters Planned
                      </span>
                    </div>

                    <div>
                      <h2 className="text-xl sm:text-2xl font-extrabold text-white">
                        {liveOutline.title}
                      </h2>
                      <p className="text-xs text-slate-300 mt-1 italic">
                        {liveOutline.intro}
                      </p>
                    </div>

                    {/* Visual Chapter Checklist */}
                    <div className="space-y-2 pt-2 border-t border-slate-800">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Generation Progress:
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {liveOutline.chapters.map((ch, idx) => {
                          const isDone = liveChapters.some((c) => c.chapter_number === ch.chapter_number);
                          const isWritingNow = !isDone && liveChapters.length === idx;

                          return (
                            <div
                              key={ch.chapter_number}
                              className={`p-3 rounded-xl border text-xs transition ${isDone
                                ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200'
                                : isWritingNow
                                  ? 'bg-pink-950/40 border-pink-500/60 text-white shadow-lg animate-pulse'
                                  : 'bg-slate-950 border-slate-800/80 text-slate-400'
                                }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold flex items-center gap-1.5 truncate">
                                  {isDone ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  ) : isWritingNow ? (
                                    <Sparkles className="w-3.5 h-3.5 text-pink-400 animate-spin shrink-0" />
                                  ) : (
                                    <span className="w-3.5 h-3.5 rounded-full border border-slate-600 inline-block shrink-0" />
                                  )}
                                  <span className="truncate">Ch {ch.chapter_number}: {ch.title}</span>
                                </span>
                                {isDone && (
                                  <span className="text-[10px] text-emerald-400 font-semibold shrink-0">
                                    Done
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Progressive Chapters Feed (Rendered as they land) */}
                {liveChapters.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-pink-400" />
                      <span>Live Chapter Stream (You can start reading now):</span>
                    </h3>
                    <div className="space-y-4">
                      {liveChapters.map((ch) => (
                        <div
                          key={ch.chapter_number}
                          className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3 animate-fade-in"
                        >
                          <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800">
                            <span className="text-pink-400 font-bold">Chapter {ch.chapter_number}</span>
                            <span>{ch.wordCount.toLocaleString()} words</span>
                          </div>
                          <div className="prose prose-invert max-w-none text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                            {ch.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : currentDraft ? (
              /* Active Completed Draft Viewer with TTS & Suggest Changes */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      if (!currentDraft.isSaved && activeBuild) {
                        setShowDiscardModal(true);
                      } else {
                        setCurrentDraft(null);
                        setActiveBuild(null);
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold flex items-center gap-1.5 border border-slate-800 transition"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Create Another Lesson</span>
                  </button>

                  {currentDraft.isSaved && (
                    <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5 bg-emerald-950/60 border border-emerald-800/80 px-3 py-1.5 rounded-xl">
                      <CheckCircle2 className="w-4 h-4" />
                      Saved in DB
                    </span>
                  )}
                </div>

                <LessonPlayer
                  id={currentDraft.id}
                  lessonId={currentDraft.id}
                  title={currentDraft.title}
                  content={currentDraft.content}
                  topicPrompt={currentDraft.topicPrompt}
                  language={currentDraft.language || selectedLanguage}
                  onSave={handleSaveLesson}
                  isSaving={isSavingDraft}
                  isSaved={currentDraft.isSaved}
                  onSuggestChanges={handleSuggestChanges}
                  isRefining={isRefiningDraft}
                  isAdmin={isAdmin}
                  adminPassword={adminPassword}
                />
              </div>
            ) : activeBuild && activeBuild.status !== 'completed' && activeBuild.outline_json ? (
              /* Unfinished Podcast In-Progress Card (Restored from DB) */
              <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-indigo-950/70 via-slate-900 to-slate-950 border border-amber-500/40 shadow-2xl space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                      Unfinished Podcast in Progress
                    </span>
                    {activeBuild.language && (
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold">
                        {activeBuild.language === 'es' ? '🇪🇸 Español' : '🇬🇧 English'}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400">
                    {activeBuild.chapters_json?.length || 0} of {activeBuild.outline_json.chapters.length} chapters completed
                  </span>
                </div>

                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white">
                    {activeBuild.title || activeBuild.topic_prompt}
                  </h2>
                  <p className="text-xs text-slate-400 mt-1 italic">
                    Prompt: "{activeBuild.topic_prompt}"
                  </p>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-950 rounded-full h-2 border border-slate-800 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-pink-500 to-indigo-500 h-full transition-all duration-500"
                    style={{
                      width: `${Math.round(
                        ((activeBuild.chapters_json?.length || 0) /
                          Math.max(1, activeBuild.outline_json.chapters.length)) *
                        100
                      )}%`
                    }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleResumeActiveBuild}
                      className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-pink-600/30 transition transform active:scale-95"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Resume Building Podcast</span>
                    </button>

                    {activeBuild.content && (
                      <button
                        onClick={() => {
                          setCurrentDraft({
                            title: activeBuild.title || activeBuild.topic_prompt,
                            content: activeBuild.content,
                            topicPrompt: activeBuild.topic_prompt,
                            language: activeBuild.language || selectedLanguage,
                            isSaved: false
                          });
                        }}
                        className="px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition"
                      >
                        <Headphones className="w-4 h-4 text-pink-400" />
                        <span>Read / Listen to Progress</span>
                      </button>
                    )}
                  </div>

                  <button
                    onClick={() => setShowDiscardModal(true)}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-700/50 text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Discard Draft</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Add Lesson Prompt Form */}
                <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/70 border border-slate-800/80 shadow-2xl space-y-6 backdrop-blur-xl">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-pink-400" />
                    <h2 className="text-xl font-bold text-white tracking-tight">
                      Create Long-Form Music Podcast
                    </h2>
                  </div>
                </div>

                <form onSubmit={handleInitiateNewLesson} className="space-y-5">
                  {/* Language Selector */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      Podcast Language / Idioma del podcast
                    </label>
                    <div className="inline-flex p-1 bg-slate-950 border border-slate-800 rounded-2xl gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedLanguage('en')}
                        className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${selectedLanguage === 'en'
                            ? 'bg-gradient-to-r from-pink-600 to-indigo-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                          }`}
                      >
                        <span>🇬🇧</span>
                        <span>English</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedLanguage('es')}
                        className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${selectedLanguage === 'es'
                            ? 'bg-gradient-to-r from-pink-600 to-indigo-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                          }`}
                      >
                        <span>🇪🇸</span>
                        <span>Español</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-2">
                      {selectedLanguage === 'es'
                        ? '¿Sobre qué tema musical te gustaría aprender?'
                        : 'What would you like to learn about music?'}
                    </label>
                    <textarea
                      rows={4}
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                      placeholder={
                        selectedLanguage === 'es'
                          ? 'p.ej. Explícame el nacimiento y evolución del flamenco fusión en los años 70 y 80, desde Paco de Lucía y Camarón hasta Smash y Veneno...'
                          : 'e.g. Tell me about the origins of Bossa Nova in Rio de Janeiro, its connection to cool jazz, and the most influential artists...'
                      }
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500 transition shadow-inner resize-none"
                      disabled={isGenerating}
                      required
                    />
                  </div>

                  {/* Sample prompt chips */}
                  <div className="space-y-2">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      {selectedLanguage === 'es' ? '¿Necesitas inspiración? Elige un tema:' : 'Need Inspiration? Pick a Topic:'}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {(selectedLanguage === 'es' ? PROMPT_SUGGESTIONS_ES : PROMPT_SUGGESTIONS_EN).map((sug) => (
                        <button
                          key={sug}
                          type="button"
                          onClick={() => setUserPrompt(sug)}
                          disabled={isGenerating}
                          className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800/80 text-[11px] text-slate-300 border border-slate-800/80 transition text-left"
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  </div>

                  {generationError && (
                    <div className="p-3.5 rounded-2xl bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>{generationError}</span>
                    </div>
                  )}

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={isGenerating || !userPrompt.trim()}
                      className="px-6 py-3 rounded-2xl bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-pink-600/30 transition transform active:scale-95 disabled:opacity-50"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>{selectedLanguage === 'es' ? 'Generar episodio de podcast' : 'Generate Deep Podcast Episode'}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Comments list for Toni Admin at the bottom of the Create Tab */}
              {renderCommentsList(true)}
            </div>
          )}
          </div>
        )}
      </div>

      {/* Discard Active Build Safeguard Warning Modal */}
      {showDiscardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-amber-500/40 p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/30">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">Unfinished Podcast in Progress</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  You have a podcast currently being built:
                  <span className="block font-semibold text-white mt-1 italic">
                    "{activeBuild?.title || activeBuild?.topic_prompt}"
                  </span>
                  with {activeBuild?.chapters_json?.length || 0} of {activeBuild?.outline_json?.chapters.length || 6} chapters written.
                </p>
                <p className="text-xs text-amber-300/90 pt-1">
                  Starting a new podcast will permanently discard this unfinished work. Are you sure?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                onClick={() => {
                  setShowDiscardModal(false);
                  setPendingPromptToRun(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
              >
                Keep Current Draft
              </button>
              <button
                onClick={handleConfirmDiscardAndStart}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-600/30"
              >
                Discard & Start New
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Saved Podcast Confirmation Modal */}
      {lessonToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-rose-500/40 p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/30">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">Delete Podcast Episode</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Are you sure you want to permanently delete:
                  <span className="block font-semibold text-white mt-1 italic">
                    "{lessonToDelete.title}"
                  </span>
                </p>
                <p className="text-xs text-rose-300/90 pt-1">
                  This will remove the episode from the database and permanently delete all converted speech audio files associated with it.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={isDeletingLesson}
                onClick={() => setLessonToDelete(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingLesson}
                onClick={handleDeleteLesson}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-600/30 flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeletingLesson ? (
                  <span>Deleting...</span>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Yes, Delete Podcast</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Login Modal */}
      <AdminLoginModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        onSuccess={handleAdminAuthSuccess}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 px-4 py-3 rounded-2xl bg-slate-900 border border-pink-500/50 text-white text-xs font-semibold shadow-2xl flex items-center gap-2 animate-fade-in backdrop-blur-md">
          <Sparkles className="w-4 h-4 text-pink-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </main>
  );
}
