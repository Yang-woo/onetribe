import { PolicyArticle } from '@/components/policy-article'
import { POLICIES } from '@/lib/policy-content'

export const dynamic = 'force-dynamic'

export default function Page() {
  return <PolicyArticle doc={POLICIES.takedown} />
}
