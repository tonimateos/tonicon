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
  Search,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { Lesson } from '@/lib/types';
import { LessonPlayer } from '@/components/LessonPlayer';
import { AdminLoginModal } from '@/components/AdminLoginModal';

const PROMPT_SUGGESTIONS = [
  'I want to learn about how the music changed in the western world in the 1960s, including folk, pop, rock, jazz, bossa, etc.',
  'The evolution of Brazilian Tropicália and MPB in the late 60s',
  'How Jamaican Dub and Sound System culture gave birth to modern remixing',
  'The golden era of Japanese City Pop and its western yacht-rock roots',
  'West African Afrobeat: Fela Kuti, Tony Allen, and polyrhythmic resistance',
  'Desert Blues from Mali: How Tuareg guitar music conquered global stages'
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
  const [searchQuery, setSearchQuery] = useState('');

  // Add Lesson generation state
  const [userPrompt, setUserPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Active generated lesson draft
  const [currentDraft, setCurrentDraft] = useState<{
    title: string;
    content: string;
    topicPrompt: string;
    isSaved: boolean;
  } | null>(null);

  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isRefiningDraft, setIsRefiningDraft] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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

  useEffect(() => {
    fetchLessons();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Generate new lesson with Gemini
  const handleGenerateLesson = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userPrompt.trim()) return;

    if (!isAdmin || !adminPassword) {
      setIsAdminModalOpen(true);
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);

    try {
      const res = await fetch('/api/lessons/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          userPrompt: userPrompt.trim(),
          password: adminPassword
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate lesson.');
      }

      setCurrentDraft({
        title: data.title || userPrompt.trim().slice(0, 60),
        content: data.content,
        topicPrompt: userPrompt.trim(),
        isSaved: false
      });
      showToast('Podcast lesson generated! Review and click Save when ready.');
    } catch (err: any) {
      console.error('Error generating lesson:', err);
      setGenerationError(err.message || 'An error occurred while calling the Gemini API.');
    } finally {
      setIsGenerating(false);
    }
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
          userSuggestion,
          password: adminPassword
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

  // Save lesson to DB
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
          password: adminPassword
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save lesson.');
      }

      setCurrentDraft({
        ...currentDraft,
        isSaved: true
      });

      showToast('Lesson saved successfully! It is now in Saved Lessons.');
      // Refresh list
      fetchLessons();
    } catch (err: any) {
      console.error('Error saving lesson:', err);
      showToast(`Save failed: ${err.message}`);
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Filter saved lessons
  const filteredLessons = savedLessons.filter((l) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return l.title.toLowerCase().includes(q) || l.topic_prompt.toLowerCase().includes(q);
  });

  return (
    <main className="min-h-screen pb-20 bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-4 py-3.5">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          {/* Brand & Back Button */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition shadow"
              title="Back to Concerts"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>

            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-pink-500/40 shadow-lg shadow-pink-500/20 shrink-0 bg-slate-900">
                <img src="/totoro.jpg" alt="Totoro" className="w-full h-full object-cover rounded-full" />
              </div>
              <div>
                <h1 className="font-extrabold text-base sm:text-lg text-white tracking-tight flex items-center gap-2">
                  <span>Tonicon</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30 font-semibold">
                    Lessons
                  </span>
                </h1>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  World music podcast lessons & interactive song listening
                </p>
              </div>
            </div>
          </div>

          {/* Admin Controls */}
          <div className="flex items-center gap-2">
            {!isAdmin ? (
              <button
                onClick={() => setIsAdminModalOpen(true)}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow"
                title="Unlock Admin Mode"
              >
                <Lock className="w-3.5 h-3.5 text-indigo-400" />
                <span>Unlock Admin</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-1 rounded-lg">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Admin Mode
                </span>
                <button
                  onClick={handleAdminLogout}
                  className="p-2 bg-slate-900 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 border border-slate-800 rounded-xl transition"
                  title="Logout Admin"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-4xl mx-auto px-4 pt-6 space-y-6">
        {/* Navigation Tabs (Saved Lessons vs Add Lesson) */}
        <div className="flex items-center gap-3 border-b border-slate-800/90 pb-3">
          <button
            onClick={() => {
              setActiveTab('saved');
              setSelectedLesson(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition ${
              activeTab === 'saved'
                ? 'bg-gradient-to-r from-pink-600 to-indigo-600 text-white shadow-lg shadow-pink-600/20'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Saved Lessons</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full bg-slate-950/60 text-[10px] text-white">
              {savedLessons.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab('add');
              setSelectedLesson(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition ${
              activeTab === 'add'
                ? 'bg-gradient-to-r from-pink-600 to-indigo-600 text-white shadow-lg shadow-pink-600/20'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Music Podcasts</span>
            {!isAdmin && <Lock className="w-3 h-3 text-slate-500 ml-0.5" />}
          </button>
        </div>

        {/* Tab 1: Saved Lessons */}
        {activeTab === 'saved' && (
          <div>
            {selectedLesson ? (
              <div className="space-y-4">
                <button
                  onClick={() => setSelectedLesson(null)}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold flex items-center gap-1.5 border border-slate-800 transition mb-2"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to all Saved Lessons</span>
                </button>

                <LessonPlayer
                  title={selectedLesson.title}
                  content={selectedLesson.content}
                  topicPrompt={selectedLesson.topic_prompt}
                  readOnly={true}
                />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search saved music lessons..."
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-2xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500 transition shadow-inner"
                  />
                </div>

                {loadingSaved ? (
                  <div className="py-16 text-center text-slate-500 text-sm">
                    <Radio className="w-6 h-6 animate-pulse mx-auto mb-2 text-pink-400" />
                    Loading saved music lessons...
                  </div>
                ) : filteredLessons.length === 0 ? (
                  <div className="py-16 text-center rounded-3xl bg-slate-900/40 border border-slate-800/80 p-8 space-y-4">
                    <div className="w-14 h-14 rounded-2xl bg-pink-500/10 border border-pink-500/20 text-pink-400 flex items-center justify-center mx-auto">
                      <Headphones className="w-7 h-7" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-base font-bold text-white">No lessons found</h3>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        {searchQuery
                          ? 'No lessons matched your search query.'
                          : 'No lessons have been saved yet. Switch to "Add Lesson" to generate your first music lesson!'}
                      </p>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => setActiveTab('add')}
                        className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold text-xs inline-flex items-center gap-1.5 shadow-lg shadow-pink-600/30 transition"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Create First Lesson</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredLessons.map((lesson) => (
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
                            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                              Podcast
                            </span>
                          </div>

                          <h3 className="text-base font-bold text-white group-hover:text-pink-300 transition line-clamp-2">
                            {lesson.title}
                          </h3>

                          {lesson.topic_prompt && (
                            <p className="text-xs text-slate-400 line-clamp-2 italic">
                              "{lesson.topic_prompt}"
                            </p>
                          )}
                        </div>

                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                          <span className="text-[11px] text-indigo-400 font-semibold flex items-center gap-1">
                            <Headphones className="w-3.5 h-3.5" />
                            Read & Listen
                          </span>
                          <span className="text-xs font-semibold text-slate-400 group-hover:translate-x-1 transition transform">
                            →
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Add Lesson */}
        {activeTab === 'add' && (
          <div className="space-y-6">
            {!isAdmin ? (
              /* Non-admin Gate Screen */
              <div className="py-16 px-6 text-center rounded-3xl bg-slate-900/60 border border-slate-800 shadow-xl space-y-5">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center mx-auto shadow-inner">
                  <Lock className="w-7 h-7" />
                </div>
                <div className="space-y-1.5 max-w-md mx-auto">
                  <h2 className="text-lg font-bold text-white">Admin Privileges Required</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    You need to be Toni (Admin) to generate and save new music lessons. You can still browse and listen to all existing lessons in the Saved Lessons tab.
                  </p>
                </div>
                <button
                  onClick={() => setIsAdminModalOpen(true)}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 inline-flex items-center gap-2 transition transform active:scale-95"
                >
                  <Lock className="w-4 h-4" />
                  <span>Unlock Admin Mode</span>
                </button>
              </div>
            ) : currentDraft ? (
              /* Active Draft Viewer with TTS & Suggest Changes */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setCurrentDraft(null)}
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
                  title={currentDraft.title}
                  content={currentDraft.content}
                  topicPrompt={currentDraft.topicPrompt}
                  onSave={handleSaveLesson}
                  isSaving={isSavingDraft}
                  isSaved={currentDraft.isSaved}
                  onSuggestChanges={handleSuggestChanges}
                  isRefining={isRefiningDraft}
                  isAdmin={isAdmin}
                />
              </div>
            ) : (
              /* Add Lesson Prompt Form */
              <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/70 border border-slate-800/80 shadow-2xl space-y-6 backdrop-blur-xl">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-pink-400" />
                    <h2 className="text-xl font-bold text-white tracking-tight">
                      Create a New Music Lesson
                    </h2>
                  </div>
                  <p className="text-xs text-slate-400">
                    Describe what you'd like to learn about music. Gemini will act as a world music expert and generate a podcast-style lesson with in-page playable YouTube tracks.
                  </p>
                </div>

                <form onSubmit={handleGenerateLesson} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-2">
                      What would you like to learn about music?
                    </label>
                    <textarea
                      rows={4}
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                      placeholder="e.g. Tell me about the origins of Bossa Nova in Rio de Janeiro, its connection to cool jazz, and the most influential artists..."
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500 transition shadow-inner resize-none"
                      disabled={isGenerating}
                      required
                    />
                  </div>

                  {/* Sample prompt chips */}
                  <div className="space-y-2">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Need Inspiration? Pick a Topic:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {PROMPT_SUGGESTIONS.map((sug) => (
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
                      {isGenerating ? (
                        <>
                          <Sparkles className="w-4 h-4 animate-spin" />
                          <span>Generating Podcast Lesson with Gemini...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <span>Send</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>

                {/* Animated Loading State while generating */}
                {isGenerating && (
                  <div className="p-6 rounded-2xl bg-slate-950 border border-pink-500/30 shadow-inner text-center space-y-3 animate-pulse">
                    <Radio className="w-8 h-8 text-pink-400 mx-auto animate-bounce" />
                    <p className="text-sm font-semibold text-white">
                      Synthesizing World Music Knowledge...
                    </p>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      Gemini is structuring your podcast episode, researching historical context, and embedding in-page playable YouTube tracks. This takes around 10-15 seconds.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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
