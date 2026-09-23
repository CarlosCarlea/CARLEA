// Local UI smoke tests. Supabase is replaced by an explicit test double.
// No remote traffic, login, payment or write is performed.
// PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs node tests/browser.test.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const root = fileURLToPath(new URL("../", import.meta.url));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  const requested = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  );
  const target = path.resolve(
    root,
    "." + (requested === "/" ? "/index.html" : requested),
  );
  if (!target.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(target);
    res.writeHead(200, {
      "content-type": types[path.extname(target)] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
let cases = 0;
try {
  for (const width of [390, 1440])
    for (const mode of [
      "visitor",
      "free",
      "premium",
      "diamond",
      "unavailable",
      "admin",
      "creator",
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      await page.route("**/js/supabase-2.57.4.js", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: `
      const mode=${JSON.stringify(mode)};
      const user=mode==='visitor'?null:{id:'user-1',email:'synthetic@example.invalid',user_metadata:{}};
      const role=['admin','creator'].includes(mode)?mode:'user';
      const plan=['premium','diamond'].includes(mode)?mode:'free';
      const level={free:0,premium:1,diamond:2}[plan];
      const profile={id:'user-1',display_name:'Cuenta de prueba',email:'synthetic@example.invalid',role,status:'active',plan:'diamond'};
      const creator={id:'creator-1',stage_name:'Perfil de prueba',user_id:'creator-user',bio:'Datos sintéticos exclusivos de la prueba.',active:true,chat_open:true};
      const ent={schema_version:1,plan,valid_until:'2099-01-01T00:00:00Z',capabilities:{canMessage:level>=1,canSendText:level>=1,canReceiveText:level>=1,canAccessPremium:level>=1,canSendMedia:level>=2,canReceiveMedia:level>=2,canSendAudio:level>=2,canReceiveAudio:level>=2,canAccessDiamond:level>=2,canRequestVideoCall:level>=2}};
      window.testCalls=[];
      const chain=table=>{
        const query={singleRow:false,filters:[],operation:'select',
          select(){return this},order(){return this},limit(){return this},in(){return this},is(){return this},
          eq(k,v){this.filters.push([k,v]);return this},
          maybeSingle(){this.singleRow=true;return this},single(){this.singleRow=true;return this},
          insert(){this.operation='insert';return this},update(){this.operation='update';return this},
          then(resolve){
            window.testCalls.push({table,operation:this.operation});
            if(['platform_plans','platform_subscriptions','registration_details'].includes(table))throw Error('Obsolete table '+table);
            let data=[];
            if(table==='platform_settings')data={operator_name:'Operador de prueba',tax_id:'NO REAL',address:'No real',privacy_email:'test@example.invalid'};
            if(table==='profiles')data=this.singleRow?profile:[profile];
            if(table==='creators')data=this.singleRow?(this.filters.some(([k])=>k==='user_id')?(role==='creator'?creator:null):creator):[creator];
            if(table==='conversations')data=[{id:'conversation-1',user_id:'user-1',creators:creator}];
            if(table==='client_subscriptions')data=level?[{id:'sub-1',plan,status:'active',verified_at:'2026-09-01',ends_at:'2099-01-01',profiles:profile}]:[];
            return Promise.resolve({data,error:null}).then(resolve);
          }
        };return query;
      };
      const channel={on(){return this},subscribe(fn){if(fn)fn('SUBSCRIBED');return this}};
      window.supabase={createClient:()=>({
        auth:{getUser:async()=>({data:{user},error:null}),onAuthStateChange(){},signOut:async()=>({error:null})},
        from:chain,channel:()=>channel,removeChannel:async()=>{},
        rpc:async(name,args)=>{window.testCalls.push({rpc:name,args});
          if(name==='get_my_entitlements')return mode==='unavailable'?{error:{message:'Migration not applied'}}:{data:ent,error:null};
          if(name==='conversation_capabilities')return {data:{...ent.capabilities,media:level>=2,peer_name:'Perfil de prueba'},error:null};
          return {data:null,error:null};
        }
      })};
    `,
        }),
      );
      await page.goto(origin);
      await page.locator("#access").waitFor();
      await page.waitForFunction(
        () => document.getElementById("identity").textContent.length > 0,
      );
      await page.check("#age");
      await page.check("#consent");
      await page.click("#enter");
      await page.waitForSelector("[data-open]");
      await page.evaluate(() => (location.hash = "plans"));
      await page.waitForSelector('[data-subscribe="diamond"]');
      assert.equal(await page.locator(".plan").count(), 3);
      assert.match(await page.locator("#main").innerText(), /19\.900/);
      assert.match(await page.locator("#main").innerText(), /39\.900/);
      if (mode === "unavailable")
        assert.equal(await page.locator(".plan.selected").count(), 0);
      else
        assert.match(
          await page.locator(".plan.selected").innerText(),
          new RegExp(
            { premium: "Premium", diamond: "Diamante" }[mode] || "Gratis",
          ),
        );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        `overflow ${mode} ${width}`,
      );
      if (mode === "premium" || mode === "diamond") {
        await page.evaluate(() => (location.hash = "chat/conversation-1"));
        await page.waitForSelector("#compose");
        if (mode === "premium") {
          await page.click("#attach");
          await page.waitForSelector("#chatUpgrade");
          assert.match(
            await page.locator("#dialogBody").innerText(),
            /Diamante/,
          );
          await page.click("#closeDialog");
        }
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          true,
          `chat overflow ${mode} ${width}`,
        );
      }
      if (mode === "admin") {
        await page.evaluate(() => (location.hash = "admin/subscriptions"));
        await page.waitForFunction(() =>
          document
            .getElementById("adminBody")
            ?.textContent.includes("Revisión manual"),
        );
      }
      if (mode === "creator") {
        await page.evaluate(() => (location.hash = "studio"));
        await page.waitForSelector("#postForm");
      }
      if (mode === "visitor") {
        await page.click("#access");
        await page.click("#register");
        await page.waitForSelector("#registerForm");
        assert.equal(await page.locator('[name="adult"]').count(), 1);
        assert.equal(
          await page.locator('[name="confirm_password"]').count(),
          1,
        );
      }
      assert.deepEqual(errors, [], `${mode} ${width}: JavaScript errors`);
      const calls = await page.evaluate(() => window.testCalls);
      assert.equal(
        calls.some((c) => c.rpc === "request_global_subscription"),
        false,
      );
      cases++;
      await context.close();
    }
  console.log(
    `PASS: ${cases} mocked browser scenarios (390/1440px), no remote traffic. Not a Supabase integration test.`,
  );
} finally {
  await browser.close();
  server.close();
}
