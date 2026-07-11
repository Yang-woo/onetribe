import { execSync } from 'node:child_process'

// Resolves local Supabase credentials once for the whole DB test run.
// CI or a developer can pre-set SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY to skip the CLI lookup.
export default function setup() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) return

  let output: string
  try {
    output = execSync('yarn --silent supabase status -o env', { encoding: 'utf8' })
  } catch {
    throw new Error(
      'Local Supabase is not running. Start it with `yarn supabase start` before `yarn test:db`.',
    )
  }

  const env: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (match) env[match[1]] = match[2]
  }

  process.env.SUPABASE_URL = env.API_URL
  process.env.SUPABASE_ANON_KEY = env.ANON_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error('Could not read local Supabase credentials from `supabase status`.')
  }
}
