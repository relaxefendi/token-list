# Bodrum İlçe Tarım Müdürlüğü — Kurum Portalı

Aynı yerel ağ (LAN) üzerindeki bilgisayarlar için tek sunuculu işbirliği uygulaması.

## Özellikler

- **Ana sayfa** — önemli mesajlar (kırmızı nokta), duyurular özeti
- **Kayan yazı** — üst şeritte akan metinler; yönetim panelinden düzenlenir
- **Sohbet** — genel sohbet odası; “önemli” kullanıcı mesajları vurgulanır
- **Toplantı** — ses, görüntü, ekran paylaşımı ve toplantı sohbeti (WebRTC)
- **Ekran yardımı** — çevrimiçi listeden kullanıcıya tıklayarak 1:1 ekran paylaşımı
- **Dosya portalı** — AES-256-GCM ile şifreli saklama; silme kapalı; değişiklik denetim kaydı
- **Duyurular** — kurum duyuruları
- **Yönetim paneli** — kullanıcılar, yetkiler, kayan yazı, dosya şifresi

## Kurulum (sunucu bilgisayarı)

```bash
cd bodrum-portal
npm install
npm start
```

Portal varsayılan olarak `http://0.0.0.0:3080` adresinde dinler.

### Ortak klasör kısayolu

```bash
npm run create-shortcut
# veya sabit IP ile:
node scripts/create-shortcut.js 192.168.1.50
```

Oluşan `kısayol/` klasörünü paylaşılan ağ klasörüne kopyalayın. Personel `.url` veya `.bat` dosyasına çift tıklayarak bağlanır.

## Varsayılan hesaplar

| Alan | Değer |
|------|--------|
| Yönetici | `admin` / `Admin123!` |
| Dosya şifresi | `BodrumTarim2024!` |

İlk girişten sonra yönetim panelinden şifreleri değiştirin.

## Veri konumları

| Yol | İçerik |
|-----|--------|
| `data/portal.db` | Kullanıcılar, mesajlar, duyurular, denetim |
| `dosyalar/encrypted/` | AES-256-GCM şifreli dosya içerikleri |

Dosyalar program arayüzünden görünür ve indirilebilir; silinemez. Düzenleme yetkisi kullanıcı bazında açılıp kapatılabilir. Kim ne zaman değiştirdiyse `file_audit` tablosunda tutulur.

## Ağ notları

- Sunucu bilgisayarın güvenlik duvarında **3080** portunu açın.
- Ses/görüntü için tarayıcıda kamera-mikrofon izni gerekir (Chrome/Edge önerilir).
- Aynı NAT/LAN içinde WebRTC genelde STUN ile çalışır; çok kısıtlı ağlarda TURN sunucusu eklenebilir.
