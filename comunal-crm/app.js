/* ============================================
   COMUNAL CRM - App principal con Supabase
   ============================================ */

// Configuración
const SUPABASE_URL = window.SUPABASE_URL || localStorage.getItem('SUPABASE_URL') || '';
const SUPABASE_KEY = window.SUPABASE_KEY || localStorage.getItem('SUPABASE_KEY') || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  alert('Sistema no configurado. Contacta al administrador.');
  window.location.href = '/';
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Estado en memoria (cache de los datos)
let state = {
  user: null,
  profile: null,
  clients: [],
  orders: [],
  payments: [],
  products: [],
  pricelists: []
};

let currentOrderItems = [];
let editingOrderId = null;
let editingClientId = null;

/* ============================================
   AUTENTICACIÓN
   ============================================ */
async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/';
    return false;
  }
  state.user = session.user;

  // Cargar perfil
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();

  if (!profile) {
    // Crear perfil si no existe
    await supabase.from('user_profiles').insert({
      id: session.user.id,
      full_name: session.user.email.split('@')[0],
      role: 'admin' // primer usuario = admin
    });
    state.profile = { full_name: session.user.email.split('@')[0], role: 'admin' };
  } else {
    state.profile = profile;
  }

  document.getElementById('userName').textContent = state.profile.full_name || state.user.email;
  document.getElementById('userRole').textContent = state.profile.role;
  return true;
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = '/';
}

/* ============================================
   CARGAR DATOS DESDE SUPABASE
   ============================================ */
async function loadAllData() {
  try {
    const [clientsRes, ordersRes, paymentsRes, productsRes, pricelistsRes] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('orders').select('*').order('date', { ascending: false }),
      supabase.from('payments').select('*').order('date', { ascending: false }),
      supabase.from('products').select('*').order('name'),
      supabase.from('pricelists').select('*')
    ]);

    state.clients = clientsRes.data || [];
    state.orders = ordersRes.data || [];
    state.payments = paymentsRes.data || [];
    state.products = productsRes.data || [];
    state.pricelists = pricelistsRes.data || [];
  } catch (e) {
    console.error(e);
    toast('Error al cargar datos', 'error');
  }
}

/* ============================================
   UTILIDADES
   ============================================ */
const fmt = n => '$' + (Number(n)||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
const todayISO = () => new Date().toISOString().slice(0,10);
const addDays = (iso, days) => {
  const d = new Date(iso+'T00:00:00');
  d.setDate(d.getDate()+Number(days));
  return d.toISOString().slice(0,10);
};
const daysBetween = (iso1, iso2) => {
  const d1 = new Date(iso1+'T00:00:00');
  const d2 = new Date(iso2+'T00:00:00');
  return Math.round((d2-d1)/(1000*60*60*24));
};
const daysOverdue = iso => daysBetween(iso, todayISO());
const fmtDate = iso => {
  if (!iso) return '—';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'});
};

function toast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(()=>t.classList.remove('show'), 2500);
}

function closeModal(id) { document.getElementById(id).classList.remove('active'); }

/* ============================================
   CÁLCULOS
   ============================================ */
function orderTotal(o) {
  return (o.items||[]).reduce((s,i)=>s+(i.qty*i.price),0);
}
function orderPaid(orderId) {
  return state.payments.filter(p => p.order_id === orderId).reduce((s,p)=>s+Number(p.amount),0);
}
function orderBalance(o) { return Math.max(0, orderTotal(o) - orderPaid(o.id)); }
function orderStatus(o) {
  if (o.delivery_status === 'pendiente') return 'pendiente';
  const balance = orderBalance(o);
  if (balance <= 0.01) return 'pagado';
  if (o.due_date && daysOverdue(o.due_date) > 0) return 'vencido';
  return 'por_cobrar';
}
function clientBalance(clientId) {
  return state.orders
    .filter(o => o.client_id === clientId && o.delivery_status === 'entregado')
    .reduce((s,o)=>s+orderBalance(o), 0);
}
function statusBadge(status) {
  const map = {
    pendiente: ['badge-blue','Por entregar'],
    por_cobrar: ['badge-amber','Por cobrar'],
    vencido: ['badge-red','Vencido'],
    pagado: ['badge-green','Pagado']
  };
  const [cls, lbl] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${lbl}</span>`;
}

/* ============================================
   NAVEGACIÓN
   ============================================ */
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'logout') return;
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-'+btn.dataset.view).classList.add('active');
    renderView(btn.dataset.view);
  });
});

function renderView(v) {
  if (v==='hoy') renderToday();
  else if (v==='pedidos') renderOrders();
  else if (v==='cobranza') renderCobranza();
  else if (v==='clientes') renderClients();
}

/* ============================================
   VISTA: HOY
   ============================================ */
function renderToday() {
  const today = todayISO();
  document.getElementById('todayDate').textContent =
    new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  const totalReceivable = state.orders
    .filter(o => o.delivery_status === 'entregado')
    .reduce((s,o)=>s+orderBalance(o),0);
  const overdue = state.orders.filter(o =>
    o.delivery_status === 'entregado' && orderBalance(o) > 0.01 && o.due_date && daysOverdue(o.due_date) > 0
  );
  const totalOverdue = overdue.reduce((s,o)=>s+orderBalance(o),0);
  const todayCollected = state.payments.filter(p=>p.date===today).reduce((s,p)=>s+Number(p.amount),0);
  const monthStart = today.slice(0,7) + '-01';
  const monthSales = state.orders.filter(o=>o.date>=monthStart).reduce((s,o)=>s+orderTotal(o),0);

  document.getElementById('todayStats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Por cobrar</div><div class="stat-value">${fmt(totalReceivable)}</div></div>
    <div class="stat-card red"><div class="stat-label">Vencido</div><div class="stat-value">${fmt(totalOverdue)}</div><div class="stat-detail">${overdue.length} pedidos</div></div>
    <div class="stat-card green"><div class="stat-label">Cobrado hoy</div><div class="stat-value">${fmt(todayCollected)}</div></div>
    <div class="stat-card amber"><div class="stat-label">Vendido mes</div><div class="stat-value">${fmt(monthSales)}</div></div>
  `;

  // Por cobrar próximos
  const limit7 = addDays(today, 7);
  const upcoming = state.orders
    .filter(o => o.delivery_status==='entregado' && orderBalance(o)>0.01 && o.due_date && o.due_date<=limit7)
    .sort((a,b)=>(a.due_date||'').localeCompare(b.due_date||''));
  const cEl = document.getElementById('todayCollections');
  if (upcoming.length === 0) cEl.innerHTML = '<div class="empty"><span class="empty-emoji">✅</span>Nada pendiente</div>';
  else cEl.innerHTML = upcoming.slice(0,10).map(o => {
    const c = state.clients.find(x=>x.id===o.client_id);
    const od = daysOverdue(o.due_date);
    const tag = od>0 ? `<span class="badge badge-red">${od}d vencido</span>` : (od===0 ? '<span class="badge badge-amber">Hoy</span>' : `<span class="badge badge-blue">en ${-od}d</span>`);
    return `<div class="alert-row">
      <div class="alert-info">
        <div class="alert-name">${c?.name||'?'} ${tag}</div>
        <div class="alert-meta">${o.folio} · Vence ${fmtDate(o.due_date)}</div>
      </div>
      <div class="alert-amount">${fmt(orderBalance(o))}</div>
      <div class="alert-actions">
        ${c?.phone?`<button class="btn btn-sm btn-accent" onclick="sendWhatsAppReminder('${o.id}')">📱</button>`:''}
        <button class="btn btn-sm btn-success" onclick="quickPayment('${o.id}')">Pago</button>
      </div>
    </div>`;
  }).join('');

  // Entregas hoy
  const deliv = state.orders.filter(o => o.delivery_date === today && o.delivery_status === 'pendiente');
  const dEl = document.getElementById('todayDeliveries');
  if (deliv.length === 0) dEl.innerHTML = '<div class="empty"><span class="empty-emoji">☕</span>Sin entregas hoy</div>';
  else dEl.innerHTML = deliv.map(o => {
    const c = state.clients.find(x=>x.id===o.client_id);
    return `<div class="alert-row">
      <div class="alert-info">
        <div class="alert-name">${c?.name||'?'}</div>
        <div class="alert-meta">${o.folio} · ${(o.items||[]).length} productos</div>
      </div>
      <div class="alert-amount">${fmt(orderTotal(o))}</div>
      <div class="alert-actions">
        <button class="btn btn-sm btn-success" onclick="markDelivered('${o.id}')">Entregar</button>
      </div>
    </div>`;
  }).join('');
}

/* ============================================
   VISTA: PEDIDOS
   ============================================ */
function renderOrders() {
  const search = (document.getElementById('orderSearch').value||'').toLowerCase();
  let rows = [...state.orders];
  if (search) {
    rows = rows.filter(o => {
      const c = state.clients.find(x=>x.id===o.client_id);
      return `${o.folio} ${c?.name||''} ${c?.business||''}`.toLowerCase().includes(search);
    });
  }
  const tbody = document.getElementById('ordersTable');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><span class="empty-emoji">📋</span>Sin pedidos</div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(o => {
    const c = state.clients.find(x=>x.id===o.client_id);
    return `<tr>
      <td><span class="pill">${o.folio}</span></td>
      <td><div class="name">${c?.name||'?'}</div>${c?.business?`<div class="meta">${c.business}</div>`:''}</td>
      <td>${fmtDate(o.date)}</td>
      <td>${o.due_date?fmtDate(o.due_date):'—'}</td>
      <td class="amount">${fmt(orderTotal(o))}</td>
      <td class="amount" style="color:${orderBalance(o)>0?'var(--red)':'var(--green)'}">${fmt(orderBalance(o))}</td>
      <td>${statusBadge(orderStatus(o))}</td>
    </tr>`;
  }).join('');
}
document.getElementById('orderSearch').addEventListener('input', renderOrders);

/* ============================================
   VISTA: COBRANZA
   ============================================ */
function renderCobranza() {
  const rows = state.orders.filter(o => o.delivery_status==='entregado' && orderBalance(o) > 0.01);
  const total = rows.reduce((s,o)=>s+orderBalance(o),0);
  const overdue = rows.filter(o=>o.due_date && daysOverdue(o.due_date)>0);
  const overdueTotal = overdue.reduce((s,o)=>s+orderBalance(o),0);

  document.getElementById('cobranzaStats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total por cobrar</div><div class="stat-value">${fmt(total)}</div></div>
    <div class="stat-card red"><div class="stat-label">Vencido</div><div class="stat-value">${fmt(overdueTotal)}</div></div>
    <div class="stat-card amber"><div class="stat-label">Pedidos</div><div class="stat-value">${rows.length}</div></div>
    <div class="stat-card"><div class="stat-label">Clientes con saldo</div><div class="stat-value">${new Set(rows.map(o=>o.client_id)).size}</div></div>
  `;

  rows.sort((a,b)=>(a.due_date||'').localeCompare(b.due_date||''));
  const tbody = document.getElementById('cobranzaTable');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><span class="empty-emoji">✅</span>Nada por cobrar</div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(o => {
    const c = state.clients.find(x=>x.id===o.client_id);
    const od = o.due_date ? daysOverdue(o.due_date) : 0;
    let dayBadge;
    if (od > 20) dayBadge = `<span class="badge badge-red">+${od}d</span>`;
    else if (od > 0) dayBadge = `<span class="badge badge-amber">${od}d</span>`;
    else if (od === 0) dayBadge = `<span class="badge badge-amber">Hoy</span>`;
    else dayBadge = `<span class="badge badge-blue">en ${-od}d</span>`;

    return `<tr>
      <td><div class="name">${c?.name||'?'}</div>${c?.business?`<div class="meta">${c.business}</div>`:''}</td>
      <td><span class="pill">${o.folio}</span></td>
      <td>${fmtDate(o.due_date)}</td>
      <td>${dayBadge}</td>
      <td class="amount" style="color:var(--red)">${fmt(orderBalance(o))}</td>
      <td class="actions">
        ${c?.phone?`<button class="btn btn-sm btn-accent" onclick="sendWhatsAppReminder('${o.id}')">📱 Avisar</button>`:''}
        <button class="btn btn-sm btn-success" onclick="quickPayment('${o.id}')">Pago</button>
      </td>
    </tr>`;
  }).join('');
}

/* ============================================
   VISTA: CLIENTES
   ============================================ */
function renderClients() {
  const search = (document.getElementById('clientSearch').value||'').toLowerCase();
  let rows = [...state.clients];
  if (search) {
    rows = rows.filter(c => `${c.name} ${c.business||''} ${c.phone||''} ${c.email||''}`.toLowerCase().includes(search));
  }
  const tbody = document.getElementById('clientsTable');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><span class="empty-emoji">👤</span>Sin clientes</div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(c => {
    const balance = clientBalance(c.id);
    return `<tr>
      <td>
        ${c.group_name?`<div class="name">${c.group_name}${c.branch?` · ${c.branch}`:''}</div><div class="meta">${c.name}</div>`:`<div class="name">${c.name}</div>`}
      </td>
      <td>${c.business || '—'}</td>
      <td>
        ${c.phone?`<div class="meta">📱 ${c.phone}</div>`:''}
        ${c.email?`<div class="meta">✉️ ${c.email}</div>`:''}
      </td>
      <td class="amount" style="color:${balance>0?'var(--red)':'var(--ink-soft)'}">${fmt(balance)}</td>
      <td class="actions">
        <button class="btn btn-sm btn-ghost" onclick="editClient('${c.id}')">Editar</button>
      </td>
    </tr>`;
  }).join('');
}
document.getElementById('clientSearch').addEventListener('input', renderClients);

/* ============================================
   MODAL CLIENTE
   ============================================ */
function openClientModal() {
  editingClientId = null;
  document.getElementById('clientModalTitle').textContent = 'Nuevo cliente';
  ['clientName','clientBusiness','clientGroup','clientBranch','clientPhone','clientEmail','clientNotes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('clientTerms').value = '15';
  document.getElementById('clientPricelist').value = 'particular';
  document.getElementById('clientModal').classList.add('active');
}
function editClient(id) {
  const c = state.clients.find(x=>x.id===id);
  if (!c) return;
  editingClientId = id;
  document.getElementById('clientModalTitle').textContent = 'Editar cliente';
  document.getElementById('clientName').value = c.name||'';
  document.getElementById('clientBusiness').value = c.business||'';
  document.getElementById('clientGroup').value = c.group_name||'';
  document.getElementById('clientBranch').value = c.branch||'';
  document.getElementById('clientPhone').value = c.phone||'';
  document.getElementById('clientEmail').value = c.email||'';
  document.getElementById('clientTerms').value = c.terms||15;
  document.getElementById('clientPricelist').value = c.pricelist_id||'particular';
  document.getElementById('clientNotes').value = c.notes||'';
  document.getElementById('clientModal').classList.add('active');
}

async function saveClient() {
  const name = document.getElementById('clientName').value.trim();
  if (!name) { toast('El nombre es obligatorio','error'); return; }
  const data = {
    name,
    business: document.getElementById('clientBusiness').value.trim() || null,
    group_name: document.getElementById('clientGroup').value.trim() || null,
    branch: document.getElementById('clientBranch').value.trim() || null,
    phone: document.getElementById('clientPhone').value.trim() || null,
    email: document.getElementById('clientEmail').value.trim() || null,
    terms: Number(document.getElementById('clientTerms').value),
    pricelist_id: document.getElementById('clientPricelist').value,
    notes: document.getElementById('clientNotes').value.trim() || null
  };

  let result;
  if (editingClientId) {
    result = await supabase.from('clients').update(data).eq('id', editingClientId);
  } else {
    result = await supabase.from('clients').insert(data);
  }

  if (result.error) {
    toast('Error: ' + result.error.message, 'error');
    return;
  }

  await loadAllData();
  closeModal('clientModal');
  toast('Cliente guardado', 'success');
  renderView(currentView());
}

/* ============================================
   MODAL PEDIDO
   ============================================ */
function openOrderModal() {
  editingOrderId = null;
  currentOrderItems = [];
  const cSel = document.getElementById('orderClient');
  cSel.innerHTML = '<option value="">Selecciona cliente...</option>' +
    state.clients.map(c=>`<option value="${c.id}">${c.name}${c.business?' · '+c.business:''}</option>`).join('');
  document.getElementById('orderDate').value = todayISO();
  document.getElementById('orderDelivery').value = todayISO();
  document.getElementById('orderTerms').value = '15';
  document.getElementById('orderDelivStatus').value = 'pendiente';
  document.getElementById('orderNotes').value = '';
  renderOrderItems();
  document.getElementById('orderModal').classList.add('active');
}

function addOrderItem() {
  currentOrderItems.push({ name:'', qty:1, price:0 });
  renderOrderItems();
}
function removeOrderItem(i) {
  currentOrderItems.splice(i,1);
  renderOrderItems();
}
function setOrderItemField(i, f, v) {
  currentOrderItems[i][f] = f==='name' ? v : Number(v)||0;
  renderOrderItems();
}
function renderOrderItems() {
  const el = document.getElementById('orderItems');
  if (currentOrderItems.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--ink-soft);font-size:13px">Sin productos. Agrega uno abajo 👇</div>';
  } else {
    el.innerHTML = currentOrderItems.map((it,i) => `
      <div class="order-item">
        <input type="text" placeholder="Producto" value="${it.name||''}" oninput="setOrderItemField(${i},'name',this.value)">
        <input type="number" step="0.01" min="0" placeholder="Cant" value="${it.qty||1}" oninput="setOrderItemField(${i},'qty',this.value)">
        <input type="number" step="0.01" min="0" placeholder="Precio" value="${it.price||0}" oninput="setOrderItemField(${i},'price',this.value)">
        <div class="item-total">${fmt((it.qty||0)*(it.price||0))}</div>
        <button class="btn btn-icon btn-danger" onclick="removeOrderItem(${i})">✕</button>
      </div>
    `).join('');
  }
  const total = currentOrderItems.reduce((s,i)=>s+(i.qty||0)*(i.price||0),0);
  document.getElementById('orderTotal').textContent = fmt(total);
}

function nextFolio() {
  const year = new Date().getFullYear();
  const prefix = 'P-'+year+'-';
  const nums = state.orders
    .filter(o=>o.folio && o.folio.startsWith(prefix))
    .map(o=>parseInt(o.folio.slice(prefix.length))||0);
  return prefix + (Math.max(0,...nums)+1).toString().padStart(4,'0');
}

async function saveOrder() {
  const clientId = document.getElementById('orderClient').value;
  if (!clientId) { toast('Selecciona un cliente','error'); return; }
  if (currentOrderItems.length === 0) { toast('Agrega al menos un producto','error'); return; }
  if (currentOrderItems.some(i => !i.name || !i.qty || i.qty <= 0)) { toast('Productos con datos faltantes','error'); return; }

  const date = document.getElementById('orderDate').value || todayISO();
  const terms = Number(document.getElementById('orderTerms').value);
  const deliveryDate = document.getElementById('orderDelivery').value || date;
  const deliveryStatus = document.getElementById('orderDelivStatus').value;
  const baseDate = deliveryStatus === 'entregado' ? deliveryDate : date;

  const data = {
    folio: nextFolio(),
    client_id: clientId,
    date,
    delivery_date: deliveryDate,
    due_date: addDays(baseDate, terms),
    terms,
    delivery_status: deliveryStatus,
    items: currentOrderItems,
    notes: document.getElementById('orderNotes').value.trim() || null
  };

  const { error } = await supabase.from('orders').insert(data);
  if (error) { toast('Error: ' + error.message, 'error'); return; }

  await loadAllData();
  closeModal('orderModal');
  toast('Pedido guardado', 'success');
  renderView(currentView());
}

async function markDelivered(id) {
  const o = state.orders.find(x=>x.id===id);
  if (!o) return;
  const today = todayISO();
  const { error } = await supabase.from('orders').update({
    delivery_status: 'entregado',
    delivery_date: today,
    due_date: addDays(today, o.terms||0)
  }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  await loadAllData();
  toast('Marcado entregado', 'success');
  renderView(currentView());
}

/* ============================================
   MODAL PAGO
   ============================================ */
function openPaymentModal() {
  const cSel = document.getElementById('payClient');
  cSel.innerHTML = '<option value="">Selecciona cliente...</option>' +
    state.clients.map(c=>`<option value="${c.id}">${c.name}${c.business?' · '+c.business:''}</option>`).join('');
  document.getElementById('payDate').value = todayISO();
  document.getElementById('payAmount').value = '';
  document.getElementById('payRef').value = '';
  document.getElementById('payOrder').innerHTML = '<option value="">A cuenta</option>';
  document.getElementById('paymentModal').classList.add('active');
}

function quickPayment(orderId) {
  const o = state.orders.find(x=>x.id===orderId);
  if (!o) return;
  openPaymentModal();
  setTimeout(()=>{
    document.getElementById('payClient').value = o.client_id;
    updatePayOrders();
    document.getElementById('payOrder').value = orderId;
    document.getElementById('payAmount').value = orderBalance(o).toFixed(2);
  }, 50);
}

function updatePayOrders() {
  const cid = document.getElementById('payClient').value;
  const sel = document.getElementById('payOrder');
  if (!cid) { sel.innerHTML = '<option value="">A cuenta</option>'; return; }
  const orders = state.orders.filter(o => o.client_id === cid && o.delivery_status === 'entregado' && orderBalance(o) > 0.01);
  sel.innerHTML = '<option value="">A cuenta</option>' +
    orders.map(o=>`<option value="${o.id}">${o.folio} · ${fmt(orderBalance(o))}</option>`).join('');
}

async function savePayment() {
  const clientId = document.getElementById('payClient').value;
  const amount = Number(document.getElementById('payAmount').value);
  if (!clientId) { toast('Selecciona cliente','error'); return; }
  if (!amount || amount<=0) { toast('Monto inválido','error'); return; }

  const data = {
    client_id: clientId,
    order_id: document.getElementById('payOrder').value || null,
    amount,
    date: document.getElementById('payDate').value || todayISO(),
    method: document.getElementById('payMethod').value,
    reference: document.getElementById('payRef').value.trim() || null
  };

  const { error } = await supabase.from('payments').insert(data);
  if (error) { toast('Error: ' + error.message, 'error'); return; }

  await loadAllData();
  closeModal('paymentModal');
  toast('Pago registrado', 'success');
  renderView(currentView());
}

/* ============================================
   WHATSAPP
   ============================================ */
async function sendWhatsAppReminder(orderId) {
  const o = state.orders.find(x=>x.id===orderId);
  if (!o) return;
  const c = state.clients.find(x=>x.id===o.client_id);
  if (!c?.phone) { toast('Sin WhatsApp registrado','error'); return; }

  const balance = orderBalance(o);
  const od = o.due_date ? daysOverdue(o.due_date) : 0;
  let msg;
  if (od <= 0) {
    msg = `¡Hola ${c.name}! 😊\n\nTe recuerdo que el pedido ${o.folio} por $${balance.toLocaleString('es-MX')} vence el ${fmtDate(o.due_date)}.\n\nCualquier duda quedo a tus órdenes.\n\nSaludos,\nComunal`;
  } else if (od <= 7) {
    msg = `Hola ${c.name}, ¿cómo estás?\n\nQuería preguntarte si pudiste revisar el pago del pedido ${o.folio} por $${balance.toLocaleString('es-MX')}. Venció hace ${od} días.\n\n¡Gracias!\nComunal`;
  } else {
    msg = `Hola ${c.name},\n\nTe escribo para dar seguimiento al pago del pedido ${o.folio} por $${balance.toLocaleString('es-MX')}, con ${od} días de atraso.\n\n¿Podemos coordinar el pago?\n\nGracias,\nComunal`;
  }

  // Registrar mensaje
  await supabase.from('message_log').insert({
    client_id: c.id,
    order_id: o.id,
    channel: 'whatsapp',
    template: od <= 0 ? 'recordatorio' : (od <= 7 ? 'reciente' : 'medio'),
    message: msg,
    sent_by: state.user.id
  });

  const phone = c.phone.replace(/\D/g,'');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  toast('WhatsApp abierto','success');
}

/* ============================================
   MISC
   ============================================ */
function currentView() {
  const active = document.querySelector('.nav-btn.active');
  return active?.dataset.view || 'hoy';
}

document.querySelectorAll('.modal-backdrop').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('active'); });
});

/* ============================================
   INICIALIZACIÓN
   ============================================ */
async function init() {
  const ok = await checkAuth();
  if (!ok) return;
  await loadAllData();
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('app').style.display = 'grid';
  renderView('hoy');
}

init();
