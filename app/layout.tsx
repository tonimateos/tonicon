import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Tonicon",
  description: "Check out which concerts Toni is attending, listen to top tracks, RSVP 'I'm going' or 'Interested', and leave comments!",
  icons: {
    icon: '/totoro-circle.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased selection:bg-pink-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
