# 약국 VMD 시뮬레이터 — 웹앱 배포 가이드

URL 하나로 어느 기기·어디서든 접속하고, 라이브러리·프로젝트·이미지를 클라우드에 저장해 같은 데이터를 공유합니다.
구성: **Vite(React)** + **Supabase(DB·이미지 저장)** + **Vercel(호스팅)**.

> Supabase 키를 넣지 않으면 자동으로 브라우저 로컬 저장으로 동작합니다(그 기기에서만 보임). "어디서든"을 쓰려면 아래 2단계까지 하세요.

---

## 0. 사전 준비
- Node.js 18+ 설치
- 무료 계정: Supabase, Vercel, (코드 올릴) GitHub

## 1. 로컬 실행
```bash
npm install
cp .env.example .env      # 아직 키 없으면 그대로 둬도 로컬 저장으로 실행됨
npm run dev               # http://localhost:5173
```

## 2. Supabase 설정 (클라우드 저장)
1. supabase.com → New project 생성
2. 좌측 **SQL Editor** → `supabase/schema.sql` 내용 붙여넣고 **Run**
   - 테이블(items, projects) + 이미지 버킷(vmd-images) + 접근정책이 생성됩니다.
3. **Storage**에 `vmd-images` 버킷이 있는지 확인(없으면 New bucket, Public 체크)
4. 좌측 **Project Settings → API** 에서 두 값 복사:
   - Project URL → `VITE_SUPABASE_URL`
   - anon public key → `VITE_SUPABASE_ANON_KEY`
5. `.env` 에 붙여넣기:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   VITE_SUPABASE_BUCKET=vmd-images
   ```
6. `npm run dev` 재시작 → 우측 상단의 "로컬 저장 모드" 표시가 사라지면 클라우드 연동 완료.

> ⚠️ 위 SQL의 기본 정책은 **anon 키로 누구나 읽기/쓰기**입니다(사내 비공개 도구용). 외부에 URL이 노출될 우려가 있으면 schema.sql의 "로그인 버전" 주석을 참고해 Supabase Auth(로그인)를 붙이세요.

## 3. 이미지 미리 연동(카탈로그 시드)
두 가지 방법 중 택1.
- **간단**: 배포 후 앱의 "제품 라이브러리"에서 직접 추가하면 이미지가 Supabase Storage에 업로드되어 모든 기기에서 보입니다.
- **미리 일괄 등록**:
  1. `public/images/` 에 이미지 파일을 넣고(예: `ursa-200-front.png`)
  2. `public/catalog.example.json` 을 복사해 `public/catalog.json` 으로 만들고 제품 목록·이미지 경로(`/images/...`) 작성
  3. 앱을 처음 열 때 라이브러리가 비어 있으면 `catalog.json` 을 자동으로 불러와 등록합니다.

## 4. Vercel 배포 (어디서든 접속)
1. 이 폴더를 GitHub 저장소로 push
2. vercel.com → New Project → 그 저장소 Import
3. Framework: **Vite** (자동 인식), Build Command `npm run build`, Output `dist`
4. **Environment Variables** 에 위 3개(VITE_SUPABASE_*) 추가
5. Deploy → 발급된 URL(예: `vmd-simulator.vercel.app`)을 어디서든 열기
6. (선택) 휴대폰에서 그 URL 접속 후 "홈 화면에 추가" → 앱처럼 사용

---

## 동작 메모
- 데이터: items(라이브러리), projects(약국별 진열)가 Supabase에 JSON으로 저장됩니다.
- 이미지: 업로드 시 `vmd-images` 버킷에 저장되고 공개 URL로 연동됩니다(시안 PNG 내보내기 호환).
- 키 미설정 시 모든 저장이 브라우저 localStorage로 떨어집니다(백업·이전은 기기 한정).
