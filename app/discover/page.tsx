'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Compass,
  Search,
  MapPin,
  Calendar,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Globe,
  Settings,
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  RefreshCw,
  Archive,
  MessageSquare,
  Code,
  FileText,
  Eye,
  Clock,
  Eraser,
  FileX
} from 'lucide-react';
import { DiscoverEvent, DiscoverPreferences, DiscoverUrl } from '@/lib/types';

export default function DiscoverPage() {
  const [activeTab, setActiveTab] = useState<'candidates' | 'interested' | 'sources' | 'preferences'>('candidates');

  // Data states
  const [candidates, setCandidates] = useState<DiscoverEvent[]>([]);
  const [interestedEvents, setInterestedEvents] = useState<DiscoverEvent[]>([]);
  const [urls, setUrls] = useState<DiscoverUrl[]>([]);
  const [preferencesText, setPreferencesText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  // Scrape state
  const [isScraping, setIsScraping] = useState<boolean>(false);
  const [scrapingUrlId, setScrapingUrlId] = useState<string | null>(null);
  const [scrapeResultMsg, setScrapeResultMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Raw extracted JSON debug modal state
  const [rawDebugModalState, setRawDebugModalState] = useState<{
    isOpen: boolean;
    sourceUrl: DiscoverUrl | null;
    rawEvents: Record<string, unknown>[];
    currentScrapingUrl: string | null;
    statusMessage: string | null;
    skippedCount: number;
    isExtracting: boolean;
    isEvaluating: boolean;
    jsonType: 'new' | 'past' | 'live';
  }>({
    isOpen: false,
    sourceUrl: null,
    rawEvents: [],
    currentScrapingUrl: null,
    statusMessage: null,
    skippedCount: 0,
    isExtracting: false,
    isEvaluating: false,
    jsonType: 'live'
  });

  // Sub-tab for interested events
  const [interestedSubTab, setInterestedSubTab] = useState<'upcoming' | 'past'>('upcoming');

  // Sources form state
  const [newUrl, setNewUrl] = useState<string>('');
  const [newUrlName, setNewUrlName] = useState<string>('');
  const [addingUrl, setAddingUrl] = useState<boolean>(false);

  // Preferences save state
  const [savingPrefs, setSavingPrefs] = useState<boolean>(false);
  const [prefsSavedMsg, setPrefsSavedMsg] = useState<boolean>(false);

  // Reject reason inline state (map eventId -> reason text)
  const [rejectingEventId, setRejectingEventId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [processingRejection, setProcessingRejection] = useState<boolean>(false);

  // AI Rule Confirmation Modal state
  const [confirmedRuleModal, setConfirmedRuleModal] = useState<{
    isOpen: boolean;
    rule: string;
    eventName: string;
  }>({
    isOpen: false,
    rule: '',
    eventName: ''
  });

  // Load all initial data
  const loadData = async () => {
    setLoading(true);
    try {
      const [candidatesRes, interestedRes, urlsRes, prefsRes] = await Promise.all([
        fetch('/api/discover/events?status=candidate'),
        fetch('/api/discover/events?status=interested'),
        fetch('/api/discover/urls'),
        fetch('/api/discover/preferences')
      ]);

      const [candidatesData, interestedData, urlsData, prefsData] = await Promise.all([
        candidatesRes.json(),
        interestedRes.json(),
        urlsRes.json(),
        prefsRes.json()
      ]);

      if (candidatesData.events) setCandidates(candidatesData.events);
      if (interestedData.events) setInterestedEvents(interestedData.events);
      if (urlsData.urls) setUrls(urlsData.urls);
      if (prefsData.preferences) setPreferencesText(prefsData.preferences.content || '');
    } catch (err) {
      console.error('Error loading discover data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle On-Demand Scraping (All Sources)
  const handleRunScrape = async () => {
    setIsScraping(true);
    setScrapeResultMsg(null);
    try {
      const res = await fetch('/api/discover/scrape', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setScrapeResultMsg({ type: 'error', text: data.error || 'Discovery failed' });
      } else {
        const addedCount = data.added || 0;
        const errs = data.errors || [];

        if (errs.length > 0 && addedCount === 0) {
          setScrapeResultMsg({ type: 'error', text: errs.join('; ') });
        } else {
          setScrapeResultMsg({
            type: 'success',
            text: `Discovery complete! Discovered ${addedCount} new potential event match${addedCount === 1 ? '' : 'es'}.`
          });
          // Refresh candidates list & urls list
          const [candRes, urlsRes] = await Promise.all([
            fetch('/api/discover/events?status=candidate'),
            fetch('/api/discover/urls')
          ]);
          const candData = await candRes.json();
          const urlsData = await urlsRes.json();
          if (candData.events) setCandidates(candData.events);
          if (urlsData.urls) setUrls(urlsData.urls);
        }
      }
    } catch (err) {
      setScrapeResultMsg({ type: 'error', text: 'Failed to run on-demand discovery.' });
    } finally {
      setIsScraping(false);
    }
  };

  // Step 1: Handle On-Demand Scraping for a Single Source URL (Extract Raw Events)
  const handleRunScrapeForSource = async (source: DiscoverUrl) => {
    setScrapingUrlId(source.id);
    setScrapeResultMsg(null);

    // Open modal immediately displaying live scraping state
    setRawDebugModalState({
      isOpen: true,
      sourceUrl: source,
      rawEvents: Array.isArray(source.new_extracted_json) ? source.new_extracted_json : [],
      currentScrapingUrl: source.url,
      statusMessage: `Connecting to ${source.url}...`,
      skippedCount: 0,
      isExtracting: true,
      isEvaluating: false,
      jsonType: 'live'
    });

    try {
      const res = await fetch('/api/discover/extract-raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url_id: source.id })
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setScrapeResultMsg({
          type: 'error',
          text: data.error || `Scraping failed for ${source.name || source.url}`
        });
        setRawDebugModalState({
          isOpen: false,
          sourceUrl: null,
          rawEvents: [],
          currentScrapingUrl: null,
          statusMessage: null,
          skippedCount: 0,
          isExtracting: false,
          isEvaluating: false,
          jsonType: 'live'
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const msg = JSON.parse(jsonStr);

            if (msg.type === 'status') {
              setRawDebugModalState((prev) => ({
                ...prev,
                currentScrapingUrl: msg.url || prev.currentScrapingUrl,
                statusMessage: msg.message || prev.statusMessage,
                skippedCount: typeof msg.skippedCount === 'number' ? msg.skippedCount : prev.skippedCount
              }));
            } else if (msg.type === 'event' && msg.event) {
              setRawDebugModalState((prev) => {
                const existingIndex = prev.rawEvents.findIndex(
                  (e) =>
                    (e.event_sublink_url && e.event_sublink_url === msg.event.event_sublink_url) ||
                    (e.event_name && e.event_name === msg.event.event_name)
                );
                const updatedList = [...prev.rawEvents];
                if (existingIndex >= 0) {
                  updatedList[existingIndex] = msg.event;
                } else {
                  updatedList.push(msg.event);
                }
                return {
                  ...prev,
                  currentScrapingUrl: msg.url || prev.currentScrapingUrl,
                  statusMessage: msg.message || prev.statusMessage,
                  skippedCount: typeof msg.skippedCount === 'number' ? msg.skippedCount : prev.skippedCount,
                  rawEvents: updatedList
                };
              });
            } else if (msg.type === 'complete') {
              const events = msg.raw_events || [];
              if (msg.url) {
                setUrls((prev) => prev.map((u) => (u.id === msg.url.id ? msg.url : u)));
              }
              if (events.length === 0) {
                setScrapeResultMsg({
                  type: 'success',
                  text: `Scraping complete for ${source.name || source.url}! No new events found (all extracted events were already in Past JSON).`
                });
              } else {
                setScrapeResultMsg({
                  type: 'success',
                  text: `Scraping complete for ${source.name || source.url}! Discovered ${events.length} new event item${events.length === 1 ? '' : 's'}.`
                });
              }
              setRawDebugModalState((prev) => ({
                ...prev,
                isOpen: true,
                sourceUrl: msg.url || source,
                rawEvents: events,
                currentScrapingUrl: null,
                statusMessage: null,
                isExtracting: false,
                isEvaluating: false,
                jsonType: 'new'
              }));
            } else if (msg.type === 'error') {
              setScrapeResultMsg({
                type: 'error',
                text: msg.message || 'Scraping failed.'
              });
              setRawDebugModalState((prev) => ({ ...prev, isExtracting: false }));
            }
          } catch (e) {
            console.error('Error parsing SSE event:', jsonStr, e);
          }
        }
      }
    } catch (err) {
      setScrapeResultMsg({
        type: 'error',
        text: `Failed to scrape source ${source.name || source.url}.`
      });
      setRawDebugModalState({
        isOpen: false,
        sourceUrl: null,
        rawEvents: [],
        currentScrapingUrl: null,
        statusMessage: null,
        skippedCount: 0,
        isExtracting: false,
        isEvaluating: false,
        jsonType: 'live'
      });
    } finally {
      setScrapingUrlId(null);
    }
  };

  // View Newly Extracted Raw JSON for a Source URL
  const handleViewNewJson = (source: DiscoverUrl) => {
    setRawDebugModalState({
      isOpen: true,
      sourceUrl: source,
      rawEvents: Array.isArray(source.new_extracted_json) ? source.new_extracted_json : [],
      currentScrapingUrl: null,
      statusMessage: null,
      skippedCount: 0,
      isExtracting: false,
      isEvaluating: false,
      jsonType: 'new'
    });
  };

  // View Past Extracted Raw JSON for a Source URL
  const handleViewPastJson = (source: DiscoverUrl) => {
    setRawDebugModalState({
      isOpen: true,
      sourceUrl: source,
      rawEvents: Array.isArray(source.last_extracted_json) ? source.last_extracted_json : [],
      currentScrapingUrl: null,
      statusMessage: null,
      skippedCount: 0,
      isExtracting: false,
      isEvaluating: false,
      jsonType: 'past'
    });
  };

  // Clear Stored New Raw JSON for a Source URL
  const handleClearNewJson = async (sourceId: string) => {
    try {
      const res = await fetch('/api/discover/urls', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sourceId, action: 'clear_new_json' })
      });
      const data = await res.json();
      if (res.ok && data.url) {
        setUrls((prev) => prev.map((u) => (u.id === sourceId ? data.url : u)));
        setRawDebugModalState((prev) => {
          if (prev.sourceUrl?.id === sourceId && prev.jsonType === 'new') {
            return { ...prev, sourceUrl: data.url, rawEvents: [] };
          }
          return prev;
        });
      }
    } catch (err) {
      console.error('Error clearing new JSON:', err);
    }
  };

  // Clear Stored Past Raw JSON for a Source URL
  const handleClearPastJson = async (sourceId: string) => {
    try {
      const res = await fetch('/api/discover/urls', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sourceId, action: 'clear_past_json' })
      });
      const data = await res.json();
      if (res.ok && data.url) {
        setUrls((prev) => prev.map((u) => (u.id === sourceId ? data.url : u)));
        setRawDebugModalState((prev) => {
          if (prev.sourceUrl?.id === sourceId && prev.jsonType === 'past') {
            return { ...prev, sourceUrl: data.url, rawEvents: [] };
          }
          return prev;
        });
      }
    } catch (err) {
      console.error('Error clearing past JSON:', err);
    }
  };

  // Send New Raw JSON Events to LLM for Match Filtering & Merge into Past JSON
  const handleSendNewToLLM = async (source: DiscoverUrl) => {
    const eventsToSend = Array.isArray(source.new_extracted_json) ? source.new_extracted_json : [];
    if (eventsToSend.length === 0) return;

    setScrapingUrlId(source.id);
    setScrapeResultMsg(null);
    try {
      const res = await fetch('/api/discover/evaluate-matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url_id: source.id,
          source_url: source.url,
          raw_events: eventsToSend
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setScrapeResultMsg({
          type: 'error',
          text: data.error || 'Failed to evaluate matches with LLM'
        });
      } else {
        const addedCount = data.added || 0;
        if (data.url) {
          setUrls((prev) => prev.map((u) => (u.id === source.id ? data.url : u)));
        }
        setScrapeResultMsg({
          type: 'success',
          text: `Match evaluation complete for "${source.name || source.url}"! Discovered ${addedCount} candidate match${addedCount === 1 ? '' : 'es'}. New JSON content merged into Past JSON.`
        });
        // Refresh candidates list and switch to Candidates tab
        const candRes = await fetch('/api/discover/events?status=candidate');
        const candData = await candRes.json();
        if (candData.events) setCandidates(candData.events);
        setActiveTab('candidates');
      }
    } catch (err) {
      setScrapeResultMsg({ type: 'error', text: 'Error sending new JSON to LLM for match filtering.' });
    } finally {
      setScrapingUrlId(null);
    }
  };

  // Mark event as Interested ("Yes")
  const handleMarkInterested = async (event: DiscoverEvent) => {
    try {
      const res = await fetch('/api/discover/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: event.id, status: 'interested' })
      });

      if (res.ok) {
        // Move from candidates to interestedEvents
        setCandidates((prev) => prev.filter((e) => e.id !== event.id));
        setInterestedEvents((prev) => [{ ...event, status: 'interested' }, ...prev]);
      }
    } catch (err) {
      console.error('Error marking event as interested:', err);
    }
  };

  // Open inline rejection box
  const handleStartRejection = (eventId: string) => {
    setRejectingEventId(eventId);
    setRejectionReason('');
  };

  // Skip reason -> Just reject event directly
  const handleSkipRejection = async (eventId: string) => {
    try {
      const res = await fetch('/api/discover/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: eventId, status: 'rejected' })
      });

      if (res.ok) {
        setCandidates((prev) => prev.filter((e) => e.id !== eventId));
        setRejectingEventId(null);
      }
    } catch (err) {
      console.error('Error rejecting event:', err);
    }
  };

  // Submit rejection reason -> Generate Gemini rule & append to preferences
  const handleSubmitRejectionReason = async (event: DiscoverEvent) => {
    if (!rejectionReason.trim()) {
      handleSkipRejection(event.id);
      return;
    }

    setProcessingRejection(true);
    try {
      // Send event + reason to Gemini to generate & auto-append rule to preferences
      const refineRes = await fetch('/api/discover/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: event.event_name,
          venue_name: event.venue_name,
          date: event.date,
          rejection_reason: rejectionReason,
          auto_append: true
        })
      });

      const refineData = await refineRes.json();

      // Update event status to rejected
      await fetch('/api/discover/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: event.id,
          status: 'rejected',
          rejection_reason: rejectionReason
        })
      });

      // Remove card from candidates list
      setCandidates((prev) => prev.filter((e) => e.id !== event.id));
      setRejectingEventId(null);

      // If preferences were returned, update preferencesText state
      if (refineData.preferences?.content) {
        setPreferencesText(refineData.preferences.content);
      }

      // Open confirmation modal displaying generated rule
      if (refineData.rule) {
        setConfirmedRuleModal({
          isOpen: true,
          rule: refineData.rule,
          eventName: event.event_name
        });
      }
    } catch (err) {
      console.error('Error refining preferences:', err);
    } finally {
      setProcessingRejection(false);
    }
  };

  // Add Source URL
  const handleAddSourceUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;

    setAddingUrl(true);
    try {
      const res = await fetch('/api/discover/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl, name: newUrlName })
      });

      const data = await res.json();
      if (res.ok && data.url) {
        setUrls((prev) => [data.url, ...prev]);
        setNewUrl('');
        setNewUrlName('');
      }
    } catch (err) {
      console.error('Error adding source URL:', err);
    } finally {
      setAddingUrl(false);
    }
  };

  // Delete Source URL
  const handleDeleteSourceUrl = async (id: string) => {
    try {
      const res = await fetch(`/api/discover/urls?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setUrls((prev) => prev.filter((u) => u.id !== id));
      }
    } catch (err) {
      console.error('Error deleting source URL:', err);
    }
  };

  // Save Preferences Text
  const handleSavePreferences = async () => {
    setSavingPrefs(true);
    setPrefsSavedMsg(false);
    try {
      const res = await fetch('/api/discover/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: preferencesText })
      });

      if (res.ok) {
        setPrefsSavedMsg(true);
        setTimeout(() => setPrefsSavedMsg(false), 3000);
      }
    } catch (err) {
      console.error('Error saving preferences:', err);
    } finally {
      setSavingPrefs(false);
    }
  };

  // Helper for Google Maps query link
  const getGoogleMapsUrl = (venueName?: string | null) => {
    if (!venueName) return '#';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueName)}`;
  };

  // Format dates
  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return 'Date TBD';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const now = new Date();

  // Interested upcoming vs past
  const upcomingInterested = interestedEvents
    .filter((e) => !e.date || new Date(e.date) >= now)
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

  const pastInterested = interestedEvents
    .filter((e) => e.date && new Date(e.date) < now)
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  return (
    <main className="min-h-screen pb-16">

      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">

          {/* Title & Back Link */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 rounded-xl transition"
              title="Back to Concerts"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="font-extrabold text-lg sm:text-xl text-white tracking-tight font-display flex items-center gap-2">
                <Compass className="w-5 h-5 text-indigo-400" />
                <span>Event Discovery</span>
              </h1>
              <p className="text-xs text-slate-400">Scrape, evaluate, and discover new cultural events with Gemini</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-4xl mx-auto px-4 pt-6 space-y-6">

        {/* Scrape Result Notification Banner */}
        {scrapeResultMsg && (
          <div
            className={`p-4 rounded-xl border flex items-center justify-between text-xs transition-all ${
              scrapeResultMsg.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {scrapeResultMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{scrapeResultMsg.text}</span>
            </div>
            <button
              onClick={() => setScrapeResultMsg(null)}
              className="text-slate-400 hover:text-white text-xs px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3 overflow-x-auto">
          <button
            id="tab-discover"
            onClick={() => setActiveTab('candidates')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              activeTab === 'candidates'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Discover Candidates</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                activeTab === 'candidates' ? 'bg-indigo-700 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {candidates.length}
            </span>
          </button>

          <button
            id="tab-interested"
            onClick={() => setActiveTab('interested')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              activeTab === 'interested'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <ThumbsUp className="w-3.5 h-3.5" />
            <span>Interested Events</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                activeTab === 'interested' ? 'bg-indigo-700 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {interestedEvents.length}
            </span>
          </button>

          <button
            id="tab-sources"
            onClick={() => setActiveTab('sources')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              activeTab === 'sources'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Sources ({urls.length})</span>
          </button>

          <button
            id="tab-preferences"
            onClick={() => setActiveTab('preferences')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              activeTab === 'preferences'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Preferences</span>
          </button>
        </div>

        {/* Tab 1: Discover Candidates */}
        {activeTab === 'candidates' && (
          <div className="space-y-4">
            {loading ? (
              <div className="flex flex-col gap-4">
                {[1, 2].map((i) => (
                  <div key={i} className="h-40 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse p-6" />
                ))}
              </div>
            ) : candidates.length > 0 ? (
              <div className="flex flex-col gap-4">
                {candidates.map((event) => (
                  <div
                    key={event.id}
                    className="p-5 bg-slate-900/90 border border-slate-800/90 hover:border-slate-700/90 rounded-2xl shadow-xl transition-all space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1.5">
                        <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                          {event.event_name}
                        </h3>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                          {/* Venue Location (Google Maps) */}
                          {event.venue_name && (
                            <a
                              href={getGoogleMapsUrl(event.venue_name)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition"
                            >
                              <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                              <span>{event.venue_name}</span>
                              <ExternalLink className="w-3 h-3 opacity-60" />
                            </a>
                          )}

                          {/* Date */}
                          <div className="inline-flex items-center gap-1 text-slate-400">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span>{formatDate(event.date)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Link to Event */}
                      {event.url && (
                        <a
                          href={event.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 inline-flex items-center gap-1.5 transition shrink-0 self-start"
                        >
                          <span>Event Link</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    {/* Match Reason Banner */}
                    {event.match_reason && (
                      <div className="p-3 bg-indigo-950/40 border border-indigo-800/60 rounded-xl flex items-start gap-2.5 text-xs">
                        <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-indigo-200">Why it matches: </span>
                          <span className="text-slate-300 leading-relaxed">{event.match_reason}</span>
                        </div>
                      </div>
                    )}

                    {/* Decision Action Bar (Yes / No / No + Reason) */}
                    <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <span className="text-[11px] text-slate-400">Are you interested in this event?</span>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Yes Button */}
                        <button
                          type="button"
                          onClick={() => handleMarkInterested(event)}
                          className="px-3.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 hover:text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                          title="Save to Interested Events"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>Yes</span>
                        </button>

                        {/* Direct No Button (No questions asked) */}
                        <button
                          type="button"
                          onClick={() => handleSkipRejection(event.id)}
                          className="px-3.5 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 hover:text-rose-300 border border-rose-500/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                          title="Reject event directly (no feedback comments)"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>No</span>
                        </button>

                        {/* No + Reason Button (Refine AI preferences) */}
                        <button
                          type="button"
                          onClick={() => handleStartRejection(event.id)}
                          className="px-3.5 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 hover:text-amber-300 border border-amber-500/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                          title="Reject event and specify reason to refine Gemini preferences"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>No + Reason</span>
                        </button>
                      </div>
                    </div>

                    {/* Inline Rejection Reason Field */}
                    {rejectingEventId === event.id && (
                      <div className="mt-3 p-4 bg-slate-950/80 border border-rose-800/40 rounded-xl space-y-3 animate-fade-in">
                        <label className="block text-xs font-medium text-slate-300">
                          Why are you not interested? (Optional)
                        </label>
                        <input
                          type="text"
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          placeholder="e.g. Too expensive, don't like venue, wrong music genre..."
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                        />
                        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setRejectingEventId(null)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs rounded-lg transition"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSkipRejection(event.id)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs rounded-lg transition"
                          >
                            Skip (Just Reject)
                          </button>
                          <button
                            type="button"
                            disabled={processingRejection}
                            onClick={() => handleSubmitRejectionReason(event)}
                            className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow transition"
                          >
                            {processingRejection ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                            <span>Confirm & Refine Preferences</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
                <Sparkles className="w-10 h-10 text-indigo-400 mx-auto mb-3 opacity-60" />
                <h3 className="text-base font-semibold text-white">No candidate events right now</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Click <strong>"Scrape & Discover"</strong> above to extract potential event matches from your saved source URLs!
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Interested Events */}
        {activeTab === 'interested' && (
          <div className="space-y-4">

            {/* Sub-tab toggle: Upcoming vs Past */}
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2">
              <button
                onClick={() => setInterestedSubTab('upcoming')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                  interestedSubTab === 'upcoming'
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Upcoming ({upcomingInterested.length})</span>
              </button>

              <button
                onClick={() => setInterestedSubTab('past')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                  interestedSubTab === 'past'
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Past ({pastInterested.length})</span>
              </button>
            </div>

            {/* List of Interested Events */}
            {interestedSubTab === 'upcoming' ? (
              upcomingInterested.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {upcomingInterested.map((event) => (
                    <div
                      key={event.id}
                      className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-white">{event.event_name}</h4>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                          {event.venue_name && (
                            <a
                              href={getGoogleMapsUrl(event.venue_name)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-indigo-400 hover:underline"
                            >
                              <MapPin className="w-3 h-3" />
                              <span>{event.venue_name}</span>
                            </a>
                          )}
                          <span>{formatDate(event.date)}</span>
                        </div>
                      </div>

                      {event.url && (
                        <a
                          href={event.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg inline-flex items-center gap-1 self-start sm:self-center"
                        >
                          <span>Event Link</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center bg-slate-900/30 border border-slate-800 rounded-xl p-6 text-slate-400 text-xs">
                  No upcoming interested events yet. Mark candidate events with "Yes" to save them here!
                </div>
              )
            ) : pastInterested.length > 0 ? (
              <div className="flex flex-col gap-4">
                {pastInterested.map((event) => (
                  <div
                    key={event.id}
                    className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 opacity-80"
                  >
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-slate-300">{event.event_name}</h4>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                        {event.venue_name && <span>{event.venue_name}</span>}
                        <span>{formatDate(event.date)}</span>
                      </div>
                    </div>
                    {event.url && (
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs rounded-lg inline-flex items-center gap-1"
                      >
                        <span>Link</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center bg-slate-900/30 border border-slate-800 rounded-xl p-6 text-slate-400 text-xs">
                No past interested events recorded.
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Sources (Manage URLs) */}
        {activeTab === 'sources' && (
          <div className="space-y-6">

            {/* Add New Source Form */}
            <form onSubmit={handleAddSourceUrl} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-indigo-400" />
                <span>Add New Event Source URL</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="url"
                  required
                  placeholder="https://example.com/events"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <input
                  type="text"
                  placeholder="Source Name / Description (Optional)"
                  value={newUrlName}
                  onChange={(e) => setNewUrlName(e.target.value)}
                  className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={addingUrl}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow flex items-center gap-1.5 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{addingUrl ? 'Adding...' : 'Add Source'}</span>
                </button>
              </div>
            </form>

            {/* Source URLs List */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Configured Source URLs</h3>

              {urls.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {urls.map((u) => (
                    <div
                      key={u.id}
                      className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl space-y-3 shadow-sm"
                    >
                      {/* Top Header: Source Info + Delete Button */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0 flex-1">
                          {u.name && <p className="text-sm font-bold text-white truncate">{u.name}</p>}
                          <a
                            href={u.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-indigo-400 hover:underline truncate inline-flex items-center gap-1.5 max-w-full"
                          >
                            <Globe className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate font-mono">{u.url}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                          </a>
                          {u.last_scraped_at && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 pt-0.5">
                              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>Last scraped: {new Date(u.last_scraped_at).toLocaleString()}</span>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => handleDeleteSourceUrl(u.id)}
                          className="p-2 bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700/80 rounded-xl transition shrink-0"
                          title="Delete Source URL"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Bottom Actions Row: 6 Explicit Buttons */}
                      <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
                        {/* 1. New JSON Button */}
                        <button
                          onClick={() => handleViewNewJson(u)}
                          disabled={!Array.isArray(u.new_extracted_json) || u.new_extracted_json.length === 0}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-medium rounded-xl transition flex items-center gap-1.5"
                          title="View newly extracted raw JSON for this source"
                        >
                          <FileText className="w-3.5 h-3.5 text-emerald-400" />
                          <span>New JSON ({Array.isArray(u.new_extracted_json) ? u.new_extracted_json.length : 0})</span>
                        </button>

                        {/* 2. Past JSON Button */}
                        <button
                          onClick={() => handleViewPastJson(u)}
                          disabled={!Array.isArray(u.last_extracted_json) || u.last_extracted_json.length === 0}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-medium rounded-xl transition flex items-center gap-1.5"
                          title="View past extracted JSON for this source"
                        >
                          <FileText className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Past JSON ({Array.isArray(u.last_extracted_json) ? u.last_extracted_json.length : 0})</span>
                        </button>

                        {/* 3. Clear New JSON Button */}
                        <button
                          onClick={() => handleClearNewJson(u.id)}
                          disabled={!Array.isArray(u.new_extracted_json) || u.new_extracted_json.length === 0}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-amber-950/60 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-400 hover:text-amber-400 border border-slate-700 text-xs font-medium rounded-xl transition flex items-center gap-1"
                          title="Clear newly extracted JSON for this source"
                        >
                          <Eraser className="w-3.5 h-3.5 text-amber-400" />
                          <span>Clear New JSON</span>
                        </button>

                        {/* 4. Clear Past JSON Button */}
                        <button
                          onClick={() => handleClearPastJson(u.id)}
                          disabled={!Array.isArray(u.last_extracted_json) || u.last_extracted_json.length === 0}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-rose-950/60 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-700 text-xs font-medium rounded-xl transition flex items-center gap-1"
                          title="Clear previously stored JSON for this source"
                        >
                          <FileX className="w-3.5 h-3.5 text-rose-400" />
                          <span>Clear Past JSON</span>
                        </button>

                        {/* 5. Scrape Button */}
                        <button
                          onClick={() => handleRunScrapeForSource(u)}
                          disabled={scrapingUrlId === u.id || isScraping}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-indigo-900/60 disabled:opacity-40 disabled:hover:bg-slate-800 text-indigo-300 hover:text-white border border-indigo-700/80 text-xs font-semibold rounded-xl transition flex items-center gap-1.5"
                          title="Scrape raw content from this source"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${scrapingUrlId === u.id ? 'animate-spin' : ''}`} />
                          <span>{scrapingUrlId === u.id ? 'Scraping...' : 'Scrape'}</span>
                        </button>

                        {/* 6. Send New to LLM Button */}
                        <button
                          onClick={() => handleSendNewToLLM(u)}
                          disabled={!Array.isArray(u.new_extracted_json) || u.new_extracted_json.length === 0 || scrapingUrlId === u.id || isScraping}
                          className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 text-white font-semibold text-xs rounded-xl shadow flex items-center gap-1.5 transition"
                          title="Send New JSON to LLM for preference match evaluation"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-violet-200" />
                          <span>Send New to LLM</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center bg-slate-900/30 border border-slate-800 rounded-xl p-6 text-slate-400 text-xs">
                  No source URLs added yet. Add a web page URL above where cultural events are published!
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Preferences */}
        {activeTab === 'preferences' && (
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Settings className="w-4 h-4 text-indigo-400" />
                  <span>Cultural & Musical Preferences</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Gemini uses these preferences to evaluate whether events match your taste. You can paste Spotify playlists, music genres, or custom rules.
                </p>
              </div>

              <button
                onClick={handleSavePreferences}
                disabled={savingPrefs}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow flex items-center gap-1.5 transition shrink-0"
              >
                <span>{savingPrefs ? 'Saving...' : 'Save Preferences'}</span>
              </button>
            </div>

            {prefsSavedMsg && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/80 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Preferences updated successfully!</span>
              </div>
            )}

            <textarea
              rows={14}
              value={preferencesText}
              onChange={(e) => setPreferencesText(e.target.value)}
              placeholder="Describe your music taste, favorite genres, venue preferences, Spotify playlists, dislike rules..."
              className="w-full p-4 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 leading-relaxed"
            />
          </div>
        )}

      </div>

      {/* Confirmed AI Rule Toast Modal */}
      {confirmedRuleModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-indigo-400">
              <Sparkles className="w-5 h-5" />
              <h3 className="font-bold text-sm text-white">Preference Refined by Gemini</h3>
            </div>

            <p className="text-xs text-slate-300">
              Based on your rejection of <strong>"{confirmedRuleModal.eventName}"</strong>, the following rule was added to your preferences:
            </p>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-emerald-300 font-mono">
              - {confirmedRuleModal.rule}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setConfirmedRuleModal({ isOpen: false, rule: '', eventName: '' })}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow transition"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Raw Extracted Events JSON Preview & Debug Modal */}
      {rawDebugModalState.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="max-w-2xl w-full bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-indigo-400">
                <Code className="w-5 h-5" />
                <div>
                  <h3 className="font-bold text-sm text-white">
                    {rawDebugModalState.jsonType === 'new'
                      ? 'New Extracted Raw Events (New JSON)'
                      : rawDebugModalState.jsonType === 'past'
                      ? 'Past Extracted Raw Events (Past JSON)'
                      : 'Scraping Source Events'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Source: {rawDebugModalState.sourceUrl?.name || rawDebugModalState.sourceUrl?.url}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {rawDebugModalState.skippedCount > 0 && (
                  <span className="px-2.5 py-1 bg-amber-950/80 text-amber-300 border border-amber-800/60 rounded-full text-xs font-semibold flex items-center gap-1.5" title={`${rawDebugModalState.skippedCount} sublinks were already crawled in past runs and skipped`}>
                    <Archive className="w-3 h-3 text-amber-400" />
                    <span>{rawDebugModalState.skippedCount} Skipped (Cached)</span>
                  </span>
                )}
                <span className="px-2.5 py-1 bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 rounded-full text-xs font-semibold flex items-center gap-1.5">
                  {rawDebugModalState.isExtracting ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                      <span>Crawling Live... ({rawDebugModalState.rawEvents.length})</span>
                    </>
                  ) : (
                    <span>{rawDebugModalState.rawEvents.length} Event Items</span>
                  )}
                </span>
              </div>
            </div>

            {/* Live Progress Banner showing precise URL being scraped */}
            {rawDebugModalState.isExtracting && (
              <div className="p-3 bg-indigo-950/50 border border-indigo-800/80 rounded-xl space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold text-indigo-300">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
                    <span className="truncate">{rawDebugModalState.statusMessage || 'Crawling webpage...'}</span>
                  </div>
                </div>

                {rawDebugModalState.currentScrapingUrl && (
                  <div className="flex items-center gap-1 text-[11px] text-slate-400 truncate pt-0.5">
                    <Globe className="w-3 h-3 text-indigo-400 shrink-0" />
                    <span className="text-slate-400">Crawling precise URL:</span>
                    <a
                      href={rawDebugModalState.currentScrapingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:underline truncate font-mono flex items-center gap-1"
                    >
                      <span>{rawDebugModalState.currentScrapingUrl}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-slate-300">
              {rawDebugModalState.jsonType === 'new'
                ? 'Below is the newly scraped raw JSON stored in the DB. Click "Send New to LLM" on the source row to evaluate preference matches.'
                : rawDebugModalState.jsonType === 'past'
                ? 'Below is the stored Past JSON content for this source (accumulated history).'
                : 'Below is the raw JSON extracted live from this source. The scraped events are stored in the DB under New JSON.'}
            </p>

            {/* Scrollable JSON Code Box - Updates Live */}
            <div className="flex-1 overflow-y-auto p-4 bg-slate-950 border border-slate-800 rounded-xl font-mono text-[11px] text-emerald-300 leading-relaxed max-h-[42vh] select-text">
              <pre>{JSON.stringify(rawDebugModalState.rawEvents, null, 2)}</pre>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-400">
                {rawDebugModalState.jsonType === 'new'
                  ? 'New JSON stored in DB. Use "Send New to LLM" on the sources list to process.'
                  : rawDebugModalState.jsonType === 'past'
                  ? 'Past JSON history stored in DB.'
                  : 'Live scraping output. Close this window when finished.'}
              </span>

              <div className="flex items-center gap-2 shrink-0">
                {rawDebugModalState.jsonType === 'new' && rawDebugModalState.sourceUrl?.id && rawDebugModalState.rawEvents.length > 0 && !rawDebugModalState.isExtracting && (
                  <button
                    type="button"
                    onClick={() => {
                      if (rawDebugModalState.sourceUrl) {
                        handleClearNewJson(rawDebugModalState.sourceUrl.id);
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-amber-950/60 text-slate-400 hover:text-amber-400 text-xs font-medium rounded-xl border border-slate-700 transition flex items-center gap-1.5"
                    title="Clear New JSON for this source"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Clear New JSON</span>
                  </button>
                )}

                {rawDebugModalState.jsonType === 'past' && rawDebugModalState.sourceUrl?.id && rawDebugModalState.rawEvents.length > 0 && !rawDebugModalState.isExtracting && (
                  <button
                    type="button"
                    onClick={() => {
                      if (rawDebugModalState.sourceUrl) {
                        handleClearPastJson(rawDebugModalState.sourceUrl.id);
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 text-xs font-medium rounded-xl border border-slate-700 transition flex items-center gap-1.5"
                    title="Clear Past JSON for this source"
                  >
                    <FileX className="w-3.5 h-3.5" />
                    <span>Clear Past JSON</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setRawDebugModalState({
                      isOpen: false,
                      sourceUrl: null,
                      rawEvents: [],
                      currentScrapingUrl: null,
                      statusMessage: null,
                      skippedCount: 0,
                      isExtracting: false,
                      isEvaluating: false,
                      jsonType: 'live'
                    })
                  }
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
