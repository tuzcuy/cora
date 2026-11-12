# CORA — Ticari Yönetim ve Satış Sistemi

## Mimari ve Ürün Kararları (V1) — Corant Soft

> Bu doküman Cora'nın "anayasası"dır. Katı kuralların İngilizce özeti için bkz. `docs/INVARIANTS.md`.
> Bir karar burada yazmıyorsa, mimariyle tutarlı en basit seçenek seçilir ve `docs/DECISIONS.md`'ye not düşülür.

---

## 0. Tek paragraf özet

Cora; toptan satış yapan işletmeler (ilk müşteri: Antalya'da otellere cam/sofra eşyası satan bir toptancı) için
**teklif → sipariş → depo → sevkiyat** zincirini tek ekranda yöneten, çok kiracılı (multi-tenant), API-first,
yıllık lisanslanabilir bir web uygulamasıdır. Logo Tiger'ın kapsamına değil, **kullanıcının 4 acısına** odaklanır:
hızlı ürün bulma, kolay teklif/sipariş, siparişin nerede olduğunu görme, kâr takibi. Muhasebe/e-fatura V2'dir.

---

## 1. Ekran görüntülerinden çıkan gerçekler (tasarımı etkileyen)

Excel'deki 9 Logo Tiger 3 ekranından çıkan ve V1'i **değiştiren** bulgular:

| Bulgu                         | Kanıt                                                                                                                   | Cora kararı                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Hacim yüksek                  | Fiş no `202612646` → yılın 8. ayında ~12.600 sipariş, 18.08'de tek günde 30+ sipariş                                    | Sipariş listesi sanal kaydırmalı (virtualized), sunucu taraflı sayfalama/filtre; 1M+ satırda çalışacak indeksler |
| Döviz V1'de zorunlu           | "YURTDIŞI SATIŞ USD", "azerbaycan yeni liste", Logo'da Yerel/İşlem/Raporlama dövizi seçenekleri                         | Belge para birimi + kur anlık görüntüsü (snapshot) + TRY karşılığı her satırda saklanır                          |
| Statü hack'i                  | Ö/S/K/B/X harfleri + satırların **renklendirilmesi** (kırmızı/mor/turuncu/cyan) — satışçılar durumu renkle takip ediyor | 8 adımlı net durum hattı + zaman çizelgesi; renkler kullanıcı tanımlı **etiket** olarak kalır                    |
| Kısmi sevkiyat                | Sipariş satırında "Bekleyen" sütunu                                                                                     | Satırda `orderedQty / reservedQty / shippedQty` günden bir                                                       |
| Ürün alanları                 | Türü(TM), Kod, Açıklama, Fiyat, Ana Birim, Fiili/Gerçek Stok, Konsinye, Özel Kod, Grup Kodu, **Üretici Kodu**           | Üretici kodu ve grup kodu ürün kartında; konsinye V2                                                             |
| Fiili vs Gerçek stok          | Logo'nun iki stok kavramı                                                                                               | `onHand` (mevcut) / `reserved` (rezerve) / `available` (satılabilir) — SAP ATP mantığı                           |
| Eksi stok var                 | Listede `-20` kırmızı                                                                                                   | Kiracı ayarı: `allowNegativeStock` (varsayılan kapalı, uyarı ile açılabilir)                                     |
| Cari hiyerarşisi              | Kodlar `120.04.0016` (Belek), `120.05.xxxx` (Manavgat), `320.01.xxxx` (İstanbul tedarikçiler)                           | Tek `BusinessPartner` tablosu (Alıcı/Satıcı/Her ikisi) + **grup/bölge**; kod formatı serbest, TDHP uyumlu        |
| Belge No & Özel Kod           | "sea life kasık", "bfa teklif", "Kitchen Supplies" — serbest metin referanslar                                          | `reference` (serbest) + `tags[]`; listede aranabilir                                                             |
| Satış elemanı                 | Her siparişte "Satış E." kodu (888, 006, 026…)                                                                          | `salesRepId` belge başlığında; performans raporları buradan                                                      |
| Ürün arama acısı              | Ctrl+F → modal → alan seç → metin yaz                                                                                   | Anlık arama (yazarken), fasetli filtre (marka/kategori/fiyat/stok), klavye ile satır ekleme                      |
| Birimler                      | Her şey ADET ama cam eşya kolili satılır                                                                                | Ürün: ana birim + opsiyonel paket birimi (koli) ve içi adet; satırda birim seçimi                                |
| Ürün seçicide "Alternatifler" | Logo'da alternatif malzeme                                                                                              | V2 (şemada `ProductAlternative` yeri ayrılır)                                                                    |

---

## 2. Ürün konumlandırma ve lisans modeli

- **Hedef segment:** 5–200 kullanıcılı toptancı/distribütör (HoReCa, yapı malzemesi, ambalaj, gıda dışı hızlı tüketim).
- **Lisans (Logo/SAP mantığı):** yıllık abonelik = _isimli kullanıcı sayısı_ × _modül paketi_.
  - Paketler: **Satış** (cari, ürün, teklif, sipariş, PDF, dashboard) · **Depo** (depo, stok, sevkiyat) · **Rapor** · (V2) **Finans**, **e-Belge**, **Satın alma**.
  - Kodda karşılığı: `License { modules[], userLimit, validUntil, signature }` → feature flag'ler. Modül kapalıysa menü ve API kapalı.
- **Dağıtım:** aynı kod tabanı ile (a) SaaS: `firma.cora.example.com`, (b) müşteri sunucusuna kurulum (büyük firmalar ister). Bu yüzden **tek DB + `tenantId`** deseni.
- **Logo ile birlikte yaşama:** ilk müşteri Logo'yu muhasebe/e-fatura için tutmaya devam edecek. Cora V1:
  - Logo Excel dışa aktarımlarından **ürün, cari, açılış stoğu** içe aktarır (Geçiş Sihirbazı).
  - Sevk edilen siparişleri Logo'ya aktarılabilir Excel formatında dışa verir. (V2: LogoConnect / REST entegrasyonu.)

---

## 3. Teknoloji yığını

| Katman          | Seçim                                                                                                  | Neden                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Monorepo        | pnpm workspaces + Turborepo, TypeScript strict                                                         | Tek dil, paylaşılan tipler, düşük bilişsel yük                                 |
| Backend         | **NestJS** + **Prisma** + **PostgreSQL 16**                                                            | Modüler yapı ERP modüllerine birebir oturur; OpenAPI otomatik; entegrasyonlar için bağımsız API |
| Kuyruk/önbellek | Redis 7 + BullMQ                                                                                       | PDF üretimi, e-posta, rapor önbelleği, kur çekme                                                |
| Frontend        | **Next.js (App Router)** + React + Tailwind + shadcn/ui + TanStack Query/Table + react-hook-form + zod | Hızlı, klavye dostu veri ekranları; virtualized tablolar                                        |
| Paylaşılan      | `packages/shared`: enum'lar, zod DTO'lar, **fiyat/KDV hesap motoru**, durum makinesi                   | Hesaplama tek yerde; web ve api aynı kuralı kullanır                                            |
| Dosya           | MinIO (S3 uyumlu) + `sharp` ile thumbnail                                                              | Ürün fotoğrafı çekirdek özellik (PDF ve Excel'e giriyor)                                        |
| PDF             | **Gotenberg** (Chromium, HTML→PDF) konteyneri                                                          | Türkçe font, fotoğraf, marka şablonu sorunsuz; şablon = HTML                                    |
| Excel           | **ExcelJS**                                                                                            | Hücreye gömülü fotoğraf destekler → "fotoğraf aktarım problemi" çözülür                         |
| E-posta         | Nodemailer (SMTP, kiracı ayarı); dev'de Mailpit                                                        |                                                                                                 |
| Arama           | PostgreSQL `pg_trgm` + normalize edilmiş `searchText` sütunu                                           | 100k ürüne kadar yeterli; Meilisearch V2                                                        |
| Auth            | E-posta+şifre (argon2), JWT access (15 dk) + httpOnly rotating refresh; RBAC permission kodları        | V2: Azure AD/SSO (kurumsal talep)                                                               |
| Proxy/TLS       | Caddy                                                                                                  | Otomatik Let's Encrypt                                                                          |
| CI/CD           | GitHub Actions → GHCR image → `ssh cora-prod` → `docker compose up`                                    |                                                                                                 |
| Test            | Vitest (birim: hesap motoru, durum makinesi, stok), Playwright (e2e kritik akış)                       |                                                                                                 |
| Log/izleme      | pino JSON log, `/health`, Sentry (V1 sonu)                                                             |                                                                                                 |

Sürümler: kurulumda güncel **stable** sürümler doğrulanır ve pinlenir.

---

## 4. Mimari ilkeler (pazarlık yok)

1. **Multi-tenant:** her iş tablosunda `tenantId`. Prisma client extension her sorguya tenant filtresi ekler; servis katmanı `TenantContext` olmadan çalışamaz. (V1.5: Postgres RLS ikinci ağ.)
2. **Para = Decimal.** Tutarlar `Decimal(18,4)`, miktar `Decimal(18,3)`, kur `Decimal(18,6)`. `number` ile para hesabı yasak.
3. **Hesaplama tek modülde:** `packages/shared/src/pricing/` — satır net, iskonto, KDV, toplam, kâr, marj. Yuvarlama satır bazında 2 hane (Logo/e-fatura uyumu). UI önizleme için, API kayıt için **aynı fonksiyonu** çağırır; API sonucu esas kabul edilir.
4. **Belge akışı (SAP Document Flow):** her belge `sourceDocumentId` ile öncülüne bağlı: Teklif → Sipariş → İrsaliye → (V2) Fatura. UI'da "Belge Akışı" zaman çizelgesi.
5. **Durum geçişleri tek yerden:** `packages/shared/src/workflow/sales-state-machine.ts` — izinli geçişler, gerekli yetki, yan etkiler (rezerve/serbest bırak/stok düş). Servisler doğrudan `status` yazamaz.
6. **Yetki = permission kodu**, rol = paket. Maliyet/kâr alanları `cost.view` yoksa API cevabından **silinir** (UI'da gizlemek yetmez).
7. **Audit:** belge ve kart değişiklikleri `AuditLog`'a diff ile yazılır (kim, ne zaman, ne değişti). Kurumsal satışın ön şartı.
8. **Soft delete + optimistic lock:** `deletedAt`, `version` (belgelerde eşzamanlı düzenleme çakışması → 409).
9. **API-first:** UI'nın yaptığı her şey `/api/v1/...` ile yapılabilir; OpenAPI `/api/docs`. Entegrasyon satış argümanıdır.
10. **Zaman:** DB'de UTC; gösterim kiracı saat dilimi (varsayılan Europe/Istanbul).
11. **i18n hazır:** metinler `tr.json` sözlüğünde; kod ve DB İngilizce; UI Türkçe.

### 4.1 Yetki modeli

Permission kodları (`alan.eylem`): `product.read/write/import`, `partner.read/write/import`, `quote.read/write/send/approve`,
`order.read/write/cancel/edit_approved`, `sales.view_all` (yoksa sadece kendi belgeleri), `stock.read/receive/adjust`,
`warehouse.pick`, `shipment.create/post`, `cost.view`, `report.view`, `export.excel`, `user.manage`, `settings.manage`, `audit.read`.

| Rol paketi | İçerdiği izinler                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Yönetici   | Hepsi                                                                                                                              |
| Satış      | product.read, partner.read/write, quote.*, order.read/write/cancel, stock.read, export.excel, (opsiyon: cost.view, sales.view_all) |
| Depo       | product.read, order.read, stock._, warehouse.pick, shipment._                                                                      |
| Muhasebe   | partner.read/write, order.read, shipment.read, report.view, export.excel, audit.read (V2: fatura/tahsilat izinleri)                |

Roller kiracı tarafından düzenlenebilir; sistem rolleri silinemez, kopyalanıp özelleştirilir.

---

## 5. Domain modeli

### 5.1 Sözlük (Logo terimi → Cora kodu)

| Türkçe / Logo             | Cora entity                   | Not                                               |
| ------------------------- | ----------------------------- | ------------------------------------------------- |
| Malzeme kartı             | `Product`                     | SAP: Material                                     |
| Cari hesap (Alıcı/Satıcı) | `BusinessPartner` (`type`)    | SAP: Business Partner; Logo CLCARD gibi tek tablo |
| Satış teklifi (Ö)         | `SalesDocument type=QUOTE`    | SAP: VA21                                         |
| Satış siparişi            | `SalesDocument type=ORDER`    | SAP: VA01                                         |
| Satış irsaliyesi          | `Shipment`                    | SAP: Delivery (VL01N)                             |
| Ambar                     | `Warehouse`                   |                                                   |
| Fiili / Gerçek stok       | `onHand` / `available`        | ATP                                               |
| Fiş no                    | `number` (`DocumentSequence`) |                                                   |
| Belge no                  | `reference`                   | serbest metin                                     |
| Özel kod                  | `tags[]`                      |                                                   |
| Satış elemanı             | `salesRepId` → `User`         |                                                   |
| Ödeme planı               | `paymentTerms` (metin + gün)  | V2: yapısal                                       |
| Malzeme fişi (giriş)      | `StockReceipt`                | V1'de manuel stok girişi                          |

### 5.2 Entity'ler ve kritik alanlar

**Kimlik & kiracı**

- `Tenant(id, name, slug, timezone, settings jsonb, createdAt)`
- `User(id, tenantId, email, passwordHash, fullName, phone, isActive, repCode, lastLoginAt)`
- `Role(id, tenantId, name, isSystem)`, `Permission(code, group)`, `RolePermission`, `UserRole`
- `License(tenantId, key, modules[], userLimit, validUntil, signature)`
- `Setting(tenantId, key, value jsonb)` → firma bilgileri, logo, varsayılan KDV, teklif geçerlilik günü, `allowNegativeStock`, `autoSendToWarehouse`, numara formatları

**Kartlar**

- `BusinessPartner(id, tenantId, code, name, name2, type CUSTOMER|SUPPLIER|BOTH, groupId, taxOffice, taxNumber, phone, email, website, city, country, currency, paymentTermDays, paymentTerms, salesRepId, priceListId?, defaultDiscountRate?, creditLimit?, externalBalance?, externalBalanceDate?, notes, tags[], isActive)`
  - `externalBalance`: Logo'dan içe aktarılan bakiye (V1'de fatura/tahsilat olmadığı için "açık bakiye" böyle gösterilir — dürüst kapsam).
- `PartnerContact(id, partnerId, name, title, phone, email, isPrimary)`
- `PartnerAddress(id, partnerId, type BILLING|SHIPPING, title, line1, line2, district, city, postalCode, country, isDefault)`
- `PartnerGroup(id, tenantId, code, name)` — bölge/segment
- `Brand`, `Category(parentId)`, `Unit(code, name, decimals)`
- `Product(id, tenantId, code, name, description, brandId, categoryId, supplierId→BusinessPartner, unitId, packageUnitId?, packageQty?, barcode, manufacturerCode, groupCode, vatRate, currency, purchasePrice, salesPrice, minStock, isActive, primaryImageId, attributes jsonb, tags[], searchText)`
- `ProductImage(id, productId, objectKey, thumbKey, sortOrder)`
- `ProductPriceHistory(id, productId, kind PURCHASE|SALES, price, currency, validFrom, userId)`
- `PriceList(id, tenantId, name, currency)`, `PriceListItem(priceListId, productId, price)` — müşteri özel fiyat
- `ProductAlternative(productId, alternativeId)` — V2 için ayrılmış

**Stok**

- `Warehouse(id, tenantId, code, name, isDefault, isActive)`
- `StockLevel(productId, warehouseId, onHand, reserved)` — `available` hesaplanır; unique (product, warehouse)
- `StockMovement(id, tenantId, productId, warehouseId, qty ±, type RECEIPT|SALE|ADJUSTMENT|TRANSFER_IN|TRANSFER_OUT|COUNT, refType, refId, unitCost, note, userId, createdAt)` — değişmez defter (ledger)
- `StockReceipt(id, tenantId, number, warehouseId, supplierId?, date, note, status)` + `StockReceiptLine(productId, qty, unitCost)` — V1'de stok girişinin tek yolu (+ Excel açılış stoğu)

**Satış**

- `SalesDocument(id, tenantId, type QUOTE|ORDER, number, date, validUntil, partnerId, contactId, shippingAddressId, salesRepId, status, currency, exchangeRate, rateDate, priceIncludesVat, subtotal, discountTotal, vatTotal, grandTotal, subtotalLocal, vatTotalLocal, grandTotalLocal, costTotalLocal, profitLocal, marginPct, paymentTerms, deliveryDate, notes, internalNotes, reference, tags[], sourceDocumentId, version, createdBy, sentAt, approvedAt, approvedBy, cancelledAt, cancelReason)`
- `SalesDocumentLine(id, documentId, lineNo, productId, description, qty, unitId, unitFactor, unitPrice, discountRate, discountAmount, vatRate, lineNet, lineVat, lineTotal, unitCostLocal, lineProfitLocal, warehouseId, reservedQty, shippedQty)`
- `DocumentStatusHistory(id, documentId, fromStatus, toStatus, userId, at, note)`
- `WarehouseTask(id, orderId, status, assignedTo, startedAt, readyAt, note)` — hazırlama süresi KPI'ı
- `Shipment(id, tenantId, number, orderId, partnerId, warehouseId, date, status DRAFT|POSTED|CANCELLED, carrier, vehiclePlate, driverName, packageCount, shippingAddress jsonb, notes, postedAt, postedBy)`
- `ShipmentLine(id, shipmentId, orderLineId, productId, qty)`
- `EmailLog(id, tenantId, documentId, to, subject, status, error, sentAt)`

**Sistem**

- `ExchangeRate(tenantId?, date, currency, rate, source TCMB|MANUAL)` — TCMB günlük çekme işi (BullMQ, 15:35 TR)
- `DocumentSequence(tenantId, docType, year, prefix, lastNumber)` — `SELECT … FOR UPDATE` ile atomik
- `AuditLog(id, tenantId, userId, entity, entityId, action, diff jsonb, ip, at)`

### 5.3 Neden teklif ve sipariş ayrı kayıt?

Aynı tabloda (`SalesDocument`) ama **iki kayıt**: teklif onaylanınca sipariş kopyalanır ve `sourceDocumentId` ile bağlanır.
Teklif revizyon görebilir, sipariş dondurulmuş onaylı hâldir; dönüşüm oranı raporu ve belge akışı buradan çıkar.
Sipariş doğrudan da açılabilir (teklifsiz) — Logo kullanıcı alışkanlığı.

---

## 6. Durum makinesi ve belge akışı

Kullanıcının istediği 8 adım ana hat; dallar eklendi.

| #   | Durum (UI)                | Kod                    | Belge                       | Kim                                           | Sistem yan etkisi                                                |
| --- | ------------------------- | ---------------------- | --------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Taslak                    | `DRAFT`                | Teklif/Sipariş              | Satışçı                                       | —                                                                |
| 2   | Müşteriye Gönderildi      | `SENT`                 | Teklif                      | Satışçı (PDF/e-posta)                         | `sentAt`                                                         |
| 3   | Onaylandı                 | `APPROVED`             | Teklif → **Sipariş oluşur** | Satışçı (`quote.approve`)                     | Sipariş kopyalanır; **stok rezerve**                             |
| —   | Reddedildi / Süresi Doldu | `REJECTED` / `EXPIRED` | Teklif                      | Satışçı / zamanlanmış iş                      | —                                                                |
| 4   | Depoya İletildi           | `SENT_TO_WAREHOUSE`    | Sipariş                     | Otomatik (`autoSendToWarehouse`) veya satışçı | Depo kuyruğuna düşer                                             |
| 5   | Hazırlanıyor              | `PICKING`              | Sipariş                     | Depo (`warehouse.pick`)                       | `WarehouseTask.startedAt`                                        |
| 6   | Hazır                     | `READY`                | Sipariş                     | Depo                                          | `readyAt`                                                        |
| 7   | Sevk Edildi               | `SHIPPED`              | Sipariş                     | İrsaliye **post** edilince                    | `onHand -=`, `reserved -=`, `StockMovement SALE`                 |
| 7b  | Kısmi Sevk                | `PARTIALLY_SHIPPED`    | Sipariş                     | Kısmi irsaliye                                | Sevk edilen satırlar düşer                                       |
| 8   | Tamamlandı                | `COMPLETED`            | Sipariş                     | Otomatik (tüm satırlar sevk)                  | —                                                                |
| —   | İptal                     | `CANCELLED`            | Her ikisi                   | `order.cancel`                                | Rezerv serbest bırakılır; sevk edilmişse iptal **yok** (iade V2) |

Kurallar:

- Geçiş tablosu `sales-state-machine.ts` içinde `{from, to, permission, guard(), effects[]}` olarak tanımlıdır; testlidir.
- Onaylı siparişte satır değişikliği: sadece `order.edit_approved` yetkisiyle ve rezerv yeniden hesaplanarak.
- Zaman çizelgesi (UI): `DocumentStatusHistory` + bağlı belgeler (teklif no, sipariş no, irsaliye no'ları) tek kartta.

---

## 7. Stok mantığı (ATP)

- `available = onHand − reserved` — listede ve ürün kartında **üç sayı** birlikte gösterilir.
- Rezervasyon: sipariş onayında satır bazında, satırın deposundan; yetmiyorsa `allowNegativeStock` kapalıysa **onay reddedilir** ve eksik miktar gösterilir (satışçı miktarı düşürür veya depo değiştirir).
- Sevk: irsaliye post → hareket defterine `SALE` kaydı; stok seviyesi defterden türetilebilir olmalı (tutarlılık job'ı gece kontrol eder).
- Kritik stok: `available < minStock` → dashboard uyarısı + ürün listesinde rozet.
- Sayım/düzeltme: `ADJUSTMENT` hareketi (`stock.adjust` yetkisi, sebep zorunlu).

---

## 8. Fiyat ve döviz

- Belge para birimi (TRY/USD/EUR) + `exchangeRate` belge tarihinde dondurulur; kur değişse belge değişmez.
- Fiyat çözümleme sırası: satır elle girilen → müşteri fiyat listesi → ürün satış fiyatı (döviz dönüşümü ile).
- Hesap (satır): `gross = qty × unitPrice` → `net = gross − discount` → `vat = net × vatRate` (2 hane yuvarla) → toplamlar = satırların toplamı.
- Maliyet: satıra `unitCostLocal` = ürünün o anki alış fiyatı (TRY) snapshot'ı; `profit = netLocal − qty × unitCostLocal`. Yetkisiz kullanıcıya bu alanlar API'den gitmez.
- Kâr marjı = `profit / netLocal`.

---

## 9. Ürün arama

- `Product.searchText` = kod + ad + açıklama + marka + üretici kodu + barkod, Türkçe karakter katlanmış küçük harf (İ→i, I→ı, Ş→s…), yazarken güncellenir; `pg_trgm` GIN indeksi.
- API: `GET /products?q=tuzluk&brand=alkan&priceMin=100&priceMax=200&inStock=true&sort=…` → 50 ms hedefi.
- UI: tek arama kutusu + sol fasetler (marka, kategori, stok durumu, fiyat aralığı); klavye ile satır seçip **Enter** ile teklife ekleme; fotoğraf thumbnail listede.
- Teklif editöründe aynı bileşen "hızlı ekleme" modunda (Logo'nun "Kodu'na çift tıkla" akışının yerine).

---

## 10. PDF, Excel, e-posta

- **PDF teklif:** `templates/quote.html` (Handlebars) → Gotenberg → MinIO → imzalı link. Şablonda firma logosu, müşteri, teklif no, tarih, geçerlilik, satış temsilcisi, satırlar (fotoğraf thumbnail), iskonto, KDV, genel toplam, ödeme koşulları. Kiracı şablonu özelleştirebilir (V1: logo/renk/alt metin).
- **E-posta ile gönder:** BullMQ job; `EmailLog`; gönderim başarılıysa durum `SENT`.
- **Excel:** ExcelJS; ürün listesi/sipariş için fotoğraf hücreye gömülü (satır yüksekliği ayarlı, 96px thumbnail). Import: Logo Excel'i sütun eşleme sihirbazı (ürün, cari, açılış stoğu).

---

## 11. Dashboard ve raporlar

- Role göre varsayılan dashboard (yönetici/satış/depo). KPI'lar: günlük/aylık ciro, bekleyen teklif, onaylı/hazırlanan/sevkteki sipariş, kâr, marj, kritik stok, en çok satan 10, en yüksek cirolu 10 müşteri, satışçı performansı.
- V1: indeksli SQL sorguları + 60 sn Redis önbellek. 500k satır sonrası materialized view + gece refresh.
- Raporlar: satış (gün/hafta/ay/yıl), ürün (çok/az satan, kârlı/kârsız), müşteri (ciro, sipariş sayısı, kârlılık), satışçı (teklif, sipariş, ciro, kâr, dönüşüm oranı). Hepsi Excel'e aktarılır.

---

## 12. Deployment

Öneri: staging ayrı bir alt alan adında koşsun; ürün canlıya `cora.example.com` (kiracılar `firma.cora.example.com`) ile çıksın.

Sunucu: Ubuntu 24.04, en az 4 vCPU / 8 GB RAM / 80 GB NVMe. Tek `docker compose`:

| Servis      | Görev                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| `caddy`     | 80/443, otomatik TLS, `/api/*` → api, diğer → web                           |
| `web`       | Next.js                                                                     |
| `api`       | NestJS                                                                      |
| `worker`    | BullMQ işleri (PDF, e-posta, kur, raporlar)                                 |
| `postgres`  | 16, volume, sadece iç ağ                                                    |
| `redis`     | 7                                                                           |
| `minio`     | dosyalar (bucket: `cora-files`)                                             |
| `gotenberg` | PDF                                                                         |
| `backup`    | gece `pg_dump` → MinIO `cora-backups` (30 gün), haftalık off-site (V1 sonu) |

Akış: `git push main` → GitHub Actions (lint, test, build, image → GHCR) → `ssh cora-prod 'cd /opt/cora && docker compose pull && docker compose up -d && docker compose exec api pnpm prisma migrate deploy'`.
Sırlar sadece sunucudaki `/opt/cora/.env` içinde; repoda `.env.example`.

---

## 13. Riskler ve dürüst notlar

1. **"Açık bakiye" V1'de gerçek değildir** — fatura/tahsilat yok. Logo bakiyesi içe aktarılıp "Dış bakiye (tarih)" olarak gösterilir. Müşteriye böyle anlatılmalı.
2. **Stok girişi** V1 listesinde yoktu; `StockReceipt` olmadan stok hiç artmaz. Eklendi.
3. **Kısmi sevkiyat** ilk günden şemada olmalı; sonradan eklemek en pahalı değişikliktir.
4. **Çift yaşam (Logo + Cora)**: pilotta veri iki yerde olacak. Geçiş sihirbazı ve Logo'ya Excel dışa aktarımı bu yüzden V1'de.
5. **Marka:** "Cora" adıyla kayıtlı yazılım markaları var; Türk Patent'te sınıf 9/42 sorgusu yapılmalı.
6. **Kapsam sürüklenmesi:** her paket tek modül. "Hazır olmadan" sonraki modüle geçilmez (Definition of Done `docs/INVARIANTS.md`'de).
