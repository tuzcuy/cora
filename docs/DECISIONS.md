# DECISIONS — Cora

Mimariyle tutarlı, şartnamede açıkça yazmayan kararlar burada. En yeni en üstte.

## 2026-09-07

### D-049 — Boş query paramları elenir; irsaliye kesmek siparişi her SHIPPABLE durumdan ilerletir

Canlı denetimde Sevkiyat ve İade ekranları bozuktu; iki eş-sınıf düzeltme:

1. **Boş enum query paramı = filtre yok.** Web liste ekranları "tümü" için boş string gönderiyor (ör. `?status=`).
   `ZodValidationPipe` artık `metadata.type === 'query'` iken boş string değerleri parse'tan önce eler; gövde (`body`)
   dokunulmaz (form bir alanı `''` ile temizleyebilir). İsteğe bağlı enum/filtreler artık 400 vermez. Birim testli.
2. **Sevkiyat kısayolu durum makinesini de ilerletir.** `SHIPPABLE` (shipments.service) APPROVED/SENT_TO_WAREHOUSE/
   PICKING'ten de irsaliye kesmeye izin veriyor ama durum makinesi yalnız READY/PARTIALLY_SHIPPED → SHIPPED
   tanımlıyordu; post edilen sipariş stok düşmesine rağmen eski durumda kalıyordu. Bu üç erken durumdan
   SHIPPED/PARTIALLY_SHIPPED geçişleri eklendi; stok etkileri irsaliye servisinde uygulandığından
   (`skipStockPosting`) bu geçişler yalnız sipariş durumunu ilerletir. `sales-state-machine.test.ts` +9 test.

### D-048 — Render `startCommand`'ında seed yok; cold start veriyi ezmez

API Render'da ücretsiz katmanda çalışıyor ve boştayken uyuyor; her uyanış (cold start) `startCommand`'ı yeniden
koşturur. `startCommand` içinde `db:seed` bulunması, her cold start'ta demo seed'ini tekrar çalıştırıp
operatörün canlı değişikliklerini (rol/yetki, ayar, kur, kart) eziyordu — seed `rolePermission.deleteMany` +
ayar/kur upsert'lerini bulk-guard'dan önce yapıyor. Karar: **Render `startCommand` yalnızca API'yi başlatır
(`pnpm start:api`)**; şema `RUN_MIGRATIONS=true` ile boot'ta `prisma migrate deploy` olarak gelir; seed
**bir kereye mahsus** elle/CI adımıdır, cold start yolunda asla yer almaz. (İlk düzeltme `831daf4`'te yapılmıştı;
bu makineye taşınırken `startCommand`'dan `db:seed` yeniden elle çıkarıldı — 2026-09-07.)

## 2026-09-05

### D-047 — Yedek: Cora geri yüklemez, tatbikatı doğrular

Yönetilen veritabanını (Render) uygulama geri yükleyemez. `/ops/backup-report` belge, hareket, cari ve ürün
sayılarıyla son yazma zamanını verir; ekranda altı adımlık tatbikat listesi durur (yedeği indir → kopyaya
`pg_restore` → API'yi kopyaya bağla → sayıları karşılaştır → geri al → tarihi karar günlüğüne yaz). Rapor, "yedek
var" demez; tatbikatın doğrulanmasını sağlar.

### D-046 — KVKK: günlükler süreyle silinir, ticari belge kalır, cari anonimleşir

Saklama süreleri `Setting.retention` içinde: işlem günlüğü 730, e-posta günlüğü 365, ticari belgeler 3650 gün,
silinmiş cari kartı 365 gün. `/ops/retention/run` önce ne silineceğini gösterir (`apply=false`), sonra uygular.
Silme talebinde cari kartının kişisel alanları anonimleştirilir (`(KVKK silindi) <kod>`), kişiler silinir,
adres satırı boşaltılır; **ticari belgeler yasal saklama gereği durur** ve işlem günlüğüne talep sebebiyle yazılır.
Erişim talebi `/ops/personal-data/...` tek JSON döndürür ve bu okuma da audit'e düşer.

### D-045 — `tenantId` taşımayan alt tablolar ebeveyn üzerinden kapsanır

`StockLevel`, `SalesDocumentLine`, `PartnerAddress` gibi alt tablolarda `tenantId` kolonu yok; uzantı bunları
"ebeveyn üzerinden kapsanır" diye atlıyordu. Doğrudan bir `stockLevel.findMany()` (P10 bildirimleri) başka
kiracının satırlarını görebiliyordu. Uzantıya `CHILD_PARENT` haritası eklendi: okuma ve toplu yazmada
`where` içine `{ <ebeveyn>: { tenantId } }` enjekte edilir, çağıran zaten ebeveyne filtre yazmışsa dokunulmaz.
Kural 1'in kapanmamış son deliğiydi; `security.spec.ts` iki testle kanıtlıyor.

### D-044 — e-Belge kuyruğu belge başına tekil, ETTN Cora'da üretilir

`EDocument` satırı kaynak belge (Shipment veya SalesDocument) başına tekildir: ERROR/CANCELLED/REJECTED dışında
bir kayıt varsa yeniden kuyruğa alma aynı kaydı döndürür — böylece aynı sevkiyat iki kez faturalanmaz. ETTN
(`cbc:UUID`) Cora'da üretilir ve tekrar denemede korunur; entegratör "aynı ETTN" (1300) yanıtı verirse belge
mükerrer değil, tekrar denemedir. GİB/entegratör kodları `GIB_ERRORS` ile Türkçeye çevrilir; bilinmeyen kodda
ham mesaj gösterilir.

### D-043 — e-Belge: sağlayıcı arayüzü + NullProvider varsayılanı, mali mühür Cora'da değil

`EInvoiceProvider` sözleşmesi dört işten ibarettir: `sendInvoice`, `sendDespatch`, `queryStatus`, `getIncoming`.
V1 varsayılanı `NullProvider`: belgeyi hazırlar, kuyruğa yazar ve "entegratör tanımlı değil" der — sessiz başarı
üretmez. `HttpProviderAdapter` gerçek entegratör için iskelettir (`EDOC_BASE_URL/USER/PASS`), yalnız istek/yanıt
eşlemesi değişir. **Mali mühür Cora'da tutulmaz**: imzalama ve GİB'e iletim entegratörde kalır; Cora payload,
kuyruk durumu ve yanıtı saklar.

### D-042 — İşlem günlüğü ekranı: diff'i olduğu gibi göster

`AuditLog.diff` alan bazında `{from,to}` tutar; ekran satıra tıklayınca bu haritayı tablo olarak gösterir,
yorumlamaz. Şifre/token alanları `AuditService.buildDiff` içinde zaten maskelenir. Liste kayıt tipi ve işlem
önekiyle filtrelenir (`status:` yazınca tüm durum geçişleri gelir).

### D-041 — Döviz kuru: TCMB'den çek veya elle gir, kaynak saklanır

`ExchangeRate` satırı `source` alanıyla TCMB/MANUAL ayrımını taşır; günlük tekil (`tenantId+date+currency`).
TCMB XML'i küçük bir regex ile ayrıştırılır (yeni bağımlılık yok) ve `ForexSelling` alınır; ulaşılamazsa hata
kullanıcıya söylenir, sessizce geçilmez. Belgeler kuru kendi tarihinde dondurmaya devam eder (P04).

### D-040 — Kullanıcı silinmez, pasifleşir; şifre bir kez gösterilir

Belgeler `createdById`/`salesRepId` ile kullanıcıya bağlı olduğundan silme yok: `isActive=false`. Kullanıcı
kendi hesabını pasifleştiremez. Yeni kullanıcıda veya sıfırlamada şifre üretilir ve **yalnız o yanıtta** düz
metin döner; veritabanında argon2 hash'i durur. `AdminService` argon2'yi import etmez, hash fonksiyonu dışarıdan
verilir — native modül test koşucusunda çöküyor (D-018 ailesi).

### D-039 — Cari ekstre ve risk: belge tabanlı, muhasebe entegrasyonu olmadan

Ekstre `openingBalance` ile başlar; açık/kapanmış ORDER belgeleri borç, RETURN belgeleri alacak sayılır ve
yürüyen bakiye hesaplanır. Kredi riski = `openingBalance + externalBalance + açık siparişlerin toplamı`;
açık sayılan durumlar APPROVED…SHIPPED. Tahsilat/fatura kaydı V1'de yok, dış bakiye elle güncellenir
(`PATCH /partners/:id/balance`) — bu alan muhasebe entegrasyonunun bağlanacağı yer.

### D-038 — Toplu fiyat güncelleme: önce önizleme, her değişiklik geçmişe

`POST /pricing/bulk-update` `dryRun` ile hiçbir şey yazmadan etkilenecek satırları döndürür; uygulandığında her
üründe `ProductPriceHistory` satırı (kim, ne zaman, hangi fiyat) oluşur. Yuvarlama seçenekleri 0,01 / 0,05 /
0,10 / 1 veya yok. Kâr/marj hesabı fiyat motorunda olduğu için ekranlarda ayrıca hesaplama yapılmaz.

### D-037 — Fiyat çözümleme: kademe listeyi geçebilir, manuel her şeyi geçer

P04'te stub bırakılan iki adım P07'de dolduruldu ve editör hiç değişmedi. Sıra: manuel → (müşteri fiyat listesi,
yoksa varsayılan liste) → miktar kademesi → ürün satış fiyatı → kur. Kademe listeyle birlikte değerlendirilir:
listede fiyat varsa kademe iskontosu o fiyata uygulanır ve **daha düşük olan** kazanır. Kademeler liste satırına
(`PriceTier.itemId`) ya da doğrudan ürüne (`productId`) bağlanabilir; eşiği geçen en yüksek `minQty` uygulanır.
`PriceResolverService` `PrismaService`'i opsiyonel alır, böylece birim testlerde veritabanı gerekmez.

### D-036 — E-posta: SMTP yoksa kuyruk, sessiz başarı yok

`MailService` SMTP ortam değişkenleriyle çalışır (`SMTP_HOST/PORT/USER/PASS/FROM`). Tanımlı değilse mesaj
`EmailLog`'a `QUEUED` olarak yazılır ve arayüz "SMTP tanımlı değil, kuyruğa alındı" der; gönderilmiş gibi
göstermeyiz. Başarılı veya kuyruklanmış gönderimde taslak teklif durum makinesi üzerinden `SENT`'e geçer.

### D-035 — İçe aktarım sihirbazı: analiz + uygula, açılış stoğu giriş fişi olur

`POST /documents/import/analyze` dosyayı okur, başlıkları Türkçe katlamayla alan adlarına eşler, ilk 20 satırı
önizler ve uyarıları döndürür: zorunlu alan boş, dosyada tekrar eden kod, okunamayan sayı, geçersiz e-posta ve
"kayıt zaten var — güncellenecek". `POST /documents/import/commit` mevcut kodu günceller, yenisini yaratır;
`openingStock` girilmişse **POSTED bir giriş fişi** ve `RECEIPT` hareketleri yazar (kural 8 — stok yalnız
ledger'dan artar). Hatalı satırlar CSV olarak indirilir. Türkçe ondalık: `1.234,56` → `1234.56`.

### D-034 — Excel dışa aktarımında fotoğraf hücreye gömülür

`exceljs` ile ürün görseli `editAs: 'oneCell'` çapasıyla satıra bağlanır; dosya tek parça `.xlsx` olarak iner,
görseller ayrı klasör değildir. Müşterinin mevcut sisteminde çözülemeyen sorun bu olduğu için birinci sınıf
özellik: liste filtresi neyse o aktarılır, maliyet/kâr sütunları yalnız `cost.view` ile eklenir.

### D-033 — Ürün görselleri veritabanında (Bytes), MinIO değil

Hedef ortamda nesne deposu yok ve Render ücretsiz katmanında kalıcı disk yok; MinIO tutulamayacak bir söz olurdu.
Görseller `ProductImage.data` (bytea, ≤2 MB, PNG/JPEG/WebP) olarak saklanır ve `/api/v1/files/images/:id`
üzerinden servis edilir. PDF ve Excel aynı baytları data URL olarak gömer. VPS'e geçilince aynı arayüzle S3/MinIO
sürücüsü eklenebilir; şema değişmez.

### D-032b — PDF: pdfmake 0.2 + paketin kendi Roboto'su

D-013 gereği Chromium yok. `pdfmake@0.2` senkron `createPdfKitDocument` API'siyle kullanılır; fontlar paketin
`build/vfs_fonts.js` base64 gömülüsünden Buffer olarak yüklenir (Roboto Türkçe karakterleri kapsar), böylece
repoya font dosyası girmez ve çalışma anında indirme olmaz. pdfmake 0.3 asenkron ve `urlResolver` gerektirdiği
için tercih edilmedi.

### D-032 — İade: RETURN tipinde satış belgesi, tutarlar pozitif

İade ayrı bir tablo değil, `SalesDocumentType.RETURN` tipinde bir `SalesDocument`; `sourceDocumentId` orijinal
siparişe bağlar. Satır tutarları pozitif tutulur (belgenin tipi onu alacak yapar); raporlarda RETURN belgeleri
düşülür. Durum akışı DRAFT → APPROVED (etki: `POST_STOCK_RETURN` → `RETURN_IN` hareketi + `onHand` artışı +
sipariş satırında `returnedQty`) → COMPLETED. Aynı satır iki kez iade edilemez; `shippedQty − returnedQty` sınırdır.

### D-031 — e-İrsaliye alanları şimdi eklendi (UBL-TR 1.2)

`Shipment` tablosu V1'de doldurulmayan ama şemada duran UBL-TR alanlarını taşır: `ublUuid` (ETTN),
`ublProfileId` (TEMELIRSALIYE), `ublTypeCode` (SEVK), `issueTime`, `actualDespatchDate`, `deliveryTermsCode`,
`carrierVkn`/`carrierTitle`, `driverTckn`, `trailerPlate`, `grossWeightKg`, `packageTypeCode` ve
`gibStatus`/`gibUuid`/`sentToGibAt`. Sebep: sonradan eklemek belge tablosunu ve tüm irsaliye akışını yeniden
yazmak demekti. P09'daki sağlayıcı adaptörü bu alanları yalnız okuyacak; mali mühür Cora'da tutulmaz.

### D-030 — Toplama miktarı sipariş satırında (`pickedQty`)

Ayrı `WarehouseTaskLine` tablosu yerine toplanan miktar `SalesDocumentLine.pickedQty`'de tutulur: irsaliye ekranı
"ne toplandıysa onu" önerebiliyor, sayfa başına ek join gerekmiyor. `WarehouseTask` sadece görev durumu
(PENDING/PICKING/READY) ve atama için kalır. Barkod okutma `pickedQty`'yi artırır; sipariş miktarını aşan okutma
reddedilir ve hangi üründe kaç fazla okutulduğu söylenir.

### D-029 — Stok yalnız `move()` üzerinden değişir; transfer/sayım/düzeltme aynı kapıdan geçer

`StockService.move()` tek yazma noktasıdır: `StockMovement` satırını yazar ve `StockLevel.onHand`'i aynı
transaction içinde aynı delta ile taşır (kural 8). Düzeltme sebebi zorunlu ve harekette saklanır; transfer tek
transaction'da `TRANSFER_OUT` + `TRANSFER_IN` (`refType='TRANSFER'`, ortak `refId`) yazar; sayım fişi açılışta
sistem miktarını dondurur ve yalnız farklı satırlar için `COUNT` hareketi üretir. Giriş fişi işlenince ürünün
`purchasePrice`'ı eldeki stokla ağırlıklı ortalanır ve `ProductPriceHistory`'ye yazılır. İrsaliye `SALE`
hareketini kendi yazdığı için `transition(..., { skipStockPosting: true })` ile durum makinesinin ikinci kez
stok düşmesi engellenir.

### D-028 — Editör: statik export rotaları, otomatik kayıt yalnız taslakta, sunucu hesabı kazanır

`/quotes/new/` ve `/orders/new/` ayrı statik rotalar; düzenleme `?id=` ile (D-014). Toplamlar istemcide
`@cora/shared` `calculateDocument` ile anlık önizlenir, kayıtta sunucu aynı motorla yeniden hesaplar ve sunucu
sonucu ekrana geri yazılır (A1). Otomatik kayıt yalnız `DRAFT` belgede: 30 sn'de bir ve satır eklendikten 1,5 sn
sonra; onaylı belgede (`order.edit_approved`) sadece Ctrl+S. İlk otomatik kayıt belgeyi yaratınca adres çubuğu
`history.replaceState` ile güncellenir (router gezinmesi editörü yeniden monte edip yazılanları düşürürdü) ve
istek sürerken yapılan düzenlemeler sunucu cevabıyla ezilmez; belge "kaydedilmedi" kalır, sonraki kayıt gönderir. Satır altındaki "satılabilir" bilgisi ürün arama
sonucundan gelir; sunucudan yüklenen satırlarda yeniden aranmaz (guard mesajı zaten otoriter).

### D-027 — `APPROVAL_PENDING` yönlendirmesi ve guard sınıfları

`→ APPROVED` isteğinde guard'lar üç sınıfa ayrılır: **blocker** (stok ATP yetersiz → 409, ürün/eksik/diğer depo
mesajı), **onay gerektiren uyarı** (marj < `Setting.minMarginPct` [vars. 15] veya kredi limiti aşımı ve kullanıcıda
`sales.approve_low_margin` / `partner.override_credit` yok) ve **uyarı**. Onay gerektiren durumda servis geçişi
`APPROVAL_PENDING`'e yönlendirir (`available-transitions` → `routesTo`), yönetici `sales.approve_low_margin` ile
`APPROVAL_PENDING → APPROVED` yapar. `CANCELLED` geçişinde not zorunlu (`cancelReason`). Her geçiş
`DocumentStatusHistory` + `AuditLog(status:<to>)` yazar.

### D-026 — Rezervasyon bir projeksiyondur; ledger'da RESERVE türü yok

`StockLevel.reserved` = açık siparişlerin (APPROVED…PARTIALLY_SHIPPED) satır `reservedQty` toplamı, temel birimde
(`qty × unitFactor`). Onay rezerve eder, iptal/serbest bırakma sıfırlar; `SHIPPED`/`COMPLETED` `POST_STOCK_SALE`
etkisiyle `SALE` `StockMovement` yazar ve `onHand` yalnız o ledger'dan düşer (kural 8). `reservedQty`/`shippedQty`
temel birimde tutulur; KOLİ satırı ADET olarak rezerve edilir.

### D-025 — Revizyon numarası `/R<n>`, kaynak belge iptal

`POST /:id/revise`: yeni belge `<no>/R<revision>` numarası, `revision+1`, `revisedFromId`; kaynak teklif state
machine üzerinden `CANCELLED` ("Revize edildi" notu). Onaylı teklif revize edilmez (sipariş üzerinden devam eder).
`copy` numarayı `DocumentSequence`'tan yeniden üretir ve `sourceDocumentId`/revizyon bağı taşımaz.
`convert` yalnız QUOTE → DRAFT ORDER, `sourceDocumentId` ile; ikinci dönüştürme 409.

### D-024 — Fiyat çözümleme sırası ve P07 için kancalar

`PriceResolverService.resolve`: **manuel** (`unitPrice` gönderildi → `isPriceOverridden=true`) → **fiyat listesi**
(P07, şimdilik `null`) → **miktar kademesi** (P07, `null`) → **ürün satış fiyatı** → belge para birimine **kur**
(belge tarihindeki kur `exchangeRate`'te dondurulur). Birim çevrimi `unitFactor` ile: `unitId === packageUnitId`
ise `packageQty`, fiyat ve maliyet `× unitFactor`. Maliyet anlık görüntüsü `unitCostLocal` satıra yazılır;
`cost.view` yoksa serializer siler.

### D-023 — Yazma yolu `BaseCrudService`: tek transaction, audit, version, soft delete

Kart varlıkları (marka, kategori, birim, depo, cari grubu) `BaseCrudService<TCreate,TUpdate>`'i genişletir.
`create/update/softDelete/restore` **tek interaktif transaction** içinde çalışır ve `AuditLog` satırı aynı tx'te
yazılır: yazma geri alınırsa audit de yoktur, yazma varsa audit kesin vardır. Optimistic lock: istemci yüklediği
`version`'ı gönderir; `updateMany({ where: { id, version } })` 0 satır etkilerse **409** + `currentVersion` döner
("Kayıt başkası tarafından değiştirildi"). Silme = `deletedAt`; "kullanımda" kontrolü **DMMF'ten türetilen**
referans ilişkileriyle yapılır (Brand/Category/PartnerGroup FK'leri `SET NULL` olduğu için DB kendiliğinden
reddetmez — servis sayar) ve 409 mesajı bağlı kayıtları listeler ("2 ürün, 1 alt kategori"). Alt sınıf yalnızca
`model`, `label` ve iki hook (`beforeWrite` — DB'nin ifade edemediği benzersizlik, `afterWrite` — "tek varsayılan
depo") tanımlar. Yazma uçları `settings.manage` / `product.write` / `partner.write` ister.

### D-022 — Belge numarası: `UPDATE … WHERE id = (SELECT … FOR UPDATE) RETURNING`

`DocumentNumberService.next(tx, docType)` çağıranın transaction'ı içinde çalışır: önce `INSERT … ON CONFLICT DO
NOTHING` ile satır garantilenir, sonra `FOR UPDATE` kilidiyle `lastNumber` artırılır. Ham SQL extension
kapsamında olmadığı için `tenantId` her ifadeye elle bağlanır. 50 paralel transaction testi (security.spec.ts §8)
1..50 aralığını boşluksuz ve tekrarsız üretir. Format `{prefix}{YYYY}-{0001}`; varsayılan prefix TEK/SIP/IRS/GIR.

### D-021 — Hata sözleşmesi: RFC 7807 + `errors` alan haritası

`ProblemJsonFilter` her hatada `type/title/status/detail/instance` verir; doğrulama ve çakışmalarda buna
`errors: { "lines[2].qty": "Miktar 0'dan büyük olmalı" }` eklenir (`_` = form geneli). Zod yolları
`lines[2].qty` biçiminde yazılır; web tarafı `toFormPath` ile `lines.2.qty`'ye çevirip react-hook-form
`setError`'a verir. Prisma hataları eşlenir: P2002 → 409 `{errors:{<kolon>: 'Bu değer zaten kullanılıyor'}}`
(`tenantId` hedefte olsa da suçlanmaz), P2003 → 409 "kullanımda", P2025 → 404. `TenantContextMissingError` →
500 `TenantContextMissing` — bir kullanıcı hatası değil, programlama hatasıdır; maskelenmez.

### D-020 — `cost.view` yoksa maliyet alanları serializer'da SİLİNİR (interceptor)

`CostFieldsInterceptor` global kayıtlıdır: kullanıcıda `cost.view` yoksa cevap gövdesinde
`purchasePrice/unitCost(Local)/costTotalLocal/lineCostLocal/profit(Local)/lineProfitLocal/marginPct/margin/
monthProfit/totalProfit` anahtarları **derinlemesine silinir** (null bırakılmaz). Servisler de bu alanları
üretmez; interceptor sonradan yazılacak her rota için son savunma hattıdır. Test `JSON.stringify` üzerinde
anahtarın hiç olmadığını doğrular.

### D-019 — Tenant extension: DMMF tabanlı sınıflandırma, sessiz geçiş yok, extended where-unique

Model listesi elle tutulmaz; `Prisma.dmmf`'ten türetilir: `tenantId` alanı olan her model kapsamda
(`TENANT_MODELS`, bugün 20), olmayanlar beyaz listede (`TENANT_FREE_MODELS`: Tenant, Permission, RolePermission,
UserRole, PartnerContact, PartnerAddress, ProductImage, ProductPriceHistory, PriceListItem, ProductAlternative,
StockLevel, StockReceiptLine, SalesDocumentLine, DocumentStatusHistory, WarehouseTask, ShipmentLine — global
referans ya da kiracılı ebeveyn üzerinden erişilen çocuk satırlar). Kapsamdaki bir modelde bağlam yoksa
**`TenantContextMissingError` fırlatılır**; tek istisna `runSystem()` (login, seed). `findUnique/update/delete/
upsert` için `tenantId` **extended where-unique** ile `where`'e eklenir (Prisma ≥5 GA): `findFirst`'e yeniden
yazmak base client'a atlar ve `$transaction` içinden **sessizce çıkar** — bu kapattığı delikten daha kötüdür.
`create/createMany`'de bağlamdaki `tenantId` çağıranın gönderdiğini ezer; `update` verisindeki `tenantId` atılır
(satır kiracı değiştiremez). `deletedAt` olan modellerde okuma ve update'e `deletedAt: null` eklenir; çağıran
`where.deletedAt` verirse ya da `withDeleted()` içindeyse eklenmez. Ham SQL kapsam dışıdır: `reports.service`
(3 sorgu, hepsi `tenantId` bağlı) ve `prisma.service.ping` (`SELECT 1`, tablo yok) denetlendi.

### D-018 — AsyncLocalStorage ve tembel Prisma promise'leri: `runSystem`/`withDeleted` içeride `await` eder

Bir Prisma sorgusu `.then` çağrılana kadar çalışmaz. `als.run(store, () => db.x.findFirst())` sorguyu **döndürür**,
`.then`'i dışarıdaki `await` çağırır ve o anda store artık yoktur. Eski extension bağlam yokken sessizce geçtiği
için bu görünmezdi; yeni extension'la `auth.service.login` bile `TenantContextMissingError` alırdı. Bu yüzden
`runSystem`, `withDeleted` ve yeni `runAsync` callback'i store içinde `await` eder ve `Promise<T>` döner. Sync
`run()` yalnızca Express middleware (`next`) içindir.

## 2026-09-04

### D-017 — Statik host'ta browser-native navigasyon

Next 16 `output: export` client-router'ı (`router.push/replace` + `<Link>`) düz statik host'ta (LiteSpeed/hcdn)
RSC `.txt` (`?_rsc=`) fetch'inde takılıp navigasyonu tamamlamıyor (URL değişmez, AuthGuard spinner'da asılı kalır —
canlıda `/dashboard` bunu yaşadı). Çözüm: tüm auth yönlendirmeleri ve menü linkleri **browser-native**
(`window.location.replace` + `<a>`). Her sayfa yüklemesinde AuthProvider cookie ile sessiz refresh yaparak oturumu
kurar. Bedeli: modüller arası tam sayfa yenileme (login-arkası ERP için kabul edilebilir). Ayrıca `api-client`
istekleri AbortController timeout + try/catch ile sarıldı — ulaşılamayan/CORS/parse hatasında UI login'e düşer.

### D-016 — Prod'da tek Web App slotu; worker inline

Hostinger Web App kotasından **tek slot** kullanılır (API). Prod'da ayrı worker süreci **yok**; BullMQ işleri
`WORKER_INLINE=true` ile API sürecinin içinde çalışır (P02'de eklenecek). `apps/worker` yalnızca Docker/VPS hedefi için durur.

### D-015 — API: Hostinger Node.js Web App (api.cora.example.com)

API, `api.cora.example.com`'da Hostinger Node.js Web Uygulaması olarak çalışır. Refresh çerezi
`domain=.cora.example.com` — böylece çerez kök alanın diğer alt alan adlarına
**sızmaz**, ama `cora.example.com` (web) ↔ `api.cora.example.com` (API) arasında paylaşılır. `SameSite=Lax` + `Secure`
(prod). **Neden None değil Lax:** `cora.example.com` ve `api.cora.example.com` aynı registrable domain
(example.com) altında → istekler cross-**origin** ama same-**site**; `SameSite=Lax` çerezleri bu isteklerde
gönderilir. `None` gereksiz zayıflatma ve üçüncü-taraf çerez engellemelerine açık hale getirir. `COOKIE_SAMESITE`
env'i kalır, prod varsayılanı `lax`. CORS allowlist: `https://cora.example.com`, `credentials: true`. Access token
**bellekte** (localStorage değil).

API hangi altyapıda çalışırsa çalışsın **MUTLAKA** `api.cora.example.com` adının arkasından sunulur. Egress kısıtı
çıkıp Render/Fly'a taşınırsa **custom domain** ile bu ad korunur. `onrender.com` gibi farklı bir registrable domain
kullanılırsa çerez **cross-site** olur; Safari bunu tamamen engeller ve oturum hiç çalışmaz.

### D-014 — Web: statik Next export, shared hosting site klasörüne rsync

Arayüz **statik Next.js export** (`output: 'export'`) olarak `cora.example.com`'un mevcut PHP/HTML site klasörüne
`rsync` ile yüklenir (SSH -p 65002). Gerekçe: paylaşımlı plan müşteri siteleriyle ortak kaynak havuzu kullanıyor;
statik arayüz **sıfır Node CPU** tüketir, ERP giriş arkasında olduğu için SSR gereksiz. SSR/BFF/middleware kaldırıldı;
rota koruması istemci tarafı (AuthGuard + sessiz refresh), yetki API'de zorlanır. Detay sayfaları **query-string**
(`/products?id=...`) — `[id]`/`generateStaticParams` yok (statik export uyumu). rsync `--delete` yalnızca `ls` ile
bulunup **onaylanan** hedef klasöre uygulanır (başka müşteri sitesini silmemek için).

### D-014a — (önceki taslak) VPS'siz taşınabilirlik minimumu — D-014/015/016 ile kesinleşti

Docker/VPS yerine yönetilen servislerle (Hostinger Node.js Web App + Supabase + Upstash) deploy hedefi eklendi.
**Şimdi yapılan minimum:** PORT/`0.0.0.0` binding, Next `output: standalone` (web sonradan **statik export**'a geçti — bkz. D-014), kök `build:*`/`start:*`
scriptleri, `.npmrc`, Prisma pooler/direct ayrımı (runtime=pooler `DATABASE_URL`, migration=`DIRECT_URL`),
`RUN_MIGRATIONS=true` ile boot'ta migrate, `apps/smoke`, `.env.hostinger.example`.
**Bilinçli ertelendi:** Storage, PDF driver, `WORKER_INLINE` — ilgili özellikler gelene kadar yazılmıyor.

- **Storage → P02** (ürün fotoğrafı ilk tüketici). İki implementasyon YAZILMAYACAK: MinIO/R2/Supabase Storage
  hepsi S3 uyumlu → **tek AWS SDK v3 client**, endpoint/credentials/forcePathStyle env'den. (Kullanıcı kararı.)
- **WORKER_INLINE → P02** (import/export job'ları gelince). Şu an çalışan zamanlanmış job **yok** (TCMB kuru
  mimaride var ama implement edilmedi), o yüzden bekletilebilir.
- **PDF driver → P08.** `apps/worker` Hostinger'a deploy edilmeyecek.
  Docker/VPS dosyaları (`deploy/`, Dockerfile'lar) **silinmedi** — ikinci hedef (on-premise kurumsal) için duruyor.

### D-013 — PDF şablonu Chromium'a bağlanmayacak

Paylaşımlı hosting hedefinde **Chromium yok** (Gotenberg çalıştırılamaz). Bu yüzden PDF teklif şablonu (P08)
Gotenberg/Chromium'a özgü CSS'e **bağlanmayacak**: modern layout hileleri, harici runtime font yükleme, Chromium'a
özgü sayfa-kırılımı numaraları kullanılmayacak. Şablon **saf JS renderer** (`@react-pdf/renderer`/`pdfmake`) varsayımıyla,
gömülü Türkçe font ile tasarlanacak. (Bu not olmazsa şablon P08'de iki kez yazılır.)

### D-012 — Tenant extension kapsamı

Tenant client extension `findMany/findFirst/count/aggregate/groupBy/updateMany/deleteMany` ve `create/createMany`
işlemlerine `tenantId` enjekte eder. `findUnique/update/delete/upsert` (unique key ile) otomatik filtrelenmez —
bunları servis katmanı açıkça scope'lar (id + tenantId). Bağlam yoksa (public/auth rotaları) veya `system` modda
enjeksiyon atlanır. Tam RLS ikinci ağ olarak V1.5.

### D-011 — Worker + deploy dosyaları yazıldı, çalıştırılmadı

`apps/worker` BullMQ iskeleti (pdf/mail/fx-rates/reports no-op processor). `deploy/` (compose.prod, Caddyfile,
deploy.sh, backup.sh, 3 Dockerfile) ve `.github/workflows` yazıldı ama **VPS olmadığı için build/deploy edilmedi**;
VPS'te doğrulanacak. Next `output: standalone` kaldırıldı (Docker'da `next start` daha basit; yerel uyarıyı da giderir).
API build/postinstall'a `prisma generate` eklendi (pnpm install üretilen client'ı ezdiği için).

### D-010 — Prisma 7 driver-adapter + `prisma.config.ts`

Prisma 7 breaking değişikliği: `datasource.url` artık `schema.prisma` içinde **desteklenmiyor**. Bağlantı
`apps/api/prisma.config.ts` içinde `defineConfig({ datasource: { url: env('DATABASE_URL') }, migrations: { seed } })`
ile veriliyor (CLI: migrate/studio/seed). Runtime'da PrismaClient **driver adapter** ile kuruluyor:
`@prisma/adapter-pg` (`PrismaPg`) + `pg` sürücüsü. `pg_trgm` + `unaccent` extension'ları init migration'ının
**başına** elle eklendi ki shadow DB, `gin_trgm_ops` GIN indekslerinden önce extension'lara sahip olsun.
Seed config `package.json`'dan `prisma.config.ts`'e taşındı. Not: Prisma `latest` dist-tag hâlâ 8.0.0-rc; 7.10.0'da kalıyoruz.

### D-009 — `packages/shared` derleme stratejisi

`@cora/shared`, `tsc` ile CommonJS + `.d.ts` olarak `dist/`'e derlenir; `type: commonjs` + `moduleResolution: NodeNext`
(bu yüzden göreli importlar `.js` uzantılı). api (Nest/CJS) ve web (Next) `dist`'i tüketir; Turborepo `^build`
ile sıra garanti eder. Vitest testleri doğrudan `src`'i çalıştırır. Neden tsup değil: ekstra bağımlılık gerekmesin,
tsc yeterli.

### D-008 — Local dev: Homebrew Postgres/Redis (Docker yerine)

Bu makinede Docker kurulu değil; kullanıcı Homebrew yolunu seçti. `postgresql@16` (16.15) ve `redis` (8.10.1)
Homebrew ile kuruldu ve `pg_ctl`/`redis-server --daemonize` ile **launchd olmadan** (headless bash'te launchd
user-agent başlamıyor) çalıştırılıyor. Dev DB: `cora_dev` (owner rol `cora`, `CREATEDB` yetkili — Prisma shadow DB için),
`pg_trgm` + `unaccent` etkin. **Not:** yerelde Redis 8, prod compose'da `redis:7`; BullMQ her ikisiyle uyumlu.
MinIO/Gotenberg/Mailpit yerelde **yok** (Docker gerektirir) → deploy'a (VPS) ertelendi. `docker-compose.dev.yml`
yine de tam stack ile yazıldı, VPS/Docker olan makinede geçerli.

### D-007 — Deploy hedefi geçici olarak yerel makine

VPS henüz alınmadı ve `cora.example.com` şu an Hostinger **paylaşımlı** hostinge (hcdn/PHP) bakıyor;
Cora'nın mimarisi (Docker + Postgres + Redis + BullMQ + Gotenberg + MinIO) paylaşımlı hostinge **kurulamaz**
(bkz. ADIM_0). Bu yüzden bu oturumda deploy hedefi = **bu geliştirme makinesi (yerel)**. Demo VPS alınınca
`deploy/` dosyalarıyla oraya çıkılacak ve `logo` A kaydı VPS IP'sine çevrilecek. Deploy dosyaları ve CI/CD yine
bu oturumda hazırlanıyor (çalıştırılmadan).

### D-006 — Node sürümü

Yerelde Node v25.9.0. `engines.node >= 20.11` (NestJS CLI şartı). `@types/node` LTS hattına (`24.13.3`) pinlendi;
ileri uyumlu olduğundan v25 runtime ile tipler uyumlu. `.nvmrc = 22` (takım için LTS önerisi).

### D-005 — TypeScript 5.9.3 (7.0.2 değil)

npm `latest` TypeScript 7.0.2 (yeni native/Go derleyicisi) ama `typescript-eslint@8.69.0` peer aralığı
`typescript >=4.8.4 <6.1.0`. TS7 seçilseydi `pnpm lint` kırılırdı. En güncel uyumlu stable = 5.9.3.

### D-004 — Prisma 7.10.0 (stable), 8.0.0-rc değil

`prisma` CLI'ın `latest` dist-tag'i RC (`8.0.0-rc.12`); `@prisma/client@latest = 7.10.0` stable. Hem CLI hem client
`7.10.0`'a pinlendi.

### D-003 — ESLint flat config + typescript-eslint 8

ESLint 10 flat config (`eslint.config.mjs`). Tip-duyarlı (type-checked) kurallar V1'de kapalı (hız + monorepo tsconfig
çözümleme sadeliği); `recommended` kuralları + `no-unused-vars` (`^_` yoksay) açık.

### D-002 — Enum'lar `as const` nesne + union tip

Prisma enum üye adlarıyla birebir eşleşen string değerler; web/api/DB'de aynı literal kullanılır.

### D-001 — Para/hesap motoru `decimal.js`, satır bazında 2 hane yuvarlama (ROUND_HALF_UP)

CORA_MIMARI §8'e göre. `calculateLine`/`calculateDocument` tek kaynak; 42 birim testi.
