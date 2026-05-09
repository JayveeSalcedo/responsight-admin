import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'

export const metadata: Metadata = {
  title:       'ResponSight Admin',
  description: 'Admin Emergency Reporting & Sentiment Analysis Dashboard for Urdaneta City',
  icons: {
    icon: [
      { url: '/icon.png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/*
        Preconnect to Google Fonts so the browser opens the TCP connection
        immediately — cuts font load latency by ~200ms.
        The actual <link> with font URLs lives here too so it's in the
        <head> as a high-priority resource, not buried inside a CSS @import.
      */}
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* App-wide providers (theme, future context, etc.) */}
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
