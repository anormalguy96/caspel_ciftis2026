Phase 2.1 üçün son, cərrahi correction və verification et.

MƏCBURİ İŞ MÜHİTİ:
- Yalnız Linux/WSL Bash istifadə et.
- Windows PowerShell, CMD və Windows-native əmrlər işlətmə.
- Repository-dəki Skills/ qovluğunu əvvəlcə yoxla.
- Tapılan relevant SKILL.md fayllarını tam oxu və guideline kimi tətbiq et.
- Final hesabatda hansı Skills guideline-larının tətbiq edildiyini yaz.
- Heç bir git push etmə.
- Docker volume silmə.
- Bütün repository-ni reset/checkout etmə.

QORUNMALI ASSET-LƏR:
- data/presentations/CASPEL_Corporate_Presentation.pdf real, təsdiqlənmiş PDF-dir.
  Gözlənilən SHA256:
  051796d6e7e6f9243739b2985a0d8d04525e55d8ef6067ba78aa3aa9e1811f03
- data/presentations/CASPEL_ERP_Presentation.pdf real, təsdiqlənmiş PDF-dir.
  Gözlənilən SHA256:
  e7033d04ff59141572ffd4cdd57163c031d7faa39052c51e29424dd0cf50aab7
- Bu iki faylı dəyişmə, generasiya etmə və git checkout ilə əvəz etmə.
- PMS və IRISSEA üçün production PDF olmamalıdır; UI “Coming Soon” göstərməlidir.
- `git checkout -- data/presentations` işlətmə.

EDİLƏCƏK DÜZƏLİŞLƏR:
1. .gitignore-dan `Skills/` sətrini sil. Skills qovluğu gizlədilməməlidir.
2. backend/scripts/generate_sample_pdfs.py production
   data/presentations qovluğuna yazmamalıdır.
   Yalnız backend/tests/fixtures/synthetic altında açıq şəkildə
   SYNTHETIC/ACME adlandırılmış test fixture-ləri yaratsın.
3. Presentation backend route:
   - təhlükəsiz Path.resolve() containment yoxlaması tətbiq et;
   - path traversal testləri əlavə et;
   - Docker /data/presentations və local development fallback-ını dəstəklə;
   - istifadə olunmayan importları sil.
4. Smoke test:
   - PDF-i GET Range 0-1023 ilə yoxla;
   - status, Content-Type, Content-Range və body ölçüsünü yoxla;
   - PDF yoxlaması FAILED olarsa script mütləq non-zero exit versin;
   - 899 baytlıq placeholder PDF sadəcə `%PDF` ilə başladığı üçün uğurlu sayılmasın.
5. Embedding testlərinə bunları əlavə et:
   - zero embeddings rədd edilir;
   - birdən çox embedding rədd edilir;
   - yanlış dimension rədd edilir;
   - legacy `response.embedding.values` formatı səssiz qəbul edilmir.
6. Frontend testləri əlavə et:
   - Corporate və ERP presentationAvailable=true;
   - PMS və IRISSEA presentationAvailable=false;
   - unavailable məhsulda iframe/download/open düymələri render olunmur;
   - “Coming Soon” görünür.
7. frontend/package-lock.json-ı silmə və `npm install` ilə yenidən generasiya etmə.
   Clean install üçün `npm ci` istifadə et.
8. Frontend Dockerfile-da reproducible build üçün `npm ci` istifadə et.
9. Backend pytest, frontend tests, frontend build, Docker Compose və smoke
   testləri faktiki icra et.
10. Exact command/output summary təqdim et. Keçməyən və ya icra olunmayan
    yoxlamanı PASSED kimi göstərmə.
11. docs/PHASE2_1_VERIFICATION_REPORT.md sənədində yanlış iddiaları düzəlt:
    - yalnız həqiqətən istifadə olunursa Path.resolve yaz;
    - real PDF hash və ölçülərini göstər;
    - frontend test nəticələrini ayrıca göstər;
    - live Gemini key yoxdursa status:
      LOCAL IMPLEMENTATION VERIFIED — LIVE GEMINI NOT VERIFIED
      yalnız bütün local testlər həqiqətən keçəndən sonra istifadə olunsun.

Sonda bunları göstər:
- git status --short
- git diff --stat
- git diff --check
- real PDF-lərin SHA256 və ölçüləri
- backend test summary
- frontend test/build summary
- Docker container status
- smoke-test summary
- live Gemini verification status
- Git push performed: No