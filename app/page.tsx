'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Music, Calendar, Archive, Sparkles, Heart, Lock, ShieldCheck, LogOut, Compass } from 'lucide-react';
import { Concert, ActionType } from '@/lib/types';
import { ConcertCard } from '@/components/ConcertCard';
import { AddConcertModal } from '@/components/AddConcertModal';
import { AdminLoginModal } from '@/components/AdminLoginModal';
import { FriendActionModal } from '@/components/FriendActionModal';

export default function HomePage() {
  const [concerts, setConcerts] = useState<Concert[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');

  // Admin state
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');

  // Modals state
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingConcert, setEditingConcert] = useState<Concert | null>(null);

  const [friendModalState, setFriendModalState] = useState<{
    isOpen: boolean;
    concertId: string;
    bandName: string;
    targetAction: ActionType;
  }>({
    isOpen: false,
    concertId: '',
    bandName: '',
    targetAction: 'GOING'
  });

  const fetchConcerts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/concerts');
      const data = await res.json();
      if (res.ok && data.concerts) {
        setConcerts(data.concerts);
      }
    } catch (err) {
      console.error('Failed to load concerts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConcerts();

    // Restore admin session if active
    const savedPass = sessionStorage.getItem('tonicon_admin_password');
    if (savedPass) {
      setAdminPassword(savedPass);
      setIsAdmin(true);
    }
  }, []);

  const handleAdminAuthSuccess = (pass: string) => {
    setAdminPassword(pass);
    setIsAdmin(true);
    sessionStorage.setItem('tonicon_admin_password', pass);
  };

  const handleAdminLogout = () => {
    setIsAdmin(false);
    setAdminPassword('');
    sessionStorage.removeItem('tonicon_admin_password');
  };

  const handleOpenAddModal = () => {
    setEditingConcert(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEditModal = (concert: Concert) => {
    setEditingConcert(concert);
    setIsAddModalOpen(true);
  };

  const now = new Date();

  // Filter concerts by date
  const upcomingConcerts = concerts
    .filter((c) => new Date(c.date) >= now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const pastConcerts = concerts
    .filter((c) => new Date(c.date) < now)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleOpenActionModal = (concertId: string, bandName: string, action: ActionType) => {
    setFriendModalState({
      isOpen: true,
      concertId,
      bandName,
      targetAction: action
    });
  };

  return (
    <main className="min-h-screen pb-16">

      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">

          {/* Logo / Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-indigo-500/40 shadow-lg shadow-indigo-500/20 shrink-0 bg-slate-900">
              <img src="/totoro.jpg" alt="Totoro" className="w-full h-full object-cover rounded-full" />
            </div>
            <div>
              <h1 className="font-extrabold text-lg sm:text-xl text-white tracking-tight font-display flex items-center gap-2">
                Tonicon
              </h1>
              <p className="text-xs text-slate-400">Toni is going to these concerts. WhatsApp him if you want to join for one, or click on "Interested" to let others know!</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Admin Only: Discover Route Navigation Button */}
            {isAdmin && (
              <Link
                href="/discover"
                className="px-3 py-2.5 bg-slate-900 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 border border-slate-700/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow"
              >
                <Compass className="w-4 h-4" />
                <span className="hidden sm:inline">Discover Events</span>
              </Link>
            )}

            {/* Admin / Add Concert Buttons */}
            {!isAdmin ? (
              <button
                id="admin-btn"
                onClick={() => setIsAdminModalOpen(true)}
                className="p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-xl shadow-lg flex items-center justify-center transition-all duration-200 shrink-0"
                title="Authenticate as Toni Admin"
              >
                <Lock className="w-4 h-4 text-indigo-400" />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  id="add-concert-btn"
                  onClick={handleOpenAddModal}
                  className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-indigo-500/25 flex items-center gap-1.5 transition-all duration-200 shrink-0"
                >
                  <Plus className="w-4 h-4 text-white" />
                  <span>Add Concert</span>
                </button>
                <button
                  id="logout-admin-btn"
                  onClick={handleAdminLogout}
                  className="p-2.5 bg-slate-900 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-800/80 rounded-xl transition shrink-0"
                  title="Logout Admin Mode"
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

        {/* Navigation Tabs (Upcoming on Left, Past on Right) */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          {/* Upcoming Tab (Left) */}
          <button
            id="tab-upcoming"
            onClick={() => setActiveTab('upcoming')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${activeTab === 'upcoming'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
              }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Upcoming</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === 'upcoming' ? 'bg-indigo-700 text-white' : 'bg-slate-800 text-slate-400'
              }`}>
              {upcomingConcerts.length}
            </span>
          </button>

          {/* Past Tab (Right) */}
          <button
            id="tab-past"
            onClick={() => setActiveTab('past')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${activeTab === 'past'
              ? 'bg-slate-800 text-white shadow-md border border-slate-700'
              : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
              }`}
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Past</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === 'past' ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400'
              }`}>
              {pastConcerts.length}
            </span>
          </button>
        </div>

        {/* Content List */}
        {loading ? (
          <div className="flex flex-col gap-6">
            {[1, 2].map((i) => (
              <div key={i} className="h-48 bg-slate-900/95 border border-slate-700/90 ring-1 ring-white/10 rounded-2xl animate-pulse p-6 flex flex-col justify-between shadow-2xl">
                <div className="space-y-3">
                  <div className="h-4 bg-slate-800 rounded w-1/3" />
                  <div className="h-6 bg-slate-800 rounded w-2/3" />
                </div>
                <div className="h-10 bg-slate-800 rounded w-full" />
              </div>
            ))}
          </div>
        ) : activeTab === 'upcoming' ? (
          upcomingConcerts.length > 0 ? (
            <div className="flex flex-col gap-6 animate-fade-in">
              {upcomingConcerts.map((concert) => (
                <ConcertCard
                  key={concert.id}
                  concert={concert}
                  isAdmin={isAdmin}
                  onEditConcert={handleOpenEditModal}
                  onOpenActionModal={handleOpenActionModal}
                />
              ))}
            </div>
          ) : (
            <div className="py-16 text-center bg-slate-900/40 border border-slate-700/80 rounded-2xl p-6">
              <Sparkles className="w-10 h-10 text-indigo-400 mx-auto mb-3 opacity-60" />
              <h3 className="text-base font-semibold text-white">No upcoming concerts listed yet</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Click "Add Concert" above to add the next gig Toni is attending!
              </p>
            </div>
          )
        ) : (
          pastConcerts.length > 0 ? (
            <div className="flex flex-col gap-6 animate-fade-in">
              {pastConcerts.map((concert) => (
                <ConcertCard
                  key={concert.id}
                  concert={concert}
                  isPast={true}
                  isAdmin={isAdmin}
                  onEditConcert={handleOpenEditModal}
                  onOpenActionModal={handleOpenActionModal}
                />
              ))}
            </div>
          ) : (
            <div className="py-16 text-center bg-slate-900/40 border border-slate-700/80 rounded-2xl p-6">
              <Archive className="w-10 h-10 text-slate-500 mx-auto mb-3 opacity-60" />
              <h3 className="text-base font-semibold text-white">No past concerts archived</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Concerts that have passed will automatically appear in this tab.
              </p>
            </div>
          )
        )}

      </div>

      {/* Modals */}
      <AdminLoginModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        onSuccess={handleAdminAuthSuccess}
      />

      <AddConcertModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={fetchConcerts}
        adminPassword={adminPassword}
        onAdminAuthSuccess={handleAdminAuthSuccess}
        concertToEdit={editingConcert}
      />

      <FriendActionModal
        isOpen={friendModalState.isOpen}
        onClose={() => setFriendModalState((prev) => ({ ...prev, isOpen: false }))}
        concertId={friendModalState.concertId}
        bandName={friendModalState.bandName}
        targetAction={friendModalState.targetAction}
        onSuccess={fetchConcerts}
      />

    </main>
  );
}
