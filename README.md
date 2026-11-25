# 대가리 깨져도 발로란트 (대깨발) — 공식 사이트

- **라이브:** https://dododo13579123-dot.github.io/daeggabal/
- **저장소:** https://github.com/dododo13579123-dot/daeggabal

발로란트 친목 디스코드 서버 **대깨발**의 랜딩 페이지 + 내전 운영 도구 모음입니다.
정적 HTML/CSS/JS만 사용하며, 서버·DB·빌드 없이 어디서든 배포할 수 있습니다.
현재 GitHub Pages(`main` 브랜치 루트)로 자동 배포됩니다.

## 구성

| 파일 | 설명 |
| --- | --- |
| `index.html` | 메인 랜딩 (서버 소개, 키워드 허브, FAQ) |
| `duo.html` | 듀오/파티 모집 + **구인 글 자동 생성기** |
| `balancer.html` | **내전 팀 밸런서** (2~8팀, 대진표, 포인트 정산, 디스코드 웹훅) |
| `season.html` | **시즌 코인 허브** (랭킹, 포인트 상점, 교환 신청, 봇 연동 JSON) |
| `events.html` | 대회 · 이벤트 (총상금 160만원, 일정, 참가 자격) |
| `rules.html` | 서버 규칙 |
| `faq.html` | FAQ (FAQPage 구조화 데이터 포함) |
| `blog/` | SEO 가이드 4편 |
| `assets/css/` | 디자인 시스템 + 도구 스타일 |
| `assets/js/` | `main.js`, `balancer.js`, `season-store.js`, `season.js`, `duo-form.js` |
| `sitemap.xml`, `robots.txt` | 검색엔진용 |

## 배포 전 체크리스트

1. **도메인 교체** — `https://dododo13579123-dot.github.io/daeggabal` 를 실제 도메인으로 모두 바꾸세요.
   ```powershell
   Get-ChildItem -Recurse -Include *.html,*.xml,*.txt |
     ForEach-Object {
       $c = Get-Content -Raw -Encoding UTF8 $_.FullName
       $c.Replace('https://dododo13579123-dot.github.io/daeggabal', 'https://실제도메인.com') |
         Set-Content -Encoding UTF8 $_.FullName
     }
   ```
2. **검색엔진 인증 코드**
   - `NAVER_SEARCH_ADVISOR_CODE` → 네이버 서치어드바이저 인증값
   - `GOOGLE_SEARCH_CONSOLE_CODE` → Google Search Console 인증값
3. **디스코드 초대 링크** — 현재 `https://discord.gg/76CTQ5Cpb9` 로 연결되어 있습니다.
4. **디스코드 웹훅** — 밸런서/시즌 페이지에서 채널 웹훅 URL을 입력하면 결과가 자동 전송됩니다.
5. **검색 등록** — Google Search Console, 네이버 서치어드바이저에 `sitemap.xml` 제출.

## 내전 밸런서

- 현재 티어 MMR + 최고 티어 MMR(가중치 조절) → 스네이크 드래프트 + 국소 최적화
- 2~8팀, 팀당 2~10명, 자동 리밸런스, 로컬 자동 저장
- 토너먼트 대진 자동 생성(부전승 지원), 스코어 입력 시 승자 자동 진출
- `참여 경기 × 150P + 승리 × 70P` 정산 → **시즌에 반영** 버튼으로 랭킹 적립
- 결과 텍스트/CSV/공유 링크/디스코드 웹훅
- 단축키: `Alt+B` 밸런스, `Alt+R` 다시 섞기

## 시즌 코인 / 상점

- `localStorage` 키: `dgv.season.v1` (밸런서는 `dgv.balancer.v1`)
- 랭킹, 승률, 티어 배지 / 상품 교환(포인트 즉시 차감, 취소 시 환불)
- 상품: VP, 니트로, 기프티콘, 칭호, MVP 배지, **경고 차감권(10,000코인)**, 굿즈
- 교환 신청 시 설정된 웹훅으로 알림 전송

### 봇 연동 계약 (제안)

`season.html`의 **봇 연동** 탭에서 전체 JSON을 복사할 수 있습니다.

```http
GET  /points?name=닉네임        → { name, points, games, wins, winRate }
GET  /leaderboard?limit=10      → { leaderboard: [...] }
GET  /shop                      → { shop: [{ id, name, price, stock }] }
POST /redeem                    → { player, itemId } → 포인트 차감
POST /settle                    → 밸런서 정산 JSON 적립
```

정적 사이트라 데이터는 브라우저에만 저장됩니다. 봇과 실시간 동기화하려면
위 스키마대로 봇 서버를 붙이고, 페이지의 JSON을 전송(`POST`)하도록 연결하세요.

## 로컬 확인

```powershell
# 파일 직접 열기 (대부분 동작, 웹훅은 CORS 제한 있을 수 있음)
start .\index.html
```

웹훅 테스트는 `https://` 로 배포한 뒤 진행하는 것을 권장합니다.

## SEO 메모

- 모든 페이지: canonical, OG/Twitter 카드, Breadcrumb/Article/FAQ/WebApplication JSON-LD
- 키워드 허브 20+개 내부 링크, `sitemap.xml` 제출
- 네이버는 `robots.txt`의 Yeti 허용 + 서치어드바이저 수집 요청 병행

## 라이선스 / 고지

Riot Games와 무관한 비공식 팬 커뮤니티입니다. VALORANT는 Riot Games, Inc.의 상표입니다.
