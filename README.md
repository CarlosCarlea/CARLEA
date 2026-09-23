# CARLÉA

Plataforma web para gestión de perfiles, contenido, membresías, conversaciones, experiencias, pagos y videollamadas, desarrollada con una arquitectura basada en frontend web y Supabase como backend.

> **Estado del proyecto:** En desarrollo activo  
> **Repositorio:** Privado  
> **Despliegue previsto:** Cloudflare Pages  
> **Backend:** Supabase  
> **Control de versiones:** Git / GitHub  

---

## 1. Descripción

CARLÉA es una plataforma web orientada a conectar usuarios con creadoras mediante perfiles, contenido multimedia, mensajería, membresías, solicitudes de experiencias y servicios de videollamada.

El sistema utiliza diferentes tipos de usuario y controla los permisos y funcionalidades disponibles según el rol autenticado.

La arquitectura del proyecto busca mantener una separación clara entre:

- Frontend.
- Autenticación.
- Base de datos.
- Storage.
- Realtime.
- Lógica de negocio.
- Administración.
- Moderación.
- Pagos.
- Contenido.
- Videollamadas.
- Mensajería.

---

# 2. Arquitectura general

```text
Usuario
   │
   ▼
Frontend CARLÉA
   │
   ├── Autenticación
   ├── Perfiles
   ├── Contenido
   ├── Chat
   ├── Experiencias
   ├── Videollamadas
   ├── Membresías
   └── Pagos
   │
   ▼
Supabase
   │
   ├── Authentication
   ├── PostgreSQL
   ├── Storage
   ├── Realtime
   ├── RLS Policies
   └── RPC / Functions
   │
   ▼
Cloudflare Pages
   │
   ▼
Aplicación pública
```

---

# 3. Tecnologías

## Frontend

- HTML5
- CSS3
- JavaScript
- Diseño responsive
- Integración con Supabase JS

## Backend

- Supabase
- PostgreSQL
- Supabase Authentication
- Supabase Storage
- Supabase Realtime
- Row Level Security — RLS
- Funciones SQL / RPC

## Infraestructura

- Git
- GitHub
- GitHub Actions
- Cloudflare Pages
- CI/CD

---

# 4. Roles del sistema

CARLÉA utiliza diferentes perfiles de acceso.

## Usuario

Puede:

- Registrarse.
- Iniciar sesión.
- Consultar perfiles de creadoras.
- Visualizar contenido disponible.
- Acceder a contenido según su nivel de membresía.
- Enviar mensajes.
- Solicitar experiencias.
- Solicitar videollamadas.
- Consultar notificaciones.
- Gestionar su cuenta.

---

## Creadora

Puede:

- Administrar su perfil.
- Actualizar información.
- Subir fotografías.
- Subir contenido.
- Seleccionar fotografía de portada.
- Administrar contenido premium.
- Consultar conversaciones.
- Responder mensajes.
- Gestionar solicitudes de experiencias.
- Consultar solicitudes de videollamadas.
- Gestionar disponibilidad.
- Consultar estados de solicitudes y pagos.

---

## Administrador

Puede:

- Gestionar usuarios.
- Gestionar creadoras.
- Aprobar contenido.
- Rechazar contenido.
- Moderar publicaciones.
- Bloquear cuentas.
- Consultar nuevas cuentas.
- Supervisar solicitudes.
- Revisar pagos.
- Confirmar pagos.
- Administrar membresías.
- Supervisar experiencias.
- Gestionar solicitudes de videollamada.
- Consultar métricas de actividad.
- Gestionar procesos internos de la plataforma.

---

# 5. Funcionalidades principales

## Autenticación

CARLÉA utiliza Supabase Authentication.

Funciones:

- Registro.
- Inicio de sesión.
- Manejo de sesión.
- Control por roles.
- Persistencia de sesión.
- Cierre de sesión.

---

## Perfiles

Cada usuario autenticado posee un perfil relacionado con su cuenta.

Los perfiles pueden contener:

- Nombre.
- Alias.
- Rol.
- Estado.
- Fotografía.
- Información pública.
- Nivel de membresía.
- Configuración de cuenta.

---

## Contenido

Las creadoras pueden subir contenido multimedia.

El sistema diferencia entre:

- Contenido público.
- Contenido disponible para usuarios registrados.
- Contenido premium.
- Contenido pendiente de moderación.
- Contenido aprobado.
- Contenido rechazado.

El contenido puede requerir aprobación administrativa antes de publicarse.

---

# 6. Membresías

CARLÉA utiliza membresías que permiten acceder a diferentes niveles de contenido y funcionalidades.

La membresía corresponde al acceso general de la plataforma y no a la suscripción individual de una creadora.

El acceso final depende de:

- Estado de la cuenta.
- Membresía activa.
- Permisos.
- Rol.
- Estado del contenido.

---

# 7. Sistema de conversaciones

CARLÉA incorpora mensajería entre usuarios y creadoras.

El sistema contempla:

- Conversaciones.
- Mensajes.
- Notificaciones.
- Estado de mensajes.
- Actualizaciones en tiempo real mediante Supabase Realtime.

Flujo básico:

```text
Usuario
   │
   ▼
Selecciona creadora
   │
   ▼
Abre conversación
   │
   ▼
Envía mensaje
   │
   ▼
Supabase
   │
   ▼
Realtime
   │
   ▼
Creadora recibe mensaje
```

---

# 8. Videollamadas

Las videollamadas se manejan mediante un flujo de solicitud y aprobación.

Flujo previsto:

```text
Usuario
   │
   ▼
Solicita videollamada
   │
   ▼
Selecciona duración
   │
   ▼
Solicitud de pago
   │
   ▼
Administrador revisa pago
   │
   ▼
Pago aprobado
   │
   ▼
Solicitud habilitada
   │
   ▼
Creadora recibe solicitud
   │
   ▼
Aceptación
   │
   ▼
Sesión de videollamada
```

La lógica relacionada con pagos y permisos debe ejecutarse del lado seguro del backend y no confiar únicamente en validaciones del frontend.

---

# 9. Experiencias

Los usuarios pueden solicitar experiencias disponibles dentro de la plataforma.

Las creadoras pueden:

- Publicar experiencias.
- Configurar duración.
- Definir disponibilidad.
- Establecer precio.
- Aceptar o rechazar solicitudes.

Las solicitudes mantienen estados internos para controlar el flujo.

Ejemplo:

```text
pending
approved
rejected
paid
completed
cancelled
```

---

# 10. Pagos

El sistema contempla solicitudes y confirmaciones de pago.

Los estados deben mantenerse sincronizados con las solicitudes correspondientes.

Los pagos pueden estar relacionados con:

- Membresías.
- Videollamadas.
- Experiencias.
- Otros servicios habilitados dentro de la plataforma.

Las operaciones financieras sensibles no deben depender exclusivamente del navegador.

---

# 11. Seguridad

El proyecto debe seguir estas reglas:

- No almacenar contraseñas manualmente.
- Utilizar Supabase Authentication.
- Mantener Row Level Security habilitado.
- Proteger tablas sensibles mediante políticas RLS.
- No exponer claves administrativas.
- No incluir `service_role` en el frontend.
- No subir secretos al repositorio.
- Mantener tokens externos como GitHub Secrets.
- Validar operaciones sensibles en backend.
- Aplicar permisos según el rol autenticado.

---

# 12. Variables de entorno

Ejemplo:

```env
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_ANON_KEY=TU_SUPABASE_ANON_KEY
```

Nunca almacenar en el repositorio:

```env
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_PASSWORD=
CLOUDFLARE_API_TOKEN=
```

Estas variables deben almacenarse mediante secretos del entorno correspondiente.

---

# 13. Instalación local

Clonar el repositorio:

```bash
git clone https://github.com/TU-USUARIO/carlea.git
```

Entrar al proyecto:

```bash
cd carlea
```

Si el proyecto utiliza dependencias Node:

```bash
npm install
```

Después iniciar el entorno correspondiente:

```bash
npm run dev
```

Si la versión actual utiliza únicamente archivos estáticos, también puede ejecutarse mediante un servidor HTTP local.

Ejemplo:

```bash
npx serve .
```

---

# 14. Estructura sugerida del proyecto

```text
carlea/
│
├── .github/
│   └── workflows/
│       └── deploy.yml
│
├── assets/
│   ├── images/
│   ├── icons/
│   └── logo/
│
├── css/
│   └── styles.css
│
├── js/
│   ├── auth.js
│   ├── supabase.js
│   ├── profiles.js
│   ├── content.js
│   ├── chat.js
│   ├── video.js
│   ├── payments.js
│   └── admin.js
│
├── supabase/
│   ├── migrations/
│   └── functions/
│
├── index.html
├── package.json
├── .gitignore
└── README.md
```

La estructura real puede variar según la versión del proyecto.

---

# 15. Estrategia Git

El repositorio utiliza dos ramas principales.

## Producción

```text
main
```

Contiene únicamente código estable destinado a producción.

---

## Desarrollo

```text
develop
```

Contiene los cambios que se encuentran en integración o pruebas.

---

## Features

Cada funcionalidad nueva debe desarrollarse en una rama independiente.

Ejemplos:

```text
feature/videochat
feature/payments
feature/messaging
feature/admin-dashboard
feature/content-moderation
```

---

## Correcciones

Ejemplos:

```text
fix/login
fix/video-call-payment
fix/profile-refresh
fix/admin-payment-request
```

---

# 16. Flujo de trabajo

```text
feature/*
     │
     ▼
develop
     │
     ▼
Pruebas
     │
     ▼
Pull Request
     │
     ▼
main
     │
     ▼
CI/CD
     │
     ▼
Cloudflare Pages
```

No realizar modificaciones directamente en `main`.

---

# 17. Versionado

CARLÉA utiliza versionado semántico:

```text
MAJOR.MINOR.PATCH
```

Ejemplo:

```text
3.4.0
```

Donde:

```text
3 = versión mayor
4 = nueva funcionalidad
0 = corrección
```

Ejemplos:

```text
v3.4.0
v3.4.1
v3.4.2
v3.5.0
v4.0.0
```

Crear una versión:

```bash
git tag -a v3.4.0 -m "CARLEA v3.4.0"
```

Publicar el tag:

```bash
git push origin v3.4.0
```

---

# 18. Convención de commits

Se recomienda utilizar commits descriptivos.

## Nueva funcionalidad

```text
feat: agrega aprobación de videollamadas
```

## Corrección

```text
fix: corrige actualización del perfil
```

## Refactorización

```text
refactor: reorganiza lógica de autenticación
```

## Base de datos

```text
db: agrega migración payment_requests
```

## Seguridad

```text
security: ajusta políticas RLS
```

## Documentación

```text
docs: actualiza README
```

---

# 19. CI/CD

El proyecto utiliza GitHub Actions.

El pipeline puede ejecutar:

1. Checkout del repositorio.
2. Instalación de dependencias.
3. Validación de archivos.
4. Revisión de código.
5. Pruebas.
6. Build.
7. Despliegue.

Flujo:

```text
git push
    │
    ▼
GitHub Actions
    │
    ▼
Validación
    │
    ├── ERROR → detener
    │
    └── OK
         │
         ▼
      Deploy
         │
         ▼
 Cloudflare Pages
```

---

# 20. Entornos

## Development

```text
develop
```

Utilizado para desarrollo e integración.

---

## Preview

Permite verificar cambios antes de producción.

Puede utilizar una URL generada por Cloudflare Pages.

---

## Production

```text
main
```

Contiene únicamente versiones aprobadas.

---

# 21. Supabase

Supabase proporciona:

```text
Authentication
PostgreSQL
Storage
Realtime
Row Level Security
RPC Functions
```

Los cambios importantes en base de datos deberían almacenarse mediante migraciones.

Ejemplo:

```text
supabase/
└── migrations/
    ├── 001_profiles.sql
    ├── 002_content.sql
    ├── 003_messages.sql
    ├── 004_payment_requests.sql
    └── 005_video_calls.sql
```

Esto permite reconstruir y auditar la evolución de la base de datos.

---

# 22. Regla de desarrollo

Antes de implementar una modificación:

1. Revisar el código existente.
2. Identificar componentes relacionados.
3. Revisar tablas Supabase existentes.
4. Revisar funciones RPC existentes.
5. Revisar políticas RLS.
6. Evitar duplicar funcionalidades.
7. Reutilizar componentes existentes.
8. Refactorizar antes de crear sistemas paralelos.
9. Probar los flujos afectados.
10. Verificar que no existan regresiones.

---

# 23. Reglas inquebrantables de CARLÉA

- No eliminar funcionalidades existentes sin aprobación.
- No sustituir el logo oficial.
- No crear sistemas paralelos cuando exista una funcionalidad equivalente.
- No duplicar tablas sin revisar primero la estructura existente.
- No duplicar RPC existentes.
- No exponer secretos.
- No realizar operaciones administrativas sensibles desde el frontend.
- No desplegar directamente código no probado a producción.
- Mantener compatibilidad responsive.
- Mantener separación clara entre roles.
- Mantener la identidad visual de CARLÉA.
- Probar autenticación después de modificaciones importantes.
- Probar navegación según rol después de cambios.
- Probar contenido después de modificaciones de Storage.
- Probar mensajería después de modificaciones Realtime.
- Probar pagos y videollamadas antes de cada release relacionado.

---

# 24. Checklist antes de producción

Antes de realizar merge hacia `main` verificar:

```text
[ ] Login funciona
[ ] Registro funciona
[ ] Rol usuario funciona
[ ] Rol creadora funciona
[ ] Rol administrador funciona
[ ] Perfiles cargan correctamente
[ ] Imágenes cargan
[ ] Storage funciona
[ ] Contenido público funciona
[ ] Contenido premium funciona
[ ] Moderación funciona
[ ] Chat funciona
[ ] Realtime funciona
[ ] Notificaciones funcionan
[ ] Experiencias funcionan
[ ] Pagos funcionan
[ ] Solicitudes de videollamada funcionan
[ ] Administrador puede aprobar pagos
[ ] No existen errores críticos en consola
[ ] No hay secretos expuestos
[ ] Responsive móvil verificado
[ ] Responsive escritorio verificado
```

---

# 25. Releases

Cada versión estable debe publicarse mediante un tag.

Ejemplo:

```bash
git checkout main

git pull

git tag -a v3.4.0 -m "CARLEA v3.4.0 estable"

git push origin v3.4.0
```

Los cambios de cada release deben documentarse.

Ejemplo:

```text
CARLÉA v3.4.1

FIXED
- Corrección flujo de videollamada.
- Corrección actualización de sesión.
- Corrección solicitudes de pagos.

IMPROVED
- Panel administrador.
- Manejo de estados.
- Validación de sesión.
```

---

# 26. Recuperación ante errores

Si una nueva versión presenta un problema crítico, Git permite recuperar una versión anterior.

Consultar versiones:

```bash
git tag
```

Consultar historial:

```bash
git log --oneline
```

El objetivo es que siempre exista una versión estable identificable y recuperable.

---

# 27. Despliegue

Producción prevista:

```text
GitHub
   │
   ▼
GitHub Actions
   │
   ▼
Cloudflare Pages
   │
   ▼
CARLÉA
   │
   ▼
Supabase
```

Los cambios realizados sobre `main` deben pasar previamente por validación.

---

# 28. Propiedad intelectual

CARLÉA es un proyecto propietario.

El código fuente, arquitectura, diseño, documentación, componentes, lógica de negocio, identidad visual y demás elementos del proyecto no deben ser copiados, distribuidos, revendidos o reutilizados sin autorización expresa del titular correspondiente.

Este repositorio debe mantenerse privado mientras no exista una decisión expresa de publicación.

---

# 29. Aviso

Este proyecto se encuentra en desarrollo activo.

Las funcionalidades, arquitectura, tablas, APIs, integraciones y procesos descritos en este documento pueden cambiar a medida que el sistema evolucione.

La documentación debe actualizarse junto con los cambios relevantes del proyecto.

---

# CARLÉA

**Plataforma web — Desarrollo activo**

```text
GitHub
   +
Supabase
   +
Cloudflare Pages
   +
CI/CD
```

**Objetivo técnico:** mantener una plataforma estable, versionada, auditable, segura y escalable.
