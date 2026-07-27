# One Tribe

[English](./README.md) · **한국어**

전 세계 하드스타일 팬들이 무대에서 가지고 돌아온 순간을, 각자의 언어로 간직하는 곳.

> ⚠️ **비공식 팬 프로젝트입니다 — Q-dance / Defqon.1 / ID&T와 무관하며 후원·승인·연계 관계가 없습니다.** 공식 로고나 상표, 자산은 일절 사용하지 않습니다.

🌐 **[onetribe.world](https://onetribe.world)** — 가동 중 · [![CI](https://github.com/Yang-woo/onetribe/actions/workflows/ci.yml/badge.svg)](https://github.com/Yang-woo/onetribe/actions/workflows/ci.yml)

## 무엇인가요

전 세계 하드댄스 씬을 위한 다국어 실시간 추억 담벼락입니다. 팬들이 페스티벌에서 찍은 사진을 올리면, 누구나 보고 다시 떠올리고 나눌 수 있습니다 — 설명은 각자의 언어로 번역돼서요. 주말의 감정을 평일까지 데려가려고 만들었습니다.

**Defqon.1**에서 시작하지만, 더 넓은 하드스타일 씬으로 확장할 수 있게 설계했습니다.

사이트는 이미 가동 중이고 기능도 다 들어가 있지만, 아직 공개적으로 알리지 않았습니다. 지금은 담벼락을 채우는 단계입니다.

## 기능

- 🌍 **17개 언어 담벼락** — 실시간으로 갱신되고, 설명은 기계 번역돼 저장됩니다. 원문은 언제든 한 번 눌러 볼 수 있습니다
- 📤 **계정 없이 업로드** — 올리면 바로 공개됩니다. 사전 승인 없이 올라간 뒤에 관리하는 방식이고, 신고와 본인 삭제 요청으로 뒷받침합니다
- 🖼️ **사진과 GIF** — JPEG·PNG·WebP·GIF를 브라우저에서 압축해 한 순간당 5장까지. 영상은 링크만 걸고 다시 호스팅하지 않습니다
- 🔗 **순간 페이지** — 추억마다 공유용 주소와 공유 카드 이미지가 생깁니다
- 🎫 **페스티벌 여권** — 다녀온 에디션을 기록하고 "나의 N번째 데프콘" 도장을 모읍니다. 기본은 익명이고, 기기를 잃어버려도 남기고 싶을 때만 이메일이나 구글 계정을 연결하면 됩니다
- ♿ **접근성** — 담벼락과 업로드 화면 모두 Lighthouse 접근성 100점

## 기술 스택

- **Next.js**(App Router) + **TypeScript** + **Tailwind CSS v4**, **Vercel** 배포
- **Supabase** — Postgres, 인증, 실시간, 행 수준 보안(RLS). 모든 쓰기는 서버 라우트를 거치고, 브라우저는 입력 권한을 갖지 않습니다
- **Cloudflare R2** — 미디어 저장(전송 비용 없음), 업로드할 때마다 정적 WebP 썸네일을 함께 만듭니다
- **next-intl** + 어댑터 뒤의 **DeepL**, 번역 결과는 영구 캐시
- 쓰기 경로에 **Cloudflare Turnstile**, 쿠키 없는 방문자 집계에 **Cloudflare Web Analytics**

## 시작하기

**Node 22**(`nvm use`)와 로컬 Supabase용 **Docker**가 필요합니다.

```bash
yarn install
cp .env.example .env.local   # 각자의 키를 채웁니다
yarn supabase start          # 로컬 Postgres + 인증, anon 키를 출력합니다
yarn dev
```

`.env.local`에 `STORAGE_DRIVER=local`을 넣으면 Cloudflare 계정 없이도 업로드 전 과정을 돌려볼 수 있습니다 — 파일이 R2 대신 디스크에 저장됩니다. `DEEPL_API_KEY`가 없으면 번역이 원문 그대로 표시되므로, 키 없이도 앱은 정상 동작합니다.

## 테스트

```bash
yarn test        # 유닛 + 컴포넌트 (Vitest)
yarn test:db     # 실제 로컬 Supabase 상대로 RLS·정책 동작 검증
yarn test:e2e    # 사용자 흐름 (Playwright, 모바일 + 데스크톱)
```

`test:db`는 모의 객체가 아니라 **실제로 띄운 로컬 Supabase에 anon 키로 접속해서** 돌립니다. 이 프로젝트에서 가장 증명할 가치가 있는 게 접근 권한 규칙이기 때문입니다. 테스트는 동작이 깨지면 반드시 실패하도록 씁니다 — 통과시키려고 존재하는 테스트는 그 자체를 결함으로 봅니다. CI가 푸시마다 세 가지를 모두 실행합니다.

## 비영리

광고, 굿즈, 유료 기능, 어떤 대가도 없습니다. 후원을 받더라도 서버 비용에 쓰이고 후원자에게 돌아가는 혜택은 없습니다. 그게 전부이고, 바뀌지 않습니다.

## 문제 신고

- **콘텐츠** — 모든 순간에 신고 링크가 있고, 사진에 찍힌 사람은 [onetribe.world/ko/takedown](https://onetribe.world/ko/takedown)에서 삭제를 요청할 수 있습니다
- **보안** — 공개 이슈 대신 <privacy@onetribe.world>로 메일 주시면 감사하겠습니다

## 기여

이슈와 풀 리퀘스트 환영합니다. 다만 비영리라는 작은 범위 안에서 방향이 정해져 있으니, 규모가 큰 작업은 먼저 이슈로 얘기해 주시면 좋습니다.

## 라이선스

코드는 [MIT](./LICENSE)입니다. "One Tribe"라는 이름과 로고, 브랜드 자산은 이 라이선스에 포함되지 않습니다. `public/kofi-cup.png`는 Ko-fi의 마크로, 브랜드 자산 이용 조건에 따라 원본 그대로 사용합니다.

## 고지

팬이 만든 비영리 프로젝트입니다. Q-dance, Defqon.1, ID&T를 비롯한 어떤 페스티벌이나 아티스트와도 무관합니다. 업로드된 모든 콘텐츠의 권리는 그것을 만든 팬에게 있습니다.
