import {sb,$,esc,checked,attempt} from './api.js';
import {config} from './config.js';
let pc,stream,callId,signalChannel,signalTimer,watchdog,countdownTimer,seen=new Set(),iceQueue=[],processing=false,localUser,activeCall;
function clearTimers(){clearInterval(signalTimer);clearTimeout(watchdog);clearInterval(countdownTimer);signalTimer=null;watchdog=null;countdownTimer=null;}
export async function stopVideo(notify=false){const previous=activeCall;callId=null;activeCall=null;clearTimers();if(signalChannel){sb.removeChannel(signalChannel);signalChannel=null;}if(pc){pc.onicecandidate=null;pc.onconnectionstatechange=null;pc.close();pc=null;}stream?.getTracks().forEach(t=>t.stop());stream=null;seen=new Set();iceQueue=[];if(previous&&notify&&previous.started_at&&!previous.ended_at)await sb.rpc('finish_video_call',{p_call_id:previous.id});}
function startCountdown(call){if(!call.started_at||!call.duration_minutes)return;const end=new Date(call.started_at).getTime()+call.duration_minutes*60000;let warned=false;const tick=()=>{const left=Math.max(0,end-Date.now()),m=Math.floor(left/60000),s=Math.floor((left%60000)/1000);if($('videoTimer'))$('videoTimer').textContent=`Tiempo restante ${m}:${String(s).padStart(2,'0')}`;if(left<=300000&&!warned){warned=true;if($('videoWarning'))$('videoWarning').textContent='Quedan 5 minutos para finalizar.';}if(left<=0){clearInterval(countdownTimer);attempt(async()=>{await sb.rpc('finish_video_call',{p_call_id:call.id});await stopVideo(false);if($('videoStatus'))$('videoStatus').textContent='Tiempo finalizado.';});}};tick();countdownTimer=setInterval(tick,1000);}
export async function startVideo(call,userId,mount){
  if(!config.videoEnabled)throw Error('Las videollamadas están deshabilitadas.');
  if(!call.started_at)throw Error('La llamada aún no tiene una hora real de inicio.');
  if(!window.isSecureContext||!navigator.mediaDevices)throw Error('Se requiere HTTPS y permiso de cámara y micrófono.');
  await stopVideo(false);localUser=userId;callId=call.id;activeCall=call;
  const root=$(mount);root.innerHTML=`<div class="row between"><p id="videoStatus">Solicitando permisos…</p><b id="videoTimer"></b></div><p id="videoWarning" class="error"></p><div class="video-grid"><video id="localVideo" autoplay playsinline muted></video><video id="remoteVideo" autoplay playsinline controls></video></div><div class="row"><button id="muteMic">Silenciar micrófono</button><button id="muteCamera">Apagar cámara</button><button id="finishRealCall" class="danger">Finalizar llamada</button></div><p class="small muted">CARLÉA no graba esta llamada. En redes restrictivas se requiere TURN configurado en producción.</p>`;
  startCountdown(call);
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:true,video:{width:{ideal:640},height:{ideal:480}}});
    if(callId!==call.id){stream.getTracks().forEach(t=>t.stop());return;}
    $('localVideo').srcObject=stream;pc=new RTCPeerConnection({iceServers:config.iceServers});for(const track of stream.getTracks())pc.addTrack(track,stream);
    pc.ontrack=e=>{if($('remoteVideo')){$('remoteVideo').srcObject=e.streams[0];$('remoteVideo').play().catch(()=>{});}};
    async function signal(kind,payload){if(callId!==call.id)return;checked(await sb.from('call_signals').insert({call_id:call.id,sender_id:userId,kind,payload}));}
    pc.onicecandidate=e=>{if(e.candidate)attempt(()=>signal('ice',e.candidate.toJSON()));};
    pc.onconnectionstatechange=()=>{if($('videoStatus'))$('videoStatus').textContent=({connected:'Conectados',connecting:'Conectando…',failed:'No se logró conectar. Prueba otra red o configura TURN.',disconnected:'Conexión interrumpida',closed:'Llamada finalizada'})[pc?.connectionState]||'Esperando al otro participante…';};
    async function consume(){if(processing||callId!==call.id||!pc)return;processing=true;try{const rows=checked(await sb.from('call_signals').select('*').eq('call_id',call.id).order('id'));for(const s of rows){if(seen.has(s.id)||s.sender_id===userId)continue;seen.add(s.id);if(s.kind==='offer'&&userId!==call.caller_id){await pc.setRemoteDescription(s.payload);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await signal('answer',answer);}else if(s.kind==='answer'&&userId===call.caller_id&&pc.signalingState==='have-local-offer')await pc.setRemoteDescription(s.payload);else if(s.kind==='ice')iceQueue.push(s.payload);if(pc.remoteDescription){while(iceQueue.length)await pc.addIceCandidate(iceQueue.shift());}}}catch(e){if($('videoStatus'))$('videoStatus').textContent='Error de conexión: '+e.message;}finally{processing=false;}}
    signalChannel=sb.channel('call-'+call.id+'-'+userId).on('postgres_changes',{event:'INSERT',schema:'public',table:'call_signals',filter:'call_id=eq.'+call.id},consume).subscribe();signalTimer=setInterval(consume,1500);
    if(userId===call.caller_id){const offer=await pc.createOffer();await pc.setLocalDescription(offer);await signal('offer',offer);}await consume();$('videoStatus').textContent='Esperando al otro participante…';
    $('muteMic').onclick=()=>{const t=stream.getAudioTracks()[0];t.enabled=!t.enabled;$('muteMic').textContent=t.enabled?'Silenciar micrófono':'Activar micrófono';};
    $('muteCamera').onclick=()=>{const t=stream.getVideoTracks()[0];t.enabled=!t.enabled;$('muteCamera').textContent=t.enabled?'Apagar cámara':'Activar cámara';};
    $('finishRealCall').onclick=()=>attempt(async()=>{await sb.rpc('finish_video_call',{p_call_id:call.id});await stopVideo(false);});
    watchdog=setTimeout(()=>{if(pc&&pc.connectionState!=='connected'&&$('videoStatus'))$('videoStatus').textContent='La conexión tarda demasiado. Comprueba que ambos entraron; si están en redes restrictivas, configura TURN.';},30000);
  }catch(e){await stopVideo(false);throw e;}
}
window.addEventListener('pagehide',()=>{stream?.getTracks().forEach(t=>t.stop());pc?.close();});
