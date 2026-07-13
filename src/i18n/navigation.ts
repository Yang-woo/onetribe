import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

// Locale-aware drop-ins for next/link & friends — components use these so
// links stay inside the visitor's locale automatically.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing)
