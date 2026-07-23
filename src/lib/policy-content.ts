/**
 * User-facing policies — verbatim from docs/10 (EN drafts). English is the
 * binding text; every locale is stacked on one page via MultilingualArticle
 * (D18), not a per-locale banner. (The enNotice message key is now unused.)
 *
 * Contact goes through Cloudflare Email Routing (privacy@onetribe.world →
 * operator inbox, live since 2026-07-20). policy-content.test.ts guards the
 * domain. Bump POLICY_LAST_UPDATED whenever text changes.
 */

/** ISO date shown as "last updated" across every policy page. */
export const POLICY_LAST_UPDATED = '2026-07-20'

/** Public site domain (D14) — display strings derive from this one literal. */
export const SITE_DOMAIN = 'onetribe.world'

/** Where removal / privacy / rights-holder requests are sent (see note above). */
export const POLICY_CONTACT_EMAIL = `privacy@${SITE_DOMAIN}`

export interface PolicySection {
  heading?: string
  paragraphs: string[]
}

export interface PolicyDoc {
  slug: 'terms' | 'privacy' | 'takedown' | 'guidelines'
  title: string
  sections: PolicySection[]
}

export const POLICIES: Record<PolicyDoc['slug'], PolicyDoc> = {
  terms: {
    slug: 'terms',
    title: 'Terms of Service',
    sections: [
      {
        heading: '1. What this is',
        paragraphs: [
          'One Tribe is an unofficial, non-commercial fan project — a shared memory archive for the hard-dance community. It is not affiliated with, endorsed by, or connected to Q-dance, Defqon.1, or any festival, artist, or label.',
        ],
      },
      {
        heading: '2. Your content',
        paragraphs: [
          'When you upload a photo or GIF, or link a video ("Memory"), you confirm that: you captured it yourself and hold the rights to share it; it was taken at a music event you attended; you grant One Tribe a non-exclusive, worldwide, royalty-free license to host, display, resize, and translate its caption, solely to operate this site.',
          'You keep ownership. You can delete your Memory at any time using your deletion link.',
        ],
      },
      {
        heading: '3. What you may not upload',
        paragraphs: [
          'Content you didn’t capture; full-song continuous recordings of performances ("set rips"); official media (aftermovies, pro photos, broadcast captures); NSFW or sexualized content; content focused on minors; AI-generated or manipulated images presented as real moments; spam or ads; content mocking or demeaning identifiable people.',
        ],
      },
      {
        heading: '4. Moderation',
        paragraphs: [
          'Uploads appear on the wall immediately. We review recent uploads and reports after publication, and may hide or remove any content at our discretion. We honor rights-holder and privacy requests quickly (see takedown), and every Memory has a report link.',
        ],
      },
      {
        heading: '5. No warranty; limitation',
        paragraphs: [
          'The site is provided "as is", free of charge. Voluntary donations only cover hosting costs and confer no benefits, features, or priority. To the maximum extent permitted by law, we accept no liability for damages arising from use of the site. Content reflects its uploaders, not the operator.',
        ],
      },
      {
        heading: '6. Changes; contact',
        paragraphs: [
          `We may update these terms; continued use means acceptance. Contact: ${POLICY_CONTACT_EMAIL}.`,
        ],
      },
    ],
  },
  privacy: {
    slug: 'privacy',
    title: 'Privacy Policy',
    sections: [
      {
        heading: '1. Who we are',
        paragraphs: [
          `One Tribe (${SITE_DOMAIN}) is a non-commercial fan project operated from South Korea. Contact: ${POLICY_CONTACT_EMAIL}.`,
        ],
      },
      {
        heading: '2. What we collect',
        paragraphs: [
          'Memories: photos/GIFs you upload and video links you embed, captions, event/city/year, an optional display name and social link. Published publicly immediately; may be hidden or removed on review or report.',
          'Account (optional): account ID (anonymous by default), display name, an optional Instagram handle (saved so your uploads can pre-fill it), home country, festival attendance log ("Passport"), and — only if you choose to link them — your email address or Google account identity.',
          'Technical: server logs needed to run and secure the service. Any analytics we add will be privacy-friendly — no cross-site tracking, no ad cookies.',
          'We do not run facial recognition or automatic tagging of people. We do not sell data.',
        ],
      },
      {
        heading: '3. People in crowd photos',
        paragraphs: [
          'Festival photos may show other attendees. Our legal basis for publishing is legitimate interest in community documentation of public events, balanced against your rights.',
          `If you appear in a photo and want it removed or blurred, tell us — we will act within 48 hours, no questions asked: ${POLICY_CONTACT_EMAIL}.`,
        ],
      },
      {
        heading: '4. Your rights (GDPR)',
        paragraphs: [
          `Access, rectification, erasure, restriction, objection, portability. You can delete your passport yourself on the passport page — your moments stay on the wall, anonymized, each with its own delete link. Email ${POLICY_CONTACT_EMAIL} for anything else. You may also complain to your local data-protection authority.`,
        ],
      },
      {
        heading: '5. Storage & processors',
        paragraphs: [
          'Content is stored with our infrastructure providers (database/auth: Supabase; media: Cloudflare R2; translation: DeepL; sign-in emails: Resend). Captions are machine-translated; translated text is cached. Data may be processed in the EU and US under standard safeguards.',
          'Donations are processed off-site by Ko-fi and GitHub Sponsors; we receive no payment data.',
        ],
      },
      {
        heading: '6. Retention',
        paragraphs: [
          'Published Memories stay until you delete them or a valid request removes them. Deleted content is purged from active systems within 30 days.',
        ],
      },
      {
        heading: '7. Minors',
        paragraphs: [
          'The site is not directed at children. We blur or remove images focusing on minors on request or at our discretion.',
        ],
      },
    ],
  },
  takedown: {
    slug: 'takedown',
    title: 'Copyright & Removal',
    sections: [
      {
        paragraphs: ['Removal requests — we keep this simple.'],
      },
      {
        heading: 'You uploaded it and want it gone?',
        paragraphs: ['Use the deletion link you received, or email us — removed immediately.'],
      },
      {
        heading: 'You’re in a photo and don’t want to be?',
        paragraphs: [
          `Email ${POLICY_CONTACT_EMAIL} with the photo link. Removed or blurred within 48 hours, no questions asked.`,
        ],
      },
      {
        heading: 'You’re a rights holder',
        paragraphs: [
          `(artist, label, festival, photographer): email ${POLICY_CONTACT_EMAIL} with (1) the content link, (2) what you own, (3) your contact. We review promptly and remove valid claims — typically within 24–48 hours. Repeat infringers are blocked from uploading.`,
          'Counter-notice: if your upload was removed and you believe it was a mistake, reply with an explanation; we may restore after review.',
          'We’re fans, not adversaries. If something bothers you, tell us and it comes down.',
        ],
      },
    ],
  },
  guidelines: {
    slug: 'guidelines',
    title: 'Community Guidelines',
    sections: [
      {
        heading: 'Keep it yours.',
        paragraphs: ['Only upload what you captured yourself.'],
      },
      {
        heading: 'Keep it real.',
        paragraphs: ['Real moments only — no AI images, no official media rips.'],
      },
      {
        heading: 'Keep it short.',
        paragraphs: [
          'Photos and GIFs — link a video instead of uploading it. No full-set recordings — support the artists.',
        ],
      },
      {
        heading: 'Keep it kind.',
        paragraphs: [
          'No mocking people, no NSFW, no hate symbols. If a stranger is the focus of your shot, imagine them seeing it.',
        ],
      },
      {
        heading: 'Minors',
        paragraphs: ['Don’t make kids the focus; we may blur.'],
      },
      {
        heading: 'Someone in your photo objects?',
        paragraphs: ['They win. Always.'],
      },
    ],
  },
}

export const ABOUT = {
  title: 'about',
  paragraphs: [
    'One Tribe is built by a fan from South Korea who flies to Defqon.1 every year — a Weekend Warrior with a long flight home.',
    'When the 2026 weekend was canceled, thousands of us were left holding memories with nowhere to put them. So this wall exists: a place where the harder-styles community keeps the moments we took home — permanent, visual, and in every language we speak.',
    'Principles: fan-owned, non-commercial, no ads, no merch. The moments belong to the people who lived them. If something here bothers you, tell us and it comes down — see the takedown page.',
    'Not affiliated with Q-dance or Defqon.1 in any way.',
  ],
}

/** About `#support` section (docs/00 D15) — shown only when a donation rail exists. */
export const ABOUT_SUPPORT = {
  title: 'support',
  body: 'One Tribe runs on a small server bill and nothing else. If you want to help keep the wall alive, you can buy the server a coffee — donations cover hosting costs only, buy you no perks, and never turn this into a business.',
}
