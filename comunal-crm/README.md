# Comunal CRM

Sistema de cobranza y gestión de pedidos para Tostadora Comunal.

## Stack
- HTML/CSS/JS plano (sin framework)
- Supabase (base de datos y auth)
- Vercel (hosting)

## Setup

### Variables de entorno (en Vercel)
- `SUPABASE_URL`: URL del proyecto de Supabase
- `SUPABASE_KEY`: anon public key

### Estructura
- `index.html`: página de login
- `app.html`: aplicación principal
- `app.js`: lógica de la app
- `build.js`: script que inyecta variables de entorno
- `vercel.json`: configuración de despliegue

## Uso
1. Login con correo y contraseña (creado en Supabase Auth)
2. Primer usuario que entra se vuelve admin automáticamente
3. Admin puede crear más usuarios desde Supabase Dashboard
