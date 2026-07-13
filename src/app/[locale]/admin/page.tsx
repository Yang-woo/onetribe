import type { Metadata } from 'next'
import { AdminPanel } from '@/components/admin-panel'

export const dynamic = 'force-dynamic'

// Operator-only — never indexed, never localized.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="mb-6 font-display text-2xl lowercase tracking-tight">admin</h1>
      <AdminPanel />
    </main>
  )
}
