# Publicar CARLÉA 3.4.0 en Cloudflare Pages + Supabase

Esta entrega conserva la conexión directa del frontend a Supabase introducida en 3.3.2. `_worker.js` queda para operaciones administrativas sensibles que **no deben ejecutarse con secretos desde el navegador**.

## 1. Primero: copia de seguridad y staging

Antes de producción, conserva el ZIP 3.3.2 y realiza un backup de la base. Aplica CARLÉA 3.4.0 primero en un proyecto o rama de staging de Supabase.

## 2. Aplicar la migración 3.4

Ejecuta **una sola vez** y en orden:

`supabase/migrations/20260922123000_integral_carlea_3_4.sql`

La migración es aditiva y reutiliza las tablas existentes. Si Supabase devuelve un error, no publiques el frontend hasta corregirlo y confirmar que la transacción se revirtió o finalizó correctamente.

## 3. Configurar Authentication y correo

En Supabase:

1. **Authentication > URL Configuration**: configura `Site URL` con el dominio real de CARLÉA.
2. Agrega a `Redirect URLs` el dominio de Pages y, cuando exista, el dominio propio.
3. Mantén la confirmación de correo habilitada.
4. Configura SMTP real y revisa las plantillas de confirmación/recuperación.
5. Prueba “Reenviar correo de verificación” con una cuenta nueva.

## 4. Configurar Storage

- `identity-private` debe permanecer privado y separado de `creator-content`.
- Los documentos de identidad no deben tener URLs públicas permanentes.
- Confirma las políticas RLS/Storage antes de permitir registros reales.
- Revisa periódicamente los documentos cuyo `documents_purge_after` haya vencido y aplica la política de conservación aprobada.

## 5. Configurar secretos en Cloudflare

En **Workers & Pages > CARLÉA > Settings > Variables and Secrets**, guarda como secretos del servidor:

- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY` **nunca** debe estar en `index.html`, `js/config.js` ni ningún archivo entregado al navegador.

La ruta backend `/api/admin/delete-account` usa esos secretos, valida el JWT del administrador y exige reautenticación antes de preparar una eliminación. Si existen dependencias financieras, de auditoría o relaciones, el sistema prioriza suspensión/anonimización.

## 6. Publicar en Cloudflare Pages

1. Abre **Workers & Pages**.
2. Usa el proyecto existente o crea Pages mediante **Direct Upload**.
3. Descomprime el ZIP 3.4.0.
4. Sube **el contenido de la carpeta**, verificando que `index.html` quede en la raíz.
5. Conserva el deployment 3.3.2 hasta terminar la validación.
6. Abre el sitio en ventana privada para evitar caché viejo.

## 7. Pruebas de aceptación obligatorias

Valida al menos:

1. Landing, logo y fondo en móvil y PC.
2. Registro de cliente, confirmación de correo, reenvío y login.
3. Registro de creadora, frontal/reverso/selfie, términos con scroll, consentimiento sensible separado y solicitud de membresía pendiente.
4. Administración: revisión de identidad y aprobación/rechazo.
5. Usuario Gratis: contenido público sin acceso Premium/Diamond.
6. Premium/Diamond: activación solamente después de aprobar el pago correspondiente.
7. Ranking y estados online/reciente.
8. Chat en dos sesiones: Realtime, `read_at`, `99+`, escribir, Presence y sonido.
9. Mensaje con teléfono/WhatsApp de prueba: debe crear alerta de moderación y **no** bloquear el mensaje.
10. Notificaciones: leer, leer todas, eliminar/dismiss y contador.
11. Contenido de creadora: publicado, en revisión, rechazado, motivo y reenvío.
12. Experiencia: elegir creadora/fecha, solicitud, pago manual, respuesta, SLA y finalización.
13. Videollamada: paquetes 30/60/90, aprobación de pago, aceptación, inicio real, temporizador y cierre.
14. Ledger: confirmar 80/20 en una videollamada finalizada y cifras mensuales derivadas de movimientos.
15. Moderación: entrada de admin en solo lectura, aviso a participantes, intervención explícita y auditoría.
16. Suspensión/eliminación: confirmar bloqueo de autoeliminación del admin y conservación de dependencias.

## 8. TURN para videollamadas

WebRTC puede funcionar directamente en algunas redes, pero para operación real necesitas TURN/STUN confiable. Configura TURN antes de considerar las videollamadas aptas para producción entre redes corporativas, móviles o NAT restrictivos.

## 9. Rollback

Si las pruebas de producción fallan, vuelve al deployment 3.3.2 en Cloudflare. Para la base de datos no improvises un rollback destructivo: la migración 3.4 añade estructuras que pueden empezar a recibir datos; restaura desde backup o realiza una migración correctiva controlada.
