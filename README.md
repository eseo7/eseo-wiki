# Parnas AI Operations Wiki - Official Release v2

- `index.html`은 위키 엔진입니다.
- `wiki_docs/*.html`은 원본 HTML 매뉴얼 20개입니다.
- 상세 보기에서는 HTML을 iframe으로 독립 렌더링해 원본 디자인을 보존합니다.
- 기존 Firebase DB에 오래된 본문이 남아 있어도, 동일 ID의 번들 문서는 `wiki_docs` 파일을 우선 표시합니다.

## 배포
루트 전체를 Firebase Hosting/S3에 업로드하세요.

## 최초/갱신
로그인 후 우측 상단 `샘플 추가` 버튼을 누르면 20개 문서 메타가 Firebase DB에 등록/갱신됩니다.
