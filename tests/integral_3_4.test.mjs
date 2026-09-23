import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../",import.meta.url);const read=p=>readFileSync(new URL(p,root),"utf8");
test("logo identity remains the same asset",()=>{const h=read("index.html");assert.match(h,/assets\/logo\.png/);assert.doesNotMatch(h,/corona|crown/i);});
test("manual payment never claims automatic charge",()=>{const a=read("js/app.js"),c=read("js/chat.js");assert.match(a,/pago será validado manualmente/i);assert.match(c,/pago será validado manualmente/i);assert.match(a,/PENDIENTE/);});
test("video packages and split are exact",()=>{const c=read("js/chat.js"),s=read("supabase/migrations/20260922123000_integral_carlea_3_4.sql");for(const n of [49900,79900,99900])assert.ok(c.includes(String(n).replace(/(\d)(?=(\d{3})+$)/g,"$1."))||s.includes(String(n)));assert.match(s,/round\(amount\*0\.20\)/);});
test("sensitive actions stay server-side",()=>{const w=read("_worker.js"),cfg=read("js/config.js");assert.match(w,/SUPABASE_SERVICE_ROLE_KEY/);assert.doesNotMatch(cfg,/SUPABASE_SERVICE_ROLE_KEY|service_role/);assert.match(w,/grant_type=password/);});
test("CARLEA does not mix training projects",()=>{for(const f of ["index.html","js/app.js","js/chat.js","styles.css"])assert.doesNotMatch(read(f),/\bSENDA\b|\bAMILECAP\b/i);});
