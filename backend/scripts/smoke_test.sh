#!/usr/bin/env bash
set -e

echo "=== 1. HEALTH CHECK ==="
curl -i -s http://localhost:8080/api/health
echo ""

echo "=== 2. READY CHECK ==="
curl -i -s http://localhost:8080/api/ready
echo ""

echo "=== 3. CREATE LEAD (REQUEST DEMO) ==="
curl -i -s -X POST http://localhost:8080/api/leads \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Emin Mammadov",
    "company": "CASPEL Global Partner",
    "business_email": "emin.mammadov@example.com",
    "interest": "erp"
  }'
echo ""

echo "=== 4. RECORD ANALYTICS EVENT ==="
curl -i -s -X POST http://localhost:8080/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "smoke_sess_01",
    "event_name": "LANDING_OPEN",
    "product": null,
    "metadata": {"source": "qr_ciftis"}
  }'
echo ""

echo "=== 5. CASPEL AI RAG CHAT QUERY ==="
curl -i -s -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "smoke_sess_01",
    "message": "What is CASPEL ERP?"
  }'
echo ""

echo "=== 6. FRONTEND ROUTE SPA RESOLUTION (/ciftis) ==="
curl -i -s http://localhost:8080/ciftis | head -n 15
echo ""

echo "=== 7. FRONTEND DISPLAY ROUTE (/ciftis/display) ==="
curl -i -s http://localhost:8080/ciftis/display | head -n 15
echo ""

echo "=== 8. FRONTEND PRODUCT ROUTE (/ciftis/product/erp) ==="
curl -i -s http://localhost:8080/ciftis/product/erp | head -n 15
echo ""

echo "=== 9. STATIC PDF PRESENTATION SERVING (Byte-Range) ==="
curl -i -s http://localhost:8080/presentations/CASPEL_ERP_Presentation.pdf | head -n 15
echo ""

echo "=== ALL SMOKE TESTS COMPLETED SUCCESSFULLY ==="
