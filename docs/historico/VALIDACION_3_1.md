# Histórico 3.1: no constituye validación de la revisión 3.2

# CARLÉA 3.1 MVP — Validación y límites

## Cambios de 3.1

- Premium ($19.900) y Diamante ($39.900) pasan a ser suscripciones globales para toda CARLÉA.
- El visitante conserva acceso sin cuenta a perfiles y publicaciones públicas.
- El registro incluye fecha de nacimiento, confirmación de contraseña, selección de tipo de cuenta, aceptaciones separadas y regreso sin crear cuenta.
- Se añadió una migración separada y revisable. No se aplicó a producción durante la creación de esta entrega.
- Las pruebas originales de 3.0 que dependían de suscripciones por creadora deben repetirse después de aplicar la migración 3.1 en un entorno controlado.

## Cambios respecto a 2.0.11

Se extrajeron las fotos públicas a archivos independientes y se eliminaron del paquete las imágenes incrustadas que simulaban contenido exclusivo mediante desenfoque. Ese desenfoque no era protección de acceso. El contenido restringido ahora procede del almacenamiento con controles de acceso.

Se restauró el logo recibido sin redibujarlo. Se sustituyó el cliente de autenticación artesanal por Supabase JS 2.57.4 distribuido localmente, se separaron configuración, API, interfaz, chat y WebRTC, y se conservaron perfiles y experiencias de la base existente.

## Pruebas realizadas

- Navegador Chromium, escritorio 1440 px y móvil 390 px: aceptación, galería de cuatro perfiles, apertura de perfil, comparación de tres planes y formulario de acceso. Sin errores de JavaScript ni desbordamiento horizontal en ese recorrido. Catálogo y planes leídos del backend real.
- Paneles de administrador, creadora y cliente Premium con respuestas controladas en navegador: navegación de ocho secciones administrativas, publicación, chat, controles multimedia y video deshabilitados para Premium. Sin errores de JavaScript ni desbordamiento horizontal. Esto no equivale a un recorrido completo autenticado en producción.
- Consultas y operaciones SQL bajo rol authenticated y claims de usuario, dentro de transacciones revertidas: Gratis sin lectura de mensajes, Premium con nivel 1 y multimedia denegada, Diamante con nivel 2 y multimedia permitida, aislamiento de perfil, rechazo de autopromoción a administrador y ausencia de permisos de usuario para editar plan o estado.
- Intento de INSERT multimedia desde Premium: rechazado por el servidor.
- WebRTC entre dos navegadores locales con cámara y micrófono sintéticos y transporte de señalización controlado: ambos conectados, dos pistas remotas recibidas (audio/video), siete mensajes de señalización, control de silenciar disponible. Esta prueba no mide redes móviles ni TURN.
- Videollamadas en base de datos: el cliente no puede aceptar su propia solicitud; la creadora participante sí puede aceptarla.
- Bloqueo de creadora: oculta su perfil del catálogo y genera auditoría; prueba revertida.
- Administración: acceso a cuentas global; lectura de mensajes denegada hasta registrar motivo de revisión.
- Consulta anónima: cuatro creadoras y ocho planes accesibles; las publicaciones privadas no son públicas.
- Todas las tablas públicas tienen RLS. Se retiraron del esquema API las funciones privilegiadas heredadas y se conservaron entradas que verifican permisos.

## Observación de seguridad pendiente

El asesor de Supabase conserva una advertencia: protección contra contraseñas filtradas deshabilitada. Revisar disponibilidad y configuración en Auth. Documentación: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Límites de lo comprobado

No se inició sesión con contraseñas reales de clientes ni se enviaron mensajes o correos a terceros. Las pruebas SQL no conservaron mensajes, solicitudes o cambios temporales de planes.

No se ha certificado pago real, push, streaming, acceso del administrador a videollamadas, calidad de video en redes móviles ni funcionamiento en el dominio público después de subir el ZIP. No se conoce la URL de ese dominio en esta entrega. El paquete conserva la ruta /sb del alojamiento anterior.

No se pudo recuperar una fuente oficial colombiana actual mediante la consulta web de esta sesión. La política es una propuesta operativa que exige completar datos y revisar obligaciones; no constituye dictamen ni certificación jurídica. No debe anunciarse como cumplimiento legal confirmado.

## Arquitectura

- Netlify: archivos estáticos y proxy HTTP /sb.
- Supabase CARLÉA: Auth, Postgres, RLS, Storage privado y Realtime.
- WebRTC: medios 1:1 entre navegadores; señalización autorizada en base de datos.
- Pagos, TURN, streaming y push: integración pendiente según lo detallado en LEEME_ANTES_DE_SUBIR.txt.

El plan gratuito de Supabase no es ilimitado. La documentación consultada indica 200 conexiones Realtime simultáneas y 2 millones de mensajes mensuales. No se verificó el consumo de la cuenta ni se activaron servicios de pago. Fuente: https://supabase.com/docs/guides/realtime/pricing
