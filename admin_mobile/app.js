// admin_mobile/app.js
const API_BASE = '/.netlify/functions'; // replace with your functions base or proxy
const adminLoginUrl = API_BASE + '/admin-login';
const productsUrl = API_BASE + '/products';
const homepageUrl = API_BASE + '/homepage';
const imagesUrl = API_BASE + '/images';

const el = (id)=>document.getElementById(id);
let token = localStorage.getItem('admin_token') || null;

function authHeaders(){ return token?{ Authorization: 'Bearer ' + token } : {}; }

el('btnLogin').addEventListener('click', async ()=>{
  const email = el('email').value.trim();
  const password = el('password').value;
  const res = await fetch(adminLoginUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
  const j = await res.json();
  if (!res.ok) { el('loginMsg').textContent = j.error || 'Login failed'; return; }
  token = j.token; localStorage.setItem('admin_token', token);
  showDashboard();
});

function showDashboard(){
  el('login').classList.add('hidden');
  el('dashboard').classList.remove('hidden');
  el('viewport').innerHTML = '<p>Welcome, admin. Choose a section.</p>';
}

el('btnProducts').addEventListener('click', ()=> loadProducts());
el('btnHomepage').addEventListener('click', ()=> loadHomepage());
el('btnImages').addEventListener('click', ()=> loadImages());

async function loadProducts(){
  el('viewport').innerHTML = '<p>Loading…</p>';
  const res = await fetch(productsUrl, { headers: authHeaders() });
  const data = await res.json();
  const list = data.map(p=>`<div class="panel"><b>${p.name}</b><div>${p.slug}</div><button onclick="editProduct('${p.id}')">Edit</button></div>`).join('');
  el('viewport').innerHTML = `<div><button onclick="createProduct()">+ New product</button></div>${list}`;
}

window.editProduct = async function(id){
  const res = await fetch(productsUrl + '?id=' + id, { headers: authHeaders() });
  const p = await res.json();
  el('viewport').innerHTML = `<div class="panel"><h3>Edit</h3><input id="e_name" value="${p.name}" /><input id="e_slug" value="${p.slug}" /><textarea id="e_meta">${JSON.stringify(p.metadata||{})}</textarea><button onclick="saveProduct('${p.id}')">Save</button></div>`;
}

window.saveProduct = async function(id){
  const payload = { name: el('e_name').value, slug: el('e_slug').value, metadata: JSON.parse(el('e_meta').value || '{}') };
  const res = await fetch(productsUrl + '?id=' + id, { method:'PUT', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify(payload) });
  const j = await res.json();
  if (!res.ok) { alert('Error: ' + JSON.stringify(j)); return; }
  alert('Saved'); loadProducts();
}

window.createProduct = function(){
  el('viewport').innerHTML = `<div class="panel"><h3>Create product</h3><input id="c_name" placeholder="Name" /><input id="c_slug" placeholder="Slug" /><button onclick="doCreateProduct()">Create</button></div>`;
}

window.doCreateProduct = async function(){
  const payload = { name: el('c_name').value, slug: el('c_slug').value };
  const res = await fetch(productsUrl, { method:'POST', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify(payload) });
  const j = await res.json();
  if (!res.ok) { alert('Error: ' + JSON.stringify(j)); return; }
  alert('Created'); loadProducts();
}

async function loadHomepage(){
  el('viewport').innerHTML = '<p>Loading…</p>';
  const res = await fetch(homepageUrl, { headers: authHeaders() });
  const data = await res.json();
  const list = data.map(b=>`<div class="panel"><b>${b.block_type}</b><div>${JSON.stringify(b.data)}</div><button onclick="editBlock('${b.id}')">Edit</button></div>`).join('');
  el('viewport').innerHTML = `<div><button onclick="createBlock()">+ New block</button></div>${list}`;
}

window.editBlock = async function(id){
  const res = await fetch(homepageUrl + '?id=' + id, { headers: authHeaders() });
  const b = await res.json();
  el('viewport').innerHTML = `<div class="panel"><h3>Edit block</h3><input id="b_type" value="${b.block_type}" /><textarea id="b_data">${JSON.stringify(b.data||{})}</textarea><button onclick="saveBlock('${b.id}')">Save</button></div>`;
}

window.saveBlock = async function(id){
  const payload = { block_type: el('b_type').value, data: JSON.parse(el('b_data').value||'{}') };
  const res = await fetch(homepageUrl + '?id=' + id, { method:'PUT', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify(payload) });
  const j = await res.json(); if (!res.ok) { alert(JSON.stringify(j)); return; } alert('Saved'); loadHomepage();
}

window.createBlock = function(){ el('viewport').innerHTML = `<div class="panel"><h3>Create block</h3><input id="c_type" placeholder="block_type" /><textarea id="c_data" placeholder='{"title":"..."}'></textarea><button onclick="doCreateBlock()">Create</button></div>` };
window.doCreateBlock = async function(){ const payload = { block_type: el('c_type').value, data: JSON.parse(el('c_data').value||'{}') }; const res = await fetch(homepageUrl, { method:'POST', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify(payload) }); const j = await res.json(); if (!res.ok) { alert(JSON.stringify(j)); return; } alert('Created'); loadHomepage(); }

async function loadImages(){ el('viewport').innerHTML = '<p>Loading images…</p>'; const res = await fetch('/.netlify/functions/images', { headers: authHeaders() }); const data = await res.json(); el('viewport').innerHTML = data.map(i=>`<div class="panel"><img src="/storage/${i.storage_path}" style="width:100%"/><div>${i.filename}</div><button onclick="delImage('${i.id}')">Delete</button></div>`).join(''); }

window.delImage = async function(id){ if(!confirm('Delete?')) return; const res = await fetch(imagesUrl + '?id=' + id, { method:'DELETE', headers: authHeaders() }); const j = await res.json(); if(!res.ok) alert(JSON.stringify(j)); else loadImages(); }

// If token present, go direct to dashboard
if (token) showDashboard();
