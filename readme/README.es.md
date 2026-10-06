<p align="center"><a href="../README.md">
  <img src="../docs/assets/logo.svg" alt="tokenharbor-bulk-creator" width="150">
</a></p>

<p align="center"><img src="../docs/assets/banner.svg" alt="tokenharbor-bulk-creator banner"></p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node"></a>
  <a href="https://playwright.dev/"><img src="https://img.shields.io/badge/playwright-%E2%9C%94-2EAD33?style=for-the-badge&logo=playwright&logoColor=white" alt="Playwright"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-22e6a5?style=for-the-badge" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/tests-9%20passed-39d0ff?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Tests">
</p>

# Creador Masivo de Cuentas Token Harbor

> Aprovisiona cuentas de Token Harbor en lote con bandejas desechables y genera automáticamente claves API con nombres aleatorios.

<p><a href="../README.md">English</a> · <a href="README.id.md">Indonesia</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <strong>Español</strong></p>

---

`tokenharbor-bulk-creator` une tres cosas en un único flujo reproducible: un proveedor de
correo desechable ([temp-email.dev](https://www.temp-email.dev)), un navegador real que ejecuta el
registro y la verificación de correo de Token Harbor igual que una persona, y el flujo de
creación de claves API del panel de Token Harbor. Dale un número y devolverá una tabla JSON
de claves `thk_live_…` listas para usar.

> Esta herramienta está pensada para automatización legítima, pruebas internas e
> investigación sobre cuentas propias. Eres responsable de cumplir los términos de
> servicio de Token Harbor y la legislación aplicable.

---

## ¿Por qué un navegador?

Token Harbor ([tokenharbor.ai](https://tokenharbor.ai)) es una aplicación Next.js cuyo registro
se ejecuta contra su propia API HTTPS (`/api/auth/signup-precheck`) y luego establece una
cookie de sesión. La verificación por correo es un **enlace en el que se hace clic**, y las
claves API se crean desde el panel autenticado. No existe una API REST pública documentada
para registrarse o emitir claves, así que el enfoque fiable es manejar la interfaz real con
[Playwright](https://playwright.dev).

## Características

- **Bandejas desechables** – crea una bandeja temp-email.dev única por cuenta.
- **Onboarding completo** – registro → verificación por correo → clave API.
- **Identidad aleatoria** – correos, contraseñas (12+ caracteres) y etiquetas de clave.
- **Claves API automáticas** – nombradas como `prod-token-7421`, prefijo `thk_live_`.
- **Consciente del límite de tasa** – detecta el throttle "take a breath" y espera.
- **Salida incremental** – el JSON se reescribe tras cada cuenta.
- **Concurrencia** – workers paralelos opcionales.
- **Reintentos** – intentos por cuenta con identidades nuevas.
- **Bandeja intercambiable** – `temp-email-dev` o cualquier REST `custom` de correo temporal.
- **Registro estructurado** – salida de consola con color y marca de tiempo.

## Arquitectura

```
src/
├── index.mjs             # entrada CLI (flags, navegador, pool de workers)
├── core/provision.mjs    # flujo de extremo a extremo, reintentos, resultado
├── tokenharbor/client.mjs# registro, verificación, creación de clave (Playwright)
├── inbox/index.mjs       # lector temp-email.dev + REST + análisis de enlaces
└── utils/                # config, random, logger
```

## Requisitos

- **Node.js 18+**
- Un navegador Chromium/Firefox/WebKit para Playwright
- Una red con acceso a `tokenharbor.ai` y `www.temp-email.dev`

## Instalación

```bash
git clone https://github.com/0xgetz/tokenharbor-bulk-creator.git
cd tokenharbor-bulk-creator
npm install
npx playwright install --with-deps chromium
```

## Inicio rápido

```bash
# Una cuenta, viendo el navegador
node src/index.mjs --headful

# Cinco cuentas, JSON en ./output
node src/index.mjs -n 5 -o output/accounts.json

# Lote de diez con dos workers
node src/index.mjs -n 10 -c 2

# Comprobar el entorno primero
node src/index.mjs --doctor
```

### Referencia CLI

| Flag | Predeterminado | Descripción |
| --- | --- | --- |
| `-n, --count` | `1` | Número de cuentas |
| `-c, --concurrency` | `1` | Workers en paralelo |
| `-o, --out` | `tokenharbor-accounts-<ts>.json` | Ruta del JSON de resultados |
| `-t, --timeout` | `180000` | Máx. ms de espera del correo de verificación |
| `--turnstile-timeout` | `150000` | Máx. ms de Cloudflare (no-op actualmente) |
| `--retries` | `3` | Intentos por cuenta |
| `--inbox-provider` | `temp-email-dev` | `temp-email-dev` \| `custom` |
| `--mail-base-url` | – | URL base del proveedor `custom` |
| `--password` | aleatoria | Contraseña fija (>= 12 caracteres) |
| `--key-name` | aleatorio | Etiqueta de clave API fija |
| `--proxy` | – | URL de proxy para el navegador |
| `--headful` | off | Mostrar el navegador |
| `-q, --quiet` | off | Mostrar solo el resumen final |
| `--doctor` | – | Comprobar el entorno y salir |

## Proveedores de bandeja

| Proveedor | Valor | Cómo funciona |
| --- | --- | --- |
| temp-email.dev *(predeterminado)* | `temp-email-dev` | Maneja la interfaz del sitio en un navegador; el sitio genera la dirección. |
| REST personalizado | `custom` | Cualquier API JSON de correo temporal clásica (`/domains`, `/accounts`, `/messages`). |

## Límite de tasa

Token Harbor aplica un throttle suave antiabuso. Cuando el registro responde con
*"You're doing that a bit fast — take a breath and try again."* la ejecución espera 45
segundos y reintenta una vez; si persiste, la cuenta se marca como fallo `rate-limit`. Para
lotes grandes, mantén `--concurrency` bajo (1–2).

## Salida

```json
{
  "ok": true,
  "email": "swiftfox482913@swiftemail.dev",
  "api_key": "thk_live_…",
  "key_name": "prod-token-7421",
  "api_base": "https://api.tokenharbor.ai/v1",
  "email_provider": "temp-email.dev"
}
```

## Licencia

Publicado bajo la [Licencia MIT](../LICENSE).
