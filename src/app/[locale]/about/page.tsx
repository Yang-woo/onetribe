import { ABOUT } from '@/lib/policy-content'

export const dynamic = 'force-dynamic'

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="mb-6 font-display text-3xl lowercase tracking-tight">{ABOUT.title}</h1>
      <div className="flex flex-col gap-4 text-paper/90">
        {ABOUT.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}
      </div>
    </main>
  )
}
