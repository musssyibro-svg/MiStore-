const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs');
const ADMIN = fs.readFileSync(require('path').join(__dirname,'..','admin.html'),'utf8');
const PORT = 8492;
const ORIGIN = 'http://localhost:'+PORT;

// ---- in-memory DB ----
let seq = 100;
const uid = () => 'id-' + (++seq);
let bikes = [
  { id:'b1', name:'KUAILUZX SL', model:'SL', supplier:'X', sku:'SL-1', slug:'sl', status:'published', availability:'in_stock', featured:false, show_on_homepage:false, customer_price_ngn:1050000, specs:{motor:'1200W',voltage:'60V',top_speed:'55km/h'}, seo:{}, bike_images:[], updated_at:'2026-07-10T00:00:00Z' },
  { id:'b2', name:'Leilin H2', model:'H2', supplier:'Y', sku:'H2-1', slug:'h2', status:'draft', availability:'in_stock', featured:true, show_on_homepage:false, customer_price_ngn:null, specs:{motor:'2000W'}, seo:{}, bike_images:[], updated_at:'2026-07-10T00:00:00Z' },
  { id:'b3', name:'Old Bike', model:'OB', supplier:'Z', sku:'OB-1', slug:'ob', status:'archived', availability:'sold_out', featured:false, show_on_homepage:false, customer_price_ngn:800000, specs:{}, seo:{}, bike_images:[], updated_at:'2026-07-10T00:00:00Z' },
];
const categories = [ {id:'c1',name:'Electric Bikes',parent_id:null,position:0}, {id:'c2',name:'Electric Motorcycles',parent_id:null,position:1} ];

function body(req){ return new Promise(r=>{let d='';req.on('data',c=>d+=c);req.on('end',()=>{try{r(d?JSON.parse(d):{})}catch(e){r({})}})}); }
function send(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(obj)); }
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000001e221bc330000000049454e44ae426082','hex');

const server = http.createServer(async (req,res)=>{
  const u = new URL(req.url, ORIGIN); const p = u.pathname; const m = req.method;
  if(m==='OPTIONS'){ res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'*','Access-Control-Allow-Headers':'*'}); return res.end(); }
  if(p==='/admin.html' || p==='/'){
    const html = ADMIN.replace(/const SUPABASE_URL =[\s\S]*?;/, `const SUPABASE_URL = '${ORIGIN}';`)
                      .replace(/const SUPABASE_ANON_KEY =[\s\S]*?;/, `const SUPABASE_ANON_KEY = 'anon-test-key';`);
    res.writeHead(200,{'Content-Type':'text/html'}); return res.end(html);
  }
  if(p.startsWith('/storage/v1/object/public/')){ res.writeHead(200,{'Content-Type':'image/png'}); return res.end(PNG); }
  if(p==='/functions/v1/bikes'){
    if(m==='GET'){
      const id=u.searchParams.get('id');
      if(id){ const b=bikes.find(x=>x.id===id); return b?send(res,200,Object.assign({images:b.bike_images||[]},b)):send(res,404,{error:'not found'}); }
      let list=bikes.slice(); const q=(u.searchParams.get('q')||'').toLowerCase();
      if(q) list=list.filter(b=>[b.name,b.model,b.supplier,b.sku].some(v=>(v||'').toLowerCase().includes(q)));
      return send(res,200,{bikes:list});
    }
    if(m==='POST'){ const pl=await body(req); pl.id=uid(); pl.bike_images=[]; pl.updated_at=new Date().toISOString(); bikes.unshift(pl); return send(res,201,pl); }
    if(m==='PUT'||m==='PATCH'){ const id=u.searchParams.get('id'); const pl=await body(req); const b=bikes.find(x=>x.id===id); if(!b)return send(res,404,{error:'nf'}); Object.assign(b,pl); b.updated_at=new Date().toISOString(); return send(res,200,b); }
    if(m==='DELETE'){ const id=u.searchParams.get('id'); bikes=bikes.filter(x=>x.id!==id); return send(res,200,{ok:true}); }
  }
  if(p==='/functions/v1/bike-images'){ return send(res,200,{ok:true,id:uid()}); }
  if(p==='/rest/v1/bike_categories'){ return send(res,200,categories); }
  // catch-all: empty array/object so other tabs' loads don't throw
  return send(res,200,[]);
});

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}) });
  const page = await browser.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push('PE:'+e.message));
  // Stub window.supabase BEFORE any page script runs → logged-in session, no real network
  await page.addInitScript(()=>{
    const chain = new Proxy(function(){}, { get:(t,k)=>{ if(k==='then') return undefined; return (...a)=>chain; }, apply:()=>chain });
    const thenable = { then:(res)=>res({data:[],error:null}) };
    function q(){ return new Proxy(thenable, { get:(t,k)=> k in t ? t[k] : (()=>q()) }); }
    const user = { id:'u1', email:'admin@test' };
    const session = { user, access_token:'tok-123' };
    window.supabase = { createClient:()=>({
      auth:{
        onAuthStateChange:(cb)=>{ setTimeout(()=>cb('SIGNED_IN',session),0); return {data:{subscription:{unsubscribe(){}}}}; },
        getSession:()=>Promise.resolve({data:{session}}),
        getUser:()=>Promise.resolve({data:{user}}),
        signInWithPassword:()=>Promise.resolve({data:{session},error:null}),
        signUp:()=>Promise.resolve({data:{},error:null}),
        signOut:()=>Promise.resolve({error:null}),
      },
      from:()=>q(),
      channel:()=>({ on(){return this;}, subscribe(){return this;} }),
      removeChannel(){}, storage:{ from:()=>({ upload:()=>Promise.resolve({error:null}), remove:()=>Promise.resolve({error:null}), getPublicUrl:()=>({data:{publicUrl:''}}) }) },
    }) };
  });
  await page.goto(ORIGIN+'/admin.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1500);
  const R = {};
  // go to Bikes tab
  await page.evaluate(()=>{ const t=[...document.querySelectorAll('[data-tab]')].find(x=>x.dataset.tab==='bikeadmin'); t&&t.click(); });
  await page.waitForTimeout(800);
  R.listLoaded = await page.evaluate(()=>document.querySelectorAll('.bkAdmRow').length);
  R.filterCounts = await page.evaluate(()=>[...document.querySelectorAll('.bkAdmChip')].map(c=>c.textContent));
  // filter: Trash shows the archived bike
  await page.evaluate(()=>{ const c=[...document.querySelectorAll('.bkAdmChip')].find(x=>x.dataset.filter==='archived'); c&&c.click(); });
  await page.waitForTimeout(300);
  R.trashRows = await page.evaluate(()=>document.querySelectorAll('.bkAdmRow').length);
  R.trashHasRestore = await page.evaluate(()=>{ document.querySelector('.bkAdmRow').click(); return true; });
  await page.waitForTimeout(400);
  R.archivedFormHasRestore = await page.evaluate(()=>!!document.getElementById('bkAdmRestoreBtn'));
  R.archivedDeleteLabel = await page.evaluate(()=>{ const b=document.getElementById('bkAdmDeleteBtn'); return b?b.textContent:null; });
  // restore it
  await page.evaluate(()=>document.getElementById('bkAdmRestoreBtn').click());
  await page.waitForTimeout(500);
  // back to all, create a new bike
  await page.evaluate(()=>{ const c=[...document.querySelectorAll('.bkAdmChip')].find(x=>x.dataset.filter==='all'); c&&c.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.getElementById('bkAdmNewBtn').click());
  await page.waitForTimeout(300);
  await page.evaluate(()=>{ document.getElementById('bkfName').value='Test Rocket'; document.getElementById('bkfModel').value='TR'; document.getElementById('bkfPriceNgn').value='1234000'; document.getElementById('bkfAvailability').value='sold_out'; });
  await page.evaluate(()=>document.getElementById('bkAdmSaveBtn').click());
  await page.waitForTimeout(600);
  R.afterCreateName = await page.evaluate(()=>document.querySelector('.sechead')?document.querySelector('.sechead').textContent:'');
  // go back to list, confirm it's there and count grew
  await page.evaluate(()=>document.getElementById('bkAdmBack').click());
  await page.waitForTimeout(500);
  R.listAfterCreate = await page.evaluate(()=>document.querySelectorAll('.bkAdmRow').length);
  R.hasNewBike = await page.evaluate(()=>[...document.querySelectorAll('.bkAdmRowName')].some(x=>x.textContent.includes('Test Rocket')));
  R.soldOutBadge = await page.evaluate(()=>[...document.querySelectorAll('.bkAdmRow')].some(r=>r.textContent.includes('Test Rocket')&&r.querySelector('.bkAdmBadge.out')));
  // open an existing bike, test duplicate detection + duplicate button + preview
  await page.evaluate(()=>{ const r=[...document.querySelectorAll('.bkAdmRow')].find(x=>x.querySelector('.bkAdmRowName').textContent.includes('KUAILUZX SL')); r&&r.click(); });
  await page.waitForTimeout(400);
  R.dupDetect = await page.evaluate(()=>{ const n=document.getElementById('bkfName'); n.value='Leilin H2'; n.dispatchEvent(new Event('input')); const w=document.getElementById('bkfDupWarn'); return w.style.display!=='none'; });
  R.preview = await page.evaluate(()=>{ document.getElementById('bkAdmPreviewBtn').click(); return document.getElementById('bkPreviewModal').classList.contains('show'); });
  await page.evaluate(()=>document.getElementById('bkPreviewModal').classList.remove('show'));
  const before = bikes.length;
  await page.evaluate(()=>document.getElementById('bkAdmDupBtn').click());
  await page.waitForTimeout(600);
  R.duplicateCreated = (bikes.length===before+1) && bikes.some(b=>/\(copy\)/.test(b.name));
  R.errs = errs.slice(0,8);
  console.log(JSON.stringify(R,null,1));
  await browser.close(); server.close();
})();
