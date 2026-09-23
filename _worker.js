const SUPABASE_ORIGIN = "https://bekvgnxsqpjblxvoutvu.supabase.co";

function destinationUrl(requestUrl) {
  const incoming = new URL(requestUrl);
  const upstreamPath = incoming.pathname.replace(/^\/sb(?:\/|$)/, "/");
  const target = new URL(upstreamPath, SUPABASE_ORIGIN);
  target.search = incoming.search;
  return target;
}
async function proxySupabase(request) {
  const target=destinationUrl(request.url),headers=new Headers(request.headers);
  for(const h of ["host","cf-connecting-ip","cf-ipcountry","cf-ray","x-forwarded-proto","content-length"])headers.delete(h);
  const init={method:request.method,headers,redirect:"manual"};if(!["GET","HEAD"].includes(request.method))init.body=await request.arrayBuffer();
  const upstream=await fetch(target,init),responseHeaders=new Headers(upstream.headers),location=responseHeaders.get("location");
  if(location?.startsWith(SUPABASE_ORIGIN))responseHeaders.set("location",location.replace(SUPABASE_ORIGIN,new URL(request.url).origin+"/sb"));
  const isJson=/(^|\+)json(?:;|$)/i.test((responseHeaders.get("content-type")||"").replace("/","+"));let body=upstream.body;
  if(request.method==="HEAD"||upstream.status===204||upstream.status===205)body=null;else if(isJson){const bytes=await upstream.arrayBuffer();responseHeaders.delete("content-length");responseHeaders.delete("content-encoding");responseHeaders.delete("transfer-encoding");if(!bytes.byteLength)return Response.json({message:"Supabase devolvió una respuesta vacía. Intenta nuevamente."},{status:502});body=bytes;}
  return new Response(body,{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders});
}
function apiHeaders(key,bearer=key){return {"content-type":"application/json","apikey":key,"authorization":`Bearer ${bearer}`};}
async function jsonOrError(response,label){const text=await response.text();let data={};try{data=text?JSON.parse(text):{};}catch{}if(!response.ok)throw new Error(data.msg||data.message||data.error_description||`${label} (${response.status})`);return data;}
async function secureDeleteAccount(request,env){
  if(request.method!=="POST")return Response.json({error:"Método no permitido"},{status:405});
  const anon=env.SUPABASE_ANON_KEY,service=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!anon||!service)return Response.json({error:"Configuración segura incompleta en Cloudflare. Define SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY como secretos del Worker."},{status:503});
  const authorization=request.headers.get("authorization")||"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
  if(!token)return Response.json({error:"Sesión administrativa requerida"},{status:401});
  let payload;try{payload=await request.json();}catch{return Response.json({error:"Solicitud inválida"},{status:400});}
  const target=String(payload.user_id||""),reason=String(payload.reason||"").trim(),password=String(payload.password||"");
  if(!target||reason.length<5||!password)return Response.json({error:"Usuario, motivo y contraseña son obligatorios"},{status:400});
  try{
    const me=await jsonOrError(await fetch(`${SUPABASE_ORIGIN}/auth/v1/user`,{headers:apiHeaders(anon,token)}),"No se pudo validar la sesión");
    const verify=await jsonOrError(await fetch(`${SUPABASE_ORIGIN}/auth/v1/token?grant_type=password`,{method:"POST",headers:apiHeaders(anon),body:JSON.stringify({email:me.email,password})}),"Reautenticación fallida");
    if(verify.user?.id!==me.id)throw new Error("Reautenticación inválida");
    const profile=await jsonOrError(await fetch(`${SUPABASE_ORIGIN}/rest/v1/profiles?id=eq.${encodeURIComponent(me.id)}&select=id,role,status`,{headers:apiHeaders(anon,token)}),"No se pudo validar administración");
    if(profile?.[0]?.role!=="admin"||profile?.[0]?.status!=="active")return Response.json({error:"Solo administración activa"},{status:403});
    if(target===me.id)return Response.json({error:"El administrador no puede eliminarse a sí mismo mediante este flujo"},{status:400});
    const prepared=await jsonOrError(await fetch(`${SUPABASE_ORIGIN}/rest/v1/rpc/admin_prepare_account_removal`,{method:"POST",headers:apiHeaders(anon,token),body:JSON.stringify({p_user_id:target,p_reason:reason})}),"No se pudo preparar la eliminación");
    const mode=typeof prepared==="string"?JSON.parse(prepared):prepared;
    if(mode?.mode==="hard_delete_candidate"){
      await jsonOrError(await fetch(`${SUPABASE_ORIGIN}/auth/v1/admin/users/${encodeURIComponent(target)}`,{method:"DELETE",headers:apiHeaders(service)}),"No se pudo eliminar el usuario de Auth");
      return Response.json({ok:true,mode:"hard_deleted"});
    }
    await jsonOrError(await fetch(`${SUPABASE_ORIGIN}/auth/v1/admin/users/${encodeURIComponent(target)}`,{method:"PUT",headers:apiHeaders(service),body:JSON.stringify({ban_duration:"876000h",user_metadata:{account_removed:true}})}),"No se pudo bloquear la cuenta anonimizada");
    return Response.json({ok:true,mode:"anonymized_and_banned",preserve_financial:!!mode?.preserve_financial,preserve_audit:!!mode?.preserve_audit});
  }catch(error){return Response.json({error:error.message||"No se pudo completar la acción"},{status:400});}
}
export default {async fetch(request,env){const path=new URL(request.url).pathname;if(path==="/api/admin/delete-account")return secureDeleteAccount(request,env);if(path==="/sb"||path.startsWith("/sb/"))return proxySupabase(request);return env.ASSETS.fetch(request);}};
